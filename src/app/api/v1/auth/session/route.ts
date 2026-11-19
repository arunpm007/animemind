import { NextResponse } from 'next/server';
import { AuthError, refresh } from '@/server/auth/service';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  readCookie,
  route,
  setAuthCookies,
} from '@/server/http/api';
import { RULES, clientIp, enforce } from '@/server/http/rate-limit';

/**
 * Silent re-authentication for the web app.
 *
 * Access tokens last 15 minutes. A server component cannot set cookies during
 * render, so it cannot refresh one itself — without this route the web app
 * simply signed the user out every quarter of an hour while a perfectly valid
 * 60-day refresh token sat unused in the cookie jar.
 *
 * A protected page with no access token but a refresh cookie bounces through
 * here, gets a new pair, and lands back where it was going. Failure falls
 * through to sign-in with the stale cookies cleared, so there is no loop.
 */
export const dynamic = 'force-dynamic';

/** Only same-site paths. An unvalidated `next` is an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export const GET = route(async ({ req }) => {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  const token = readCookie(req, REFRESH_COOKIE);

  if (!token) {
    return NextResponse.redirect(new URL('/sign-in', url.origin));
  }

  // Over the limit: back to sign-in without touching the cookies.
  try {
    await enforce(RULES.refreshPerIp, clientIp(req));
  } catch {
    return NextResponse.redirect(new URL('/sign-in', url.origin));
  }

  try {
    const result = await refresh({ refreshToken: token, client: 'web' });
    const res = NextResponse.redirect(new URL(next, url.origin));
    return setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken!,
      expiresIn: result.expiresIn,
    });
  } catch (err) {
    const res = NextResponse.redirect(new URL('/sign-in', url.origin));

    // Clear the cookies ONLY when the token is definitively dead — expired,
    // revoked, or replayed. Clearing on any error means a momentary database
    // blip permanently signs the user out: the cookie is gone, so every later
    // attempt short-circuits on "no token" and their perfectly valid 60-day
    // session becomes unreachable. A transient failure should cost one retry,
    // not the session.
    if (err instanceof AuthError) return clearAuthCookies(res);

    console.error('session refresh failed (transient):', err);
    return res;
  }
});
