/**
 * Provider-agnostic domain types.
 *
 * Nothing in this directory may import a provider, a database client, React,
 * or anything from `next`. These are pure values and pure functions so that
 * the hard logic (series derivation) is testable without I/O and reusable by
 * any transport — HTTP today, a mobile BFF or a worker tomorrow.
 */

export type WorkId = string;

/** Normalised medium. Providers each spell these differently. */
export type WorkKind =
  | 'tv'
  | 'ona'
  | 'movie'
  | 'ova'
  | 'special'
  | 'music'
  | 'unknown';

/** Normalised release state of a work in the real world. */
export type ReleaseStatus =
  | 'finished'
  | 'airing'
  | 'not_yet_aired'
  | 'cancelled'
  | 'hiatus'
  | 'unknown';

/**
 * Normalised relation vocabulary.
 *
 * Providers disagree wildly here; the normaliser maps into this set and
 * everything downstream reasons only about these names.
 */
export type RelationKind =
  | 'sequel'
  | 'prequel'
  | 'side_story'
  | 'parent_story'
  | 'summary'
  | 'alternative_version'
  | 'alternative_setting'
  | 'spin_off'
  | 'character'
  | 'adaptation'
  | 'full_story'
  | 'other';

/** How an off-spine work relates to the main story, for UI grouping. */
export type Track =
  | 'movie'
  | 'ova'
  | 'special'
  | 'spinoff'
  | 'side_story'
  | 'recap'
  | 'alternative'
  | 'other';

export interface GraphNode {
  id: WorkId;
  title: string;
  kind: WorkKind;
  status: ReleaseStatus;
  /** ISO date or null. Used only as an ordering tiebreak — never as truth. */
  startDate: string | null;
  episodeCount: number | null;
}

export interface GraphEdge {
  from: WorkId;
  to: WorkId;
  kind: RelationKind;
}

export interface SpineEntry {
  workId: WorkId;
  /** 1-based position in the main story line. */
  ord: number;
}

export interface ExtraMember {
  workId: WorkId;
  track: Track;
  /** The relation that placed it here, for explaining the grouping in the UI. */
  via: RelationKind;
}

export interface SeriesDiagnostics {
  /**
   * True when the franchise cannot be honestly reduced to one watch order.
   * The UI MUST NOT show a single "what's next" when this is set — it shows a
   * story-line switcher instead. This is the Fate case.
   */
  ambiguous: boolean;
  /** Edges dropped to break a cycle, with the reason, for debugging bad data. */
  cyclesBroken: Array<{ from: WorkId; to: WorkId; reason: string }>;
  /** Edges referencing a node we never resolved (partial hydration). */
  danglingEdges: number;
  /** True when no TV/ONA existed and we fell back to treating movies as spine. */
  usedKindFallback: boolean;
}

export interface SeriesGraph {
  seedId: WorkId;
  /** Every work considered part of this franchise, spine and extras alike. */
  franchise: WorkId[];
  /** The main story line, in watch order. */
  spine: SpineEntry[];
  /** Everything else, grouped. */
  extras: ExtraMember[];
  /**
   * TV/ONA works that retell the story rather than continue it (UBW vs DEEN
   * Fate/stay night). A parallel line, not a later one.
   */
  alternativeLines: WorkId[];
  diagnostics: SeriesDiagnostics;
}
