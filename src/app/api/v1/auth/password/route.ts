import { z } from 'zod';
import { changePassword } from '@/server/auth/service';
import { REFRESH_COOKIE, authed, body, ok, readCookie } from '@/server/http/api';
import { RULES, enforce } from '@/server/http/rate-limit';

const request = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

export const POST = authed(async ({ req, actor }) => {
  const input = await body(req, request);
  await enforce(RULES.passwordPerUser, actor.userId);
  await changePassword({
    userId: actor.userId,
    ...input,
    // Keep THIS device signed in; every other session is revoked.
    keepSessionToken: readCookie(req, REFRESH_COOKIE) ?? undefined,
  });
  return ok({ ok: true });
});
