import { NextResponse } from 'next/server';
import { registerRequest } from '@/contracts';
import { register } from '@/server/auth/service';
import { signupsOpen } from '@/server/auth/config';
import { HttpError } from '@/server/http/api';
import { body, ok, route, setAuthCookies } from '@/server/http/api';
import { RULES, clientIp, enforce } from '@/server/http/rate-limit';

export const POST = route(async ({ req }) => {
  if (!signupsOpen()) {
    throw new HttpError('forbidden', 'New sign-ups are closed for now. You can try the demo instead.');
  }
  const input = await body(req, registerRequest);
  await enforce(RULES.registerPerIp, clientIp(req));
  const result = await register(input);

  if (input.client !== 'web') return ok(result);

  // Web keeps the refresh token in an httpOnly cookie the page's JS cannot
  // read, so it is stripped from the body rather than handed to the document.
  const { refreshToken, ...safe } = result;
  return setAuthCookies(ok(safe) as NextResponse, {
    accessToken: result.accessToken,
    refreshToken: refreshToken!,
    expiresIn: result.expiresIn,
  });
});
