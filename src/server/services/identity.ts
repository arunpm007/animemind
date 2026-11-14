import { and, eq, inArray, sql } from 'drizzle-orm';
import { unscoped } from '../db/client';
import {
  episode,
  seriesMember,
  work,
  workExternalId,
  workRelation,
} from '../db/schema';

/**
 * Cross-provider identity.
 *
 * Every provider numbers the same anime differently. Attack on Titan is
 * MyAnimeList 16498 and Kitsu 7442, so a catalog that keys on (provider,
 * providerId) alone holds two rows for one show — and a library built from one
 * provider then offers to "Add" a title the user finished years ago.
 *
 * Kitsu publishes mappings to the other sites, which gives a reliable key. We
 * MERGE rather than cross-link: a link means every query downstream has to
 * resolve it and one that forgets reintroduces the bug, whereas a merge leaves
 * exactly one row and nothing downstream needs to know this file exists.
 */

export interface ExternalId {
  site: string;
  externalId: string;
}

/** Sites trusted as identity. Others are useful links but not keys. */
const IDENTITY_SITES = new Set(['myanimelist', 'anilist', 'anidb', 'kitsu']);

/** `myanimelist/anime` and `myanimelist` are the same site. */
export function normaliseSite(site: string): string {
  return site.split('/')[0].trim().toLowerCase();
}

export function identityIdsOnly(ids: ExternalId[]): ExternalId[] {
  return ids
    .map((i) => ({ site: normaliseSite(i.site), externalId: String(i.externalId).trim() }))
    .filter((i) => i.externalId && IDENTITY_SITES.has(i.site));
}

/**
 * Claim a set of external ids for a work, merging if another work holds one.
 *
 * Returns the id of the surviving work, which may differ from the one passed
 * in — the caller must use the returned value from then on.
 */
export async function reconcileIdentity(
  workId: string,
  rawIds: ExternalId[],
): Promise<string> {
  const db = unscoped();
  const ids = identityIdsOnly(rawIds);
  if (!ids.length) return workId;

  // Who already claims any of these?
  const claims = await db
    .select()
    .from(workExternalId)
    .where(
      sql`(${workExternalId.site}, ${workExternalId.externalId}) IN ${sql.raw(
        `(${ids.map((i) => `('${i.site.replace(/'/g, "''")}','${i.externalId.replace(/'/g, "''")}')`).join(',')})`,
      )}`,
    );

  const others = [...new Set(claims.map((c) => c.workId))].filter((id) => id !== workId);

  let survivor = workId;
  for (const other of others) {
    // The older row wins: it is the one users already have in their libraries
    // and the one series membership already points at.
    const [a, b] = await db
      .select({ id: work.id, createdAt: work.createdAt })
      .from(work)
      .where(inArray(work.id, [survivor, other]))
      .orderBy(work.createdAt);
    if (!a || !b) continue;
    survivor = await mergeWorks(a.id, b.id);
  }

  // Claim anything still unclaimed for the survivor.
  if (ids.length) {
    await db
      .insert(workExternalId)
      .values(ids.map((i) => ({ ...i, workId: survivor })))
      .onConflictDoNothing();
  }

  return survivor;
}

/**
 * Fold `loserId` into `keeperId` and delete it.
 *
 * Every table that points at a work has to move, and user rows need care
 * because the same person may track BOTH copies — in which case the furthest
 * progress wins, for the same reason the sync protocol takes max(): a merge
 * must never cost someone episodes they have watched.
 */
export async function mergeWorks(keeperId: string, loserId: string): Promise<string> {
  if (keeperId === loserId) return keeperId;
  const db = unscoped();

  await db.transaction(async (tx) => {
    // ── user-owned rows ──
    //
    // Delegated to a SECURITY DEFINER function because `user_work` and
    // `watch_session` are under FORCE row-level security and this code runs
    // with no user pinned, so it can see NOTHING in either table. Doing the
    // moves from here updated zero rows and then deleted the losing work,
    // whose ON DELETE CASCADE is enforced by the system and ignores RLS — so
    // the watch history went with it. See drizzle/_post/0005_merge_user_work.sql
    // for why the privilege is confined to that one function.
    await tx.execute(sql`SELECT merge_user_work(${keeperId}::uuid, ${loserId}::uuid)`);

    // ── catalog ──
    //
    // Every table below has a unique constraint that the keeper may already
    // satisfy, so each repoint has to clear the colliding loser rows first.
    // Repointing blind raises a duplicate-key error halfway through and
    // leaves the merge half-applied.

    await tx.execute(sql`
      DELETE FROM episode l
       WHERE l.work_id = ${loserId}
         AND EXISTS (SELECT 1 FROM episode k
                      WHERE k.work_id = ${keeperId} AND k.number = l.number)
    `);
    await tx.update(episode).set({ workId: keeperId }).where(eq(episode.workId, loserId));

    await tx.execute(sql`
      DELETE FROM work_relation l
       WHERE l.from_work_id = ${loserId}
         AND EXISTS (SELECT 1 FROM work_relation k
                      WHERE k.from_work_id = ${keeperId}
                        AND k.to_work_id = l.to_work_id
                        AND k.kind = l.kind)
    `);
    await tx
      .update(workRelation)
      .set({ fromWorkId: keeperId })
      .where(eq(workRelation.fromWorkId, loserId));

    await tx.execute(sql`
      DELETE FROM work_relation l
       WHERE l.to_work_id = ${loserId}
         AND EXISTS (SELECT 1 FROM work_relation k
                      WHERE k.to_work_id = ${keeperId}
                        AND k.from_work_id = l.from_work_id
                        AND k.kind = l.kind)
    `);
    await tx
      .update(workRelation)
      .set({ toWorkId: keeperId })
      .where(eq(workRelation.toWorkId, loserId));

    // Once the two are one, any edge between them is a work relating to
    // itself.
    await tx.execute(
      sql`DELETE FROM work_relation WHERE from_work_id = to_work_id`,
    );

    await tx.execute(sql`
      DELETE FROM series_member l
       WHERE l.work_id = ${loserId}
         AND EXISTS (SELECT 1 FROM series_member k
                      WHERE k.work_id = ${keeperId} AND k.series_id = l.series_id)
    `);
    await tx
      .update(seriesMember)
      .set({ workId: keeperId })
      .where(eq(seriesMember.workId, loserId));

    await tx
      .update(workExternalId)
      .set({ workId: keeperId })
      .where(eq(workExternalId.workId, loserId));

    /**
     * The keeper must answer to the LOSER's own id from now on.
     *
     * Without this the merge undoes itself. `resolveWorkId` falls back to the
     * external-id table precisely because the surviving row no longer carries
     * the other provider's number — so if nothing claims it, the next crawl
     * or search that looks that id up finds nothing, inserts a fresh row, and
     * the duplicate is back. Observed exactly that way: two Attack on Titan
     * rows merged, and a background relation walk thirty-eight minutes later
     * recreated one of them.
     *
     * The UPDATE above moves a claim the loser already held, which covers
     * rows ingested since claiming became automatic. This covers the rest,
     * and makes the guarantee belong to the merge rather than depending on
     * something else having run first.
     */
    await tx.execute(sql`
      INSERT INTO work_external_id (site, external_id, work_id)
      SELECT CASE WHEN l.provider = 'kitsu' THEN 'kitsu' ELSE 'myanimelist' END,
             l.provider_id,
             ${keeperId}::uuid
        FROM work l
       WHERE l.id = ${loserId}::uuid
      ON CONFLICT (site, external_id) DO UPDATE SET work_id = ${keeperId}::uuid
    `);

    // ── fill any gaps on the keeper from the loser ──
    await tx.execute(sql`
      UPDATE work k SET
        cover_url     = COALESCE(k.cover_url, l.cover_url),
        banner_url    = COALESCE(k.banner_url, l.banner_url),
        synopsis      = COALESCE(k.synopsis, l.synopsis),
        episode_count = COALESCE(k.episode_count, l.episode_count),
        title_english = COALESCE(k.title_english, l.title_english),
        title_native  = COALESCE(k.title_native, l.title_native),
        start_date    = COALESCE(k.start_date, l.start_date)
       FROM work l
      WHERE k.id = ${keeperId} AND l.id = ${loserId}
    `);

    await tx.delete(work).where(eq(work.id, loserId));
  });

  return keeperId;
}

/** The identity site a provider's own ids belong to. */
export function siteForProvider(provider: 'jikan' | 'mal' | 'kitsu'): string {
  // Jikan serves MyAnimeList data under MyAnimeList's ids, so both are the
  // same identity space. Saying otherwise is what let one anime occupy two
  // catalog rows.
  return provider === 'kitsu' ? 'kitsu' : 'myanimelist';
}

/**
 * Find an existing work for a provider id, through identity if need be.
 *
 * The direct (provider, providerId) match misses after a merge: the surviving
 * row carries the OTHER provider's id, so a later search result would create a
 * fresh duplicate and quietly undo the merge. The external-id table is what
 * closes that loop.
 */
export async function resolveWorkId(
  provider: 'jikan' | 'mal' | 'kitsu',
  providerId: string,
): Promise<string | null> {
  const db = unscoped();

  const direct = await db.query.work.findFirst({
    where: and(eq(work.provider, provider), eq(work.providerId, providerId)),
  });
  if (direct) return direct.id;

  const claim = await db.query.workExternalId.findFirst({
    where: and(
      eq(workExternalId.site, siteForProvider(provider)),
      eq(workExternalId.externalId, providerId),
    ),
  });
  return claim?.workId ?? null;
}

/**
 * Find rows that are the same anime under two providers.
 *
 * Repairs duplicates that identity registration missed — rows written before
 * it existed, and rows the relation crawl discovered without claiming ids for.
 *
 * The net is narrow on purpose: a missed duplicate is untidy, a wrong merge
 * rewrites someone's watch history. So a pair must agree on medium AND episode
 * count AND a title, and come from different providers.
 *
 * Titles are compared with punctuation and spacing stripped, because that is
 * the ONLY thing separating the real duplicates. MyAnimeList writes "Shingeki
 * no Kyojin: The Final Season" and Kitsu writes "Shingeki no Kyojin The Final
 * Season" — one colon, which an exact comparison treats as two different
 * shows, so the season was listed twice on its own series page and counted
 * twice in every franchise total.
 *
 * Either title may carry the match, since providers disagree about which
 * romanisation is canonical, but a title only matches its OWN field: comparing
 * one row's romaji against another's English is how a show gets merged with
 * its own spin-off.
 */
export async function findDuplicatePairs(): Promise<
  Array<{ keeper: string; loser: string; title: string }>
> {
  const db = unscoped();
  // Normalise to letters and digits only, so punctuation, spacing and case
  // cannot hide a duplicate. The empty-string guard matters: two rows with no
  // English title both normalise to '' and would otherwise match each other.
  const norm = (col: string) =>
    sql.raw(`lower(regexp_replace(coalesce(${col}, ''), '[^[:alnum:]]', '', 'g'))`);

  const rows = await db.execute<{ keeper: string; loser: string; title: string }>(sql`
    SELECT a.id AS keeper, b.id AS loser,
           coalesce(a.title_english, a.title_romaji) AS title
      FROM work a
      JOIN work b
        ON a.provider <> b.provider
       -- Oldest wins: it is the row already in libraries and already pointed
       -- at by series membership.
       AND a.created_at < b.created_at
       AND a.kind = b.kind
       AND coalesce(a.episode_count, -1) = coalesce(b.episode_count, -1)
       -- When both know when they aired, they must agree. Two providers'
       -- rows for one anime share a year; two SEASONS of one anime do not.
       -- Saekano is the live near-miss: "Saenai Heroine no Sodatekata" and
       -- "Saenai Heroine no Sodatekata ♭" are season 1 and season 2, and the
       -- ♭ is punctuation as far as the normaliser is concerned, so the two
       -- titles come out identical. Only their lengths (12 and 11) tell them
       -- apart, and lengths do coincide. The year is the second lock.
       AND (
            a.start_date IS NULL OR b.start_date IS NULL
         OR date_part('year', a.start_date) = date_part('year', b.start_date)
       )
       AND (
            (${norm('a.title_romaji')} <> '' AND ${norm('a.title_romaji')} = ${norm('b.title_romaji')})
         OR (${norm('a.title_english')} <> '' AND ${norm('a.title_english')} = ${norm('b.title_english')})
       )
  `);
  return rows;
}
