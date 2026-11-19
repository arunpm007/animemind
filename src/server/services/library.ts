import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  Dashboard,
  LibraryEntry,
  LibrarySeriesEntry,
  SearchResult,
  SeriesDetail,
  UpNext,
  UpNextRow,
  WatchStateDto,
} from '@/contracts';
import { asUser, unscoped, type Transaction } from '../db/client';
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
  options: { useProvider?: boolean } = {},
): Promise<SearchOutcome> {
  const provider = defaultProvider();
  const db = unscoped();

  let ids: string[] = [];
  let degraded = false;

  // Local-only search: answers from titles already in the catalog, with no
  // third-party call and no writes. Used for signed-out visitors, so an
  // anonymous bot cannot spend our provider quota or grow the database.
  if (options.useProvider === false) {
    ids = (await searchLocal(q, limit)).map((r) => r.id);
  } else try {
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
      const held = Boolean(owned && !owned.deletedAt);
      return {
        ...toWorkSummary(w),
        inLibrary: held,
        libraryStatus: (held ? owned!.status : null) as WatchStateDto | null,
        libraryProgress: held ? owned!.progress : null,
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
/**
 * The entry that immediately follows each of `fromIds` on its own spine.
 *
 * Built with the query builder rather than raw SQL: interpolating a JS array
 * into a sql`` template spreads it into ANY($1, $2, $3), which is a syntax
 * error. inArray binds it as a single array parameter.
 */
async function spineSuccessorsOf(
  tx: Transaction,
  fromIds: string[],
): Promise<{ nextId: string; fromTitle: string }[]> {
  if (!fromIds.length) return [];

  const m1 = alias(seriesMember, 'm1');
  const m2 = alias(seriesMember, 'm2');

  return tx
    .selectDistinct({
      nextId: m2.workId,
      // Match the title the user sees everywhere else; falling back to romaji
      // here made the same show appear under two different names on one
      // screen.
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
    .where(and(inArray(m1.workId, fromIds), isNotNull(m1.spineOrd)));
}

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
    .select({
      workId: seriesMember.workId,
      seriesId: seriesMember.seriesId,
      spineOrd: seriesMember.spineOrd,
    })
    .from(seriesMember)
    .where(inArray(seriesMember.workId, owned.map((o) => o.w.id)));
  const seriesIds = [...new Set(membership.map((m) => m.seriesId))];
  if (!seriesIds.length) return [];

  /**
   * One owned work belongs to ONE card.
   *
   * A work can be a member of several series. Fullmetal Alchemist (2003) and
   * Brotherhood each head their own and each appear in the other's as an
   * alternative version, along with the films and OVAs the two share. Counting
   * a work on every card it appears on meant both Fullmetal cards claimed
   * both adaptations — "47 entries" for a library of 45 — and, worse, someone
   * who owned only a shared film would have been shown the same film as two
   * separate library cards.
   *
   * Home is the series whose MAIN LINE the work sits on, since that is the
   * story it belongs to. A work on no spine anywhere is an extra everywhere,
   * and no series has a better claim than another, so the lowest series id
   * wins — arbitrary, but stable, which is what stops a card appearing and
   * disappearing between page loads.
   */
  const ordered = [...membership].sort((a, b) => (a.seriesId < b.seriesId ? -1 : 1));
  const homeByWork = new Map<string, string>();
  for (const m of ordered) {
    if (m.spineOrd === null || homeByWork.has(m.workId)) continue;
    homeByWork.set(m.workId, m.seriesId);
  }
  for (const m of ordered) {
    if (!homeByWork.has(m.workId)) homeByWork.set(m.workId, m.seriesId);
  }

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
      .filter((x): x is (typeof owned)[number] => Boolean(x))
      // Counted on its home card only, so nothing is counted twice and no
      // work produces two cards.
      .filter((o) => homeByWork.get(o.w.id) === s.id);
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

    /**
     * Episode-level progress across the spine.
     *
     * Entry counts flatter long franchises and punish short ones: "1 of 2
     * entries" of One Piece reads as halfway and is nowhere near it. Counted
     * over the spine only, to stay consistent with totalEntries.
     */
    const rollSpine = spine.length
      ? spine
      : members.filter((m) => ownedByWork.has(m.w.id));

    let episodesWatched = 0;
    let episodesTotal: number | null = 0;
    let availableNow = 0;

    for (const m of rollSpine) {
      const o = ownedByWork.get(m.w.id);
      const count = m.w.episodeCount;

      // An entry marked completed counts in full even if the episode counter
      // was never ticked up — people mark a season watched without walking
      // the stepper to 12.
      if (o) {
        episodesWatched +=
          o.uw.status === 'completed'
            ? (count ?? o.uw.progress)
            : Math.min(o.uw.progress, count ?? o.uw.progress);
      }

      // One unknown count makes the whole total a guess, so say so rather
      // than quietly reporting a smaller number as if it were the truth.
      if (episodesTotal !== null) {
        episodesTotal = count === null ? null : episodesTotal + count;
      }

      const released = m.w.releaseStatus === 'finished' || m.w.releaseStatus === 'airing';
      // Anything already decided on or under way is not backlog: dropped is a
      // choice, and the entry in progress is reported by `current` instead,
      // so counting it here would show it twice on one row.
      const settled =
        o &&
        (o.uw.status === 'completed' ||
          o.uw.status === 'dropped' ||
          o.uw.status === 'watching' ||
          o.uw.progress > 0);
      if (released && !settled) availableNow += 1;
    }

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
      episodesWatched,
      episodesTotal,
      availableNow,
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
      const successors = await spineSuccessorsOf(tx, completedIds);

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

/* ──────────────────────────────── up next ─────────────────────────────── */

/**
 * The backlog: what you could watch tonight, and how far in you already are.
 *
 * This exists because `planned` and `on_hold` previously had nowhere to go.
 * The add sheet told people both went to "Library", and the library is a
 * poster wall sorted by recency — so the two states that mean "I intend to
 * come back to this" were the two the app could not show you.
 *
 * Worse, intent was actively punished. Today's "arrived since you last
 * looked" is built from successors NOT already in the library, so the moment
 * you acknowledged a new season by adding it as plan-to-watch, it dropped off
 * the home page and landed nowhere. Doing nothing kept it visible; recording
 * your intent hid it. This page is where it lands instead.
 *
 * Three buckets, ordered by how much the user has already invested, and
 * deliberately disjoint so nothing is listed twice:
 *
 *   paused          owned, on_hold            — time already spent
 *   readyToStart    owned, planned, aired     — intent already stated
 *   continueSeries  NOT owned, follows a completed entry, aired
 */
export async function getUpNext(actor: Actor): Promise<UpNext> {
  // Resolved before the transaction below, not inside it: listLibrarySeries
  // opens its own asUser scope, and nesting would put a transaction inside a
  // transaction to no purpose.
  const rollups = await listLibrarySeries(actor);
  const rollBySeries = new Map(rollups.map((r) => [r.seriesId, r]));

  return asUser(actor.userId, async (tx) => {
    const owned = await tx
      .select({ uw: userWork, w: work })
      .from(userWork)
      .innerJoin(work, eq(work.id, userWork.workId))
      .where(and(eq(userWork.userId, actor.userId), isNull(userWork.deletedAt)));

    const ownedIds = new Set(owned.map((o) => o.w.id));
    const completedIds = owned
      .filter((o) => o.uw.status === 'completed')
      .map((o) => o.w.id);

    const successors = await spineSuccessorsOf(tx, completedIds);
    const nextIds = successors.map((s) => s.nextId).filter((id) => !ownedIds.has(id));
    const nextWorks = nextIds.length
      ? await tx.select().from(work).where(inArray(work.id, nextIds))
      : [];

    // work → series, so each row can carry its franchise roll-up.
    const allIds = [...ownedIds, ...nextIds];
    const member = allIds.length
      ? await tx
          .select({
            workId: seriesMember.workId,
            seriesId: seriesMember.seriesId,
            spineOrd: seriesMember.spineOrd,
          })
          .from(seriesMember)
          .where(inArray(seriesMember.workId, allIds))
      : [];
    /**
     * A work belongs to MORE THAN ONE series, so pick deliberately.
     *
     * Fullmetal Alchemist (2003) and Brotherhood each head their own series
     * and each appear in the other's as an alternative version. Building the
     * lookup with `new Map(rows.map(...))` silently kept whichever row came
     * back last, so the 2003 series was read as on-spine (true in its own
     * series) while pointing at Brotherhood's — it wore Brotherhood's
     * "0 of 1 watched, 0/64 eps", and because both then hashed to the same
     * series the two were collapsed into one row and Brotherhood vanished.
     *
     * A work's home is the series whose MAIN LINE it sits on. Only if it is
     * nobody's main line does any membership do.
     */
    const seriesByWork = new Map<string, string>();
    const spineOrdByWork = new Map<string, number>();
    for (const m of member) {
      if (m.spineOrd === null || spineOrdByWork.has(m.workId)) continue;
      spineOrdByWork.set(m.workId, m.spineOrd);
      seriesByWork.set(m.workId, m.seriesId);
    }
    for (const m of member) {
      if (!seriesByWork.has(m.workId)) seriesByWork.set(m.workId, m.seriesId);
    }

    const aired = (w: WorkRow) =>
      w.releaseStatus === 'finished' || w.releaseStatus === 'airing';

    /** On the main line, as opposed to a film, OVA or alternative version. */
    const onSpine = (w: WorkRow) => spineOrdByWork.has(w.id);
    const seriesOf = (w: WorkRow) => rollBySeries.get(seriesByWork.get(w.id) ?? '');

    /**
     * The franchise roll-up belongs to the main line only.
     *
     * An extra shares a series with the spine but is not counted in it, so
     * lending it the spine's numbers states something false: Fullmetal
     * Alchemist (2003) is a 51-episode retelling, and it was displaying
     * Brotherhood's "0 of 1 watched, 0/64 eps" as if the two were one story.
     */
    const rollOf = (w: WorkRow) => (onSpine(w) ? seriesOf(w) : undefined);

    const rowFor = (
      w: WorkRow,
      uw: UserWorkRow | null,
      reason: string | null,
    ): UpNextRow => {
      const roll = rollOf(w);
      // The link is useful even for an extra; only the counts are withheld.
      const series = seriesOf(w);
      const own = w.titleEnglish ?? w.titleRomaji;
      return {
        work: toWorkSummary(w),
        seriesSlug: series?.slug ?? null,
        // Only when it adds something. Printing "Mashle" under "Mashle" is
        // noise, and the row has little enough room as it is.
        seriesTitle: series && series.title !== own ? series.title : null,
        reason,
        progress: uw ? uw.progress : null,
        lastWatchedAt: uw?.lastWatchedAt?.toISOString() ?? null,
        entriesWatched: roll?.completedEntries ?? 0,
        entriesTotal: roll?.totalEntries ?? 1,
        /**
         * `roll ? x : y`, never `roll?.x ?? y`.
         *
         * episodesTotal is deliberately null when any entry on the spine has
         * no episode count yet, and `??` cannot tell that apart from having
         * no series at all — so it fell through to this one work's own count
         * and reported it as the franchise total. Solo Leveling, whose third
         * season is unannounced, rendered "5/12" when the truthful answer is
         * "5 of we-don't-know". A total that is quietly wrong is worse than
         * one that admits it.
         */
        episodesWatched: roll ? roll.episodesWatched : (uw?.progress ?? 0),
        episodesTotal: roll ? roll.episodesTotal : w.episodeCount,
        availableNow: roll?.availableNow ?? 0,
      };
    };

    /**
     * Rank by when the user last touched the FRANCHISE, not this entry.
     *
     * A planned season of something finished last week should outrank a
     * cold plan-to-watch added a year ago, and an entry never started has no
     * date of its own to sort by. A never-touched series falls to 0 and
     * sinks, which is the right place for it.
     */
    const seriesRecency = (w: WorkRow) => {
      const at = rollOf(w)?.lastWatchedAt;
      return at ? Date.parse(at) : 0;
    };
    const byRecency = (a: WorkRow, b: WorkRow) => seriesRecency(b) - seriesRecency(a);

    /* ── one row per series, not one per entry ── */

    type Candidate = { w: WorkRow; uw: UserWorkRow | null; reason: string | null };

    /**
     * Of several entries of one franchise, the one to watch NEXT.
     *
     * Spine order first, because that is the order the story happens in.
     * Air date breaks a tie, and the title settles the rest so the page does
     * not reshuffle between loads.
     */
    const nextFirst = (a: Candidate, b: Candidate) => {
      const oa = spineOrdByWork.get(a.w.id) ?? Number.MAX_SAFE_INTEGER;
      const ob = spineOrdByWork.get(b.w.id) ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      const da = a.w.startDate ?? '9999-99-99';
      const dbb = b.w.startDate ?? '9999-99-99';
      if (da !== dbb) return da < dbb ? -1 : 1;
      return (a.w.titleEnglish ?? a.w.titleRomaji).localeCompare(
        b.w.titleEnglish ?? b.w.titleRomaji,
      );
    };

    /**
     * A franchise is ONE decision, so it gets one row.
     *
     * Listing every qualifying entry meant Bleach filled four consecutive
     * rows — Thousand-Year Blood War parts 1 to 4 — each printing the same
     * "1 of 5 watched · 366/416 eps · 4 ready", because that line describes
     * the franchise and all four rows shared it. Four rows, one fact, and
     * every other series pushed off the screen behind them. The answer is the
     * earliest unwatched entry; "4 ready" on it already says there is more
     * behind it, and the series page has the detail.
     *
     * Only the MAIN LINE collapses. A film or an alternative version is a
     * separate thing to decide about, not a later part of the same one.
     *
     * `claimed` is shared across the buckets, in the order they are built, so
     * a franchise that qualifies twice appears in the bucket representing the
     * most investment — being paused partway outranks never having started.
     */
    const claimed = new Set<string>();
    const oneEach = (cands: Candidate[]): Candidate[] => {
      const groups = new Map<string, Candidate[]>();
      for (const c of cands) {
        const sid = seriesByWork.get(c.w.id);
        const key = sid && onSpine(c.w) ? `s:${sid}` : `w:${c.w.id}`;
        const g = groups.get(key);
        if (g) g.push(c);
        else groups.set(key, [c]);
      }
      const out: Candidate[] = [];
      for (const [key, g] of groups) {
        if (claimed.has(key)) continue;
        claimed.add(key);
        out.push(g.sort(nextFirst)[0]);
      }
      return out;
    };

    const paused = oneEach(
      owned
        .filter((o) => o.uw.status === 'on_hold')
        .map((o) => ({ w: o.w, uw: o.uw, reason: null })),
    )
      // These have a real date of their own — when you stopped.
      .sort(
        (a, b) =>
          (b.uw?.lastWatchedAt?.getTime() ?? 0) - (a.uw?.lastWatchedAt?.getTime() ?? 0),
      )
      .map((c) => rowFor(c.w, c.uw, null));

    const readyToStart = oneEach(
      owned
        .filter((o) => o.uw.status === 'planned' && aired(o.w))
        .map((o) => ({ w: o.w, uw: o.uw, reason: null })),
    )
      .sort((a, b) => byRecency(a.w, b.w))
      .map((c) => rowFor(c.w, c.uw, null));

    const fromTitle = new Map(successors.map((s) => [s.nextId, s.fromTitle]));
    const continueSeries = oneEach(
      nextWorks
        .filter(aired)
        .map((w) => ({ w, uw: null, reason: `follows ${fromTitle.get(w.id) ?? ''}` })),
    )
      .sort((a, b) => byRecency(a.w, b.w))
      .map((c) => rowFor(c.w, null, c.reason));

    // Not actionable yet, but it was added or awaited, so the page has to say
    // where it went rather than appear to have lost it.
    const notOutYet =
      owned.filter((o) => o.uw.status === 'planned' && !aired(o.w)).length +
      nextWorks.filter((w) => !aired(w)).length;

    return { paused, readyToStart, continueSeries, notOutYet };
  });
}
