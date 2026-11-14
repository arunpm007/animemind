import { z } from 'zod';
import { updateProfile } from '@/server/auth/service';
import { authed, body, ok } from '@/server/http/api';

const request = z.object({
  displayName: z.string().max(60).nullable(),
});

const handler = authed(async ({ req, actor }) => {
  const input = await body(req, request);
  const trimmed = input.displayName?.trim() || null;
  return ok(await updateProfile({ userId: actor.userId, displayName: trimmed }));
});

// PATCH is the honest verb; POST is accepted because the shared client helper
// speaks GET and POST only, and one endpoint is not worth a third method on it.
export const PATCH = handler;
export const POST = handler;
