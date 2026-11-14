/**
 * The dashboard's links must point somewhere.
 *
 * Regression for a logic bug that could not have worked: series slugs were
 * resolved only for works in the user's own library, then used for the two
 * sections that are by definition NOT in it — "new season available" and
 * "waiting on" list unowned successors. Every lookup missed, every slug came
 * back null, and because the card's only link rendered conditionally on that
 * slug, the whole row was inert. Clicking it did nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { asUser, unscoped } from '@/server/db/client';
import { account, series, userWork, work, workRelation } from '@/server/db/schema';
import { recomputeSeries } from '@/server/services/ingest';
import { getDashboard } from '@/server/services/library';
import type { Actor } from '@/server/http/api';

const TAG = `dash-${Date.now()}`;
const ids: string[] = [];
let actor: Actor;
let userId = '';

beforeAll(async () => {
  const db = unscoped();

  // Season 1 (finished, will be completed) -> Season 2 (aired, NOT owned).
  for (const [n, status] of [
    ['1', 'finished'],
    ['2', 'finished'],
  ] as const) {
    const [row] = await db
      .insert(work)
      .values({
        provider: 'kitsu',
        providerId: `${TAG}-${n}`,
        kind: 'tv',
        titleRomaji: `Dashboard Test S${n}`,
        episodeCount: 12,
        releaseStatus: status,
        startDate: `${2020 + Number(n)}-01-01`,
        contentHash: `h${n}`,
      })
      .returning({ id: work.id });
    ids.push(row.id);
  }

  await db
    .insert(workRelation)
    .values({ fromWorkId: ids[0], toWorkId: ids[1], kind: 'sequel' })
    .onConflictDoNothing();
  await db
    .insert(workRelation)
    .values({ fromWorkId: ids[1], toWorkId: ids[0], kind: 'prequel' })
    .onConflictDoNothing();

  await recomputeSeries(ids[0]);

  const [a] = await db
    .insert(account)
    .values({ email: `${TAG}@test.local`, passwordHash: 'x', displayName: 'Dash' })
    .returning();
  userId = a.id;
  actor = { userId: a.id, role: 'member', tier: 'free' };

  // Owns and has finished season 1 ONLY.
  await asUser(a.id, async (tx) => {
    await tx.insert(userWork).values({
      userId: a.id,
      workId: ids[0],
      status: 'completed',
      progress: 12,
      completedAt: new Date(),
    });
  });
});

afterAll(async () => {
  const db = unscoped();
  if (userId) await db.delete(account).where(eq(account.id, userId));
  const s = await db.query.series.findFirst({ where: eq(series.rootWorkId, ids[0]) });
  if (s) await db.delete(series).where(eq(series.id, s.id));
  await db.delete(work).where(inArray(work.id, ids));
});

describe('getDashboard', () => {
  it('surfaces the next season once the previous one is finished', async () => {
    const d = await getDashboard(actor);
    const next = d.newlyAvailable.find((n) => n.work.id === ids[1]);
    expect(next).toBeDefined();
    expect(next!.becauseYouFinished).toContain('Dashboard Test S1');
  });

  it('gives that card a link — it is unowned, which is exactly why it broke', async () => {
    const d = await getDashboard(actor);
    const next = d.newlyAvailable.find((n) => n.work.id === ids[1]);
    // Null here means the card renders with nothing clickable on it.
    expect(next!.seriesSlug).toBeTruthy();
    expect(next!.seriesSlug).toMatch(/^dashboard-test/);
  });

  it('still links the owned rows it always did', async () => {
    await asUser(actor.userId, async (tx) => {
      await tx
        .update(userWork)
        .set({ status: 'watching', progress: 3 })
        .where(eq(userWork.workId, ids[0]));
    });
    const d = await getDashboard(actor);
    const cont = d.continueWatching.find((c) => c.work.id === ids[0]);
    expect(cont?.seriesSlug).toBeTruthy();
    // restore
    await asUser(actor.userId, async (tx) => {
      await tx
        .update(userWork)
        .set({ status: 'completed', progress: 12 })
        .where(eq(userWork.workId, ids[0]));
    });
  });
});
