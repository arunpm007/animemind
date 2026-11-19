import { z } from 'zod';
import { RULES, enforce } from '@/server/http/rate-limit';
import { watchState } from '@/contracts';
import { addToLibrary, listLibrary } from '@/server/services/library';
import { authed, body, ok, query } from '@/server/http/api';

export const GET = authed(async ({ req, actor }) => {
  const { status } = query(req, z.object({ status: watchState.optional() }));
  return ok(await listLibrary(actor, { status }));
});

/**
 * Either identifier works, and `workId` is preferred.
 *
 * `/search` returns `work.id`, so a client that just searched already holds
 * the internal id and adding touches no network. `providerId` stays supported
 * for a client that only has a MyAnimeList id — but it costs a provider
 * round-trip, which fails when the provider is down.
 */
const addRequest = z
  .object({
    /** Our internal uuid, as returned by /search. Preferred. */
    workId: z.string().uuid().optional(),
    /** A MyAnimeList id. Used only when workId is absent. */
    providerId: z.string().min(1).optional(),
    status: watchState.optional(),
    progress: z.number().int().min(0).optional(),
  })
  .refine((v) => v.workId || v.providerId, {
    message: 'Provide either workId or providerId.',
  });

export const POST = authed(async ({ req, actor }) => {
  // Adding shares the sync budget: both write to the same tables.
  await enforce(RULES.syncPerUser, actor.userId);
  const input = await body(req, addRequest);
  return ok(await addToLibrary(actor, input), undefined, { status: 201 });
});
