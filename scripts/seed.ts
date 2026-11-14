/**
 * Development seed.
 *
 * Builds two real franchises and their relation graphs offline, runs the
 * series builder over them, and attaches them to an account. This exists
 * because the upstream provider is a scraper of MyAnimeList and inherits its
 * downtime — being unable to develop the UI because someone else's server is
 * having a bad afternoon is not acceptable.
 *
 *   pnpm seed                      # seeds the first account found
 *   pnpm seed you@example.com      # seeds a specific account
 *
 * Data is real (genuine MAL ids, titles, dates and relation types) so that
 * what you see locally matches what the live provider would produce.
 */
import { eq } from 'drizzle-orm';
import { asUser, unscoped } from '../src/server/db/client';
import { account, userWork, work, workRelation } from '../src/server/db/schema';
import { recomputeSeries, upsertWork } from '../src/server/services/ingest';
import type { RawWork } from '../src/server/providers/types';
import type { ReleaseStatus, WorkKind } from '../src/server/domain/types';

// Only verified CDN paths. An unverified guess 404s and renders as a blank
// tile, which looks like an application bug rather than missing art; passing
// null lets the poster fall back to the title honestly.
const COVER = (id: string | null) =>
  id ? `https://cdn.myanimelist.net/images/anime/${id}.jpg` : null;

function w(
  providerId: string,
  titleRomaji: string,
  titleEnglish: string | null,
  kind: WorkKind,
  startDate: string | null,
  episodeCount: number | null,
  releaseStatus: ReleaseStatus,
  cover: string | null,
  accentHex: string,
): RawWork & { accentHex: string } {
  return {
    providerId,
    kind,
    titleRomaji,
    titleEnglish,
    titleNative: null,
    synonyms: [],
    synopsis: null,
    coverUrl: COVER(cover),
    bannerUrl: null,
    episodeCount,
    durationMin: 24,
    releaseStatus,
    startDate,
    endDate: null,
    seasonYear: startDate ? Number(startDate.slice(0, 4)) : null,
    broadcastDow: null,
    broadcastTime: null,
    broadcastTz: null,
    genres: ['Action'],
    studios: [],
    score: null,
    popularity: null,
    raw: { seeded: true },
    accentHex,
  };
}

const AOT = '#8c4a3f';
const SL = '#3f5f8c';
const OPM = '#8c7a3f';

const WORKS = [
  // ── Attack on Titan: a complete spine plus the full menagerie of extras ──
  w('16498', 'Shingeki no Kyojin', 'Attack on Titan', 'tv', '2013-04-07', 25, 'finished', '10/47347', AOT),
  w('25777', 'Shingeki no Kyojin Season 2', 'Attack on Titan Season 2', 'tv', '2017-04-01', 12, 'finished', '4/84177', AOT),
  w('35760', 'Shingeki no Kyojin Season 3', 'Attack on Titan Season 3', 'tv', '2018-07-23', 12, 'finished', '1173/92110', AOT),
  w('38524', 'Shingeki no Kyojin Season 3 Part 2', 'Attack on Titan Season 3 Part 2', 'tv', '2019-04-29', 10, 'finished', '1517/100633', AOT),
  w('40028', 'Shingeki no Kyojin: The Final Season', 'Attack on Titan Final Season', 'tv', '2020-12-07', 16, 'finished', '1000/110531', AOT),
  w('48583', 'Shingeki no Kyojin: The Final Season Part 2', 'Attack on Titan Final Season Part 2', 'tv', '2022-01-10', 12, 'finished', '1988/119437', AOT),
  w('18397', 'Shingeki no Kyojin OVA', null, 'ova', '2013-12-09', 3, 'finished', null, AOT),
  w('25781', 'Shingeki no Kyojin: Kuinaki Sentaku', 'No Regrets', 'ova', '2014-12-09', 2, 'finished', null, AOT),
  w('31374', 'Shingeki! Kyojin Chuugakkou', 'Junior High', 'tv', '2015-10-04', 12, 'finished', null, AOT),
  w('23775', 'Shingeki no Kyojin Movie 1: Guren no Yumiya', null, 'movie', '2014-11-22', 1, 'finished', null, AOT),
  w('42091', 'Shingeki no Kyojin: Chronicle', null, 'movie', '2020-07-17', 1, 'finished', null, AOT),

  // ── Solo Leveling: S1+S2 done, S3 announced without a date ──
  w('52299', 'Ore dake Level Up na Ken', 'Solo Leveling', 'tv', '2024-01-07', 12, 'finished', '1801/142390', SL),
  w('58567', 'Ore dake Level Up na Ken Season 2', 'Solo Leveling Season 2', 'tv', '2025-01-05', 13, 'finished', '1448/147351', SL),
  w('61371', 'Ore dake Level Up na Ken Season 3', 'Solo Leveling Season 3', 'tv', null, null, 'not_yet_aired', null, SL),

  // ── One Punch Man: both seasons watched, season 3 announced with no date.
  //    This is the state the "Waiting on" page exists for.
  w('30276', 'One Punch Man', null, 'tv', '2015-10-05', 12, 'finished', '12/76049', OPM),
  w('34134', 'One Punch Man 2nd Season', null, 'tv', '2019-04-10', 12, 'finished', null, OPM),
  w('52807', 'One Punch Man 3rd Season', null, 'tv', null, null, 'not_yet_aired', null, OPM),
] as const;

/** [from, to, relation] — the same vocabulary the normaliser emits. */
const RELATIONS: Array<[string, string, string]> = [
  ['16498', '25777', 'sequel'],
  ['25777', '35760', 'sequel'],
  ['35760', '38524', 'sequel'],
  ['38524', '40028', 'sequel'],
  ['40028', '48583', 'sequel'],
  ['16498', '18397', 'side_story'],
  ['16498', '25781', 'spin_off'],
  ['16498', '31374', 'spin_off'],
  ['16498', '23775', 'summary'],
  ['16498', '42091', 'summary'],
  ['52299', '58567', 'sequel'],
  ['58567', '61371', 'sequel'],
  ['30276', '34134', 'sequel'],
  ['34134', '52807', 'sequel'],
];

/** Where the seeded user is up to. */
const PROGRESS: Record<string, { status: 'watching' | 'completed'; progress: number }> = {
  '16498': { status: 'completed', progress: 25 },
  '25777': { status: 'completed', progress: 12 },
  '35760': { status: 'completed', progress: 12 },
  '38524': { status: 'completed', progress: 10 },
  '40028': { status: 'watching', progress: 9 },
  '52299': { status: 'completed', progress: 12 },
  '30276': { status: 'completed', progress: 12 },
  '34134': { status: 'completed', progress: 12 },
};

async function main() {
  const db = unscoped();
  const wanted = process.argv[2];

  const user = wanted
    ? await db.query.account.findFirst({ where: eq(account.email, wanted.toLowerCase()) })
    : await db.query.account.findFirst();

  if (!user) {
    console.error(
      wanted
        ? `No account for ${wanted}. Create one at /sign-in first.`
        : 'No accounts yet. Create one at /sign-in first.',
    );
    process.exit(1);
  }

  const idByProvider = new Map<string, string>();
  for (const raw of WORKS) {
    const { id } = await upsertWork(raw, 'jikan');
    await db.update(work).set({ accentHex: raw.accentHex }).where(eq(work.id, id));
    idByProvider.set(raw.providerId, id);
  }
  console.log(`  ${WORKS.length} works`);

  for (const [from, to, kind] of RELATIONS) {
    const f = idByProvider.get(from);
    const t = idByProvider.get(to);
    if (!f || !t) continue;
    // Both directions, exactly as a provider emits them — this is also what
    // proves the builder's de-duplication actually works.
    await db
      .insert(workRelation)
      .values({ fromWorkId: f, toWorkId: t, kind })
      .onConflictDoNothing();
    await db
      .insert(workRelation)
      .values({
        fromWorkId: t,
        toWorkId: f,
        kind: kind === 'sequel' ? 'prequel' : kind,
      })
      .onConflictDoNothing();
  }
  console.log(`  ${RELATIONS.length} relations`);

  for (const root of ['16498', '52299', '30276']) {
    const id = idByProvider.get(root)!;
    const seriesId = await recomputeSeries(id);
    console.log(`  series ${seriesId} from ${root}`);
  }

  // User-owned rows go through asUser, not the unscoped connection. Row-level
  // security rejects an identity-less write with 42501 — which is the policy
  // doing its job, and the reason the seed cannot take a shortcut here either.
  await asUser(user.id, async (tx) => {
    for (const [providerId, p] of Object.entries(PROGRESS)) {
      const workId = idByProvider.get(providerId);
      if (!workId) continue;
      await tx
        .insert(userWork)
        .values({
          userId: user.id,
          workId,
          status: p.status,
          progress: p.progress,
          startedAt: new Date(Date.now() - 86_400_000 * 30),
          completedAt:
            p.status === 'completed' ? new Date(Date.now() - 86_400_000 * 3) : null,
          lastWatchedAt: new Date(Date.now() - 86_400_000),
        })
        .onConflictDoUpdate({
          target: [userWork.userId, userWork.workId],
          set: { status: p.status, progress: p.progress, deletedAt: null },
        });
    }
  });
  console.log(`  ${Object.keys(PROGRESS).length} library entries for ${user.email}`);
  console.log('\nseeded.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
