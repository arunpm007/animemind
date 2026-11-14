/**
 * Cross-provider identity: the merge, and the matcher that feeds it.
 *
 * Two anime catalogs number the same show differently, so one anime can occupy
 * two rows. The series builder then lays both on the spine and the user sees
 * the same season listed twice, once as "Attack on Titan: The Final Season"
 * and once as "Attack on Titan Final Season".
 *
 * Merging them is the repair, and a merge rewrites watch history — which makes
 * it the single most dangerous operation in the app. The first test here is
 * the one that matters: `user_work` is under FORCE row-level security, so a
 * merge running without a user identity CANNOT SEE the rows it is supposed to
 * move, while `ON DELETE CASCADE` on the losing work deletes them anyway.
 * Silent, total loss of someone's progress, performed by the tool whose own
 * comments promise it will never cost anyone an episode.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { asUser, unscoped } from '@/server/db/client';
import { account, userWork, work } from '@/server/db/schema';
import { findDuplicatePairs, mergeWorks, resolveWorkId } from '@/server/services/identity';
import { upsertWork } from '@/server/services/ingest';

const TAG = `merge-${Date.now()}`;
const db = () => unscoped();

let userId = '';
const made: string[] = [];

async function makeWork(opts: {
  tag: string;
  romaji: string;
  english?: string | null;
  provider?: 'jikan' | 'kitsu';
  episodeCount?: number | null;
  kind?: 'tv' | 'movie';
  startDate?: string;
}) {
  const [row] = await db()
    .insert(work)
    .values({
      provider: opts.provider ?? 'kitsu',
      providerId: `${TAG}-${opts.tag}`,
      kind: opts.kind ?? 'tv',
      titleRomaji: opts.romaji,
      titleEnglish: opts.english ?? null,
      episodeCount: opts.episodeCount === undefined ? 12 : opts.episodeCount,
      startDate: opts.startDate ?? null,
      releaseStatus: 'finished',
      contentHash: `h-${TAG}-${opts.tag}`,
    })
    .returning({ id: work.id });
  made.push(row.id);
  return row.id;
}

beforeAll(async () => {
  const [a] = await db()
    .insert(account)
    .values({ email: `${TAG}@test.local`, passwordHash: 'x' })
    .returning();
  userId = a.id;
});

afterAll(async () => {
  if (userId) await db().delete(account).where(eq(account.id, userId));
  const alive = made.filter(Boolean);
  if (alive.length) await db().delete(work).where(inArray(work.id, alive));
});

/** What the user actually has, read through their own identity. */
async function held(workId: string) {
  return asUser(userId, async (tx) =>
    tx.query.userWork.findFirst({
      where: and(eq(userWork.userId, userId), eq(userWork.workId, workId)),
    }),
  );
}

describe('mergeWorks and the watch history it moves', () => {
  it('carries progress over when only the LOSING row is in the library', async () => {
    const keeper = await makeWork({ tag: 'k1', romaji: `Keep One ${TAG}` });
    const loser = await makeWork({ tag: 'l1', romaji: `Keep One ${TAG}`, provider: 'jikan' });

    await asUser(userId, async (tx) => {
      await tx.insert(userWork).values({
        userId,
        workId: loser,
        status: 'completed',
        progress: 12,
      });
    });

    await mergeWorks(keeper, loser);

    // Before the fix this was undefined: the merge could not see the row, and
    // deleting the losing work cascaded it out of existence.
    const after = await held(keeper);
    expect(after).toBeDefined();
    expect(after!.progress).toBe(12);
    expect(after!.status).toBe('completed');
  });

  it('never regresses progress when the user holds BOTH rows', async () => {
    const keeper = await makeWork({ tag: 'k2', romaji: `Keep Two ${TAG}` });
    const loser = await makeWork({ tag: 'l2', romaji: `Keep Two ${TAG}`, provider: 'jikan' });

    await asUser(userId, async (tx) => {
      await tx.insert(userWork).values([
        // The row being kept is the one that is FURTHER BEHIND, so a merge
        // that simply preferred the keeper would cost this user nine episodes.
        { userId, workId: keeper, status: 'watching', progress: 3, favorite: false },
        { userId, workId: loser, status: 'completed', progress: 12, favorite: true },
      ]);
    });

    await mergeWorks(keeper, loser);

    const after = await held(keeper);
    expect(after!.progress).toBe(12);
    expect(after!.status).toBe('completed');
    expect(after!.favorite).toBe(true);
    expect(await held(loser)).toBeUndefined();
  });
});

describe('findDuplicatePairs', () => {
  it('matches titles that differ only in punctuation or spacing', async () => {
    // The real pair, verbatim from the catalog. Kitsu drops the colon that
    // MyAnimeList writes, which was enough to hide the duplicate from an
    // exact-match comparison for as long as it existed.
    const a = await makeWork({
      tag: 'p1',
      romaji: 'Shingeki no Kyojin: The Final Season ' + TAG,
      provider: 'jikan',
      episodeCount: 16,
    });
    const b = await makeWork({
      tag: 'p2',
      romaji: 'Shingeki no Kyojin The Final Season ' + TAG,
      provider: 'kitsu',
      episodeCount: 16,
    });

    const pairs = await findDuplicatePairs();
    const found = pairs.find((p) => p.keeper === a && p.loser === b);
    expect(found).toBeDefined();
  });

  it('matches on the English title when the romaji ones differ', async () => {
    const a = await makeWork({
      tag: 'e1',
      romaji: `Totally Different Romaji ${TAG}`,
      english: `Shared English ${TAG}`,
      provider: 'jikan',
      episodeCount: 24,
    });
    const b = await makeWork({
      tag: 'e2',
      romaji: `Another Romaji Entirely ${TAG}`,
      english: `Shared English ${TAG}`,
      provider: 'kitsu',
      episodeCount: 24,
    });

    const pairs = await findDuplicatePairs();
    expect(pairs.some((p) => p.keeper === a && p.loser === b)).toBe(true);
  });

  it('refuses a pair whose episode counts disagree', async () => {
    // Season 1 and a 1-episode recap can share a title. Merging them would
    // destroy a real watch history to tidy the catalog.
    const a = await makeWork({
      tag: 'd1',
      romaji: `Risky Title ${TAG}`,
      provider: 'jikan',
      episodeCount: 25,
    });
    const b = await makeWork({
      tag: 'd2',
      romaji: `Risky Title ${TAG}`,
      provider: 'kitsu',
      episodeCount: 1,
    });

    const pairs = await findDuplicatePairs();
    expect(pairs.some((p) => p.keeper === a && p.loser === b)).toBe(false);
  });

  it('refuses a pair of different media, however alike the titles', async () => {
    const a = await makeWork({
      tag: 'm1',
      romaji: `Same Name ${TAG}`,
      provider: 'jikan',
      episodeCount: 1,
      kind: 'tv',
    });
    const b = await makeWork({
      tag: 'm2',
      romaji: `Same Name ${TAG}`,
      provider: 'kitsu',
      episodeCount: 1,
      kind: 'movie',
    });

    const pairs = await findDuplicatePairs();
    expect(pairs.some((p) => p.keeper === a && p.loser === b)).toBe(false);
  });

  it('refuses two seasons whose titles differ only by a symbol', async () => {
    // The live near-miss. The normaliser strips the ♭, so season 2 comes out
    // identical to season 1 — and lengths, the only other guard, do coincide
    // in real catalogs. Merging these would fold a whole season of watch
    // history into the one before it.
    const a = await makeWork({
      tag: 'y1',
      romaji: `Saenai Heroine no Sodatekata ${TAG}`,
      provider: 'jikan',
      episodeCount: 12,
      startDate: '2015-01-09',
    });
    const b = await makeWork({
      tag: 'y2',
      romaji: `Saenai Heroine no Sodatekata ♭ ${TAG}`,
      provider: 'kitsu',
      episodeCount: 12,
      startDate: '2017-04-07',
    });

    const pairs = await findDuplicatePairs();
    expect(pairs.some((p) => p.keeper === a && p.loser === b)).toBe(false);
  });

  it('still pairs one anime whose two rows agree on the year', async () => {
    const a = await makeWork({
      tag: 'y3',
      romaji: `Kimi no Shiranai ${TAG}`,
      provider: 'jikan',
      episodeCount: 13,
      startDate: '2019-04-06',
    });
    const b = await makeWork({
      tag: 'y4',
      romaji: `Kimi no Shiranai ${TAG}`,
      provider: 'kitsu',
      episodeCount: 13,
      // Providers disagree about the exact day; the year is what must match.
      startDate: '2019-04-07',
    });

    const pairs = await findDuplicatePairs();
    expect(pairs.some((p) => p.keeper === a && p.loser === b)).toBe(true);
  });

  it('never pairs two rows from the same provider', async () => {
    const a = await makeWork({ tag: 's1', romaji: `Same Provider ${TAG}`, provider: 'kitsu' });
    const b = await makeWork({ tag: 's2', romaji: `Same Provider ${TAG}`, provider: 'kitsu' });
    const pairs = await findDuplicatePairs();
    expect(pairs.some((p) => p.keeper === a && p.loser === b)).toBe(false);
  });
});

/**
 * A merge that does not survive the next crawl is not a merge.
 *
 * `resolveWorkId` falls back to the external-id table precisely because the
 * surviving row no longer carries the other provider's number. If nothing
 * claims that number, the next lookup finds nothing, inserts a fresh row, and
 * the duplicate is back — observed in the live catalog, where two Attack on
 * Titan rows were merged and a background relation walk recreated one of them
 * thirty-eight minutes later.
 */
describe('a merge stays merged', () => {
  it('makes the keeper answer to the loser\u2019s id', async () => {
    const keeper = await makeWork({ tag: 'r1', romaji: `Resolve Me ${TAG}` });
    const loser = await makeWork({
      tag: 'r2',
      romaji: `Resolve Me ${TAG}`,
      provider: 'jikan',
    });

    await mergeWorks(keeper, loser);

    // The id the losing row was known by must now lead to the survivor.
    expect(await resolveWorkId('jikan', `${TAG}-r2`)).toBe(keeper);
  });

  it('does not let the next ingest recreate the row it just absorbed', async () => {
    const keeper = await makeWork({ tag: 'r3', romaji: `Re-ingest ${TAG}` });
    const loser = await makeWork({
      tag: 'r4',
      romaji: `Re-ingest ${TAG}`,
      provider: 'jikan',
    });
    await mergeWorks(keeper, loser);

    // Exactly what a relation walk does when it meets that id again.
    const again = await upsertWork(
      {
        providerId: `${TAG}-r4`,
        kind: 'tv',
        titleRomaji: `Re-ingest ${TAG}`,
        titleEnglish: null,
        titleNative: null,
        synonyms: [],
        synopsis: null,
        coverUrl: null,
        bannerUrl: null,
        episodeCount: 12,
        durationMin: null,
        releaseStatus: 'finished',
        startDate: null,
        endDate: null,
        seasonYear: null,
        broadcastDow: null,
        broadcastTime: null,
        broadcastTz: null,
        genres: [],
        studios: [],
        score: null,
        popularity: null,
        raw: {},
      },
      'jikan',
    );

    expect(again.id).toBe(keeper);

    const rows = await db()
      .select({ id: work.id })
      .from(work)
      .where(inArray(work.providerId, [`${TAG}-r3`, `${TAG}-r4`]));
    expect(rows).toHaveLength(1);
  });

  it('keeps the surviving row\u2019s own provenance when another provider refreshes it', async () => {
    const keeper = await makeWork({ tag: 'r5', romaji: `Stable Id ${TAG}`, provider: 'kitsu' });
    const loser = await makeWork({ tag: 'r6', romaji: `Stable Id ${TAG}`, provider: 'jikan' });
    await mergeWorks(keeper, loser);

    await upsertWork(
      {
        providerId: `${TAG}-r6`,
        kind: 'tv',
        titleRomaji: `Stable Id ${TAG}`,
        titleEnglish: 'Refreshed',
        titleNative: null,
        synonyms: [],
        synopsis: null,
        coverUrl: null,
        bannerUrl: null,
        episodeCount: 12,
        durationMin: null,
        releaseStatus: 'finished',
        startDate: null,
        endDate: null,
        seasonYear: null,
        broadcastDow: null,
        broadcastTime: null,
        broadcastTz: null,
        genres: [],
        studios: [],
        score: null,
        popularity: null,
        raw: {},
      },
      'jikan',
    );

    const row = await db().query.work.findFirst({ where: eq(work.id, keeper) });
    // The data refreshed; the identity did not move to the other provider.
    expect(row!.titleEnglish).toBe('Refreshed');
    expect(row!.provider).toBe('kitsu');
    expect(row!.providerId).toBe(`${TAG}-r5`);
  });
});
