import { syncRequest } from '@/contracts';
import { sync } from '@/server/services/sync';
import { authed, body, ok } from '@/server/http/api';

/**
 * Push and pull in one round trip. See src/contracts/sync.ts for the protocol
 * and the merge rules a client may rely on.
 */
export const POST = authed(async ({ req, actor }) => {
  const input = await body(req, syncRequest);
  return ok(await sync(actor, input));
});
