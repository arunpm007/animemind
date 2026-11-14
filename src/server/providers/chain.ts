import type {
  AnimeProvider,
  ProviderCapabilities,
  RawEpisode,
  RawRelation,
  RawWork,
} from './types';
import { ProviderNotFoundError, ProviderUnavailableError } from './types';

/**
 * Try each provider in order until one answers.
 *
 * This exists because neither source is complete on its own:
 *
 *   MAL (official)  fast, first-party, inlines relation metadata,
 *                   but has NO episode endpoint in v2
 *   Jikan (mirror)  has episodes, but was measured at ~10% availability
 *
 * So the chain is not a redundancy hack — it is how the app gets full
 * coverage. Episode lookups fall through to Jikan by design, and everything
 * else falls through only when the primary is genuinely down.
 *
 * A "not found" is an ANSWER and stops the chain. Asking the next provider
 * about an id that belongs to the first one's id space would at best waste a
 * request and at worst return a different show entirely.
 */
export class ChainProvider implements AnimeProvider {
  readonly id: 'jikan' | 'mal' | 'kitsu';
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly providers: AnimeProvider[]) {
    if (!providers.length) throw new Error('ChainProvider needs at least one provider');
    this.id = providers[0].id;
    this.capabilities = providers[0].capabilities;
  }

  private async attempt<T>(
    op: string,
    fn: (p: AnimeProvider) => Promise<T>,
  ): Promise<T> {
    let last: unknown;
    for (const p of this.providers) {
      try {
        return await fn(p);
      } catch (err) {
        // A definitive "no such work" is the answer, not a failure to answer.
        if (err instanceof ProviderNotFoundError) throw err;
        if (!(err instanceof ProviderUnavailableError)) throw err;
        last = err;
      }
    }
    throw new ProviderUnavailableError(
      this.providers.map((p) => p.id).join('+'),
      `every provider failed for ${op}: ${String(last)}`,
    );
  }

  search(query: string, limit: number): Promise<RawWork[]> {
    return this.attempt('search', (p) => p.search(query, limit));
  }

  getWork(providerId: string): Promise<RawWork> {
    return this.attempt('getWork', (p) => p.getWork(providerId));
  }

  getRelations(providerId: string): Promise<RawRelation[]> {
    return this.attempt('getRelations', (p) => p.getRelations(providerId));
  }

  getEpisodes(providerId: string): Promise<RawEpisode[]> {
    return this.attempt('getEpisodes', (p) => p.getEpisodes(providerId));
  }
}
