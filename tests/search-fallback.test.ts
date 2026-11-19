/**
 * Search must survive the provider being down.
 *
 * This is not a hypothetical: Jikan mirrors MyAnimeList and was measured at
 * roughly 10% availability (1 success in 10 probes for by-id, 0 in 10 for
 * search) while MyAnimeList itself answered in about a second. Failing the
 * whole search screen because of that would make the app unusable for reasons
 * that have nothing to do with the user's own library.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { unscoped } from '@/server/db/client';
import { work } from '@/server/db/schema';
import { ProviderUnavailableError } from '@/server/providers/types';
import * as ingest from '@/server/services/ingest';
import { search } from '@/server/services/library';

const TAG = `fallback-${Date.now()}`;
const ids: string[] = [];

beforeAll(async () => {
  const db = unscoped();
  for (const [n, title] of [
    ['1', `Zeta Gundam ${TAG}`],
    ['2', `Gundam Wing ${TAG}`],
    ['3', `Cowboy Bebop ${TAG}`],
  ] as const) {
    const [row] = await db
      .insert(work)
      .values({
        provider: 'jikan',
        providerId: `${TAG}-${n}`,
        kind: 'tv',
        titleRomaji: title,
        titleEnglish: title,
        releaseStatus: 'finished',
        contentHash: `h${n}`,
      })
      .returning({ id: work.id });
    ids.push(row.id);
  }
});

afterAll(async () => {
  await unscoped().delete(work).where(inArray(work.id, ids));
  vi.restoreAllMocks();
});

/** Force the provider to behave as it does during a real outage. */
function providerDown() {
  vi.spyOn(ingest, 'defaultProvider').mockReturnValue({
    id: 'jikan',
    capabilities: { inlinesRelationMetadata: false, maxRequestsPerMinute: 50 },
    search: async () => {
      throw new ProviderUnavailableError('jikan', 'failed after 2 attempts');
    },
    getWork: async () => {
      throw new ProviderUnavailableError('jikan', 'down');
    },
    getRelations: async () => [],
    getEpisodes: async () => [],
  });
}

describe('search with the provider unavailable', () => {
  it('falls back to the local catalog and flags the result as degraded', async () => {
    providerDown();
    const { results, degraded } = await search(null, `Gundam ${TAG}`, 10);

    expect(degraded).toBe(true);
    expect(results.map((r) => r.title)).toEqual(
      expect.arrayContaining([`Zeta Gundam ${TAG}`, `Gundam Wing ${TAG}`]),
    );
    // Every token must match, so an unrelated title stays out.
    expect(results.map((r) => r.title)).not.toContain(`Cowboy Bebop ${TAG}`);
  });

  it('matches tokens in any order and out of sequence', async () => {
    // The real failure this guards: a single phrase ILIKE needs the words
    // adjacent, so "Wing Gundam" — or even "Gundam <tag>" against
    // "Gundam Wing <tag>" — silently returns nothing.
    providerDown();
    const reordered = await search(null, `Wing ${TAG} Gundam`, 10);
    expect(reordered.results.map((r) => r.title)).toContain(`Gundam Wing ${TAG}`);

    const partial = await search(null, `bebop ${TAG}`, 10);
    expect(partial.results.map((r) => r.title)).toEqual([`Cowboy Bebop ${TAG}`]);
  });

  it('returns an empty, still-degraded result when nothing local matches', async () => {
    providerDown();
    const { results, degraded } = await search(null, 'nothing-matches-this-xyzzy', 10);
    // `degraded` must stay true on an empty result, or the UI will claim
    // "no such anime exists" when it simply could not look.
    expect(results).toEqual([]);
    expect(degraded).toBe(true);
  });

  it('does not swallow a programming error as an outage', async () => {
    vi.spyOn(ingest, 'defaultProvider').mockReturnValue({
      id: 'jikan',
      capabilities: { inlinesRelationMetadata: false, maxRequestsPerMinute: 50 },
      search: async () => {
        throw new TypeError('bug in the normaliser');
      },
      getWork: async () => {
        throw new Error('x');
      },
      getRelations: async () => [],
      getEpisodes: async () => [],
    });
    // Only ProviderUnavailableError means "upstream is down". Catching
    // everything here would hide our own bugs behind a friendly message.
    await expect(search(null, 'anything', 5)).rejects.toThrow(TypeError);
  });
});

describe('signed-out (local-only) search', () => {
  it('answers from the local catalog without ever calling the provider', async () => {
    const providerSearch = vi.fn(async () => []);
    vi.spyOn(ingest, 'defaultProvider').mockReturnValue({
      id: 'jikan',
      capabilities: { inlinesRelationMetadata: false, maxRequestsPerMinute: 50 },
      search: providerSearch,
      getWork: async () => {
        throw new Error('must not be called');
      },
      getRelations: async () => [],
      getEpisodes: async () => [],
    });
    const { results, degraded } = await search(null, `Bebop ${TAG}`, 10, { useProvider: false });
    expect(providerSearch).not.toHaveBeenCalled();
    expect(degraded).toBe(false);
    expect(results.map((r) => r.title)).toEqual([`Cowboy Bebop ${TAG}`]);
  });
});
