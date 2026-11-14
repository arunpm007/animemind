import type { ReleaseStatus, RelationKind, WorkKind } from '../domain/types';

/**
 * Providers return RAW shapes in this normalised vocabulary. The provider
 * vocabulary itself (Jikan's "Sequel", MAL's "prequel", AniList's "SEQUEL")
 * stops at the normaliser and never reaches the domain, the database or the
 * API. That boundary is the whole reason swapping provider is a config change.
 */

export interface RawWork {
  providerId: string;
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
