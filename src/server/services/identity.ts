import { and, eq, inArray, sql } from 'drizzle-orm';
import { unscoped } from '../db/client';
import {
  episode,
  seriesMember,
  userWork,
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
    // ── user_work: combine where a user holds both ──
    const dupes = await tx.execute<{
      user_id: string;
      keep_progress: number;
      lose_progress: number;
    }>(sql`
      SELECT k.user_id,
             k.progress AS keep_progress,
             l.progress AS lose_progress
        FROM user_work k
        JOIN user_work l ON l.user_id = k.user_id AND l.work_id = ${loserId}
       WHERE k.work_id = ${keeperId}
    `);

    for (const d of dupes) {
      // Never regress: take the further of the two, and prefer the stronger
      // status (completed beats watching beats planned).
      await tx.execute(sql`
        UPDATE user_work k
           SET progress = GREATEST(k.progress, l.progress),
               status = CASE
                 WHEN 'completed' IN (k.status::text, l.status::text) THEN 'completed'::watch_state
                 WHEN 'watching'  IN (k.status::text, l.status::text) THEN 'watching'::watch_state
                 ELSE k.status
               END,
               rewatch_count = GREATEST(k.rewatch_count, l.rewatch_count),
               favorite = k.favorite OR l.favorite,
               rating = COALESCE(k.rating, l.rating),
               notes = COALESCE(k.notes, l.notes),
               last_watched_at = GREATEST(k.last_watched_at, l.last_watched_at)
          FROM user_work l
         WHERE k.user_id = ${d.user_id} AND k.work_id = ${keeperId}
           AND l.user_id = ${d.user_id} AND l.work_id = ${loserId}
      `);
      await tx
        .delete(userWork)
        .where(and(eq(userWork.userId, d.user_id), eq(userWork.workId, loserId)));
    }

    // Whatever is left has no counterpart — just repoint it.
    await tx.update(userWork).set({ workId: keeperId }).where(eq(userWork.workId, loserId));

    // ── watch sessions: pass numbers could collide, so offset rather than drop ──
    await tx.execute(sql`
      UPDATE watch_session l
         SET work_id = ${keeperId},
             pass_no = l.pass_no + COALESCE(
               (SELECT max(pass_no) FROM watch_session k
                 WHERE k.user_id = l.user_id AND k.work_id = ${keeperId}), 0)
       WHERE l.work_id = ${loserId}
    `);

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

/** Deduplicate the conflicting rows that existed before identity was tracked. */
export async function findDuplicatePairs(): Promise<
  Array<{ keeper: string; loser: string; title: string }>
> {
  const db = unscoped();
  // Only exact title matches across different providers — a deliberately
  // narrow net, because a false merge costs someone their watch history.
  const rows = await db.execute<{ keeper: string; loser: string; title: string }>(sql`
    SELECT a.id AS keeper, b.id AS loser, a.title_romaji AS title
      FROM work a
      JOIN work b
        ON lower(a.title_romaji) = lower(b.title_romaji)
       AND a.provider <> b.provider
       AND a.created_at < b.created_at
       AND COALESCE(a.episode_count, -1) = COALESCE(b.episode_count, -1)
  `);
  return rows;
}
