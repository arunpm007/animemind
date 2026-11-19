import { NextResponse } from 'next/server';
import { logout } from '@/server/auth/service';
import { REFRESH_COOKIE, clearAuthCookies, ok, readCookie, route } from '@/server/http/api';

/**
 * Sign out: revoke the session family server-side, then clear the cookies.
 *
 * Two kinds of caller:
 *   - App clients keep their refresh token themselves and send it in a JSON
 *     body ({ refreshToken }). Previously the body was ignored, so an app's
 *     "sign out" left its session alive for the full 60 days.
 *   - The web app holds the token in an httpOnly cookie and signs out with a
 *     plain HTML form (works without JavaScript). A form post is answered with
 *     a redirect to the sign-in page, not a JSON body the user would be left
 *     staring at.
 */
export const POST = route(async ({ req }) => {
  const contentType = req.headers.get('content-type') ?? '';
  const fromForm =
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data');

  let bodyToken: string | undefined;
  if (contentType.includes('application/json')) {
    const parsed = (await req.json().catch(() => null)) as { refreshToken?: unknown } | null;
    if (typeof parsed?.refreshToken === 'string' && parsed.refreshToken) {
      bodyToken = parsed.refreshToken;
    }
  }

  const token = bodyToken ?? readCookie(req, REFRESH_COOKIE);
  if (token) await logout(token);

  if (fromForm) {
    // 303: the browser follows with a GET, so a refresh never re-submits.
    const res = NextResponse.redirect(new URL('/sign-in', req.url), 303);
    return clearAuthCookies(res);
  }
  return clearAuthCookies(ok({ ok: true }) as NextResponse);
});
