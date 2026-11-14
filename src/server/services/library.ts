import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  Dashboard,
  LibraryEntry,
  LibrarySeriesEntry,
  SearchResult,
  SeriesDetail,
  WatchStateDto,
} from '@/contracts';
import { asUser, unscoped } from '../db/client';
import { account, series, seriesMember, userWork, work } from '../db/schema';
import type { Actor } from '../http/api';
import { HttpError, notFound } from '../http/api';
import { toLibraryEntry, toUserProgress, toWorkSummary } from '../http/serialise';
import { defaultProvider, ensureWork, scheduleHydration, upsertWork } from './ingest';
import { ProviderUnavailableError } from '../providers/types';

type WorkRow = typeof work.$inferSelect;
type UserWorkRow = typeof userWork.$inferSelect;

/* ──────────────────────────────── search ──────────────────────────────── */

/**
 * Search the provider, then annotate with the caller's library state.
 *
 * The `inLibrary` flag is the single most valuable field on this endpoint: it
 * answers "have I already watched this?" in the results list, which is the
 * question that started this project. Doing it here rather than in a second
 * round trip is what makes the answer instant.
 */
export interface SearchOutcome {
  results: SearchResult[];
  /** True when the provider was unreachable and this came from our catalog. */
  degraded: boolean;
}

/**
 * Search the local catalog.
 *
 * The fallback when the provider is unreachable. It cannot find a title nobody
 * has ever looked up, but it can find everything you already track — and
 * "which season of Attack on Titan was I on?" is a question about your own
 * library, not about the internet. Refusing to answer it because a third party
 * is down would be absurd.
 */
async function searchLocal(q: string, limit: number): Promise<WorkRow[]> {
  const db = unscoped();

  // Token-AND, not a single phrase match. One ILIKE over the whole query
  // requires the words to be adjacent and in order, so "gundam wing" misses
  // "Mobile Suit Gundam Wing" and "titan final" misses "Attack on Titan: The
  // Final Season". People type fragments in whatever order they remember them,
  // which is the entire premise of a product for people who half-remember things.
  const tokens = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6); // a bounded number of ILIKEs per query

  if (!tokens.length) return [];

  // Romaji, English and synonyms concatenated, so a query can span fields:
  // "shingeki final" matches even when one word is only in the other title.
  const haystack = sql`(
    coalesce(${work.titleRomaji}, '') || ' ' ||
    coalesce(${work.titleEnglish}, '') || ' ' ||
    coalesce(array_to_string(${work.synonyms}, ' '), '')
  )`;

  const conditions = tokens.map((t) => sql`${haystack} ILIKE ${`%${t}%`}`);

  return db
    .select()
    .from(work)
    .where(sql.join(conditions, sql` AND `))
    // Popularity is a reasonable relevance proxy within a catalog this small;
    // NULLS LAST keeps never-ranked entries from floating to the top.
    .orderBy(sql`${work.popularity} ASC NULLS LAST`)
    .limit(limit);
}

export async function search(
  actor: Actor | null,
  q: string,
  limit: number,
): Promise<SearchOutcome> {
  const provider = defaultProvider();
  const db = unscoped();

  let ids: string[] = [];
  let degraded = false;

  try {
    const raw = await provider.search(q, limit);
    // Persist what we found. Search is the cheapest way to warm the catalog,
    // and it means adding a title afterwards needs no further provider call.
    for (const r of raw) {
      const { id } = await upsertWork(r, provider.id);
      ids.push(id);
    }
  } catch (err) {
    // The provider is a mirror of MyAnimeList and is frequently down —
    // measured at roughly 10% availability while MAL itself was healthy.
    // Failing the whole screen because of that would make the app unusable
    // for reasons that have nothing to do with the user's own data.
    if (!(err instanceof ProviderUnavailableError)) throw err;
    degraded = true;
    ids = (await searchLocal(q, limit)).map((r) => r.id);
  }

  if (!ids.length) return { results: [], degraded };

  const rows = await db.select().from(work).where(inArray(work.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  let mine = new Map<string, UserWorkRow>();
  if (actor) {
    mine = await asUser(actor.userId, async (tx) => {
      const owned = await tx
        .select()
        .from(userWork)
        .where(and(eq(userWork.userId, actor.userId), inArray(userWork.workId, ids)));
      return new Map(owned.map((o) => [o.workId, o]));
    });
  }

  // Preserve the provider's relevance order — it is better than anything we
  // would compute, and re-sorting by our own popularity column reliably buries
  // the exact title the user typed.
  const results = ids
    .map((id) => byId.get(id))
    .filter((w): w is WorkRow => Boolean(w))
    .map((w) => {
      const owned = mine.get(w.id);
      return {
        ...toWorkSummary(w),
        inLibrary: Boolean(owned && !owned.deletedAt),
        libraryStatus: (owned && !owned.deletedAt ? owned.status : null) as
          | WatchStateDto
          | null,
      };
    });

  return { results, degraded };
}

/* ──────────────────────────────── library ─────────────────────────────── */

/**
 * Add a title to the caller's library.
 *
 * Accepts EITHER identifier, and prefers the internal one:
 *
 *   workId      our uuid, which is what /search already returned
 *   providerId  a MyAnimeList id, for a client that only has that
 *
 * This distinction caused a real bug. Search results carry `work.id` (a uuid),
 * the client sent it as `providerId`, and the lookup missed — so adding a
 * title *already in our own database* went to the network, waited out the
 * provider timeout, and failed with 503 while the provider was down.
 *
 * Taking the internal id makes the common path touch no network at all, which
 * is also why adding works perfectly well during an outage.
 */
export async function addToLibrary(
  actor: Actor,
  input: {
    workId?: string;
    providerId?: string;
    status?: WatchStateDto;
    progress?: number;
  },
): Promise<LibraryEntry> {
  let workId: string;

  if (input.workId) {
    const existing = await unscoped().query.work.findFirst({
      where: eq(work.id, input.workId),
    });
    if (!existing) throw notFound('That title is not in the catalog.');
    workId = existing.id;
  } else if (input.providerId) {
    workId = await ensureWork(input.providerId);
  } else {
    throw new HttpError('bad_request', 'Provide either workId or providerId.');
  }

  return asUser(actor.userId, async (tx) => {
    await tx
      .insert(userWork)
      .values({
        userId: actor.userId,
        workId,
        status: input.status ?? 'planned',
        progress: input.progress ?? 0,
        startedAt: input.status === 'watching' ? new Date() : null,
        completedAt: input.status === 'completed' ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [userWork.userId, userWork.workId],
        set: { deletedAt: null, status: input.status ?? 'planned' },
      });

    const [row] = await tx
      .select({ uw: userWork, w: work })
      .from(userWork)
      .innerJoin(work, eq(work.id, userWork.workId))
      .where(and(eq(userWork.userId, actor.userId), eq(userWork.workId, workId)));

    // Work out the rest of the franchise in the background. The caller gets
    // their row back now; the series page becomes available moments later.
    scheduleHydration(workId);

    const slugs = await seriesSlugsFor(tx, [workId]);
    return toLibraryEntry(row.w, row.uw, slugs.get(workId) ?? null);
  });
}

export async function listLibrary(
  actor: Actor,
  filter: { status?: WatchStateDto } = {},
): Promise<LibraryEntry[]> {
  return asUser(actor.userId, async (tx) => {
    const rows = await tx
      .select({ uw: userWork, w: work })
      .from(userWork)
      .innerJoin(work, eq(work.id, userWork.workId))
      .where(
        and(
          eq(userWork.userId, actor.userId),
          isNull(userWork.deletedAt),
          filter.status ? eq(userWork.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(userWork.lastWatchedAt), desc(userWork.updatedSeq));

    // Resolve each entry's series so the UI has somewhere to navigate. A
    // separate query rather than a join: a work can belong to one series, but
    // the join multiplies rows if that ever stops being true.
    const slugs = await seriesSlugsFor(
      tx,
      rows.map((r) => r.w.id),
    );

    return rows.map((r) => toLibraryEntry(r.w, r.uw, slugs.get(r.w.id) ?? null));
  });
}

/** workId -> series slug, for linking a library entry to its series page. */
async function seriesSlugsFor(
  tx: Parameters<Parameters<typeof asUser>[1]>[0],
  workIds: string[],
): Promise<Map<string, string>> {
  if (!workIds.length) return new Map();
  const rows = await tx
    .select({ workId: seriesMember.workId, slug: series.slug })
    .from(seriesMember)
    .innerJoin(series, eq(series.id, seriesMember.seriesId))
    .where(inArray(seriesMember.workId, workIds));
  return new Map(rows.map((r) => [r.workId, r.slug]));
}

/* ──────────────────────── library, grouped ──────────────────────── */

/**
 * One status for a whole franchise, from the states of its entries.
 *
 * Ordered by what the user would say out loud. "I'm watching Attack on Titan"
 * is true the moment any season is in progress, regardless of the other five.
 */
function deriveSeriesStatus(states: UserWorkRow[]): WatchStateDto {
  if (!states.length) return 'planned';
  if (states.some((s) => s.status === 'watching' || s.rewatching)) return 'watching';
  if (states.some((s) => s.status === 'on_hold')) return 'on_hold';
  if (states.every((s) => s.status === 'completed')) return 'completed';
  if (states.every((s) => s.status === 'dropped')) return 'dropped';
  return 'planned';
}

/**
 * The library, one row per series.
 *
 * Note it reports `totalEntries` from the full spine, not from what the user
 * owns — "Season 5 of 6" is only meaningful if the 6 counts seasons that
 * exist, including the ones they have not added.
 */
export async function listLibrarySeries(
  actor: Actor,
): Promise<LibrarySeriesEntry[]> {
  const db = unscoped();

  const owned = await asUser(actor.userId, async (tx) =>
    tx
      .select({ uw: userWork, w: work })
      .from(userWork)
      .innerJoin(work, eq(work.id, userWork.workId))
      .where(and(eq(userWork.userId, actor.userId), isNull(userWork.deletedAt))),
  );
  if (!owned.length) return [];

  // Which series each owned work belongs to.
  const membership = await db
    .select({ workId: seriesMember.workId, seriesId: seriesMember.seriesId })
    .from(seriesMember)
    .where(inArray(seriesMember.workId, owned.map((o) => o.w.id)));
  const seriesIds = [...new Set(membership.map((m) => m.seriesId))];
  if (!seriesIds.length) return [];

  const [seriesRows, allMembers] = await Promise.all([
    db.select().from(series).where(inArray(series.id, seriesIds)),
    db
      .select({ m: seriesMember, w: work })
      .from(seriesMember)
      .innerJoin(work, eq(work.id, seriesMember.workId))
      .where(inArray(seriesMember.seriesId, seriesIds)),
  ]);

  const ownedByWork = new Map(owned.map((o) => [o.w.id, o]));
  const out: LibrarySeriesEntry[] = [];

  for (const s of seriesRows) {
    const members = allMembers.filter((m) => m.m.seriesId === s.id);
    const spine = members
      .filter((m) => m.m.spineOrd !== null)
      .sort((a, b) => (a.m.spineOrd ?? 0) - (b.m.spineOrd ?? 0));

    const mine = members
      .map((m) => ownedByWork.get(m.w.id))
      .filter((x): x is (typeof owned)[number] => Boolean(x));
    if (!mine.length) continue;

    const states = mine.map((m) => m.uw);

    // Where they are: the first spine entry they own that is not finished,
    // falling back to the most recently touched entry off the spine.
    const inProgress = spine
      .map((m) => ownedByWork.get(m.w.id))
      .find((o) => o && !(o.uw.status === 'completed' && !o.uw.rewatching));
    const fallback = [...mine].sort(
      (a, b) => (b.uw.lastWatchedAt?.getTime() ?? 0) - (a.uw.lastWatchedAt?.getTime() ?? 0),
    )[0];
    const cursor = inProgress ?? (states.every((x) => x.status === 'completed') ? null : fallback);

    // The representative poster is the FIRST entry on the spine — the one
    // people picture when they hear the name, not whichever season happened
    // to be added first.
    const root = spine[0]?.w ?? mine[0].w;

    // Name the gaps, do not just count them.
    const missingEntries = spine
      .filter((m) => !ownedByWork.has(m.w.id))
      .map((m) => ({
        workId: m.w.id,
        title: m.w.titleEnglish ?? m.w.titleRomaji,
        ord: m.m.spineOrd,
        status: m.w.releaseStatus,
      }));

    const hasUnwatchedNext = missingEntries.some(
      (m) => m.status === 'finished' || m.status === 'airing',
    );

    out.push({
      seriesId: s.id,
      slug: s.slug,
      title: s.title,
      coverUrl: root.coverUrl,
      accentHex: root.accentHex,
      totalEntries: spine.length || mine.length,
      ownedEntries: mine.length,
      completedEntries: states.filter((x) => x.status === 'completed').length,
      status: deriveSeriesStatus(states),
      favorite: states.some((x) => x.favorite),
      rating: states.find((x) => x.rating !== null)?.rating ?? null,
      current: cursor
        ? {
            workId: cursor.w.id,
            title: cursor.w.titleEnglish ?? cursor.w.titleRomaji,
            ord: members.find((m) => m.w.id === cursor.w.id)?.m.spineOrd ?? null,
            progress: cursor.uw.progress,
            total: cursor.w.episodeCount,
          }
        : null,
      missingEntries,
      hasUnwatchedNext,
      lastWatchedAt:
        states
          .map((x) => x.lastWatchedAt)
          .filter((d): d is Date => Boolean(d))
          .sort((a, b) => b.getTime() - a.getTime())[0]
          ?.toISOString() ?? null,
    });
  }

  // Most recently touched first; never-watched titles fall to the end.
  return out.sort(
    (a, b) =>
      (b.lastWatchedAt ? Date.parse(b.lastWatchedAt) : 0) -
      (a.lastWatchedAt ? Date.parse(a.lastWatchedAt) : 0),
  );
}

/* ──────────────────────────────── series ──────────────────────────────── */

/**
 * Decide the single most useful next action.
 *
 * Computed server-side so every client agrees. Deliberately returns null when
 * the series is `ambiguous`: with parallel retellings there is no single right
 * answer, and inventing one is worse than admitting it.
 */
function deriveNextUp(
  spine: Array<{ w: WorkRow; u: UserWorkRow | undefined; ord: number }>,
  ambiguous: boolean,
): SeriesDetail['nextUp'] {
  if (ambiguous) return null;

  for (const entry of spine) {
    const total = entry.w.episodeCount;
    const watched = entry.u?.progress ?? 0;
    const done = entry.u?.status === 'completed' && !entry.u.rewatching;

    if (done) continue;

    if (entry.w.releaseStatus === 'not_yet_aired') return null; // nothing to watch yet

    if (watched > 0 && (total === null || watched < total)) {
      return {
        reason: 'continue_episode',
        work: toWorkSummary(entry.w),
        episode: watched + 1,
      };
    }
    if (watched === 0) {
      return {
        reason: entry.ord === 1 ? 'start_series' : 'start_next_season',
        work: toWorkSummary(entry.w),
        episode: 1,
      };
    }
  }

  const last = spine[spine.length - 1];
  if (last && last.u?.status === 'completed') {
    return { reason: 'rewatch_available', work: toWorkSummary(last.w), episode: null };
  }
  return null;
}

export async function getSeries(
  actor: Actor | null,
  slug: string,
): Promise<SeriesDetail> {
  const db = unscoped();
  const s = await db.query.series.findFirst({ where: eq(series.slug, slug) });
  if (!s) throw notFound('That series is not in the catalog yet.');

  const members = await db
    .select({ m: seriesMember, w: work })
    .from(seriesMember)
    .innerJoin(work, eq(work.id, seriesMember.workId))
    .where(eq(seriesMember.seriesId, s.id));

  const workIds = members.map((m) => m.w.id);

  let mine = new Map<string, UserWorkRow>();
  if (actor && workIds.length) {
    mine = await asUser(actor.userId, async (tx) => {
      const rows = await tx
        .select()
        .from(userWork)
        .where(
          and(eq(userWork.userId, actor.userId), inArray(userWork.workId, workIds)),
        );
      return new Map(rows.map((r) => [r.workId, r]));
    });
  }

  const spineRows = members
    .filter((m) => m.m.spineOrd !== null)
    .sort((a, b) => (a.m.spineOrd ?? 0) - (b.m.spineOrd ?? 0))
    .map((m) => ({ w: m.w, u: mine.get(m.w.id), ord: m.m.spineOrd as number }));

  const extraRows = members.filter((m) => m.m.spineOrd === null);

  const diagnostics = (s.diagnostics ?? {}) as { ambiguous?: boolean };
  const altIds = new Set(
    extraRows.filter((m) => m.m.track === 'alternative').map((m) => m.w.id),
  );

  const hasUnairedSequel = spineRows.some(
    (r) => r.w.releaseStatus === 'not_yet_aired' || r.w.releaseStatus === 'unknown',
  );
  const airing = spineRows.some((r) => r.w.releaseStatus === 'airing');

  // Franchise-level description comes from the first entry — the one the
  // title refers to.
  const descriptive = spineRows[0]?.w ?? members[0]?.w;

  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    synopsis: descriptive?.synopsis ?? null,
    genres: descriptive?.genres ?? [],
    studios: descriptive?.studios ?? [],
    year: descriptive?.seasonYear ?? null,
    // Members are written after the series row, so an empty spine shortly
    // after an add means the walk is still running, not that the show has no
    // seasons.
    // An empty spine is never a useful thing to show. Whether the walk is
    // still running or it finished without finding a main line, the honest
    // message is the same: we are still working it out.
    hydrating: spineRows.length === 0,
    ambiguous: s.ambiguous || Boolean(diagnostics.ambiguous),
    spine: spineRows.map((r) => ({
      ord: r.ord,
      work: toWorkSummary(r.w),
      progress: r.u ? toUserProgress(r.u) : null,
    })),
    extras: extraRows.map((m) => ({
      track: m.m.track ?? 'other',
      via: m.m.via ?? 'other',
      work: toWorkSummary(m.w),
      progress: mine.get(m.w.id) ? toUserProgress(mine.get(m.w.id)!) : null,
    })),
    alternativeLines: extraRows
      .filter((m) => altIds.has(m.w.id))
      .map((m) => toWorkSummary(m.w)),
    nextUp: deriveNextUp(spineRows, s.ambiguous),
    releaseSummary: { airing, hasUnairedSequel, nextEpisodeAt: null },
    computedAt: s.computedAt.toISOString(),
  };
}

/* ─────────────────────────────── dashboard ────────────────────────────── */

/**
 * The home screen is a call sheet, not a catalog: only things that want a
 * decision today. Everything here is one query over the user's own rows plus
 * the already-derived series membership — no provider calls on a page load.
 */
export async function getDashboard(actor: Actor): Promise<Dashboard> {
  const db = unscoped();
  const me = await db.query.account.findFirst({ where: eq(account.id, actor.userId) });

  return asUser(actor.userId, async (tx) => {
    const rows = await tx
      .select({ uw: userWork, w: work })
      .from(userWork)
      .innerJoin(work, eq(work.id, userWork.workId))
      .where(and(eq(userWork.userId, actor.userId), isNull(userWork.deletedAt)));

    const slugByWork = new Map<string, string>();

    /**
     * Resolve series slugs for a set of works.
     *
     * Called twice on purpose. Looking these up only for the user's OWN
     * library — which is what this did — guarantees a miss for the two
     * sections that matter most: "new season available" and "waiting on" are
     * by definition titles NOT in the library yet. Their slug came back null,
     * so the only link on the row never rendered and the card was inert.
     */
    const resolveSlugs = async (workIds: string[]) => {
      const missing = workIds.filter((id) => !slugByWork.has(id));
      if (!missing.length) return;
      const memberRows = await tx
        .select({ workId: seriesMember.workId, slug: series.slug })
        .from(seriesMember)
        .innerJoin(series, eq(series.id, seriesMember.seriesId))
        .where(inArray(seriesMember.workId, missing));
      for (const m of memberRows) slugByWork.set(m.workId, m.slug);
    };

    await resolveSlugs(rows.map((r) => r.w.id));

    const counts = {
      watching: rows.filter((r) => r.uw.status === 'watching' || r.uw.rewatching).length,
      // Filled in below from the derived list. Counting owned-but-unaired rows
      // here instead gave "All 0" next to a visible waiting item, because the
      // things you are waiting for are by definition NOT in your library yet.
      waiting: 0,
      completed: rows.filter((r) => r.uw.status === 'completed').length,
      planned: rows.filter((r) => r.uw.status === 'planned').length,
      total: rows.length,
    };

    const continueWatching = rows
      .filter((r) => r.uw.status === 'watching' || r.uw.rewatching)
      .sort(
        (a, b) =>
          (b.uw.lastWatchedAt?.getTime() ?? 0) - (a.uw.lastWatchedAt?.getTime() ?? 0),
      )
      .slice(0, 6)
      .map((r) => ({
        work: toWorkSummary(r.w),
        seriesSlug: slugByWork.get(r.w.id) ?? null,
        nextEpisode:
          r.w.episodeCount === null || r.uw.progress < r.w.episodeCount
            ? r.uw.progress + 1
            : null,
        progress: toUserProgress(r.uw),
      }));

    // "New season is out and you finished the last one" — the payoff of the
    // whole series graph, expressed as one query over derived data.
    const ownedIds = new Set(rows.map((r) => r.w.id));
    const completedIds = rows
      .filter((r) => r.uw.status === 'completed')
      .map((r) => r.w.id);

    const newlyAvailable: Dashboard['newlyAvailable'] = [];
    const waitingOn: Dashboard['waitingOn'] = [];

    if (completedIds.length) {
      // Built with the query builder rather than raw SQL: interpolating a JS
      // array into a sql`` template spreads it into ANY($1, $2, $3), which is
      // a syntax error. inArray binds it as a single array parameter.
      const m1 = alias(seriesMember, 'm1');
      const m2 = alias(seriesMember, 'm2');

      const successors = await tx
        .selectDistinct({
          nextId: m2.workId,
          // Match the title the user sees everywhere else; falling back to
          // romaji here made the same show appear under two different names
          // on one screen.
          fromTitle: sql<string>`coalesce(${work.titleEnglish}, ${work.titleRomaji})`,
        })
        .from(m1)
        .innerJoin(
          m2,
          and(
            eq(m2.seriesId, m1.seriesId),
            // the immediately following entry on the same spine
            eq(m2.spineOrd, sql`${m1.spineOrd} + 1`),
          ),
        )
        .innerJoin(work, eq(work.id, m1.workId))
        .where(and(inArray(m1.workId, completedIds), isNotNull(m1.spineOrd)));

      const nextIds = successors.map((s) => s.nextId).filter((id) => !ownedIds.has(id));
      if (nextIds.length) {
        // These are unowned, so they were not covered by the first pass.
        await resolveSlugs(nextIds);
        const nextWorks = await tx.select().from(work).where(inArray(work.id, nextIds));
        const fromTitle = new Map(successors.map((s) => [s.nextId, s.fromTitle]));

        for (const w of nextWorks) {
          const entry = {
            work: toWorkSummary(w),
            seriesSlug: slugByWork.get(w.id) ?? null,
            becauseYouFinished: fromTitle.get(w.id) ?? '',
          };
          if (w.releaseStatus === 'finished' || w.releaseStatus === 'airing') {
            newlyAvailable.push(entry);
          } else {
            waitingOn.push({
              work: entry.work,
              seriesSlug: entry.seriesSlug,
              expected: w.startDate ?? null,
              status: w.releaseStatus,
            });
          }
        }
      }
    }

    counts.waiting = waitingOn.length;

    return {
      greetingName: me?.displayName ?? null,
      counts,
      continueWatching,
      newlyAvailable: newlyAvailable.slice(0, 8),
      waitingOn: waitingOn.slice(0, 12),
    };
  });
}
