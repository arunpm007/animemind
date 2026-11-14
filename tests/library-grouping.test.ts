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
/** Two retellings that share their films, as Fullmetal Alchemist does. */
const twin: string[] = [];
let sharedFilm = '';
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

  // Two works that each head their own series and each appear in the other's
  // as an alternative version, plus one film that belongs to both.
  for (const [tag, title, eps] of [
    ['tw1', `Twin Tale ${TAG}`, 51],
    ['tw2', `Twin Tale: Retold ${TAG}`, 64],
  ] as const) {
    const [row] = await db
      .insert(work)
      .values({
        provider: 'kitsu',
        providerId: `${TAG}-${tag}`,
        kind: 'tv',
        titleRomaji: title,
        titleEnglish: title,
        episodeCount: eps,
        releaseStatus: 'finished',
        contentHash: `h-${TAG}-${tag}`,
      })
      .returning({ id: work.id });
    twin.push(row.id);
    ids.push(row.id);
  }
  const [film] = await db
    .insert(work)
    .values({
      provider: 'kitsu',
      providerId: `${TAG}-twfilm`,
      kind: 'movie',
      titleRomaji: `Twin Tale: The Film ${TAG}`,
      titleEnglish: `Twin Tale: The Film ${TAG}`,
      episodeCount: 1,
      releaseStatus: 'finished',
      contentHash: `h-${TAG}-twfilm`,
    })
    .returning({ id: work.id });
  sharedFilm = film.id;
  ids.push(film.id);

  await db
    .insert(workRelation)
    .values([
      { fromWorkId: twin[0], toWorkId: twin[1], kind: 'alternative_version' },
      { fromWorkId: twin[1], toWorkId: twin[0], kind: 'alternative_version' },
      { fromWorkId: twin[0], toWorkId: sharedFilm, kind: 'side_story' },
      { fromWorkId: sharedFilm, toWorkId: twin[0], kind: 'parent_story' },
      { fromWorkId: twin[1], toWorkId: sharedFilm, kind: 'side_story' },
      { fromWorkId: sharedFilm, toWorkId: twin[1], kind: 'parent_story' },
    ])
    .onConflictDoNothing();
  await recomputeSeries(twin[0]);
  await recomputeSeries(twin[1]);

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
      // Both retellings, and the film the two series share.
      { userId: a.id, workId: twin[0], status: 'planned', progress: 0 },
      { userId: a.id, workId: twin[1], status: 'planned', progress: 0 },
      { userId: a.id, workId: sharedFilm, status: 'planned', progress: 0 },
    ]);
  });
});

afterAll(async () => {
  const db = unscoped();
  if (userId) await db.delete(account).where(eq(account.id, userId));
  const roots = await db.query.series.findMany({
    where: inArray(series.rootWorkId, [ids[0], twin[0], twin[1], sharedFilm].filter(Boolean)),
  });
  if (roots.length) {
    await db.delete(series).where(inArray(series.id, roots.map((r) => r.id)));
  }
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

/**
 * A work can be a member of several series, and must be counted by one.
 *
 * Fullmetal Alchemist (2003) and Brotherhood each head their own series and
 * each appear in the other's as an alternative version, along with the films
 * and OVAs the two share. Counting an owned work on every card it appears on
 * made both Fullmetal cards claim both adaptations — a 45-title library
 * reporting 47 entries — and someone who owned only a shared film was shown
 * that one film as two separate library cards.
 */
describe('works shared between two series', () => {
  it('counts every owned work exactly once across all cards', async () => {
    const rows = await listLibrarySeries(actor);
    const counted = rows.reduce((n, r) => n + r.ownedEntries, 0);
    // Six owned works: three of the franchise, two retellings, one film.
    expect(counted).toBe(6);
  });

  it('gives each retelling its own card, with only its own entries', async () => {
    const rows = await listLibrarySeries(actor);
    const original = rows.find((r) => r.title === `Twin Tale ${TAG}`);
    const retold = rows.find((r) => r.title === `Twin Tale: Retold ${TAG}`);
    expect(original).toBeDefined();
    expect(retold).toBeDefined();
    // Three owned works between them — one retelling each, plus the film,
    // which has to land on exactly one of the two. Four would mean a card is
    // claiming the other's retelling.
    expect(original!.ownedEntries + retold!.ownedEntries).toBe(3);
    // And each reports its OWN length, not the other's.
    expect(original!.episodesTotal).toBe(51);
    expect(retold!.episodesTotal).toBe(64);
  });

  it('never shows one shared film as two cards', async () => {
    const rows = await listLibrarySeries(actor);
    const claiming = rows.filter((r) => r.missingEntries.length >= 0 && r.ownedEntries > 0);
    // The film belongs to both series; exactly one of them may count it.
    const withFilm = claiming.filter((r) =>
      [`Twin Tale ${TAG}`, `Twin Tale: Retold ${TAG}`].includes(r.title),
    );
    expect(withFilm.reduce((n, r) => n + r.ownedEntries, 0)).toBe(3);
  });
});
