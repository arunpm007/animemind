/**
 * Sign-out and the session bounce, end to end through the real route handlers.
 *
 * Regressions from the 19 Nov QA:
 *   - an app client's sign-out (token in the JSON body) left the session alive;
 *   - the web form's sign-out stranded the user on a raw JSON page;
 *   - `/api/v1/auth/session?next=/\evil.example` redirected off-site.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { unscoped } from '@/server/db/client';
import { account } from '@/server/db/schema';
import { POST as registerRoute } from '@/app/api/v1/auth/register/route';
import { POST as refreshRoute } from '@/app/api/v1/auth/refresh/route';
import { POST as logoutRoute } from '@/app/api/v1/auth/logout/route';
import { GET as sessionRoute } from '@/app/api/v1/auth/session/route';

const ORIGIN = 'http://localhost:3000';
const stamp = Date.now();
let n = 0;

afterAll(async () => {
  await unscoped().delete(account).where(like(account.email, `signout-${stamp}-%`));
});

/** A fresh account; returns its refresh token (app-style, token in the body). */
async function newSession(): Promise<string> {
  const res = await registerRoute(
    new Request(`${ORIGIN}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': `10.9.${stamp % 200}.${n}` },
      body: JSON.stringify({
        email: `signout-${stamp}-${n++}@test.local`,
        password: 'correct horse battery staple',
        client: 'ios',
      }),
    }),
    undefined as never,
  );
  const body = (await res.json()) as { data: { refreshToken: string } };
  return body.data.refreshToken;
}

const refresh = (refreshToken: string) =>
  refreshRoute(
    new Request(`${ORIGIN}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '10.8.0.1' },
      body: JSON.stringify({ refreshToken, client: 'ios' }),
    }),
    undefined as never,
  );

describe('sign-out', () => {
  it('app client: token in the JSON body ends the session', async () => {
    const token = await newSession();
    const res = await logoutRoute(
      new Request(`${ORIGIN}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      }),
      undefined as never,
    );
    expect(res.status).toBe(200);
    expect((await refresh(token)).status).toBe(401);
  });

  it('web form: ends the session, clears cookies and redirects to sign-in', async () => {
    const token = await newSession();
    const res = await logoutRoute(
      new Request(`${ORIGIN}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `am_refresh=${encodeURIComponent(token)}`,
        },
        body: '',
      }),
      undefined as never,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in`);
    const cleared = res.headers.getSetCookie().join('\n');
    expect(cleared).toMatch(/am_access=;/);
    expect(cleared).toMatch(/am_refresh=;/);
    expect((await refresh(token)).status).toBe(401);
  });

  it('API caller with only a cookie still gets JSON', async () => {
    const token = await newSession();
    const res = await logoutRoute(
      new Request(`${ORIGIN}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { cookie: `am_refresh=${encodeURIComponent(token)}` },
      }),
      undefined as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect((await refresh(token)).status).toBe(401);
  });

  it('a junk body never crashes sign-out', async () => {
    const res = await logoutRoute(
      new Request(`${ORIGIN}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      undefined as never,
    );
    expect(res.status).toBe(200);
  });
});

describe('session bounce', () => {
  it('never redirects off-site, even with the backslash trick', async () => {
    const token = await newSession();
    const res = await sessionRoute(
      new Request(`${ORIGIN}/api/v1/auth/session?next=${encodeURIComponent('/\\evil.example')}`, {
        headers: { cookie: `am_refresh=${encodeURIComponent(token)}`, 'x-real-ip': '10.7.0.1' },
      }),
      undefined as never,
    );
    const location = res.headers.get('location') ?? '';
    expect(new URL(location).host).toBe('localhost:3000');
    expect(new URL(location).pathname).toBe('/');
  });

  it('keeps a legitimate on-site destination', async () => {
    const token = await newSession();
    const res = await sessionRoute(
      new Request(`${ORIGIN}/api/v1/auth/session?next=${encodeURIComponent('/library?tab=watching')}`, {
        headers: { cookie: `am_refresh=${encodeURIComponent(token)}`, 'x-real-ip': '10.7.0.2' },
      }),
      undefined as never,
    );
    expect(res.headers.get('location')).toBe(`${ORIGIN}/library?tab=watching`);
  });
});
