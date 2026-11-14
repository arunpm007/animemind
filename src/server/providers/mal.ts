import type { ReleaseStatus, RelationKind, WorkKind } from '../domain/types';
import { type CacheAdapter, fetchJson, malBucket } from './http';
import {
  type AnimeProvider,
  type ProviderCapabilities,
  ProviderNotFoundError,
  ProviderUnavailableError,
  type RawEpisode,
  type RawRelation,
  type RawWork,
} from './types';

/**
 * The official MyAnimeList API (v2).
 *
 * First-party, so it does not inherit a scraper's uptime — Jikan was measured
 * at roughly 10% availability while this endpoint answered in about 0.46s.
 *
 * Two things it does better than the mirror:
 *
 *  - `related_anime` carries `media_type` and `status` on each node, so the
 *    series builder can classify a neighbour without a follow-up request. That
 *    removes the N+1 that forces relation hydration into a background job.
 *  - `relation_type` is already snake_case and maps 1:1 onto the domain
 *    vocabulary, with none of the casing drift that silently dropped every
 *    spin-off when reading Jikan.
 *
 * What it does NOT do: there is no per-episode endpoint in v2. Episode lists
 * still come from Jikan, which is why the provider chain exists rather than a
 * straight swap.
 *
 * Auth is a client id in a header — no OAuth, no secret — for public data.
 * Register one free at https://myanimelist.net/apiconfig.
 */

const BASE = 'https://api.myanimelist.net/v2';

/** Everything we read. MAL returns only `id`/`title` unless asked. */
const WORK_FIELDS = [
  'id',
  'title',
  'main_picture',
  'alternative_titles',
  'start_date',
  'end_date',
  'synopsis',
  'mean',
  'popularity',
  'media_type',
  'status',
  'genres',
  'num_episodes',
  'start_season',
  'broadcast',
  'average_episode_duration',
  'studios',
].join(',');

/**
 * Nested field selection on the related nodes. This is the request that makes
 * relation hydration cheap; if MAL ever stops honouring the nested syntax the
 * normaliser degrades to hint-less relations and hydration simply falls back
 * to fetching each neighbour, exactly as it does for Jikan.
 */
const DETAIL_FIELDS = `${WORK_FIELDS},related_anime{node{id,title,media_type,status,start_date,num_episodes}}`;

/* ─────────────────────── provider vocabulary maps ─────────────────────── */

const KIND: Record<string, WorkKind> = {
  tv: 'tv',
  ova: 'ova',
  movie: 'movie',
  special: 'special',
  ona: 'ona',
  music: 'music',
  tv_special: 'special',
  cm: 'special',
  pv: 'special',
  unknown: 'unknown',
};

const STATUS: Record<string, ReleaseStatus> = {
  finished_airing: 'finished',
  currently_airing: 'airing',
  not_yet_aired: 'not_yet_aired',
};

/** MAL's relation_type is already snake_case and aligns with the domain. */
const RELATION: Record<string, RelationKind> = {
  sequel: 'sequel',
  prequel: 'prequel',
  side_story: 'side_story',
  parent_story: 'parent_story',
  summary: 'summary',
  alternative_version: 'alternative_version',
  alternative_setting: 'alternative_setting',
  spin_off: 'spin_off',
  character: 'character',
  full_story: 'full_story',
  other: 'other',
};

const DOW: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/* ──────────────────────────── raw payloads ──────────────────────────── */

interface MalNode {
  id: number;
  title: string;
  main_picture?: { medium?: string; large?: string };
  alternative_titles?: { synonyms?: string[]; en?: string; ja?: string };
  start_date?: string;
  end_date?: string;
  synopsis?: string;
  mean?: number;
  popularity?: number;
  media_type?: string;
  status?: string;
  genres?: Array<{ name: string }>;
  num_episodes?: number;
  start_season?: { year: number; season: string };
  broadcast?: { day_of_the_week?: string; start_time?: string };
  /** SECONDS, not minutes. Treating it as minutes yields 24-hour episodes. */
  average_episode_duration?: number;
  studios?: Array<{ name: string }>;
  related_anime?: Array<{ node: MalNode; relation_type: string }>;
}

export function normaliseMalWork(a: MalNode): RawWork {
  return {
    providerId: String(a.id),
    kind: KIND[a.media_type ?? ''] ?? 'unknown',
    titleRomaji: a.title,
    titleEnglish: a.alternative_titles?.en || null,
    titleNative: a.alternative_titles?.ja || null,
    synonyms: a.alternative_titles?.synonyms ?? [],
    synopsis: a.synopsis || null,
    coverUrl: a.main_picture?.large ?? a.main_picture?.medium ?? null,
    bannerUrl: null,
    // 0 means unknown or still running, never "no episodes" — conflating the
    // two makes an airing show render as 0/0 and look finished.
    episodeCount: a.num_episodes && a.num_episodes > 0 ? a.num_episodes : null,
    durationMin: a.average_episode_duration
      ? Math.round(a.average_episode_duration / 60)
      : null,
    releaseStatus: STATUS[a.status ?? ''] ?? 'unknown',
    startDate: a.start_date ? a.start_date.slice(0, 10) : null,
    endDate: a.end_date ? a.end_date.slice(0, 10) : null,
    seasonYear: a.start_season?.year ?? null,
    broadcastDow: a.broadcast?.day_of_the_week
      ? (DOW[a.broadcast.day_of_the_week.toLowerCase()] ?? null)
      : null,
    broadcastTime: a.broadcast?.start_time ?? null,
    // MAL broadcast times are always JST and the field is not returned.
    broadcastTz: a.broadcast?.start_time ? 'Asia/Tokyo' : null,
    genres: (a.genres ?? []).map((g) => g.name),
    studios: (a.studios ?? []).map((s) => s.name),
    score: a.mean ?? null,
    popularity: a.popularity ?? null,
    raw: a,
  };
}

export function normaliseMalRelations(a: MalNode): RawRelation[] {
  const out: RawRelation[] = [];
  for (const rel of a.related_anime ?? []) {
    const kind = RELATION[rel.relation_type];
    if (!kind || !rel.node) continue;
    out.push({
      kind,
      providerId: String(rel.node.id),
      // The payoff over the mirror: enough metadata to classify this
      // neighbour without fetching it.
      hint: {
        title: rel.node.title,
        kind: rel.node.media_type ? KIND[rel.node.media_type] : undefined,
        releaseStatus: rel.node.status ? STATUS[rel.node.status] : undefined,
        startDate: rel.node.start_date ? rel.node.start_date.slice(0, 10) : null,
      },
    });
  }
  return out;
}

/* ───────────────────────────── the provider ───────────────────────────── */

export class MalProvider implements AnimeProvider {
  readonly id = 'mal' as const;

  readonly capabilities: ProviderCapabilities = {
    // The whole reason to prefer this provider.
    inlinesRelationMetadata: true,
    maxRequestsPerMinute: 60,
  };

  constructor(
    private readonly clientId: string,
    private readonly cache?: CacheAdapter,
  ) {
    if (!clientId) {
      throw new Error('MalProvider requires a client id (MAL_CLIENT_ID).');
    }
  }

  private get<T>(
    path: string,
    ttlMs?: number,
    budget: 'interactive' | 'background' = 'background',
  ) {
    const limits =
      budget === 'interactive'
        ? { attempts: 1, timeoutMs: 4_000 }
        : { attempts: 4, timeoutMs: 15_000 };

    return fetchJson<T>(`${BASE}${path}`, {
      bucket: malBucket,
      cache: this.cache,
      provider: 'mal',
      ttlMs,
      headers: { 'X-MAL-CLIENT-ID': this.clientId },
      ...limits,
    });
  }

  async search(query: string, limit = 20): Promise<RawWork[]> {
    const qs = new URLSearchParams({
      // MAL rejects queries shorter than 3 characters outright.
      q: query.trim(),
      limit: String(Math.min(limit, 100)),
      fields: WORK_FIELDS,
      nsfw: 'false',
    });
    const { data } = await this.get<{ data: Array<{ node: MalNode }> }>(
      `/anime?${qs}`,
      15 * 60 * 1000,
      'interactive',
    );
    return (data?.data ?? []).map((d) => normaliseMalWork(d.node));
  }

  async getWork(providerId: string): Promise<RawWork> {
    const { data } = await this.get<MalNode>(
      `/anime/${providerId}?fields=${DETAIL_FIELDS}`,
      undefined,
      'interactive',
    );
    if (!data?.id) throw new ProviderNotFoundError('mal', providerId);
    return normaliseMalWork(data);
  }

  async getRelations(providerId: string): Promise<RawRelation[]> {
    // Same URL as getWork, so this is a cache hit immediately after it.
    const { data } = await this.get<MalNode>(
      `/anime/${providerId}?fields=${DETAIL_FIELDS}`,
    );
    if (!data?.id) throw new ProviderNotFoundError('mal', providerId);
    return normaliseMalRelations(data);
  }

  async getEpisodes(): Promise<RawEpisode[]> {
    // MAL API v2 exposes no per-episode data. Declared as unavailable rather
    // than returning [], so the provider chain falls through to Jikan instead
    // of concluding the show has no episodes.
    throw new ProviderUnavailableError(
      'mal',
      'MAL API v2 has no episode endpoint',
      false,
    );
  }
}
