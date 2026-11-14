/**
 * Integration tests for series computation against the real database.
 *
 * The depth test exists because of a live bug: the recursive CTE that gathers
 * a franchise capped at 4 hops, so Attack on Titan's six-entry sequel chain
 * lost its two newest seasons. Nothing threw, nothing logged — the series page
 * simply ended early. For a product whose entire purpose is "is there another
 * season?", quietly dropping the newest season is the worst failure it has.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { unscoped } from '@/server/db/client';
import { series, seriesMember, work, workRelation } from '@/server/db/schema';
import { recomputeSeries } from '@/server/services/ingest';
import type { RawWork } from '@/server/providers/types';

const TAG = `depthtest-${Date.now()}`;
const CHAIN = 9; // deliberately longer than any limit we might be tempted to set

const ids: string[] = [];
let rootId = '';

const raw = (n: number): RawWork => ({
  providerId: `${TAG}-${n}`,
  kind: 'tv',
  titleRomaji: `Chain Season ${n}`,
  titleEnglish: null,
  titleNative: null,
  synonyms: [],
  synopsis: null,
  coverUrl: null,
  bannerUrl: null,
  episodeCount: 12,
  durationMin: 24,
  releaseStatus: 'finished',
  startDate: `${2010 + n}-01-01`,
  endDate: null,
  seasonYear: 2010 + n,
  broadcastDow: null,
  broadcastTime: null,
  broadcastTz: null,
  genres: [],
  studios: [],
  score: null,
  popularity: null,
  raw: {},
});

beforeAll(async () => {
  const db = unscoped();
  for (let n = 1; n <= CHAIN; n += 1) {
    const r = raw(n);
    const [row] = await db
      .insert(work)
      .values({
        provider: 'jikan',
        providerId: r.providerId,
        kind: r.kind,
        titleRomaji: r.titleRomaji,
        episodeCount: r.episodeCount,
        releaseStatus: r.releaseStatus,
        startDate: r.startDate,
        contentHash: `h${n}`,
      })
      .returning({ id: work.id });
    ids.push(row.id);
  }
  rootId = ids[0];

  for (let i = 0; i < ids.length - 1; i += 1) {
    // Both directions, as a provider emits them.
    await db
      .insert(workRelation)
      .values({ fromWorkId: ids[i], toWorkId: ids[i + 1], kind: 'sequel' })
      .onConflictDoNothing();
    await db
      .insert(workRelation)
      .values({ fromWorkId: ids[i + 1], toWorkId: ids[i], kind: 'prequel' })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  const db = unscoped();
  const s = await db.query.series.findFirst({ where: eq(series.rootWorkId, rootId) });
  if (s) await db.delete(series).where(eq(series.id, s.id));
  await db.delete(work).where(inArray(work.id, ids));
});

describe('recomputeSeries', () => {
  it('keeps the WHOLE chain, however long the franchise runs', async () => {
    const db = unscoped();
    const seriesId = await recomputeSeries(rootId);

    const members = await db
      .select({ ord: seriesMember.spineOrd, workId: seriesMember.workId })
      .from(seriesMember)
      .where(eq(seriesMember.seriesId, seriesId));

    const spine = members
      .filter((m) => m.ord !== null)
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));

    expect(spine).toHaveLength(CHAIN);
    // And in the right order, not merely present.
    expect(spine.map((s) => s.workId)).toEqual(ids);
  });

  it('starts the spine at the true root even when seeded from the middle', async () => {
    // Adding season 5 must still produce the series that begins at season 1;
    // otherwise "start here" would point a new viewer at the middle.
    const seriesId = await recomputeSeries(ids[4]);
    const db = unscoped();
    const first = await db
      .select({ workId: seriesMember.workId })
      .from(seriesMember)
      .where(eq(seriesMember.seriesId, seriesId));

    const s = await db.query.series.findFirst({ where: eq(series.id, seriesId) });
    expect(s?.rootWorkId).toBe(ids[0]);
    expect(first).toHaveLength(CHAIN);
  });

  it('is idempotent — recomputing does not duplicate members', async () => {
    const db = unscoped();
    const seriesId = await recomputeSeries(rootId);
    await recomputeSeries(rootId);
    const members = await db
      .select({ workId: seriesMember.workId })
      .from(seriesMember)
      .where(eq(seriesMember.seriesId, seriesId));
    expect(members).toHaveLength(CHAIN);
  });
});
