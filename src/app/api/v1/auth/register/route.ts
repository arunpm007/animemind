import { NextResponse } from 'next/server';
import { registerRequest } from '@/contracts';
import { register } from '@/server/auth/service';
import { body, ok, route, setAuthCookies } from '@/server/http/api';

export const POST = route(async ({ req }) => {
  const input = await body(req, registerRequest);
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
