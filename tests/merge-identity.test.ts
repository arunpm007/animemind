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
import { findDuplicatePairs, mergeWorks } from '@/server/services/identity';

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

  it('never pairs two rows from the same provider', async () => {
    const a = await makeWork({ tag: 's1', romaji: `Same Provider ${TAG}`, provider: 'kitsu' });
    const b = await makeWork({ tag: 's2', romaji: `Same Provider ${TAG}`, provider: 'kitsu' });
    const pairs = await findDuplicatePairs();
    expect(pairs.some((p) => p.keeper === a && p.loser === b)).toBe(false);
  });
});
