/**
 * Normaliser tests against a REAL captured Jikan payload.
 *
 * The fixture is a live response, trimmed to the fields we read. Synthetic
 * fixtures agree with whatever the normaliser happens to do; a captured one
 * disagrees when the provider changes, which is the entire point. The
 * "Spin-Off" / "Side Story" casing bug below was found this way and would
 * otherwise have silently emptied every franchise of its extras.
 */
import { describe, expect, it } from 'vitest';
import { normaliseJikanRelations, normaliseJikanWork } from '@/server/providers/jikan';
import { buildSeries } from '@/server/domain/series';
import type { GraphEdge, GraphNode } from '@/server/domain/types';
import aot from './fixtures/jikan-aot.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payload = aot as any;

describe('normaliseJikanWork', () => {
  const w = normaliseJikanWork(payload);

  it('maps the core fields', () => {
    expect(w.providerId).toBe('16498');
    expect(w.kind).toBe('tv');
    expect(w.titleRomaji).toBe('Shingeki no Kyojin');
    expect(w.titleEnglish).toBe('Attack on Titan');
    expect(w.releaseStatus).toBe('finished');
    expect(w.episodeCount).toBe(25);
  });

  it('parses "24 min per ep" into minutes', () => {
    expect(w.durationMin).toBe(24);
  });

  it('reduces air dates to calendar dates, not instants', () => {
    // Shifting an air date by a timezone is a visible, real bug.
    expect(w.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.startDate).toBe('2013-04-07');
  });

  it('maps the broadcast day to a weekday index', () => {
    expect(w.broadcastDow).toBe(0); // "Sundays"
    expect(w.broadcastTz).toBe('Asia/Tokyo');
  });

  it('merges themes into genres and keeps studios', () => {
    expect(w.genres.length).toBeGreaterThan(0);
    expect(w.studios).toContain('Wit Studio');
  });
});

describe('normaliseJikanRelations', () => {
  const rels = normaliseJikanRelations(payload);

  it('maps labels whose casing differs from the docs', () => {
    // The live API sends "Side Story" and "Spin-Off"; an exact-match table
    // drops both and the franchise loses every extra.
    expect(rels.some((r) => r.kind === 'side_story')).toBe(true);
    expect(rels.filter((r) => r.kind === 'spin_off').length).toBeGreaterThanOrEqual(3);
  });

  it('finds the sequel', () => {
    const seq = rels.filter((r) => r.kind === 'sequel');
    expect(seq).toHaveLength(1);
    expect(seq[0].providerId).toBe('25777');
  });

  it('maps the compilation films as summaries, not sequels', () => {
    expect(rels.filter((r) => r.kind === 'summary').length).toBeGreaterThanOrEqual(3);
  });

  it('excludes the source manga', () => {
    // Adaptation -> manga 23390 shares the id space but is another medium.
    expect(rels.find((r) => r.providerId === '23390')).toBeUndefined();
  });

  it('loses no anime relation to an unmapped label', () => {
    const animeEntries = payload.relations.flatMap(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (g: any) => g.entry.filter((e: any) => e.type === 'anime'),
    );
    expect(rels).toHaveLength(animeEntries.length);
  });
});

describe('normaliser -> series builder, end to end', () => {
  it('produces a sane structure from the real payload', () => {
    const w = normaliseJikanWork(payload);
    const rels = normaliseJikanRelations(payload);

    const nodes: GraphNode[] = [
      {
        id: w.providerId,
        title: w.titleRomaji,
        kind: w.kind,
        status: w.releaseStatus,
        startDate: w.startDate,
        episodeCount: w.episodeCount,
      },
      // Stand-ins for the un-hydrated neighbours. In production these are
      // filled in by the background relation walk; here they prove the builder
      // tolerates partial hydration, which is its normal state.
      ...rels.map((r) => ({
        id: r.providerId,
        title: r.hint?.title ?? r.providerId,
        kind: 'unknown' as const,
        status: 'unknown' as const,
        startDate: null,
        episodeCount: null,
      })),
    ];
    const edges: GraphEdge[] = rels.map((r) => ({
      from: w.providerId,
      to: r.providerId,
      kind: r.kind,
    }));

    const s = buildSeries({ seedId: w.providerId, nodes, edges });

    // The seed is the only known TV entry, so it is the whole spine until the
    // neighbours are hydrated. Crucially it does not crash or invent an order.
    expect(s.spine.map((e) => e.workId)).toEqual(['16498']);
    // Character-linked works never join the franchise.
    expect(s.franchise).not.toContain('49739');
    // Everything else is accounted for.
    expect(s.spine.length + s.extras.length).toBe(s.franchise.length);
  });
});
