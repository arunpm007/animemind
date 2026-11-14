import { NextResponse } from 'next/server';
import { logout } from '@/server/auth/service';
import { REFRESH_COOKIE, clearAuthCookies, ok, readCookie, route } from '@/server/http/api';

export const POST = route(async ({ req }) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (token) await logout(token);
  return clearAuthCookies(ok({ ok: true }) as NextResponse);
});
