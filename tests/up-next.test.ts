/**
 * The backlog screen.
 *
 * Two things are being pinned down here, and the second is the subtle one.
 *
 * 1. The three buckets must be DISJOINT. They are built from different
 *    sources — two from the user's own rows, one from the series graph — and
 *    nothing stops a title qualifying for two of them except the filters. A
 *    season listed under both "ready to start" and "continue the series" is
 *    the same bug as the duplicate posters in the library, one screen over.
 *
 * 2. The roll-up is counted in EPISODES, not entries. "1 of 2 entries" of a
 *    1000-episode show reads as halfway, which is the kind of number that is
 *    worse than no number at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { asUser, unscoped } from '@/server/db/client';
import { account, series, seriesMember, userWork, work, workRelation } from '@/server/db/schema';
import { recomputeSeries } from '@/server/services/ingest';
import { getUpNext, listLibrarySeries } from '@/server/services/library';
import type { Actor } from '@/server/http/api';

const TAG = `upnext-${Date.now()}`;
let actor: Actor;
let userId = '';

/** Franchise A: four seasons, 12 episodes each. */
const A: string[] = [];
/** Franchise B: two seasons, the second with an unknown episode count. */
const B: string[] = [];
/** Standalone, planned and already out. */
let C = '';
/** Standalone, planned and NOT out. */
let D = '';
/** Franchise E: four aired seasons, several planned at once. */
const E: string[] = [];
/** Franchise F: one season plus an off-spine film. */
const F: string[] = [];
let FMovie = '';
/** Franchise G: qualifies for two buckets at once. */
const G: string[] = [];
/** Two retellings of one story, each the head of its own series. */
let H1 = '';
let H2 = '';

const db = () => unscoped();

async function makeWork(opts: {
  tag: string;
  title: string;
  episodeCount: number | null;
  releaseStatus: 'finished' | 'airing' | 'not_yet_aired';
  kind?: 'tv' | 'movie';
}) {
  const [row] = await db()
    .insert(work)
    .values({
      provider: 'kitsu',
      providerId: `${TAG}-${opts.tag}`,
      kind: opts.kind ?? 'tv',
      titleRomaji: opts.title,
      titleEnglish: opts.title,
      episodeCount: opts.episodeCount,
      releaseStatus: opts.releaseStatus,
      contentHash: `h-${TAG}-${opts.tag}`,
    })
    .returning({ id: work.id });
  return row.id;
}

/** Link a chain so recomputeSeries can derive a spine from it. */
async function chain(ids: string[]) {
  for (let i = 0; i < ids.length - 1; i += 1) {
    await db()
      .insert(workRelation)
      .values({ fromWorkId: ids[i], toWorkId: ids[i + 1], kind: 'sequel' })
      .onConflictDoNothing();
    await db()
      .insert(workRelation)
      .values({ fromWorkId: ids[i + 1], toWorkId: ids[i], kind: 'prequel' })
      .onConflictDoNothing();
  }
  await recomputeSeries(ids[0]);
}

beforeAll(async () => {
  for (let n = 1; n <= 4; n += 1) {
    A.push(
      await makeWork({
        tag: `a${n}`,
        title: `Alpha Saga S${n} ${TAG}`,
        episodeCount: 12,
        // The fourth is not out yet, so it can never be "available now".
        releaseStatus: n === 4 ? 'not_yet_aired' : 'finished',
      }),
    );
  }
  await chain(A);

  B.push(await makeWork({ tag: 'b1', title: `Beta Tale S1 ${TAG}`, episodeCount: 24, releaseStatus: 'finished' }));
  B.push(await makeWork({ tag: 'b2', title: `Beta Tale S2 ${TAG}`, episodeCount: null, releaseStatus: 'airing' }));
  await chain(B);

  C = await makeWork({ tag: 'c', title: `Gamma One ${TAG}`, episodeCount: 12, releaseStatus: 'finished' });
  await recomputeSeries(C);

  D = await makeWork({ tag: 'd', title: `Delta Soon ${TAG}`, episodeCount: 12, releaseStatus: 'not_yet_aired' });
  await recomputeSeries(D);

  for (let n = 1; n <= 4; n += 1) {
    E.push(
      await makeWork({
        tag: `e${n}`,
        title: `Epsilon Arc S${n} ${TAG}`,
        episodeCount: 12,
        releaseStatus: 'finished',
      }),
    );
  }
  await chain(E);

  F.push(
    await makeWork({
      tag: 'f1',
      title: `Zeta Story ${TAG}`,
      episodeCount: 12,
      releaseStatus: 'finished',
    }),
  );
  FMovie = await makeWork({
    tag: 'fm',
    title: `Zeta Story: The Film ${TAG}`,
    episodeCount: 1,
    releaseStatus: 'finished',
    kind: 'movie',
  });
  // An alternative version sits in the series but OFF the spine.
  await db()
    .insert(workRelation)
    .values([
      { fromWorkId: F[0], toWorkId: FMovie, kind: 'alternative_version' },
      { fromWorkId: FMovie, toWorkId: F[0], kind: 'alternative_version' },
    ])
    .onConflictDoNothing();
  await recomputeSeries(F[0]);

  for (let n = 1; n <= 3; n += 1) {
    G.push(
      await makeWork({
        tag: `g${n}`,
        title: `Theta Line S${n} ${TAG}`,
        episodeCount: 12,
        releaseStatus: 'finished',
      }),
    );
  }
  await chain(G);

  // The Fullmetal Alchemist shape: a 2003 adaptation and a later retelling,
  // each heading its own series and each appearing in the other's as an
  // alternative version. One work, two series, different spine status in each.
  H1 = await makeWork({
    tag: 'h1',
    title: `Iota Chronicle ${TAG}`,
    episodeCount: 51,
    releaseStatus: 'finished',
  });
  H2 = await makeWork({
    tag: 'h2',
    title: `Iota Chronicle: Rebuilt ${TAG}`,
    episodeCount: 64,
    releaseStatus: 'finished',
  });
  await db()
    .insert(workRelation)
    .values([
      { fromWorkId: H1, toWorkId: H2, kind: 'alternative_version' },
      { fromWorkId: H2, toWorkId: H1, kind: 'alternative_version' },
    ])
    .onConflictDoNothing();
  await recomputeSeries(H1);
  await recomputeSeries(H2);

  const [a] = await db()
    .insert(account)
    .values({ email: `${TAG}@test.local`, passwordHash: 'x' })
    .returning();
  userId = a.id;
  actor = { userId: a.id, role: 'member', tier: 'free' };

  await asUser(a.id, async (tx) => {
    await tx.insert(userWork).values([
      // Alpha: finished the first two. The third has aired and is NOT owned,
      // which is exactly the "continue the series" case.
      { userId: a.id, workId: A[0], status: 'completed', progress: 12 },
      { userId: a.id, workId: A[1], status: 'completed', progress: 12 },
      // Beta: started and stopped.
      { userId: a.id, workId: B[0], status: 'on_hold', progress: 5, lastWatchedAt: new Date() },
      // Gamma: intent stated, already out.
      { userId: a.id, workId: C, status: 'planned', progress: 0 },
      // Delta: intent stated, not out.
      { userId: a.id, workId: D, status: 'planned', progress: 0 },
      // Epsilon: finished the first, then planned THREE at once. This is the
      // shape that filled the page with one franchise.
      { userId: a.id, workId: E[0], status: 'completed', progress: 12 },
      { userId: a.id, workId: E[1], status: 'planned', progress: 0 },
      { userId: a.id, workId: E[2], status: 'planned', progress: 0 },
      { userId: a.id, workId: E[3], status: 'planned', progress: 0 },
      // Zeta: the season and its film, both planned.
      { userId: a.id, workId: F[0], status: 'planned', progress: 0 },
      { userId: a.id, workId: FMovie, status: 'planned', progress: 0 },
      // Theta: S1 finished and S2 never added (so S2 is a "continue the
      // series" candidate), while S3 was added as plan-to-watch. One series,
      // two buckets.
      { userId: a.id, workId: G[0], status: 'completed', progress: 12 },
      { userId: a.id, workId: G[2], status: 'planned', progress: 0 },
      // Both retellings planned. They are different shows, not one show twice.
      { userId: a.id, workId: H1, status: 'planned', progress: 0 },
      { userId: a.id, workId: H2, status: 'planned', progress: 0 },
    ]);
  });
});

afterAll(async () => {
  if (userId) await db().delete(account).where(eq(account.id, userId));
  const ids = [...A, ...B, C, D, ...E, ...F, FMovie, ...G, H1, H2].filter(Boolean);
  if (!ids.length) return;
  const members = await db()
    .select({ seriesId: seriesMember.seriesId })
    .from(seriesMember)
    .where(inArray(seriesMember.workId, ids));
  const seriesIds = [...new Set(members.map((m) => m.seriesId))];
  if (seriesIds.length) await db().delete(series).where(inArray(series.id, seriesIds));
  await db().delete(work).where(inArray(work.id, ids));
});

const titles = (rows: { work: { title: string } }[]) => rows.map((r) => r.work.title);
const mine = <T extends { work: { title: string } }>(rows: T[]) =>
  rows.filter((r) => r.work.title.includes(TAG));

describe('getUpNext buckets', () => {
  it('puts a stopped entry under Paused, with where it stopped', async () => {
    const { paused } = await getUpNext(actor);
    const row = mine(paused).find((r) => r.work.title.startsWith('Beta Tale S1'));
    expect(row).toBeDefined();
    expect(row!.progress).toBe(5);
  });

  it('puts an aired plan-to-watch under Ready to start', async () => {
    const { readyToStart } = await getUpNext(actor);
    expect(titles(mine(readyToStart))).toContain(`Gamma One ${TAG}`);
  });

  it('does NOT put an unaired plan-to-watch there — it is not actionable', async () => {
    const { readyToStart, notOutYet } = await getUpNext(actor);
    expect(titles(mine(readyToStart))).not.toContain(`Delta Soon ${TAG}`);
    // and it is accounted for rather than silently dropped
    expect(notOutYet).toBeGreaterThanOrEqual(1);
  });

  it('offers the next season of something finished, with why', async () => {
    const { continueSeries } = await getUpNext(actor);
    const row = mine(continueSeries).find((r) => r.work.title.startsWith('Alpha Saga S3'));
    expect(row).toBeDefined();
    // "follows Alpha Saga S2" — the row has to justify itself or it reads as
    // an advert for a show the user never asked about.
    expect(row!.reason).toContain('Alpha Saga S2');
  });

  it('never offers an unreleased season as watchable now', async () => {
    const { continueSeries, readyToStart, paused } = await getUpNext(actor);
    const all = [...continueSeries, ...readyToStart, ...paused];
    expect(titles(mine(all))).not.toContain(`Alpha Saga S4 ${TAG}`);
  });

  it('lists nothing twice across the three buckets', async () => {
    const { paused, readyToStart, continueSeries } = await getUpNext(actor);
    const ids = [...paused, ...readyToStart, ...continueSeries]
      .filter((r) => r.work.title.includes(TAG))
      .map((r) => r.work.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe('the franchise roll-up', () => {
  it('counts EPISODES across the whole spine, not entries', async () => {
    const { continueSeries } = await getUpNext(actor);
    const row = mine(continueSeries).find((r) => r.work.title.startsWith('Alpha Saga S3'))!;

    expect(row.entriesWatched).toBe(2);
    expect(row.entriesTotal).toBe(4);
    // Two finished seasons of twelve.
    expect(row.episodesWatched).toBe(24);
    expect(row.episodesTotal).toBe(48);
  });

  it('counts only what has aired as ready, so an unreleased season is excluded', async () => {
    const { continueSeries } = await getUpNext(actor);
    const row = mine(continueSeries).find((r) => r.work.title.startsWith('Alpha Saga S3'))!;
    // S3 has aired and is unowned; S4 is not out. One, not two.
    expect(row.availableNow).toBe(1);
  });

  it('refuses to give a total when any entry has no episode count', async () => {
    const rows = await listLibrarySeries(actor);
    const beta = rows.find((r) => r.title.includes('Beta'));
    expect(beta).toBeDefined();
    // S2 is airing with no count yet. Summing the known ones would report 24
    // as if it were the whole story, which is a confident lie; null lets the
    // UI say "?" instead.
    expect(beta!.episodesTotal).toBeNull();
    expect(beta!.episodesWatched).toBe(5);
  });

  it('carries the unknown total THROUGH to the backlog row', async () => {
    /**
     * Tested separately from listLibrarySeries on purpose.
     *
     * The roll-up was right and the row was wrong: getUpNext fell back with
     * `roll?.episodesTotal ?? w.episodeCount`, and `??` cannot distinguish
     * "this series has no known total" from "this work has no series". So a
     * null total silently became the single season's own episode count, and
     * the page displayed a confident 5/12 for a franchise whose length is
     * genuinely unknown. The service was never wrong; only the row was.
     */
    const { paused } = await getUpNext(actor);
    const beta = mine(paused).find((r) => r.work.title.startsWith('Beta Tale S1'))!;
    expect(beta.episodesTotal).toBeNull();
    // and not quietly replaced by this one entry's own count
    expect(beta.episodesTotal).not.toBe(24);
    expect(beta.episodesWatched).toBe(5);
  });

  it('credits a completed entry in full even if the counter was never ticked', async () => {
    // People mark a season watched without walking the stepper to 12.
    await asUser(userId, async (tx) => {
      await tx
        .update(userWork)
        .set({ status: 'completed', progress: 0 })
        .where(eq(userWork.workId, A[2]));
      await tx.insert(userWork).values({
        userId,
        workId: A[2],
        status: 'completed',
        progress: 0,
      }).onConflictDoNothing();
    });

    const rows = await listLibrarySeries(actor);
    const alpha = rows.find((r) => r.title.includes('Alpha'))!;
    // S1 and S2 at 12 each, plus S3 completed at progress 0 → credited 12.
    expect(alpha.episodesWatched).toBe(36);
  });
});

/**
 * A franchise is one decision, so it gets one row.
 *
 * Listing every qualifying entry put Bleach on the page four times over —
 * Thousand-Year Blood War parts 1 to 4, consecutive, each printing the same
 * "1 of 5 watched · 366/416 eps · 4 ready", because that line describes the
 * franchise and all four rows shared it. One fact, four rows, and every other
 * series pushed off the screen behind them.
 */
describe('one row per series', () => {
  it('collapses several planned seasons of one franchise into a single row', async () => {
    const { readyToStart } = await getUpNext(actor);
    const epsilon = mine(readyToStart).filter((r) => r.work.title.startsWith('Epsilon Arc'));
    expect(epsilon).toHaveLength(1);
  });

  it('offers the EARLIEST unwatched season, not an arbitrary one', async () => {
    const { readyToStart } = await getUpNext(actor);
    const row = mine(readyToStart).find((r) => r.work.title.startsWith('Epsilon Arc'))!;
    // S1 is finished, so the story continues at S2 — not S3 or S4, which are
    // equally "planned" and would be nonsense to start with.
    expect(row.work.title).toBe(`Epsilon Arc S2 ${TAG}`);
  });

  it('still says how much of the franchise is waiting', async () => {
    const { readyToStart } = await getUpNext(actor);
    const row = mine(readyToStart).find((r) => r.work.title.startsWith('Epsilon Arc'))!;
    // Collapsing must not hide the backlog, only stop repeating it.
    expect(row.availableNow).toBe(3);
    expect(row.entriesTotal).toBe(4);
  });

  it('keeps an off-spine film as its own row', async () => {
    // A film is a separate thing to decide about, not a later part of the
    // same one, so it does not fold into the season above it.
    const { readyToStart } = await getUpNext(actor);
    const zeta = mine(readyToStart).filter((r) => r.work.title.startsWith('Zeta Story'));
    expect(zeta).toHaveLength(2);
  });

  it('does not lend the spine roll-up to an entry that is not on it', async () => {
    const { readyToStart } = await getUpNext(actor);
    const film = mine(readyToStart).find((r) => r.work.title.includes('The Film'))!;
    // The film is one episode long and is counted in no spine. Showing the
    // season's totals here would state that the two are one story.
    expect(film.entriesTotal).toBe(1);
    expect(film.episodesTotal).toBe(1);
    expect(film.availableNow).toBe(0);
  });

  it('never puts one series in two buckets', async () => {
    // Theta qualifies twice over: S2 was never added and follows a finished
    // season, while S3 is sitting in plan-to-watch. Without a claim shared
    // across the buckets it would be listed once in each, which is the same
    // complaint one screen further down.
    const { readyToStart, continueSeries } = await getUpNext(actor);
    const inReady = mine(readyToStart).filter((r) => r.work.title.startsWith('Theta Line'));
    const inContinue = mine(continueSeries).filter((r) =>
      r.work.title.startsWith('Theta Line'),
    );
    expect(inReady.length + inContinue.length).toBe(1);
    // Stated intent outranks a suggestion, so it lands in Ready to start.
    expect(inReady).toHaveLength(1);
  });
});

/**
 * A work can belong to more than one series.
 *
 * Fullmetal Alchemist (2003) and Brotherhood each head their own series and
 * each appear in the other's as an alternative version. Resolving that with
 * `new Map(rows.map(...))` keeps whichever row the database happened to
 * return last, so a work could be read as on-spine (true of its own series)
 * while pointing at the other one's totals — and because both then hashed to
 * the same series, one of the two was collapsed away entirely.
 */
describe('a work that belongs to two series', () => {
  it('lists both retellings, not one', async () => {
    const { readyToStart } = await getUpNext(actor);
    const iota = mine(readyToStart).filter((r) => r.work.title.startsWith('Iota Chronicle'));
    expect(iota).toHaveLength(2);
  });

  it('gives each one its OWN length, not the other\u2019s', async () => {
    const { readyToStart } = await getUpNext(actor);
    const iota = mine(readyToStart).filter((r) => r.work.title.startsWith('Iota Chronicle'));
    const original = iota.find((r) => !r.work.title.includes('Rebuilt'))!;
    const rebuilt = iota.find((r) => r.work.title.includes('Rebuilt'))!;
    expect(original.episodesTotal).toBe(51);
    expect(rebuilt.episodesTotal).toBe(64);
  });
});
