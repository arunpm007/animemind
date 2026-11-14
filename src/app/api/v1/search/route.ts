import { searchQuery } from '@/contracts';
import { search } from '@/server/services/library';
import { getActor, ok, query, route } from '@/server/http/api';

// Search is available signed-out; the `inLibrary` flag simply comes back false.
export const GET = route(async ({ req }) => {
  const { q, limit } = query(req, searchQuery);
  const actor = await getActor(req);
  const { results, degraded } = await search(actor, q, limit);
  // `degraded` tells the client these came from our own catalog because the
  // provider was unreachable — so it can say so instead of implying this is
  // everything that exists.
  return ok(results, degraded ? { degraded } : undefined);
});
