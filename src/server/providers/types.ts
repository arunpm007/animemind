import type { ReleaseStatus, RelationKind, WorkKind } from '../domain/types';

/**
 * Providers return RAW shapes in this normalised vocabulary. The provider
 * vocabulary itself (Jikan's "Sequel", MAL's "prequel", AniList's "SEQUEL")
 * stops at the normaliser and never reaches the domain, the database or the
 * API. That boundary is the whole reason swapping provider is a config change.
 */

export interface RawWork {
  providerId: string;
  /**
   * Which provider actually produced this record, and therefore which id
   * space `providerId` belongs to.
   *
   * Set by ChainProvider, which presents itself under its PRIMARY provider's
   * id while any member of the chain may have answered. Storing a row under
   * the primary's name when a fallback produced it files a MyAnimeList id in
   * Kitsu's id space — two numbering schemes of small integers, so the id
   * stays plausible and silently points at a different anime. Later lookups
   * then create a second row for the show (the duplicate), and cross-provider
   * identity reads the wrong mappings and can merge two unrelated titles,
   * which costs a user their watch history.
   *
   * Absent from a provider that is not chained; the caller falls back to the
   * provider it asked.
   */
  sourceProvider?: 'jikan' | 'mal' | 'kitsu';
  kind: WorkKind;
  titleRomaji: string;
  titleEnglish: string | null;
  titleNative: string | null;
  synonyms: string[];
  synopsis: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
  /** NULL when unknown or still running. Never 0 as a stand-in. */
  episodeCount: number | null;
  durationMin: number | null;
  releaseStatus: ReleaseStatus;
  startDate: string | null;
  endDate: string | null;
  seasonYear: number | null;
  broadcastDow: number | null;
  broadcastTime: string | null;
  broadcastTz: string | null;
  genres: string[];
  studios: string[];
  score: number | null;
  popularity: number | null;
  raw: unknown;
}

export interface RawRelation {
  kind: RelationKind;
  providerId: string;
  /**
   * Present when the provider inlines it; absent means a follow-up fetch.
   *
   * `work` is a COMPLETE normalised record, which some providers (Kitsu) give
   * for free in the same payload. Carrying only a few fields instead meant
   * every neighbour discovered this way was created without cover art —
   * 73 of 73 such works had no poster — while the art sat unread in the
   * response we had already paid for.
   */
  hint?: {
    kind?: WorkKind;
    title?: string;
    releaseStatus?: ReleaseStatus;
    startDate?: string | null;
    work?: RawWork;
  };
}

export interface RawEpisode {
  number: number;
  title: string | null;
  airDate: string | null;
  isFiller: boolean | null;
  isRecap: boolean | null;
}

export interface ProviderCapabilities {
  /**
   * True when a single work fetch returns enough metadata about each related
   * work to classify it. False (Jikan) means relation hydration costs one extra
   * request per neighbour, which is why hydration must run in the background.
   */
  inlinesRelationMetadata: boolean;
  maxRequestsPerMinute: number;
}

export interface AnimeProvider {
  readonly id: 'jikan' | 'mal' | 'kitsu';
  readonly capabilities: ProviderCapabilities;

  search(query: string, limit: number): Promise<RawWork[]>;
  getWork(providerId: string): Promise<RawWork>;
  getRelations(providerId: string): Promise<RawRelation[]>;
  getEpisodes(providerId: string): Promise<RawEpisode[]>;

  /**
   * This work's ids at OTHER providers, when the provider publishes them.
   *
   * Optional because only some do. Without it the catalog keeps one row per
   * provider for the same anime, and a library built on one provider cannot
   * recognise a title it already holds under another.
   */
  getExternalIds?(providerId: string): Promise<Array<{ site: string; externalId: string }>>;
}

/** Thrown when a provider is reachable but cannot serve — distinct from a bug. */
export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderNotFoundError extends Error {
  constructor(provider: string, id: string) {
    super(`${provider}: work ${id} not found`);
    this.name = 'ProviderNotFoundError';
  }
}
