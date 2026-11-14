import type { ReleaseStatus, RelationKind, WorkKind } from '../domain/types';
import { type CacheAdapter, fetchJson, jikanBucket } from './http';
import {
  type AnimeProvider,
  type ProviderCapabilities,
  ProviderNotFoundError,
  type RawEpisode,
  type RawRelation,
  type RawWork,
} from './types';

const BASE = 'https://api.jikan.moe/v4';

/* ─────────────────────── provider vocabulary maps ─────────────────────── */

const KIND: Record<string, WorkKind> = {
  TV: 'tv',
  'TV Special': 'special',
  Movie: 'movie',
  OVA: 'ova',
  ONA: 'ona',
  Special: 'special',
  Music: 'music',
  CM: 'special',
  PV: 'special',
};

const STATUS: Record<string, ReleaseStatus> = {
  'Finished Airing': 'finished',
  'Currently Airing': 'airing',
  'Not yet aired': 'not_yet_aired',
};

/**
 * Jikan's relation labels, mapped into the domain vocabulary.
 *
 * `Alternative version` vs `Sequel` is the single most consequential mapping
 * in this file: get it wrong and Fate/Monogatari order incorrectly, because
 * the series builder treats one as a continuation and the other as a retelling.
 *
 * Keys are looked up case- and punctuation-insensitively. The live API returns
 * "Side Story" and "Spin-Off" where the documentation shows "Side story" and
 * "Spin-off"; an exact-match table drops those on the floor silently, taking
 * every OVA and spin-off out of the franchise with them. Normalising the key
 * makes the mapping immune to that drift.
 */
const RELATION: Record<string, RelationKind> = {
  sequel: 'sequel',
  prequel: 'prequel',
  sidestory: 'side_story',
  parentstory: 'parent_story',
  summary: 'summary',
  alternativeversion: 'alternative_version',
  alternativesetting: 'alternative_setting',
  spinoff: 'spin_off',
  character: 'character',
  adaptation: 'adaptation',
  fullstory: 'full_story',
  other: 'other',
};

/** "Spin-Off" -> "spinoff", "Side Story" -> "sidestory". */
const relationKey = (label: string) => label.toLowerCase().replace(/[^a-z]/g, '');

const DOW: Record<string, number> = {
  Sundays: 0,
  Mondays: 1,
  Tuesdays: 2,
  Wednesdays: 3,
  Thursdays: 4,
  Fridays: 5,
  Saturdays: 6,
};

/* ──────────────────────────── raw payloads ──────────────────────────── */

interface JikanAnime {
  mal_id: number;
  images?: { webp?: Record<string, string>; jpg?: Record<string, string> };
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms?: string[];
  type: string | null;
  episodes: number | null;
  status: string | null;
  aired?: { from: string | null; to: string | null };
  duration: string | null;
  synopsis: string | null;
  season: string | null;
  year: number | null;
  broadcast?: { day: string | null; time: string | null; timezone: string | null };
  studios?: Array<{ name: string }>;
  genres?: Array<{ name: string }>;
  themes?: Array<{ name: string }>;
  score: number | null;
  popularity: number | null;
  relations?: Array<{
    relation: string;
    entry: Array<{ mal_id: number; type: string; name: string }>;
  }>;
}

const isoDate = (v: string | null | undefined): string | null =>
  v ? (v.slice(0, 10) || null) : null;

function minutesFrom(duration: string | null): number | null {
  if (!duration) return null;
  const hr = /(\d+)\s*hr/.exec(duration);
  const min = /(\d+)\s*min/.exec(duration);
  const total = (hr ? Number(hr[1]) * 60 : 0) + (min ? Number(min[1]) : 0);
  return total > 0 ? total : null;
}

export function normaliseJikanWork(a: JikanAnime): RawWork {
  return {
    providerId: String(a.mal_id),
    kind: KIND[a.type ?? ''] ?? 'unknown',
    titleRomaji: a.title,
    titleEnglish: a.title_english ?? null,
    titleNative: a.title_japanese ?? null,
    synonyms: a.title_synonyms ?? [],
    synopsis: a.synopsis ?? null,
    coverUrl:
      a.images?.webp?.large_image_url ??
      a.images?.jpg?.large_image_url ??
      a.images?.jpg?.image_url ??
      null,
    bannerUrl: null, // Jikan exposes no banner art; the UI derives one from the cover.
    // A 0 from the provider means "unknown", not "no episodes". Conflating the
    // two makes an airing show render as 0/0 and look finished.
    episodeCount: a.episodes && a.episodes > 0 ? a.episodes : null,
    durationMin: minutesFrom(a.duration),
    releaseStatus: STATUS[a.status ?? ''] ?? 'unknown',
    startDate: isoDate(a.aired?.from),
    endDate: isoDate(a.aired?.to),
    seasonYear: a.year ?? null,
    broadcastDow: a.broadcast?.day ? (DOW[a.broadcast.day] ?? null) : null,
    broadcastTime: a.broadcast?.time ?? null,
    broadcastTz: a.broadcast?.timezone ?? null,
    genres: [...(a.genres ?? []), ...(a.themes ?? [])].map((g) => g.name),
    studios: (a.studios ?? []).map((s) => s.name),
    score: a.score ?? null,
    popularity: a.popularity ?? null,
    raw: a,
  };
}

export function normaliseJikanRelations(a: JikanAnime): RawRelation[] {
  const out: RawRelation[] = [];
  for (const group of a.relations ?? []) {
    const kind = RELATION[relationKey(group.relation)];
    if (!kind) continue;
    for (const entry of group.entry) {
      // Manga, novels and light novels share the id space but are a different
      // medium; the series builder has no use for them.
      if (entry.type !== 'anime') continue;
      out.push({
        kind,
        providerId: String(entry.mal_id),
        // Jikan gives a name but no format or status, so the series builder
        // cannot classify this neighbour without a follow-up fetch. That is
        // exactly why relation hydration is a background job.
        hint: { title: entry.name },
      });
    }
  }
  return out;
}

/* ───────────────────────────── the provider ───────────────────────────── */

export class JikanProvider implements AnimeProvider {
  readonly id = 'jikan' as const;

  readonly capabilities: ProviderCapabilities = {
    inlinesRelationMetadata: false,
    maxRequestsPerMinute: 50,
  };

  constructor(private readonly cache?: CacheAdapter) {}

  /**
   * `budget` separates the two very different patience levels in this app.
   * A person watching a spinner will abandon at ~10s, so the interactive path
   * gets few attempts and a short deadline and surfaces a real error. A
   * background job has all night, so it retries patiently instead of giving up
   * and leaving the catalog stale.
   */
  private get<T>(
    path: string,
    ttlMs?: number,
    budget: 'interactive' | 'background' = 'background',
  ) {
    const limits =
      budget === 'interactive'
        // ONE attempt, short deadline. Retrying an unresponsive provider while
        // someone watches a spinner spends their patience to maybe save a
        // fallback that is already sitting there. A healthy Jikan answers in
        // well under a second, so 4s is generous rather than tight.
        ? { attempts: 1, timeoutMs: 4_000 }
        : { attempts: 4, timeoutMs: 15_000 };

    return fetchJson<T>(`${BASE}${path}`, {
      bucket: jikanBucket,
      cache: this.cache,
      provider: 'jikan',
      ttlMs,
      ...limits,
    });
  }

  async search(query: string, limit = 20): Promise<RawWork[]> {
    const qs = new URLSearchParams({
      q: query,
      limit: String(Math.min(limit, 25)),
      sfw: 'true',
      order_by: 'members',
      sort: 'desc',
    });
    // Short TTL: search is the one place stale results are noticeable, because
    // a just-announced sequel is exactly what the user is looking for.
    const { data } = await this.get<{ data: JikanAnime[] }>(
      `/anime?${qs}`,
      15 * 60 * 1000,
      'interactive',
    );
    return (data?.data ?? []).map(normaliseJikanWork);
  }

  async getWork(providerId: string): Promise<RawWork> {
    // Interactive: this sits behind the "Add" button.
    const { data } = await this.get<{ data: JikanAnime }>(
      `/anime/${providerId}/full`,
      undefined,
      'interactive',
    );
    if (!data?.data) throw new ProviderNotFoundError('jikan', providerId);
    return normaliseJikanWork(data.data);
  }

  async getRelations(providerId: string): Promise<RawRelation[]> {
    // `/full` already carries relations, so this costs nothing extra beyond the
    // cache lookup that getWork just warmed.
    const { data } = await this.get<{ data: JikanAnime }>(`/anime/${providerId}/full`);
    if (!data?.data) throw new ProviderNotFoundError('jikan', providerId);
    return normaliseJikanRelations(data.data);
  }

  async getEpisodes(providerId: string): Promise<RawEpisode[]> {
    const out: RawEpisode[] = [];
    let page = 1;
    for (;;) {
      const { data } = await this.get<{
        data: Array<{
          mal_id: number;
          title: string | null;
          aired: string | null;
          filler: boolean;
          recap: boolean;
        }>;
        pagination?: { has_next_page: boolean };
      }>(`/anime/${providerId}/episodes?page=${page}`, 24 * 60 * 60 * 1000);

      for (const e of data?.data ?? []) {
        out.push({
          number: e.mal_id,
          title: e.title ?? null,
          airDate: isoDate(e.aired),
          isFiller: e.filler ?? null,
          isRecap: e.recap ?? null,
        });
      }

      if (!data?.pagination?.has_next_page) break;
      page += 1;
      // One Piece is 11+ pages at 100/page. Hard stop so a pathological entry
      // cannot drain the whole minute budget in one call.
      if (page > 30) break;
    }
    return out;
  }
}
