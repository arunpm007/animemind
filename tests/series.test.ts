import { describe, expect, it } from 'vitest';
import { buildSeries } from '@/server/domain/series';
import {
  allFixtures,
  attackOnTitan,
  cyclic,
  fate,
  movieOnly,
  onePiece,
  withUnairedSequel,
} from './fixtures/graphs';

const run = (f: typeof attackOnTitan) =>
  buildSeries({ seedId: f.seedId, nodes: f.nodes, edges: f.edges });

describe('buildSeries — Attack on Titan', () => {
  const r = run(attackOnTitan);
  const order = r.spine.map((s) => s.workId);

  it('orders the five TV seasons correctly', () => {
    expect(order).toEqual(['16498', '20958', '99147', '104578', '110277']);
  });

  it('never lets an OVA prequel head the spine', () => {
    // "No Regrets" is a declared PREQUEL of season 1 but is an OVA.
    expect(order).not.toContain('20811');
    expect(order[0]).toBe('16498');
    const extra = r.extras.find((e) => e.workId === '20811');
    expect(extra?.track).toBe('ova');
  });

  it('keeps a TV-format spin-off off the spine', () => {
    expect(order).not.toContain('21281');
    expect(r.extras.find((e) => e.workId === '21281')?.track).toBe('spinoff');
  });

  it('classifies recaps and films', () => {
    expect(r.extras.find((e) => e.workId === '119113')?.track).toBe('recap');
    expect(r.extras.find((e) => e.workId === '20691')?.track).toBe('alternative');
  });

  it('excludes the source manga from the franchise entirely', () => {
    expect(r.franchise).not.toContain('manga-53390');
  });

  it('is not ambiguous — there is one real order here', () => {
    expect(r.diagnostics.ambiguous).toBe(false);
  });
});

describe('buildSeries — Fate', () => {
  const r = run(fate);
  const order = r.spine.map((s) => s.workId);

  it('refuses to linearise retellings into one order', () => {
    // Zero -> stay night is a real continuation. UBW is not.
    expect(order).toEqual(['10087', '356']);
    expect(order).not.toContain('11741');
  });

  it('reports the parallel lines instead of inventing an order', () => {
    expect(r.alternativeLines).toContain('11741');
    expect(r.diagnostics.ambiguous).toBe(true);
  });

  it('still counts everything as one franchise', () => {
    expect(r.franchise).toHaveLength(5);
  });
});

describe('buildSeries — cyclic data', () => {
  const r = run(cyclic);

  it('terminates and emits every member exactly once', () => {
    const order = r.spine.map((s) => s.workId);
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
  });

  it('breaks the cycle at the chronologically backwards edge', () => {
    expect(r.diagnostics.cyclesBroken).toHaveLength(1);
    expect(r.diagnostics.cyclesBroken[0]).toMatchObject({ from: 'd', to: 'a' });
  });

  it('recovers the true chronological order', () => {
    expect(r.spine.map((s) => s.workId)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('buildSeries — One Piece', () => {
  const r = run(onePiece);

  it('has exactly one spine entry despite 1000+ episodes', () => {
    expect(r.spine).toEqual([{ workId: '21', ord: 1 }]);
  });

  it('files the films as extras, ordered by release', () => {
    const films = r.extras.filter((e) => e.track === 'movie').map((e) => e.workId);
    expect(films).toEqual(['459', '12859']);
  });
});

describe('buildSeries — film-only franchise', () => {
  const r = run(movieOnly);

  it('falls back to films as the spine and says so', () => {
    expect(r.spine.map((s) => s.workId)).toEqual(['m1', 'm2', 'm3']);
    expect(r.diagnostics.usedKindFallback).toBe(true);
  });
});

describe('buildSeries — announced sequel', () => {
  const r = run(withUnairedSequel);

  it('places an unaired sequel on the spine so "waiting" can find it', () => {
    expect(r.spine.map((s) => s.workId)).toEqual(['s1', 's2']);
  });
});

describe('buildSeries — invariants across every fixture', () => {
  it.each(allFixtures.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const r = run(f);

    // 1. The seed is always somewhere in its own franchise.
    expect(r.franchise).toContain(f.seedId);

    // 2. Spine and extras partition the franchise — nothing lost, nothing double-counted.
    const spineIds = r.spine.map((s) => s.workId);
    const extraIds = r.extras.map((e) => e.workId);
    expect([...spineIds, ...extraIds].sort()).toEqual([...r.franchise].sort());
    expect(new Set([...spineIds, ...extraIds]).size).toBe(r.franchise.length);

    // 3. ord is dense and 1-based — the UI renders it directly.
    expect(spineIds.map((_, i) => i + 1)).toEqual(r.spine.map((s) => s.ord));

    // 4. Deterministic: same input, same output. The order gets persisted.
    expect(run(f)).toEqual(r);
  });
});
