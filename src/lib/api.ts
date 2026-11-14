'use client';

import type { ApiError } from '@/contracts';

/**
 * Browser-side API client.
 *
 * Deliberately the same shape a React Native client would use: one envelope,
 * one error type, one place that knows about transport. The only web-specific
 * line is `credentials: 'include'`, because the browser holds its token in an
 * httpOnly cookie while a native client would attach a bearer header here.
 */

export class ApiRequestError extends Error {
  constructor(public readonly payload: ApiError) {
    super(payload.message);
    this.name = 'ApiRequestError';
  }
}

export interface Envelope<T> {
  data: T;
  meta?: { cursor?: string | null; hasMore?: boolean; degraded?: boolean };
}

/**
 * In-flight refresh, shared by every caller.
 *
 * Access tokens last 15 minutes, so a page left open will hit 401 on its next
 * write — and without this, marking an episode after a coffee break silently
 * failed and the tick reverted.
 *
 * The single-flight lock is not optional. Refresh tokens ROTATE and a reused
 * one is treated as theft, revoking the whole session family. Two tabs (or two
 * parallel fetches) refreshing at once would race, the loser would present an
 * already-rotated token, and the server would correctly sign the user out
 * everywhere. One shared promise makes that impossible.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: 'web' }),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Clear on the next tick so simultaneous callers all observe this run
      // rather than starting a second one.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  { allowRetry = true } = {},
): Promise<Envelope<T>> {
  let res = await send(path, init);

  // A 401 on a page that was working means the short-lived access token aged
  // out, not that the user is signed out. Refresh once and retry before
  // surfacing anything; the refresh endpoint itself is excluded to avoid a loop.
  if (res.status === 401 && allowRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) res = await send(path, init);
  }

  const body = (await res.json().catch(() => null)) as
    | Envelope<T>
    | { error: ApiError }
    | null;

  if (!body) {
    throw new ApiRequestError({ code: 'internal', message: 'Malformed response.' });
  }
  if ('error' in body) throw new ApiRequestError(body.error);
  return body;
}

export const api = {
  /** Just the payload — the common case. */
  get: <T>(path: string) => request<T>(path).then((e) => e.data),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) }).then(
      (e) => e.data,
    ),
  /** Payload plus meta, for callers that care about `degraded` or paging. */
  getEnvelope: <T>(path: string) => request<T>(path),
};
