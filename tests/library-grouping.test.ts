/**
 * The library lists series, not entries.
 *
 * Regression for a presentation bug with a real cost: listing one row per work
 * put six near-identical Attack on Titan posters side by side, which reads as
 * duplicated data rather than as seasons. Thirteen rows represented five
 * franchises.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { asUser, unscoped } from '@/server/db/client';
import { account, series, userWork, work, workRelation } from '@/server/db/schema';
import { recomputeSeries } from '@/server/services/ingest';
import { listLibrarySeries } from '@/server/services/library';
import type { Actor } from '@/server/http/api';

const TAG = `group-${Date.now()}`;
const ids: string[] = [];
let actor: Actor;
let userId = '';

beforeAll(async () => {
  const db = unscoped();

  // A four-season franchise, with art on every entry.
  for (let n = 1; n <= 4; n += 1) {
    const [row] = await db
      .insert(work)
      .values({
        provider: 'kitsu',
        providerId: `${TAG}-${n}`,
        kind: 'tv',
        titleRomaji: `Grouping Test S${n}`,
        titleEnglish: `Grouping Test S${n}`,
        coverUrl: `https://media.kitsu.app/fake/${n}.jpg`,
        episodeCount: 12,
        releaseStatus: 'finished',
        startDate: `${2018 + n}-01-01`,
        contentHash: `h${n}`,
      })
      .returning({ id: work.id });
    ids.push(row.id);
  }

  for (let i = 0; i < ids.length - 1; i += 1) {
    await db
      .insert(workRelation)
      .values({ fromWorkId: ids[i], toWorkId: ids[i + 1], kind: 'sequel' })
      .onConflictDoNothing();
    await db
      .insert(workRelation)
      .values({ fromWorkId: ids[i + 1], toWorkId: ids[i], kind: 'prequel' })
      .onConflictDoNothing();
  }
  await recomputeSeries(ids[0]);

  const [a] = await db
    .insert(account)
    .values({ email: `${TAG}@test.local`, passwordHash: 'x' })
    .returning();
  userId = a.id;
  actor = { userId: a.id, role: 'member', tier: 'free' };

  // Owns THREE of the four: first two finished, third in progress.
  await asUser(a.id, async (tx) => {
    await tx.insert(userWork).values([
      { userId: a.id, workId: ids[0], status: 'completed', progress: 12 },
      { userId: a.id, workId: ids[1], status: 'completed', progress: 12 },
      {
        userId: a.id,
        workId: ids[2],
        status: 'watching',
        progress: 5,
        lastWatchedAt: new Date(),
      },
    ]);
  });
});

afterAll(async () => {
  const db = unscoped();
  if (userId) await db.delete(account).where(eq(account.id, userId));
  const s = await db.query.series.findFirst({ where: eq(series.rootWorkId, ids[0]) });
  if (s) await db.delete(series).where(eq(series.id, s.id));
  await db.delete(work).where(inArray(work.id, ids));
});

describe('listLibrarySeries', () => {
  it('collapses three owned entries into ONE row', async () => {
    const rows = await listLibrarySeries(actor);
    const mine = rows.filter((r) => r.title.startsWith('Grouping Test'));
    expect(mine).toHaveLength(1);
    expect(mine[0].ownedEntries).toBe(3);
  });

  it('counts the whole spine, not just what is owned', async () => {
    // "Season 3 of 4" is only meaningful if the 4 includes the season the
    // user has not added yet.
    const [row] = (await listLibrarySeries(actor)).filter((r) =>
      r.title.startsWith('Grouping Test'),
    );
    expect(row.totalEntries).toBe(4);
    expect(row.completedEntries).toBe(2);
  });

  it('reports the entry actually in progress', async () => {
    const [row] = (await listLibrarySeries(actor)).filter((r) =>
      r.title.startsWith('Grouping Test'),
    );
    expect(row.current?.ord).toBe(3);
    expect(row.current?.progress).toBe(5);
    expect(row.status).toBe('watching');
  });

  it('uses the FIRST spine entry for the poster', async () => {
    // The season people picture when they hear the name, not whichever
    // happened to be added first.
    const [row] = (await listLibrarySeries(actor)).filter((r) =>
      r.title.startsWith('Grouping Test'),
    );
    expect(row.coverUrl).toContain('/fake/1.jpg');
  });

  it('flags that a later aired entry is missing from the library', async () => {
    const [row] = (await listLibrarySeries(actor)).filter((r) =>
      r.title.startsWith('Grouping Test'),
    );
    expect(row.hasUnwatchedNext).toBe(true);
  });

  it('NAMES what is missing, not just how many', async () => {
    // "2 of 4" tells someone something is absent without telling them what,
    // which is the half of the message they can act on.
    const [row] = (await listLibrarySeries(actor)).filter((r) =>
      r.title.startsWith('Grouping Test'),
    );
    expect(row.missingEntries).toHaveLength(1);
    expect(row.missingEntries[0].title).toBe('Grouping Test S4');
    expect(row.missingEntries[0].ord).toBe(4);
  });
});
