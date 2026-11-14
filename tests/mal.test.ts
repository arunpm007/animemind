/**
 * MyAnimeList official API v2 — normaliser and provider chain.
 *
 * The payload below mirrors the documented v2 shape. It is replaced with a
 * captured live response as soon as a client id is available; until then these
 * tests pin the two things most likely to be silently wrong: the unit of
 * `average_episode_duration`, and the relation vocabulary.
 */
import { describe, expect, it } from 'vitest';
import { normaliseMalRelations, normaliseMalWork } from '@/server/providers/mal';
import { ChainProvider } from '@/server/providers/chain';
import {
  type AnimeProvider,
  ProviderNotFoundError,
  ProviderUnavailableError,
  type RawWork,
} from '@/server/providers/types';

const payload = {
  id: 16498,
  title: 'Shingeki no Kyojin',
  main_picture: {
    medium: 'https://cdn.myanimelist.net/images/anime/10/47347.jpg',
    large: 'https://cdn.myanimelist.net/images/anime/10/47347l.jpg',
  },
  alternative_titles: {
    synonyms: ['AoT'],
    en: 'Attack on Titan',
    ja: '進撃の巨人',
  },
  start_date: '2013-04-07',
  end_date: '2013-09-29',
  synopsis: 'Centuries ago…',
  mean: 8.56,
  popularity: 1,
  media_type: 'tv',
  status: 'finished_airing',
  genres: [{ name: 'Action' }, { name: 'Drama' }],
  num_episodes: 25,
  start_season: { year: 2013, season: 'spring' },
  broadcast: { day_of_the_week: 'sunday', start_time: '01:58' },
  // SECONDS. 1440 is a 24-minute episode, not a 24-hour one.
  average_episode_duration: 1440,
  studios: [{ name: 'Wit Studio' }],
  related_anime: [
    {
      node: {
        id: 25777,
        title: 'Shingeki no Kyojin Season 2',
        media_type: 'tv',
        status: 'finished_airing',
        start_date: '2017-04-01',
        num_episodes: 12,
      },
      relation_type: 'sequel',
    },
    {
      node: {
        id: 25781,
        title: 'Kuinaki Sentaku',
        media_type: 'ova',
        status: 'finished_airing',
        start_date: '2014-12-09',
      },
      relation_type: 'spin_off',
    },
    {
      node: {
        id: 42091,
        title: 'Chronicle',
        media_type: 'movie',
        status: 'finished_airing',
        start_date: '2020-07-17',
      },
      relation_type: 'summary',
    },
  ],
};

describe('normaliseMalWork', () => {
  const w = normaliseMalWork(payload);

  it('maps the core fields', () => {
    expect(w.providerId).toBe('16498');
    expect(w.kind).toBe('tv');
    expect(w.titleEnglish).toBe('Attack on Titan');
    expect(w.titleNative).toBe('進撃の巨人');
    expect(w.synonyms).toEqual(['AoT']);
    expect(w.releaseStatus).toBe('finished');
    expect(w.episodeCount).toBe(25);
  });

  it('converts episode duration from SECONDS to minutes', () => {
    // The trap: MAL gives seconds where Jikan gives "24 min per ep". Passing
    // it through unconverted turns every episode into a 1440-minute one.
    expect(w.durationMin).toBe(24);
  });

  it('maps the broadcast day and assumes JST', () => {
    expect(w.broadcastDow).toBe(0); // sunday
    expect(w.broadcastTz).toBe('Asia/Tokyo');
  });

  it('keeps air dates as calendar dates', () => {
    expect(w.startDate).toBe('2013-04-07');
    expect(w.endDate).toBe('2013-09-29');
  });

  it('treats a zero episode count as unknown', () => {
    const airing = normaliseMalWork({ ...payload, num_episodes: 0 });
    expect(airing.episodeCount).toBeNull();
  });
});

describe('normaliseMalRelations', () => {
  const rels = normaliseMalRelations(payload);

  it('maps the snake_case relation vocabulary directly', () => {
    expect(rels.map((r) => r.kind).sort()).toEqual(['sequel', 'spin_off', 'summary']);
  });

  it('carries enough inline metadata to classify without a second request', () => {
    // This is the entire reason to prefer MAL over the mirror.
    const spinoff = rels.find((r) => r.providerId === '25781');
    expect(spinoff?.hint?.kind).toBe('ova');
    expect(spinoff?.hint?.releaseStatus).toBe('finished');
    expect(spinoff?.hint?.startDate).toBe('2014-12-09');
  });

  it('ignores an unknown relation type rather than guessing', () => {
    const odd = normaliseMalRelations({
      ...payload,
      related_anime: [
        { node: { id: 1, title: 'X' }, relation_type: 'something_new' },
      ],
    });
    expect(odd).toEqual([]);
  });
});

/* ─────────────────────────── the provider chain ─────────────────────────── */

function stub(over: Partial<AnimeProvider> & { id: 'mal' | 'jikan' }): AnimeProvider {
  return {
    capabilities: { inlinesRelationMetadata: false, maxRequestsPerMinute: 60 },
    search: async () => [],
    getWork: async () => ({ providerId: 'x' }) as RawWork,
    getRelations: async () => [],
    getEpisodes: async () => [],
    ...over,
  } as AnimeProvider;
}

const down = (id: 'mal' | 'jikan') =>
  stub({
    id,
    search: async () => {
      throw new ProviderUnavailableError(id, 'down');
    },
    getEpisodes: async () => {
      throw new ProviderUnavailableError(id, 'no episode endpoint', false);
    },
  });

describe('ChainProvider', () => {
  it('falls through to the next provider when the first is down', async () => {
    const chain = new ChainProvider([
      down('mal'),
      stub({ id: 'jikan', search: async () => [{ providerId: '1' } as RawWork] }),
    ]);
    const out = await chain.search('x', 5);
    expect(out).toHaveLength(1);
  });

  it('routes episodes to Jikan, because MAL v2 has none', async () => {
    const chain = new ChainProvider([
      down('mal'),
      stub({
        id: 'jikan',
        getEpisodes: async () => [
          { number: 1, title: 'Ep 1', airDate: null, isFiller: null, isRecap: null },
        ],
      }),
    ]);
    const eps = await chain.getEpisodes('16498');
    expect(eps).toHaveLength(1);
  });

  it('stops on "not found" instead of asking the next provider', async () => {
    // Ids are per-provider. Asking Jikan about a MAL id that does not exist
    // could return a different show entirely.
    let jikanCalled = false;
    const chain = new ChainProvider([
      stub({
        id: 'mal',
        getWork: async () => {
          throw new ProviderNotFoundError('mal', '999');
        },
      }),
      stub({
        id: 'jikan',
        getWork: async () => {
          jikanCalled = true;
          return { providerId: '999' } as RawWork;
        },
      }),
    ]);

    await expect(chain.getWork('999')).rejects.toThrow(ProviderNotFoundError);
    expect(jikanCalled).toBe(false);
  });

  it('reports every provider failing as a single outage', async () => {
    const chain = new ChainProvider([down('mal'), down('jikan')]);
    await expect(chain.search('x', 5)).rejects.toThrow(ProviderUnavailableError);
  });

  it('does not swallow a programming error', async () => {
    const chain = new ChainProvider([
      stub({
        id: 'mal',
        search: async () => {
          throw new TypeError('bug');
        },
      }),
      stub({ id: 'jikan' }),
    ]);
    await expect(chain.search('x', 5)).rejects.toThrow(TypeError);
  });
});
