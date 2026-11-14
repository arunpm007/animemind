import type { GraphEdge, GraphNode } from '@/server/domain/types';

/**
 * Hand-authored relation graphs that encode the specific shapes that break
 * naive series derivation. IDs are the real AniList/MAL ids so these can be
 * re-derived from a live provider when checking for drift.
 *
 * These are deliberately NOT captured provider dumps: each one isolates one
 * trap, so a failure names the bug instead of just going red.
 */

export interface Fixture {
  name: string;
  seedId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const tv = (
  id: string,
  title: string,
  startDate: string | null,
  episodeCount: number | null = null,
  status: GraphNode['status'] = 'finished',
): GraphNode => ({ id, title, kind: 'tv', status, startDate, episodeCount });

const of = (
  id: string,
  title: string,
  kind: GraphNode['kind'],
  startDate: string | null,
  status: GraphNode['status'] = 'finished',
): GraphNode => ({ id, title, kind, status, startDate, episodeCount: null });

/**
 * TRAP: an OVA is a declared PREQUEL of season 1. A prequel-walk that ignores
 * medium puts "No Regrets" at spine position 1 and every season shifts by one.
 * Also contains a TV-format SPIN_OFF (Junior High) that must stay off-spine
 * despite being an eligible kind.
 */
export const attackOnTitan: Fixture = {
  name: 'Attack on Titan (OVA-prequel + TV-spinoff traps)',
  seedId: '16498',
  nodes: [
    tv('16498', 'Shingeki no Kyojin', '2013-04-07', 25),
    tv('20958', 'Shingeki no Kyojin Season 2', '2017-04-01', 12),
    tv('99147', 'Shingeki no Kyojin Season 3', '2018-07-23', 12),
    tv('104578', 'Shingeki no Kyojin Season 3 Part 2', '2019-04-29', 10),
    tv('110277', 'Shingeki no Kyojin: The Final Season', '2020-12-07', 16),
    of('20811', 'Kuinaki Sentaku (No Regrets)', 'ova', '2014-12-09'),
    of('18397', 'Shingeki no Kyojin OVA', 'ova', '2013-12-09'),
    of('20691', 'Guren no Yumiya', 'movie', '2014-11-22'),
    of('119113', 'Shingeki no Kyojin: Chronicle', 'movie', '2020-07-17'),
    tv('21281', 'Shingeki! Kyojin Chuugakkou', '2015-10-04', 12),
  ],
  edges: [
    { from: '16498', to: '20958', kind: 'sequel' },
    { from: '20958', to: '99147', kind: 'sequel' },
    { from: '99147', to: '104578', kind: 'sequel' },
    { from: '104578', to: '110277', kind: 'sequel' },
    // the trap: an OVA declared as the prequel of season 1
    { from: '16498', to: '20811', kind: 'prequel' },
    { from: '16498', to: '18397', kind: 'side_story' },
    { from: '16498', to: '20691', kind: 'alternative_version' },
    { from: '16498', to: '119113', kind: 'summary' },
    { from: '16498', to: '21281', kind: 'spin_off' },
    // cross-medium, must never enter the franchise
    { from: '16498', to: 'manga-53390', kind: 'adaptation' },
  ],
};

/**
 * TRAP: the franchise genuinely has no single order. UBW retells the same
 * route Fate/stay night already covered. Any product that prints one linear
 * order here is lying to the user.
 */
export const fate: Fixture = {
  name: 'Fate (irreducible — parallel retellings)',
  seedId: '356',
  nodes: [
    tv('356', 'Fate/stay night', '2006-01-07', 24),
    tv('10087', 'Fate/Zero', '2011-10-02', 13),
    tv('11741', 'Fate/stay night: Unlimited Blade Works', '2014-10-05', 12),
    of('20698', 'Fate/stay night: Unlimited Blade Works (movie)', 'movie', '2010-01-23'),
    tv('21719', 'Fate/Apocrypha', '2017-07-02', 25),
  ],
  edges: [
    // Zero is the prequel of stay night -> forward edge Zero -> stay night
    { from: '356', to: '10087', kind: 'prequel' },
    // UBW retells stay night. NOT a sequel.
    { from: '356', to: '11741', kind: 'alternative_version' },
    { from: '356', to: '20698', kind: 'alternative_version' },
    { from: '356', to: '21719', kind: 'alternative_setting' },
  ],
};

/**
 * TRAP: mislabelled data produces a genuine cycle. Kahn's algorithm alone
 * never terminates; the algorithm must break the cycle deterministically.
 */
export const cyclic: Fixture = {
  name: 'Cyclic franchise (mislabelled sequel edge)',
  seedId: 'a',
  nodes: [
    tv('a', 'Bakemonogatari', '2009-07-03', 15),
    tv('b', 'Nisemonogatari', '2012-01-08', 11),
    tv('c', 'Monogatari Series: Second Season', '2013-07-07', 26),
    tv('d', 'Owarimonogatari', '2015-10-04', 12),
  ],
  edges: [
    { from: 'a', to: 'b', kind: 'sequel' },
    { from: 'b', to: 'c', kind: 'sequel' },
    { from: 'c', to: 'd', kind: 'sequel' },
    // the lie: the newest entry declared as a predecessor of the oldest
    { from: 'd', to: 'a', kind: 'sequel' },
  ],
};

/** A long-runner with no seasons at all, plus a pile of films. */
export const onePiece: Fixture = {
  name: 'One Piece (single spine entry, many films)',
  seedId: '21',
  nodes: [
    tv('21', 'One Piece', '1999-10-20', null, 'airing'),
    of('459', 'One Piece: Dead End no Bouken', 'movie', '2003-03-01'),
    of('12859', 'One Piece Film: Z', 'movie', '2012-12-15'),
    of('1237', 'One Piece: Taose! Kaizoku Ganzack', 'ova', '1998-12-26'),
  ],
  edges: [
    { from: '21', to: '459', kind: 'side_story' },
    { from: '21', to: '12859', kind: 'side_story' },
    { from: '21', to: '1237', kind: 'alternative_version' },
  ],
};

/** No TV entry anywhere — the spine has to fall back to films. */
export const movieOnly: Fixture = {
  name: 'Film-only franchise (kind fallback)',
  seedId: 'm1',
  nodes: [
    of('m1', 'Rebuild 1.0', 'movie', '2007-09-01'),
    of('m2', 'Rebuild 2.0', 'movie', '2009-06-27'),
    of('m3', 'Rebuild 3.0', 'movie', '2012-11-17'),
  ],
  edges: [
    { from: 'm1', to: 'm2', kind: 'sequel' },
    { from: 'm2', to: 'm3', kind: 'sequel' },
  ],
};

/** An announced-but-unaired sequel: the "waiting for season 2" signal. */
export const withUnairedSequel: Fixture = {
  name: 'Announced sequel (not yet aired)',
  seedId: 's1',
  nodes: [
    tv('s1', 'Example S1', '2024-01-07', 12),
    tv('s2', 'Example S2', null, null, 'not_yet_aired'),
  ],
  edges: [{ from: 's1', to: 's2', kind: 'sequel' }],
};

export const allFixtures: Fixture[] = [
  attackOnTitan,
  fate,
  cyclic,
  onePiece,
  movieOnly,
  withUnairedSequel,
];
