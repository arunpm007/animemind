/**
 * Cross-provider identity has to actually RUN.
 *
 * The merge logic, the external-id table and the reconciliation were all
 * present and correct, and in the live catalog not one work of 465 had ever
 * claimed an id. Two things saw to that:
 *
 *   1. `ensureWork` returned early whenever the row already existed — and
 *      search warms the catalog before anyone can add anything, so the row
 *      ALWAYS existed and registration never ran once.
 *   2. The relation crawl created works through `upsertWork`, which claimed
 *      nothing at all.
 *
 * So the duplicate that identity exists to prevent could never be detected,
 * and "Attack on Titan: The Final Season" sat on the series spine next to
 * "Attack on Titan Final Season" — the same sixteen episodes, counted twice.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';
import { unscoped } from '@/server/db/client';
import { work, workExternalId } from '@/server/db/schema';
import { ensureWork, upsertWork } from '@/server/services/ingest';
import { ChainProvider } from '@/server/providers/chain';
import { ProviderUnavailableError } from '@/server/providers/types';
import type {
  AnimeProvider,
  ProviderCapabilities,
  RawEpisode,
  RawRelation,
  RawWork,
} from '@/server/providers/types';

const TAG = `ident-${Date.now()}`;
const db = () => unscoped();

function rawWork(providerId: string, title: string, episodeCount = 16): RawWork {
  return {
    providerId,
    kind: 'tv',
    titleRomaji: title,
    titleEnglish: title,
    titleNative: null,
    synonyms: [],
    synopsis: null,
    coverUrl: null,
    bannerUrl: null,
    episodeCount,
    durationMin: null,
    releaseStatus: 'finished',
    startDate: null,
    endDate: null,
    seasonYear: null,
    broadcastDow: null,
    broadcastTime: null,
    broadcastTz: null,
    genres: [],
    studios: [],
    score: null,
    popularity: null,
    raw: {},
  };
}

const CAPS: ProviderCapabilities = {
  inlinesRelationMetadata: true,
  maxRequestsPerMinute: 60,
};

/** A provider that answers from a fixture and counts what was asked of it. */
class FakeProvider implements AnimeProvider {
  readonly capabilities = CAPS;
  externalIdCalls = 0;

  constructor(
    readonly id: 'jikan' | 'mal' | 'kitsu',
    private readonly works: Record<string, RawWork>,
    private readonly mappings: Record<string, Array<{ site: string; externalId: string }>> = {},
    private readonly down = false,
  ) {}

  async search(): Promise<RawWork[]> {
    if (this.down) throw new ProviderUnavailableError(this.id, 'down');
    return Object.values(this.works);
  }
  async getWork(providerId: string): Promise<RawWork> {
    if (this.down) throw new ProviderUnavailableError(this.id, 'down');
    return this.works[providerId];
  }
  async getRelations(): Promise<RawRelation[]> {
    if (this.down) throw new ProviderUnavailableError(this.id, 'down');
    return [];
  }
  async getEpisodes(): Promise<RawEpisode[]> {
    return [];
  }
  async getExternalIds(providerId: string) {
    if (this.down) throw new ProviderUnavailableError(this.id, 'down');
    this.externalIdCalls += 1;
    return this.mappings[providerId] ?? [];
  }
}

afterAll(async () => {
  const rows = await db()
    .select({ id: work.id })
    .from(work)
    .where(like(work.providerId, `%${TAG}%`));
  if (rows.length) {
    await db()
      .delete(work)
      .where(inArray(work.id, rows.map((r) => r.id)));
  }
});

describe('a work claims the id it already knows', () => {
  it('records its own id on upsert, with no provider call', async () => {
    const { id } = await upsertWork(rawWork(`k-${TAG}`, `Claim Me ${TAG}`), 'kitsu');

    const claim = await db().query.workExternalId.findFirst({
      where: eq(workExternalId.externalId, `k-${TAG}`),
    });
    expect(claim).toBeDefined();
    expect(claim!.workId).toBe(id);
    // Kitsu ids live in Kitsu's space; a Jikan row would claim MyAnimeList's.
    expect(claim!.site).toBe('kitsu');
  });

  it('files the row under the provider that ANSWERED, not the one asked', async () => {
    // The chain presents itself as Kitsu while Jikan does the work. Storing
    // the result as Kitsu would put a MyAnimeList id in Kitsu's id space —
    // plausible, wrong, and later merged into whichever Kitsu anime happens
    // to carry that number.
    const kitsuDown = new FakeProvider('kitsu', {}, {}, true);
    const jikan = new FakeProvider('jikan', {
      [`j-${TAG}`]: rawWork(`j-${TAG}`, `Fallback Row ${TAG}`),
    });
    const chain = new ChainProvider([kitsuDown, jikan]);
    expect(chain.id).toBe('kitsu');

    const [found] = await chain.search('x', 1);
    expect(found.sourceProvider).toBe('jikan');

    const { id } = await upsertWork(found, chain.id);
    const row = await db().query.work.findFirst({ where: eq(work.id, id) });
    expect(row!.provider).toBe('jikan');

    const claim = await db().query.workExternalId.findFirst({
      where: eq(workExternalId.externalId, `j-${TAG}`),
    });
    expect(claim!.site).toBe('myanimelist');
  });
});

describe('ensureWork on a row search already cached', () => {
  it('registers identity instead of returning early', async () => {
    // Exactly the live sequence: search warms the catalog, then the user adds.
    const kitsuWork = rawWork(`kc-${TAG}`, `Shingeki no Kyojin The Final Season ${TAG}`);
    await upsertWork(kitsuWork, 'kitsu');

    const provider = new FakeProvider(
      'kitsu',
      { [`kc-${TAG}`]: kitsuWork },
      {
        [`kc-${TAG}`]: [
          { site: 'kitsu', externalId: `kc-${TAG}` },
          { site: 'myanimelist', externalId: `mal-${TAG}` },
        ],
      },
    );

    await ensureWork(`kc-${TAG}`, provider);

    expect(provider.externalIdCalls).toBe(1);
    const claim = await db().query.workExternalId.findFirst({
      where: eq(workExternalId.externalId, `mal-${TAG}`),
    });
    expect(claim).toBeDefined();
  });

  it('does not re-ask once the ids are claimed', async () => {
    const w = rawWork(`kd-${TAG}`, `Already Known ${TAG}`);
    await upsertWork(w, 'kitsu');
    const provider = new FakeProvider(
      'kitsu',
      { [`kd-${TAG}`]: w },
      { [`kd-${TAG}`]: [{ site: 'kitsu', externalId: `kd-${TAG}` }] },
    );

    await ensureWork(`kd-${TAG}`, provider);
    await ensureWork(`kd-${TAG}`, provider);
    await ensureWork(`kd-${TAG}`, provider);

    // Identity is settled after the first call; the rest are free.
    expect(provider.externalIdCalls).toBe(1);
  });

  it('merges the other provider’s row for the same anime', async () => {
    // The duplicate, reproduced: MyAnimeList wrote the colon, Kitsu did not.
    const { id: jikanRow } = await upsertWork(
      rawWork(`mal2-${TAG}`, `Shingeki no Kyojin: The Final Season ${TAG}`),
      'jikan',
    );
    const kitsuRaw = rawWork(`kit2-${TAG}`, `Shingeki no Kyojin The Final Season ${TAG}`);
    await upsertWork(kitsuRaw, 'kitsu');

    const provider = new FakeProvider(
      'kitsu',
      { [`kit2-${TAG}`]: kitsuRaw },
      {
        [`kit2-${TAG}`]: [
          { site: 'kitsu', externalId: `kit2-${TAG}` },
          // Kitsu's mapping is what lets the two rows recognise each other.
          { site: 'myanimelist', externalId: `mal2-${TAG}` },
        ],
      },
    );

    const survivor = await ensureWork(`kit2-${TAG}`, provider);

    // The older row wins: it is the one already in libraries.
    expect(survivor).toBe(jikanRow);
    const left = await db()
      .select({ id: work.id })
      .from(work)
      .where(inArray(work.providerId, [`mal2-${TAG}`, `kit2-${TAG}`]));
    expect(left).toHaveLength(1);
  });
});
