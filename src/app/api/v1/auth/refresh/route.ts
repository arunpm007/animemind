import { NextResponse } from 'next/server';
import { refreshRequest } from '@/contracts';
import { refresh } from '@/server/auth/service';
import {
  REFRESH_COOKIE,
  body,
  ok,
  readCookie,
  route,
  setAuthCookies,
  unauthorized,
} from '@/server/http/api';

export const POST = route(async ({ req }) => {
  const input = await body(req, refreshRequest);
  // Mobile sends the token in the body; web has it only as a cookie.
  const token = input.refreshToken ?? readCookie(req, REFRESH_COOKIE);
  if (!token) throw unauthorized('No session to refresh.');

  const result = await refresh({ refreshToken: token, client: input.client });

  if (input.client !== 'web') return ok(result);

  const { refreshToken, ...safe } = result;
  return setAuthCookies(ok(safe) as NextResponse, {
    accessToken: result.accessToken,
    refreshToken: refreshToken!,
    expiresIn: result.expiresIn,
  });
});
