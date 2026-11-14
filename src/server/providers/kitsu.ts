import type { ReleaseStatus, RelationKind, WorkKind } from '../domain/types';
import { type CacheAdapter, fetchJson, kitsuBucket } from './http';
import {
  type AnimeProvider,
  type ProviderCapabilities,
  ProviderNotFoundError,
  type RawEpisode,
  type RawRelation,
  type RawWork,
} from './types';

/**
 * Kitsu — the primary source.
 *
 * Chosen after the mirror we started on (Jikan) proved unusable: measured at
 * 1/10 then 0/10 successful requests across three sessions, while Kitsu
 * answered 8/8 in under a second.
 *
 * It is the only source that covers everything this app needs at once:
 *
 *   - no API key, so the app works on a fresh clone with no signup
 *   - TYPED relations (`sequel`, `spinoff`, `alternative_version`…) which the
 *     series builder depends on and which no key-free source otherwise gives
 *   - the related work's subtype and status INLINE, removing the extra
 *     request per neighbour that Jikan forces
 *   - episode lists, which the official MyAnimeList API v2 does not expose
 *   - poster AND cover art, so pages have a real backdrop
 *
 * It speaks JSON:API, so related records arrive in a separate `included`
 * array keyed by (type, id) rather than nested — hence the lookup maps below.
 */

const BASE = 'https://kitsu.io/api/edge';
const HEADERS = { Accept: 'application/vnd.api+json' };

/* ─────────────────────── provider vocabulary maps ─────────────────────── */

const KIND: Record<string, WorkKind> = {
  TV: 'tv',
  ONA: 'ona',
  OVA: 'ova',
  movie: 'movie',
  special: 'special',
  music: 'music',
};

const STATUS: Record<string, ReleaseStatus> = {
  finished: 'finished',
  current: 'airing',
  upcoming: 'not_yet_aired',
  unreleased: 'not_yet_aired',
  tba: 'unknown',
};

/**
 * Kitsu's `role` values, mapped to the domain vocabulary.
 *
 * Note `spinoff` — one word, where MyAnimeList writes `Spin-Off` and the
 * domain uses `spin_off`. Normalised below rather than matched exactly,
 * because an exact-match table is precisely how every OVA and spin-off once
 * went silently missing from Jikan's data.
 */
const RELATION: Record<string, RelationKind> = {
  sequel: 'sequel',
  prequel: 'prequel',
  sidestory: 'side_story',
  parentstory: 'parent_story',
  summary: 'summary',
  fullstory: 'full_story',
  alternativeversion: 'alternative_version',
  alternativesetting: 'alternative_setting',
  spinoff: 'spin_off',
  adaptation: 'adaptation',
  character: 'character',
  other: 'other',
};

const relationKey = (role: string) => role.toLowerCase().replace(/[^a-z]/g, '');

/* ──────────────────────────── raw payloads ──────────────────────────── */

interface KitsuResource {
  id: string;
  type: string;
  attributes: KitsuAnimeAttrs;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}

interface KitsuAnimeAttrs {
  canonicalTitle?: string;
  titles?: Record<string, string>;
  abbreviatedTitles?: string[] | null;
  synopsis?: string | null;
  subtype?: string;
  status?: string;
  episodeCount?: number | null;
  episodeLength?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  posterImage?: Record<string, string> | null;
  coverImage?: Record<string, string> | null;
  averageRating?: string | null;
  popularityRank?: number | null;
  /** On an episode resource. */
  number?: number | null;
  airdate?: string | null;
}

const day = (v?: string | null) => (v ? v.slice(0, 10) : null);

export function normaliseKitsuWork(r: KitsuResource): RawWork {
  const a = r.attributes ?? {};
  const titles = a.titles ?? {};

  // en_jp is the romaji transliteration; `canonicalTitle` is whichever Kitsu
  // considers primary and is not reliably one or the other.
  const romaji = titles.en_jp || a.canonicalTitle || 'Untitled';
  const english = titles.en || titles.en_us || null;

  const synonyms = [
    ...(a.abbreviatedTitles ?? []),
    ...Object.values(titles).filter((t) => t && t !== romaji && t !== english),
  ];

  return {
    providerId: r.id,
    kind: KIND[a.subtype ?? ''] ?? 'unknown',
    titleRomaji: romaji,
    titleEnglish: english && english !== romaji ? english : null,
    titleNative: titles.ja_jp ?? null,
    synonyms: [...new Set(synonyms)],
    synopsis: a.synopsis || null,
    coverUrl:
      a.posterImage?.large ?? a.posterImage?.medium ?? a.posterImage?.original ?? null,
    // Kitsu is the only source we have that ships a real banner.
    bannerUrl: a.coverImage?.large ?? a.coverImage?.original ?? null,
    // 0 means unknown or still running, never "no episodes" — conflating the
    // two makes an airing show render as 0/0 and look finished.
    episodeCount: a.episodeCount && a.episodeCount > 0 ? a.episodeCount : null,
    // Already minutes here, unlike MAL's seconds and Jikan's "24 min per ep".
    durationMin: a.episodeLength && a.episodeLength > 0 ? a.episodeLength : null,
    releaseStatus: STATUS[a.status ?? ''] ?? 'unknown',
    startDate: day(a.startDate),
    endDate: day(a.endDate),
    seasonYear: a.startDate ? Number(a.startDate.slice(0, 4)) : null,
    // Kitsu does not publish a broadcast slot.
    broadcastDow: null,
    broadcastTime: null,
    broadcastTz: null,
    genres: [],
    studios: [],
    score: a.averageRating ? Number(a.averageRating) / 10 : null,
    popularity: a.popularityRank ?? null,
    raw: r,
  };
}

/* ───────────────────────────── the provider ───────────────────────────── */

export class KitsuProvider implements AnimeProvider {
  readonly id = 'kitsu' as const;

  readonly capabilities: ProviderCapabilities = {
    // The reason this is primary: a neighbour arrives classified.
    inlinesRelationMetadata: true,
    maxRequestsPerMinute: 60,
  };

  constructor(private readonly cache?: CacheAdapter) {}

  private get<T>(
    path: string,
    ttlMs?: number,
    budget: 'interactive' | 'background' = 'background',
  ) {
    const limits =
      budget === 'interactive'
        ? { attempts: 1, timeoutMs: 6_000 }
        : { attempts: 4, timeoutMs: 15_000 };

    return fetchJson<T>(`${BASE}${path}`, {
      bucket: kitsuBucket,
      cache: this.cache,
      provider: 'kitsu',
      headers: HEADERS,
      ttlMs,
      ...limits,
    });
  }

  async search(query: string, limit = 20): Promise<RawWork[]> {
    const qs = new URLSearchParams({
      'filter[text]': query.trim(),
      'page[limit]': String(Math.min(limit, 20)),
    });
    // Short TTL: a just-announced sequel is exactly what someone searching is
    // most likely to be looking for.
    const { data } = await this.get<{ data: KitsuResource[] }>(
      `/anime?${qs}`,
      15 * 60 * 1000,
      'interactive',
    );
    return (data?.data ?? []).map(normaliseKitsuWork);
  }

  async getWork(providerId: string): Promise<RawWork> {
    const { data } = await this.get<{ data: KitsuResource }>(
      `/anime/${providerId}`,
      undefined,
      'interactive',
    );
    if (!data?.data) throw new ProviderNotFoundError('kitsu', providerId);
    return normaliseKitsuWork(data.data);
  }

  async getRelations(providerId: string): Promise<RawRelation[]> {
    const qs = new URLSearchParams({
      'filter[source_id]': providerId,
      'filter[source_type]': 'Anime',
      include: 'destination',
      'page[limit]': '20',
    });

    const { data } = await this.get<{
      data: Array<{
        attributes: { role?: string };
        relationships?: { destination?: { data?: { id: string; type: string } | null } };
      }>;
      included?: KitsuResource[];
    }>(`/media-relationships?${qs}`);

    // JSON:API returns the related records flat in `included`, keyed by
    // (type, id) — the relationship entry itself only holds a pointer.
    const included = new Map<string, KitsuResource>();
    for (const r of data?.included ?? []) included.set(`${r.type}:${r.id}`, r);

    const out: RawRelation[] = [];
    for (const rel of data?.data ?? []) {
      const kind = RELATION[relationKey(rel.attributes?.role ?? '')];
      if (!kind) continue;

      const ptr = rel.relationships?.destination?.data;
      // Manga and novels share the relationship table; a different medium is
      // of no use to the series builder.
      if (!ptr || ptr.type !== 'anime') continue;

      const node = included.get(`${ptr.type}:${ptr.id}`);
      const a = node?.attributes;

      out.push({
        kind,
        providerId: ptr.id,
        // The payoff: an `included` node carries the same attributes as a full
        // anime record — art, episode count, dates — so the neighbour can be
        // normalised outright rather than stubbed. No extra request, and no
        // posterless placeholder left behind.
        hint: node
          ? {
              title: a?.titles?.en_jp || a?.canonicalTitle,
              kind: a?.subtype ? KIND[a.subtype] : undefined,
              releaseStatus: a?.status ? STATUS[a.status] : undefined,
              startDate: day(a?.startDate),
              work: normaliseKitsuWork(node),
            }
          : undefined,
      });
    }
    return out;
  }

  async getEpisodes(providerId: string): Promise<RawEpisode[]> {
    const out: RawEpisode[] = [];
    let offset = 0;

    for (;;) {
      const qs = new URLSearchParams({
        'page[limit]': '20',
        'page[offset]': String(offset),
      });
      const { data } = await this.get<{
        data: KitsuResource[];
        meta?: { count?: number };
      }>(`/anime/${providerId}/episodes?${qs}`, 24 * 60 * 60 * 1000);

      const page = data?.data ?? [];
      for (const e of page) {
        const a = e.attributes ?? {};
        if (a.number == null) continue;
        out.push({
          number: a.number,
          title: a.canonicalTitle || null,
          airDate: day(a.airdate),
          // Kitsu does not mark filler.
          isFiller: null,
          isRecap: null,
        });
      }

      if (page.length < 20) break;
      offset += 20;
      // One Piece is 1000+ episodes at 20/page. Hard stop so a long-runner
      // cannot drain the whole rate budget in one call; the rest arrives on a
      // later pass.
      if (offset >= 600) break;
    }

    return out;
  }
}
