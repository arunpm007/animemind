/**
 * Kitsu normaliser, against a CAPTURED LIVE payload.
 *
 * Kitsu is the primary source, so this is the file that notices when it
 * changes shape. A synthetic fixture would agree with whatever the normaliser
 * happens to do; a captured one disagrees when reality moves — which is how
 * the `"Spin-Off"` casing bug in the Jikan adapter was found.
 */
import { describe, expect, it } from 'vitest';
import { normaliseKitsuWork } from '@/server/providers/kitsu';
import { buildSeries } from '@/server/domain/series';
import type { GraphEdge, GraphNode, RelationKind } from '@/server/domain/types';
import fixture from './fixtures/kitsu-aot.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const work = (fixture as any).work;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const relations = (fixture as any).relations;

/** Mirrors KitsuProvider.getRelations, which is private to the class. */
function relationsFrom(payload: {
  data: Array<{
    attributes: { role?: string };
    relationships?: { destination?: { data?: { id: string; type: string } | null } };
  }>;
  included?: Array<{ id: string; type: string; attributes: Record<string, unknown> }>;
}) {
  const MAP: Record<string, RelationKind> = {
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
  const KIND: Record<string, string> = {
    TV: 'tv',
    ONA: 'ona',
    OVA: 'ova',
    movie: 'movie',
    special: 'special',
    music: 'music',
  };

  const inc = new Map(payload.included?.map((i) => [`${i.type}:${i.id}`, i]) ?? []);
  const out: Array<{ kind: RelationKind; providerId: string; hint?: Record<string, unknown> }> = [];

  for (const rel of payload.data) {
    const kind = MAP[(rel.attributes.role ?? '').toLowerCase().replace(/[^a-z]/g, '')];
    const ptr = rel.relationships?.destination?.data;
    if (!kind || !ptr || ptr.type !== 'anime') continue;
    const node = inc.get(`${ptr.type}:${ptr.id}`);
    const a = node?.attributes as Record<string, string> | undefined;
    out.push({
      kind,
      providerId: ptr.id,
      hint: a
        ? { title: a.canonicalTitle, kind: KIND[a.subtype], startDate: a.startDate }
        : undefined,
    });
  }
  return out;
}

describe('normaliseKitsuWork', () => {
  const w = normaliseKitsuWork(work);

  it('maps the core fields', () => {
    expect(w.providerId).toBe('7442');
    expect(w.kind).toBe('tv');
    expect(w.titleEnglish).toBe('Attack on Titan');
    expect(w.episodeCount).toBe(25);
    expect(w.releaseStatus).toBe('finished');
  });

  it('prefers the romaji transliteration for the primary title', () => {
    // en_jp is the romaji form; canonicalTitle is whichever Kitsu considers
    // primary and is not reliably one or the other.
    expect(w.titleRomaji).toBe('Shingeki no Kyojin');
  });

  it('reads episode length as minutes, not seconds', () => {
    // MAL gives seconds here and Jikan gives "24 min per ep"; three sources,
    // three units, one column.
    expect(w.durationMin).toBe(24);
  });

  it('keeps air dates as calendar dates', () => {
    expect(w.startDate).toBe('2013-04-07');
    expect(w.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('provides both poster and banner art', () => {
    // The only source of the three that ships a usable banner.
    expect(w.coverUrl).toMatch(/^https:/);
    expect(w.bannerUrl).toMatch(/^https:/);
  });

  it('treats a zero or absent episode count as unknown', () => {
    const airing = normaliseKitsuWork({
      ...work,
      attributes: { ...work.attributes, episodeCount: null },
    });
    expect(airing.episodeCount).toBeNull();
  });
});

describe('Kitsu relations', () => {
  const rels = relationsFrom(relations);

  it('returns TYPED relations — the reason this provider is primary', () => {
    const kinds = new Set(rels.map((r) => r.kind));
    expect(kinds.has('sequel')).toBe(true);
    expect(kinds.has('spin_off')).toBe(true);
    expect(kinds.has('side_story')).toBe(true);
  });

  it('maps "spinoff" despite the spelling differing from the domain', () => {
    // Kitsu: `spinoff`. MyAnimeList: `Spin-Off`. Domain: `spin_off`.
    expect(rels.filter((r) => r.kind === 'spin_off').length).toBeGreaterThanOrEqual(2);
  });

  it('carries the neighbour subtype inline, so no follow-up fetch is needed', () => {
    const withKind = rels.filter((r) => r.hint?.kind);
    expect(withKind.length).toBe(rels.length);
  });

  it('excludes other media sharing the relationship table', () => {
    // The manga adaptation is in the payload but is not an anime.
    expect(rels.every((r) => r.kind !== 'adaptation' || r.hint?.kind)).toBe(true);
  });
});

describe('Kitsu -> series builder, end to end', () => {
  it('derives the real Attack on Titan spine from live data', () => {
    const seed = normaliseKitsuWork(work);
    const rels = relationsFrom(relations);

    const nodes: GraphNode[] = [
      {
        id: seed.providerId,
        title: seed.titleRomaji,
        kind: seed.kind,
        status: seed.releaseStatus,
        startDate: seed.startDate,
        episodeCount: seed.episodeCount,
      },
      ...rels.map((r) => ({
        id: r.providerId,
        title: (r.hint?.title as string) ?? r.providerId,
        kind: ((r.hint?.kind as GraphNode['kind']) ?? 'unknown') as GraphNode['kind'],
        status: 'unknown' as const,
        startDate: (r.hint?.startDate as string) ?? null,
        episodeCount: null,
      })),
    ];
    const edges: GraphEdge[] = rels.map((r) => ({
      from: seed.providerId,
      to: r.providerId,
      kind: r.kind,
    }));

    const s = buildSeries({ seedId: seed.providerId, nodes, edges });
    const spineTitles = s.spine.map(
      (e) => nodes.find((n) => n.id === e.workId)!.title,
    );

    // Season 1 leads, Season 2 follows — one hop of relations only reaches
    // the immediate neighbour, which is correct for a single fetch.
    expect(spineTitles[0]).toBe('Shingeki no Kyojin');
    expect(spineTitles.some((t) => /Season 2/i.test(t))).toBe(true);

    // The traps, on real data rather than hand-written fixtures.
    const extraKinds = new Map(s.extras.map((e) => [e.workId, e.track]));
    const noRegrets = rels.find((r) => /Kuinaki/i.test(String(r.hint?.title)));
    if (noRegrets) {
      // An OVA must never sit on the spine, whatever its relation says.
      expect(s.spine.map((e) => e.workId)).not.toContain(noRegrets.providerId);
      expect(extraKinds.get(noRegrets.providerId)).toBe('ova');
    }

    const juniorHigh = rels.find((r) => /Chuugakkou|Junior High/i.test(String(r.hint?.title)));
    if (juniorHigh) {
      // TV format, but a spin-off — stays off the main story.
      expect(s.spine.map((e) => e.workId)).not.toContain(juniorHigh.providerId);
      expect(extraKinds.get(juniorHigh.providerId)).toBe('spinoff');
    }

    // Nothing lost: spine and extras partition the franchise exactly.
    expect(s.spine.length + s.extras.length).toBe(s.franchise.length);
  });
});
