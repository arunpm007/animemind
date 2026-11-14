import type {
  ExtraMember,
  GraphEdge,
  GraphNode,
  RelationKind,
  SeriesGraph,
  SpineEntry,
  Track,
  WorkId,
  WorkKind,
} from './types';

/**
 * Relations that do NOT make something part of the same franchise.
 * `adaptation` points at the source manga/novel (a different medium);
 * `character` links unrelated shows that merely share a cast member.
 */
const NON_FRANCHISE: ReadonlySet<RelationKind> = new Set<RelationKind>([
  'adaptation',
  'character',
]);

/** The only relations that can order one work after another. */
const CONTINUATION: ReadonlySet<RelationKind> = new Set<RelationKind>([
  'sequel',
  'prequel',
]);

/**
 * Relations that mark a work as a retelling rather than a continuation.
 * Following these when ordering is what makes naive implementations emit
 * nonsense orders for Fate and Monogatari.
 */
const RETELLING: ReadonlySet<RelationKind> = new Set<RelationKind>([
  'alternative_version',
  'alternative_setting',
]);

/** Kinds eligible to carry the main story line, in preference order. */
const PRIMARY_KINDS: ReadonlySet<WorkKind> = new Set<WorkKind>(['tv', 'ona']);
const FALLBACK_KINDS: ReadonlySet<WorkKind> = new Set<WorkKind>(['movie']);

const EDGE_SEP = '->';

function edgeKey(from: WorkId, to: WorkId): string {
  return `${from}${EDGE_SEP}${to}`;
}

/**
 * Normalise a continuation edge to point forward in story time.
 *
 * Providers emit both directions for the same fact: A "sequel" B means B
 * follows A, and B "prequel" A means the same thing from the other side.
 * Collapsing both to a single forward edge is what makes the graph a DAG.
 */
function forwardEdge(e: GraphEdge): { from: WorkId; to: WorkId } | null {
  if (e.kind === 'sequel') return { from: e.from, to: e.to };
  if (e.kind === 'prequel') return { from: e.to, to: e.from };
  return null;
}

function time(node: GraphNode | undefined): number {
  if (!node?.startDate) return Number.POSITIVE_INFINITY;
  const t = Date.parse(node.startDate);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Classify an off-spine member for UI grouping.
 *
 * Precedence is medium-first, with two deliberate exceptions. People browse
 * extras by medium ("the films", "the OVAs"), so a One Piece film filed under
 * `side_story` still belongs in Movies. Recaps and retellings override medium
 * because they change the *decision* rather than the format: a compilation
 * film is something you skip, not something you watch next.
 */
function trackFor(node: GraphNode, via: RelationKind): Track {
  if (via === 'summary') return 'recap';
  if (RETELLING.has(via)) return 'alternative';
  switch (node.kind) {
    case 'movie':
      return 'movie';
    case 'ova':
      return 'ova';
    case 'special':
      return 'special';
    default:
      break;
  }
  if (via === 'spin_off') return 'spinoff';
  if (via === 'side_story' || via === 'parent_story') return 'side_story';
  return 'other';
}

export interface BuildSeriesInput {
  seedId: WorkId;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Derive a watchable series structure from a provider relation graph.
 *
 * The contract that matters:
 *  - The spine contains ONLY works reachable from the seed through
 *    sequel/prequel edges AND of a primary kind. An OVA prequel therefore
 *    never becomes "season zero" (the Attack on Titan trap).
 *  - Retellings are reported separately, never ordered into the spine. When
 *    any exist the result is flagged `ambiguous` and callers must not claim a
 *    single "what to watch next" (the Fate trap).
 *  - Cycles from mislabelled provider data are broken deterministically
 *    rather than hanging (the Monogatari trap).
 */
export function buildSeries({ seedId, nodes, edges }: BuildSeriesInput): SeriesGraph {
  const byId = new Map<WorkId, GraphNode>(nodes.map((n) => [n.id, n]));
  const seed = byId.get(seedId);
  if (!seed) {
    throw new Error(`buildSeries: seed ${seedId} not present in nodes`);
  }

  let danglingEdges = 0;
  const usable = edges.filter((e) => {
    const ok = byId.has(e.from) && byId.has(e.to);
    if (!ok) danglingEdges += 1;
    return ok;
  });

  // ---------------------------------------------------------------- franchise
  // Undirected closure over every edge except the ones that cross media or
  // merely share characters.
  const franchiseAdj = new Map<WorkId, Array<{ to: WorkId; kind: RelationKind }>>();
  for (const e of usable) {
    if (NON_FRANCHISE.has(e.kind)) continue;
    if (!franchiseAdj.has(e.from)) franchiseAdj.set(e.from, []);
    if (!franchiseAdj.has(e.to)) franchiseAdj.set(e.to, []);
    franchiseAdj.get(e.from)!.push({ to: e.to, kind: e.kind });
    franchiseAdj.get(e.to)!.push({ to: e.from, kind: e.kind });
  }

  /** workId -> the relation kind by which we first reached it from the seed. */
  const reachedVia = new Map<WorkId, RelationKind>();
  const franchise: WorkId[] = [];
  {
    const queue: WorkId[] = [seedId];
    const seen = new Set<WorkId>([seedId]);
    while (queue.length) {
      const id = queue.shift()!;
      franchise.push(id);
      for (const { to, kind } of franchiseAdj.get(id) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        reachedVia.set(to, kind);
        queue.push(to);
      }
    }
  }
  const inFranchise = new Set(franchise);

  // ------------------------------------------------------------ spine members
  // Continuation-only closure from the seed. Kind is checked when *traversing*,
  // so an OVA cannot act as a bridge between two TV seasons either.
  const isKind = (kinds: ReadonlySet<WorkKind>, id: WorkId) => {
    const n = byId.get(id);
    return !!n && kinds.has(n.kind);
  };

  let spineKinds = PRIMARY_KINDS;
  let usedKindFallback = false;
  if (!isKind(PRIMARY_KINDS, seedId) && isKind(FALLBACK_KINDS, seedId)) {
    spineKinds = FALLBACK_KINDS;
    usedKindFallback = true;
  }

  const contAdj = new Map<WorkId, Set<WorkId>>(); // forward edges only
  const contUndirected = new Map<WorkId, Set<WorkId>>();
  const seenEdge = new Set<string>();
  for (const e of usable) {
    if (!CONTINUATION.has(e.kind)) continue;
    const fwd = forwardEdge(e);
    if (!fwd) continue;
    if (!inFranchise.has(fwd.from) || !inFranchise.has(fwd.to)) continue;
    // Both endpoints must be able to carry the story line.
    if (!isKind(spineKinds, fwd.from) || !isKind(spineKinds, fwd.to)) continue;
    const key = edgeKey(fwd.from, fwd.to);
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);

    if (!contAdj.has(fwd.from)) contAdj.set(fwd.from, new Set());
    contAdj.get(fwd.from)!.add(fwd.to);
    if (!contUndirected.has(fwd.from)) contUndirected.set(fwd.from, new Set());
    if (!contUndirected.has(fwd.to)) contUndirected.set(fwd.to, new Set());
    contUndirected.get(fwd.from)!.add(fwd.to);
    contUndirected.get(fwd.to)!.add(fwd.from);
  }

  const spineSet = new Set<WorkId>();
  if (isKind(spineKinds, seedId)) {
    const queue: WorkId[] = [seedId];
    spineSet.add(seedId);
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of contUndirected.get(id) ?? []) {
        if (spineSet.has(next)) continue;
        spineSet.add(next);
        queue.push(next);
      }
    }
  }

  // ------------------------------------------------------------------ ordering
  const cyclesBroken: Array<{ from: WorkId; to: WorkId; reason: string }> = [];
  const order = topoOrder(spineSet, contAdj, byId, cyclesBroken);
  const spine: SpineEntry[] = order.map((workId, i) => ({ workId, ord: i + 1 }));

  // -------------------------------------------------------------------- extras
  const extras: ExtraMember[] = [];
  const alternativeLines: WorkId[] = [];
  for (const id of franchise) {
    if (spineSet.has(id)) continue;
    const node = byId.get(id)!;
    const via = reachedVia.get(id) ?? 'other';
    if (RETELLING.has(via) && spineKinds.has(node.kind)) {
      alternativeLines.push(id);
    }
    extras.push({ workId: id, track: trackFor(node, via), via });
  }
  extras.sort((a, b) => time(byId.get(a.workId)) - time(byId.get(b.workId)));

  return {
    seedId,
    franchise,
    spine,
    extras,
    alternativeLines,
    diagnostics: {
      ambiguous: alternativeLines.length > 0,
      cyclesBroken,
      danglingEdges,
      usedKindFallback,
    },
  };
}

/**
 * Kahn's algorithm with two deterministic guarantees:
 *  - ties broken by start date then id, so the same graph always yields the
 *    same order (important: the order is persisted and diffed);
 *  - genuine cycles broken by dropping the most chronologically backwards
 *    edge, so bad provider data degrades instead of hanging.
 */
function topoOrder(
  members: ReadonlySet<WorkId>,
  adj: ReadonlyMap<WorkId, Set<WorkId>>,
  byId: ReadonlyMap<WorkId, GraphNode>,
  cyclesBroken: Array<{ from: WorkId; to: WorkId; reason: string }>,
): WorkId[] {
  const out = new Map<WorkId, Set<WorkId>>();
  const indeg = new Map<WorkId, number>();
  for (const id of members) {
    out.set(id, new Set());
    indeg.set(id, 0);
  }
  for (const [from, tos] of adj) {
    if (!members.has(from)) continue;
    for (const to of tos) {
      if (!members.has(to)) continue;
      if (out.get(from)!.has(to)) continue;
      out.get(from)!.add(to);
      indeg.set(to, (indeg.get(to) ?? 0) + 1);
    }
  }

  const cmp = (a: WorkId, b: WorkId) => {
    const d = time(byId.get(a)) - time(byId.get(b));
    return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
  };

  const result: WorkId[] = [];
  const placed = new Set<WorkId>();
  const ready = [...members].filter((id) => (indeg.get(id) ?? 0) === 0);

  while (result.length < members.size) {
    if (ready.length === 0) {
      // Every remaining node sits on a cycle. Break the edge that runs most
      // strongly backwards in time; that is almost always the mislabelled one.
      const remaining = [...members].filter((id) => !placed.has(id));
      let victim: { from: WorkId; to: WorkId; delta: number } | null = null;
      for (const from of remaining) {
        for (const to of out.get(from) ?? []) {
          if (placed.has(to)) continue;
          const delta = time(byId.get(from)) - time(byId.get(to));
          if (!victim || delta > victim.delta) victim = { from, to, delta };
        }
      }
      if (!victim) break; // defensive: nothing left to cut
      out.get(victim.from)!.delete(victim.to);
      const next = (indeg.get(victim.to) ?? 1) - 1;
      indeg.set(victim.to, next);
      cyclesBroken.push({
        from: victim.from,
        to: victim.to,
        reason: 'cycle: dropped most chronologically backwards edge',
      });
      if (next === 0) ready.push(victim.to);
      continue;
    }

    ready.sort(cmp);
    const id = ready.shift()!;
    if (placed.has(id)) continue;
    placed.add(id);
    result.push(id);
    for (const to of out.get(id) ?? []) {
      const next = (indeg.get(to) ?? 1) - 1;
      indeg.set(to, next);
      if (next === 0) ready.push(to);
    }
  }

  return result;
}
