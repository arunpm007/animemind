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
  ): Promise<{ answered: AnimeProvider; value: T }> {
    let last: unknown;
    for (const p of this.providers) {
      try {
        return { answered: p, value: await fn(p) };
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

  /**
   * Stamp the provider that actually answered onto every record.
   *
   * The chain presents itself under the PRIMARY provider's id, so a caller
   * that writes `provider: chain.id` files whatever came back under the
   * primary's name. When a fallback answered, that puts a MyAnimeList id in
   * Kitsu's id space — both are small integers, so nothing looks wrong — and
   * the row then refers to a different anime than its id claims. The next
   * lookup under the true id creates a second row for the same show, and
   * cross-provider identity fetches mappings for the wrong title.
   */
  private stamp(w: RawWork, answered: AnimeProvider): RawWork {
    return { ...w, sourceProvider: w.sourceProvider ?? answered.id };
  }

  async search(query: string, limit: number): Promise<RawWork[]> {
    const { answered, value } = await this.attempt('search', (p) =>
      p.search(query, limit),
    );
    return value.map((w) => this.stamp(w, answered));
  }

  async getWork(providerId: string): Promise<RawWork> {
    const { answered, value } = await this.attempt('getWork', (p) =>
      p.getWork(providerId),
    );
    return this.stamp(value, answered);
  }

  async getRelations(providerId: string): Promise<RawRelation[]> {
    const { answered, value } = await this.attempt('getRelations', (p) =>
      p.getRelations(providerId),
    );
    // A relation can inline a complete record, which is upserted directly and
    // so needs the same provenance as anything else.
    return value.map((r) =>
      r.hint?.work
        ? { ...r, hint: { ...r.hint, work: this.stamp(r.hint.work, answered) } }
        : r,
    );
  }

  async getEpisodes(providerId: string): Promise<RawEpisode[]> {
    return (await this.attempt('getEpisodes', (p) => p.getEpisodes(providerId))).value;
  }

  async getExternalIds(
    providerId: string,
  ): Promise<Array<{ site: string; externalId: string }>> {
    // Only the provider that owns this id space can answer. Asking a fallback
    // about an id from another provider returns a different show.
    const primary = this.providers[0];
    if (!primary.getExternalIds) return [];
    try {
      return await primary.getExternalIds(providerId);
    } catch {
      // Identity is an optimisation; failing to fetch it must not fail ingest.
      return [];
    }
  }
}
