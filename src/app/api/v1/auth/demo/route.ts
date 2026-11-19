import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientKind } from '@/contracts';
import { loginDemo } from '@/server/auth/service';
import { body, ok, route, setAuthCookies } from '@/server/http/api';
import { RULES, clientIp, enforce } from '@/server/http/rate-limit';

const request = z.object({ client: clientKind.default('web') });

/** "Try the demo": sign in to the shared demo account without a password. */
export const POST = route(async ({ req }) => {
  const input = await body(req, request);
  await enforce(RULES.demoPerIp, clientIp(req));
  const result = await loginDemo(input.client);

  if (input.client !== 'web') return ok(result);

  const { refreshToken, ...safe } = result;
  return setAuthCookies(ok(safe) as NextResponse, {
    accessToken: result.accessToken,
    refreshToken: refreshToken!,
    expiresIn: result.expiresIn,
  });
});
