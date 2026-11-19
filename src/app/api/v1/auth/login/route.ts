import { NextResponse } from 'next/server';
import { loginRequest } from '@/contracts';
import { login } from '@/server/auth/service';
import { body, ok, route, setAuthCookies } from '@/server/http/api';
import { RULES, clientIp, enforce } from '@/server/http/rate-limit';

export const POST = route(async ({ req }) => {
  const input = await body(req, loginRequest);
  await enforce(RULES.loginPerIp, clientIp(req));
  await enforce(RULES.loginPerEmail, input.email.trim());
  const result = await login(input);

  if (input.client !== 'web') return ok(result);

  const { refreshToken, ...safe } = result;
  return setAuthCookies(ok(safe) as NextResponse, {
    accessToken: result.accessToken,
    refreshToken: refreshToken!,
    expiresIn: result.expiresIn,
  });
});
