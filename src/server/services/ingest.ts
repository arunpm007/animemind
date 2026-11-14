import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildSeries } from '../domain/series';
import type { GraphEdge, GraphNode, RelationKind } from '../domain/types';
import { unscoped } from '../db/client';
import {
  episode as episodeTable,
  providerCache,
  series,
  seriesMember,
  work,
  workEvent,
  workRelation,
} from '../db/schema';
import { ChainProvider } from '../providers/chain';
import { JikanProvider } from '../providers/jikan';
import { KitsuProvider } from '../providers/kitsu';
import { MalProvider } from '../providers/mal';
import type { AnimeProvider, RawWork } from '../providers/types';
import type { CacheAdapter } from '../providers/http';

/**
 * Ingestion: provider -> normalised rows -> derived series.
 *
 * The rule that shapes everything here is that adding a title must feel
 * instant. Jikan gives no format or status for a related work, so classifying
 * one neighbour costs one request, and a franchise like Fate has dozens. Doing
 * that inline would mean a thirty-second spinner on "Add", so the flow is:
 *
 *   1. fetch the seed                         (1 request, blocking)
 *   2. write it, return to the user           (instant)
 *   3. walk the neighbourhood in background   (N requests, budgeted)
 *   4. recompute the series, emit events      (no requests)
 *
 * Step 3 is resumable and idempotent, so a crash or a rate-limit pause costs
 * nothing but time.
 */

/** Postgres-backed provider cache: dev reloads and retries cost no API budget. */
const dbCache: CacheAdapter = {
  async get(url) {
    const db = unscoped();
    const row = await db.query.providerCache.findFirst({
      where: eq(providerCache.url, url),
    });
    return row ? { body: row.body, fetchedAt: row.fetchedAt } : null;
  },
  async set(url, body, status) {
    const db = unscoped();
    await db
      .insert(providerCache)
      .values({ url, body: body as object, status })
      .onConflictDoUpdate({
        target: providerCache.url,
        set: { body: body as object, status, fetchedAt: new Date() },
      });
  },
};

/**
 * Provider selection.
 *
 * With MAL_CLIENT_ID set: the official MyAnimeList API leads and Jikan backs
 * it up. That ordering is not just about uptime — MAL v2 has no episode
 * endpoint, so episode lookups fall through to Jikan by design, while search,
 * details and relations get a first-party source that also inlines the
 * relation metadata.
 *
 * Without it: Jikan alone, which is where this started.
 */
export function defaultProvider(): AnimeProvider {
  // Kitsu leads, always. It needs no API key, so a fresh clone works with no
  // signup, and it is the only key-free source with TYPED relations — which
  // the series builder cannot function without. Measured 8/8 available while
  // Jikan managed 0/10.
  const chain: AnimeProvider[] = [new KitsuProvider(dbCache)];

  // Optional second opinion. MAL has richer broadcast data (day and time of
  // week, which Kitsu omits), so it is worth having when a key is configured.
  const malClientId = process.env.MAL_CLIENT_ID?.trim();
  if (malClientId) chain.push(new MalProvider(malClientId, dbCache));

  // Last resort. Kept because it carries filler-episode flags that nothing
  // else does, and a third fallback costs nothing when the first two work.
  chain.push(new JikanProvider(dbCache));

  return new ChainProvider(chain);
}

/* ─────────────────────────── change detection ─────────────────────────── */

/**
 * Hash only the fields whose change is worth telling a user about.
 *
 * Score and popularity churn constantly and mean nothing here; including them
 * would mark every work dirty on every sync and drown the real signal.
 */
export function contentHashOf(w: RawWork): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        w.releaseStatus,
        w.episodeCount,
        w.startDate,
        w.endDate,
        w.broadcastDow,
        w.broadcastTime,
        w.kind,
      ]),
    )
    .digest('hex');
}

const NEXT_SYNC: Record<string, number> = {
  airing: 6 * 60 * 60 * 1000,
  not_yet_aired: 24 * 60 * 60 * 1000,
  finished: 30 * 24 * 60 * 60 * 1000,
  cancelled: 30 * 24 * 60 * 60 * 1000,
  hiatus: 7 * 24 * 60 * 60 * 1000,
  unknown: 7 * 24 * 60 * 60 * 1000,
};

function nextSyncAt(w: RawWork): Date {
  let ms = NEXT_SYNC[w.releaseStatus] ?? NEXT_SYNC.unknown;
  // An unaired title with a date inside the next month is about to become the
  // most interesting row in the database; check it daily rather than weekly.
  if (w.releaseStatus === 'not_yet_aired' && w.startDate) {
    const days = (Date.parse(w.startDate) - Date.now()) / 86_400_000;
    if (days <= 30) ms = 24 * 60 * 60 * 1000;
  }
  return new Date(Date.now() + ms);
}

/* ──────────────────────────────── upsert ──────────────────────────────── */

function rowFrom(w: RawWork, providerId: 'jikan' | 'mal' | 'kitsu') {
  return {
    provider: providerId,
    providerId: w.providerId,
    kind: w.kind,
    titleRomaji: w.titleRomaji,
    titleEnglish: w.titleEnglish,
    titleNative: w.titleNative,
    synonyms: w.synonyms,
    synopsis: w.synopsis,
    coverUrl: w.coverUrl,
    bannerUrl: w.bannerUrl,
    episodeCount: w.episodeCount,
    durationMin: w.durationMin,
    releaseStatus: w.releaseStatus,
    startDate: w.startDate,
    endDate: w.endDate,
    seasonYear: w.seasonYear,
    broadcastDow: w.broadcastDow,
    broadcastTime: w.broadcastTime,
    broadcastTz: w.broadcastTz,
    genres: w.genres,
    studios: w.studios,
    score: w.score === null ? null : String(w.score),
    popularity: w.popularity,
    raw: w.raw as object,
    contentHash: contentHashOf(w),
    lastSyncedAt: new Date(),
    nextSyncAt: nextSyncAt(w),
    syncFailures: 0,
  };
}

export interface UpsertResult {
  id: string;
  changed: boolean;
  events: Array<{ type: string; before: unknown; after: unknown }>;
}

/** Insert or update one work, emitting an event for each meaningful change. */
export async function upsertWork(
  w: RawWork,
  providerId: 'jikan' | 'mal' | 'kitsu' = 'kitsu',
): Promise<UpsertResult> {
  const db = unscoped();
  const next = rowFrom(w, providerId);

  const existing = await db.query.work.findFirst({
    where: and(eq(work.provider, providerId), eq(work.providerId, w.providerId)),
  });

  if (!existing) {
    const [row] = await db.insert(work).values(next).returning({ id: work.id });
    return { id: row.id, changed: true, events: [] };
  }

  const events: UpsertResult['events'] = [];
  if (existing.contentHash !== next.contentHash) {
    if (existing.releaseStatus !== next.releaseStatus) {
      events.push({
        type: 'status_changed',
        before: existing.releaseStatus,
        after: next.releaseStatus,
      });
    }
    if (existing.episodeCount !== next.episodeCount) {
      events.push({
        type: 'episode_count_changed',
        before: existing.episodeCount,
        after: next.episodeCount,
      });
    }
    if (existing.startDate !== next.startDate) {
      events.push({
        type: 'date_changed',
        before: existing.startDate,
        after: next.startDate,
      });
    }
  }

  await db.update(work).set(next).where(eq(work.id, existing.id));

  if (events.length) {
    await db
      .insert(workEvent)
      .values(events.map((e) => ({ workId: existing.id, ...e })));
  }

  return { id: existing.id, changed: events.length > 0, events };
}

/* ──────────────────────────── relation walk ──────────────────────────── */

export interface HydrateOptions {
  /** Maximum works fetched in one pass. Bounds the API spend per job. */
  budget?: number;
  /** BFS depth from the seed. 2 covers a season chain plus its extras. */
  depth?: number;
}

/**
 * Walk the relation neighbourhood, resolving each neighbour into a real row.
 *
 * Budgeted and resumable on purpose. If the budget runs out mid-franchise the
 * series is simply computed from what is known so far, and the next pass
 * continues — a partially hydrated series renders correctly (the builder
 * tolerates `unknown` kinds) rather than failing.
 */
export async function hydrateRelations(
  seedWorkId: string,
  provider: AnimeProvider = defaultProvider(),
  { budget = 25, depth = 2 }: HydrateOptions = {},
): Promise<{ fetched: number; discovered: number }> {
  const db = unscoped();
  const seed = await db.query.work.findFirst({ where: eq(work.id, seedWorkId) });
  if (!seed) throw new Error(`hydrateRelations: unknown work ${seedWorkId}`);

  let fetched = 0;
  let discovered = 0;
  const visited = new Set<string>();
  const queue: Array<{ providerId: string; level: number }> = [
    { providerId: seed.providerId, level: 0 },
  ];

  while (queue.length && fetched < budget) {
    const { providerId, level } = queue.shift()!;
    if (visited.has(providerId)) continue;
    visited.add(providerId);

    let relations;
    try {
      relations = await provider.getRelations(providerId);
      fetched += 1;
    } catch {
      // One unreachable neighbour must not abort the walk; the next pass
      // retries it and the series renders from what resolved.
      continue;
    }

    const fromRow = await db.query.work.findFirst({
      where: and(eq(work.provider, provider.id), eq(work.providerId, providerId)),
    });
    if (!fromRow) continue;

    for (const rel of relations) {
      let toRow = await db.query.work.findFirst({
        where: and(eq(work.provider, provider.id), eq(work.providerId, rel.providerId)),
      });

      if (!toRow) {
        // The payoff of a provider that inlines relation metadata: a neighbour
        // arrives with enough detail (medium, status, date) for the series
        // builder to place it, so no request is needed at all. With Jikan this
        // branch never fires and each neighbour costs one call — which is the
        // whole reason hydration is budgeted and backgrounded.
        const hint = rel.hint;
        if (hint?.kind && hint.title) {
          const { id } = await upsertWork(
            {
              providerId: rel.providerId,
              kind: hint.kind,
              titleRomaji: hint.title,
              titleEnglish: null,
              titleNative: null,
              synonyms: [],
              synopsis: null,
              coverUrl: null,
              bannerUrl: null,
              episodeCount: null,
              durationMin: null,
              releaseStatus: hint.releaseStatus ?? 'unknown',
              startDate: hint.startDate ?? null,
              endDate: null,
              seasonYear: hint.startDate ? Number(hint.startDate.slice(0, 4)) : null,
              broadcastDow: null,
              broadcastTime: null,
              broadcastTz: null,
              genres: [],
              studios: [],
              score: null,
              popularity: null,
              raw: { fromRelationHint: true },
            },
            provider.id,
          );
          discovered += 1;
          toRow = await db.query.work.findFirst({ where: eq(work.id, id) });
        } else if (level < depth && fetched < budget) {
          try {
            const raw = await provider.getWork(rel.providerId);
            fetched += 1;
            const { id } = await upsertWork(raw, provider.id);
            discovered += 1;
            toRow = await db.query.work.findFirst({ where: eq(work.id, id) });
          } catch {
            continue;
          }
        }
      }
      if (!toRow) continue;

      await db
        .insert(workRelation)
        .values({ fromWorkId: fromRow.id, toWorkId: toRow.id, kind: rel.kind })
        .onConflictDoNothing();

      if (level + 1 <= depth && !visited.has(rel.providerId)) {
        queue.push({ providerId: rel.providerId, level: level + 1 });
      }
    }

    await db
      .update(work)
      .set({ relationsHydrated: true })
      .where(eq(work.id, fromRow.id));
  }

  return { fetched, discovered };
}

/* ───────────────────────── series computation ───────────────────────── */

const SLUG = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Current algorithm revision. Bumping it invalidates every cached series. */
export const GRAPH_VERSION = 1;

/**
 * Recompute the series containing `seedWorkId` and persist it.
 *
 * Pure derivation: reads work + work_relation, runs the domain builder, writes
 * series + series_member. Safe to run at any time; it never touches user data.
 */
export async function recomputeSeries(seedWorkId: string): Promise<string> {
  const db = unscoped();

  // Pull the connected component around the seed.
  //
  // The depth limit must exceed the longest sequel chain in the catalog, not
  // merely "a couple of hops": Attack on Titan alone is six entries deep, and
  // a limit of 4 silently truncated the newest seasons — the exact thing this
  // product exists to surface. Long-runners like Gundam and Precure go deeper
  // still, so the limit is set well past any real franchise.
  //
  // `character` and `adaptation` edges are excluded here rather than later.
  // They cross into other franchises and other media, and following them turns
  // the walk into a traversal of most of the catalog via shared voice cast —
  // which is both wrong and the one realistic way this query could blow up.
  const component = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE reach(id, depth) AS (
      SELECT ${seedWorkId}::uuid, 0
      UNION
      SELECT CASE WHEN r.from_work_id = reach.id THEN r.to_work_id
                  ELSE r.from_work_id END,
             reach.depth + 1
        FROM work_relation r
        JOIN reach ON (r.from_work_id = reach.id OR r.to_work_id = reach.id)
       WHERE reach.depth < 24
         AND r.kind NOT IN ('character', 'adaptation')
    )
    SELECT DISTINCT id FROM reach
  `);

  const ids = [...new Set(component.map((r) => r.id))];
  const works = await db.select().from(work).where(inArray(work.id, ids));
  const rels = ids.length
    ? await db
        .select()
        .from(workRelation)
        .where(inArray(workRelation.fromWorkId, ids))
    : [];

  const nodes: GraphNode[] = works.map((w) => ({
    id: w.id,
    title: w.titleEnglish ?? w.titleRomaji,
    kind: w.kind,
    status: w.releaseStatus,
    startDate: w.startDate,
    episodeCount: w.episodeCount,
  }));
  const edges: GraphEdge[] = rels.map((r) => ({
    from: r.fromWorkId,
    to: r.toWorkId,
    kind: r.kind as RelationKind,
  }));

  const graph = buildSeries({ seedId: seedWorkId, nodes, edges });

  const rootId = graph.spine[0]?.workId ?? seedWorkId;
  const rootWork = works.find((w) => w.id === rootId);
  const title = rootWork?.titleEnglish ?? rootWork?.titleRomaji ?? 'Untitled';

  // The series is keyed by its root work, so recomputation updates in place
  // rather than accumulating duplicates as a franchise grows.
  const existing = await db.query.series.findFirst({
    where: eq(series.rootWorkId, rootId),
  });

  let seriesId: string;
  const values = {
    rootWorkId: rootId,
    title,
    slug: `${SLUG(title)}-${rootId.slice(0, 8)}`,
    ambiguous: graph.diagnostics.ambiguous,
    diagnostics: graph.diagnostics as unknown as object,
    graphVersion: GRAPH_VERSION,
    computedAt: new Date(),
  };

  if (existing) {
    await db.update(series).set(values).where(eq(series.id, existing.id));
    seriesId = existing.id;
    await db.delete(seriesMember).where(eq(seriesMember.seriesId, seriesId));
  } else {
    const [row] = await db.insert(series).values(values).returning({ id: series.id });
    seriesId = row.id;
  }

  const members = [
    ...graph.spine.map((s) => ({
      seriesId,
      workId: s.workId,
      spineOrd: s.ord,
      track: null,
      via: null,
    })),
    ...graph.extras.map((e) => ({
      seriesId,
      workId: e.workId,
      spineOrd: null,
      track: e.track,
      via: e.via,
    })),
  ];
  if (members.length) await db.insert(seriesMember).values(members);

  return seriesId;
}

/* ──────────────────────────── public entry ──────────────────────────── */

/**
 * Resolve a provider id into a local work, fast.
 *
 * Returns as soon as the seed row exists. Relation hydration and series
 * computation are the caller's decision to schedule, because the interactive
 * "Add" path wants to return now and the background job wants to wait.
 */
export async function ensureWork(
  providerWorkId: string,
  provider: AnimeProvider = defaultProvider(),
): Promise<string> {
  const db = unscoped();
  const existing = await db.query.work.findFirst({
    where: and(eq(work.provider, provider.id), eq(work.providerId, providerWorkId)),
  });
  if (existing) return existing.id;

  const raw = await provider.getWork(providerWorkId);
  const { id } = await upsertWork(raw, provider.id);
  return id;
}

/* ───────────────────── background hydration ───────────────────── */

/** Works currently being hydrated, so two adds cannot duplicate the walk. */
const hydrating = new Set<string>();

/**
 * Walk relations and build the series, without making the caller wait.
 *
 * Adding a title used to record the work and stop there: no relations, no
 * series, no "season 3 is announced" — the answer the whole product exists to
 * give. The refresh worker would eventually notice, but "eventually" is up to
 * six hours after someone pressed Add, which is indistinguishable from broken.
 *
 * Deliberately fire-and-forget. The HTTP response returns in ~100ms while this
 * continues in the background; a long-running Node process is exactly what
 * this app deploys as, which is also why it is not on serverless.
 */
export function scheduleHydration(workId: string): void {
  if (hydrating.has(workId)) return;
  hydrating.add(workId);

  void (async () => {
    try {
      const db = unscoped();
      const row = await db.query.work.findFirst({ where: eq(work.id, workId) });
      if (!row) return;

      if (!row.relationsHydrated) {
        await hydrateRelations(workId, defaultProvider(), { budget: 25, depth: 2 });
      }
      await recomputeSeries(workId);
    } catch (err) {
      // Never surface: the title is already saved and usable, and the next
      // refresh run retries. Failing here must not break the add.
      console.warn(`background hydration failed for ${workId}:`, err);
    } finally {
      hydrating.delete(workId);
    }
  })();
}

/** Fill the episode list. Lazy: One Piece is 11 pages and nobody is waiting. */
export async function hydrateEpisodes(
  workId: string,
  provider: AnimeProvider = defaultProvider(),
): Promise<number> {
  const db = unscoped();
  const row = await db.query.work.findFirst({ where: eq(work.id, workId) });
  if (!row) return 0;

  const eps = await provider.getEpisodes(row.providerId);
  if (!eps.length) return 0;

  await db
    .insert(episodeTable)
    .values(
      eps.map((e) => ({
        workId,
        number: e.number,
        title: e.title,
        airDate: e.airDate,
        isFiller: e.isFiller,
        isRecap: e.isRecap,
      })),
    )
    .onConflictDoUpdate({
      target: [episodeTable.workId, episodeTable.number],
      set: {
        title: sql`excluded.title`,
        airDate: sql`excluded.air_date`,
        isFiller: sql`excluded.is_filler`,
      },
    });

  await db.update(work).set({ episodesHydrated: true }).where(eq(work.id, workId));
  return eps.length;
}
