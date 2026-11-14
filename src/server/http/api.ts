import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import type { ApiError, ErrorCode } from '@/contracts';
import { AuthError } from '../auth/service';
import { verifyAccessToken } from '../auth/tokens';
import { ProviderNotFoundError, ProviderUnavailableError } from '../providers/types';

/**
 * The HTTP adapter. Its entire job is: parse -> call a service -> envelope.
 *
 * Business logic does not live here and must not. A service function takes a
 * typed input and an Actor and returns typed output; that is what lets the
 * same logic be reached by a route handler today and, if it is ever worth it,
 * by a worker or a native BFF without reimplementation.
 */

export interface Actor {
  userId: string;
  role: 'member' | 'admin';
  tier: 'free' | 'plus';
}

export const ACCESS_COOKIE = 'am_access';
export const REFRESH_COOKIE = 'am_refresh';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  provider_unavailable: 503,
  internal: 500,
};

export class HttpError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ApiError['details'],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Not found') => new HttpError('not_found', what);
export const unauthorized = (msg = 'Sign in to continue.') =>
  new HttpError('unauthorized', msg);

export function ok<T>(
  data: T,
  meta?: { cursor?: string | null; hasMore?: boolean; degraded?: boolean },
  init?: ResponseInit,
) {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, init);
}

export function fail(error: HttpError, requestId: string) {
  const body: { error: ApiError } = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      requestId,
    },
  };
  return NextResponse.json(body, { status: STATUS[error.code] });
}

/**
 * Map a thrown error onto the wire.
 *
 * Unknown errors are deliberately flattened to a generic message: an exception
 * string can carry a table name, a file path or a fragment of a query, and
 * none of that belongs in a client response. The detail goes to the log with
 * the request id so it can still be found.
 */
function toHttpError(err: unknown, requestId: string): HttpError {
  if (err instanceof HttpError) return err;

  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '_';
      (details[path] ??= []).push(issue.message);
    }
    return new HttpError('validation_failed', 'That request was not valid.', details);
  }

  if (err instanceof AuthError) {
    return err.code === 'email_taken'
      ? new HttpError('conflict', err.message)
      : new HttpError('unauthorized', err.message);
  }

  if (err instanceof ProviderNotFoundError) {
    return new HttpError('not_found', 'That title could not be found.');
  }

  if (err instanceof ProviderUnavailableError) {
    return new HttpError(
      'provider_unavailable',
      'The anime database is not responding right now. Your library is unaffected — try again shortly.',
    );
  }

  console.error(`[${requestId}]`, err);
  return new HttpError('internal', 'Something went wrong on our end.');
}

/* ───────────────────────────── identity ───────────────────────────── */

/**
 * Resolve the caller from either an Authorization header or a cookie.
 *
 * Mobile sends `Authorization: Bearer`; the web app sends a cookie it cannot
 * read from JS. Accepting both here is the whole reason there is no separate
 * mobile auth stack — the header is checked first so an explicit token always
 * beats a stale cookie in the same browser.
 */
export async function getActor(req: Request): Promise<Actor | null> {
  const header = req.headers.get('authorization');
  let token: string | null = null;

  if (header?.toLowerCase().startsWith('bearer ')) {
    token = header.slice(7).trim();
  } else {
    const cookie = req.headers.get('cookie') ?? '';
    const match = new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`).exec(cookie);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  return { userId: claims.sub, role: claims.role, tier: claims.tier };
}

export function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/* ───────────────────────────── handlers ───────────────────────────── */

type Handler<Ctx> = (args: {
  req: Request;
  ctx: Ctx;
  requestId: string;
}) => Promise<Response>;

/** Wrap a public route: error mapping, request id, no identity required. */
export function route<Ctx = unknown>(handler: Handler<Ctx>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const res = await handler({ req, ctx, requestId });
      res.headers.set('x-request-id', requestId);
      return res;
    } catch (err) {
      return fail(toHttpError(err, requestId), requestId);
    }
  };
}

/** Wrap an authenticated route. The actor is resolved before the body runs. */
export function authed<Ctx = unknown>(
  handler: (args: {
    req: Request;
    ctx: Ctx;
    actor: Actor;
    requestId: string;
  }) => Promise<Response>,
) {
  return route<Ctx>(async ({ req, ctx, requestId }) => {
    const actor = await getActor(req);
    if (!actor) throw unauthorized();
    return handler({ req, ctx, actor, requestId });
  });
}

/** Parse and validate a JSON body, or throw a 422 with field-level detail. */
export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError('bad_request', 'Expected a JSON body.');
  }
  return schema.parse(raw);
}

/** Parse and validate the query string. */
export function query<T>(req: Request, schema: ZodType<T>): T {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams));
}

/* ───────────────────────────── cookies ───────────────────────────── */

const isProd = process.env.NODE_ENV === 'production';

export function setAuthCookies(
  res: NextResponse,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
) {
  // The access cookie is readable by the server only. The refresh cookie is
  // additionally scoped to the refresh endpoint, so an XSS that somehow reads
  // one cookie still cannot mint new sessions from any other path.
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: tokens.expiresIn,
  });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 60 * 24 * 60 * 60,
  });
  return res;
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { path: '/api/v1/auth', maxAge: 0 });
  return res;
}
