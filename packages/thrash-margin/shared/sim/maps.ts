/**
 * Map layouts. A map is a set of sites (positions, names, terrain), the edges between them, and
 * where each faction starts for each possible number of rivals.
 *
 * The prototype hard-coded every rival slot on five of its seven maps to faction 2, so choosing
 * "3 enemy factions" on the default map produced one faction holding two capitals. Each map now
 * declares a layout per rival count, and the lobby caps the rival count at what the map can seat.
 */
import { nextInt, next, shuffle } from './rng';
import type { TerrainType } from './types';

export interface MapSite {
  id: number;
  x: number;
  y: number;
  name: string;
  terrain?: TerrainType;
  /** Becomes a stronghold when strongholds are enabled. */
  stronghold?: boolean;
  /** Added to the neutral garrison (can be negative). */
  garrison?: number;
}

export interface StartSite {
  capital: number;
  /** Extra territories an AI faction starts with, in priority order. Humans get the capital alone. */
  extras: number[];
}

export interface MapLayout {
  sites: MapSite[];
  edges: [number, number][];
  /** Where faction 1 starts. */
  player: number;
  /** Index = number of rivals (1..maxRivals). Entry k is the start site for faction k + 2. */
  rivals: Record<number, StartSite[]>;
}

export interface MapDef {
  id: string;
  name: string;
  style: string;
  desc: string;
  viewBox: string;
  maxRivals: number;
  territories: number;
  build: (seed: number) => MapLayout;
}

// ---------------------------------------------------------------------------
// Heartlands — 20 territories
// ---------------------------------------------------------------------------

const HEARTLANDS: MapLayout = {
  sites: [
    { id: 0,  x: 68,  y: 55,  name: 'Ironhold',   terrain: 'coast' },
    { id: 1,  x: 195, y: 42,  name: 'Ashford' },
    { id: 2,  x: 320, y: 35,  name: 'Dunepass',   terrain: 'forest' },
    { id: 3,  x: 445, y: 42,  name: 'Stormgate' },
    { id: 4,  x: 548, y: 58,  name: 'Redfort',    terrain: 'mountain' },
    { id: 5,  x: 62,  y: 158, name: 'Millhaven',  terrain: 'coast' },
    { id: 6,  x: 178, y: 148, name: 'Greywall',   garrison: 1 },
    { id: 7,  x: 300, y: 140, name: 'Thornfield', terrain: 'forest', stronghold: true },
    { id: 8,  x: 422, y: 148, name: 'Ironpass' },
    { id: 9,  x: 535, y: 165, name: 'Crimsonton', terrain: 'mountain' },
    { id: 10, x: 80,  y: 268, name: 'Lowbridge',  terrain: 'coast' },
    { id: 11, x: 200, y: 258, name: 'Saltmere' },
    { id: 12, x: 318, y: 252, name: 'Midkeep',    terrain: 'forest', stronghold: true, garrison: 1 },
    { id: 13, x: 436, y: 258, name: 'Ashveil' },
    { id: 14, x: 540, y: 272, name: 'Emberveil',  terrain: 'mountain' },
    { id: 15, x: 65,  y: 375, name: 'Southfen',   terrain: 'coast', garrison: -1 },
    { id: 16, x: 190, y: 368, name: 'Marshgate' },
    { id: 17, x: 312, y: 362, name: 'Stonekeep',  terrain: 'forest', garrison: 1 },
    { id: 18, x: 432, y: 368, name: 'Cindervale' },
    { id: 19, x: 542, y: 385, name: 'Ashpeak',    terrain: 'mountain' },
  ],
  edges: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 9], [0, 5], [1, 5], [1, 6], [2, 6], [2, 7], [3, 7], [3, 8], [8, 9], [9, 14],
    [5, 6], [6, 7], [7, 8], [8, 13], [13, 14],
    [5, 10], [6, 10], [6, 11], [7, 11], [7, 12], [8, 12], [13, 18], [14, 18], [14, 19],
    [10, 11], [10, 15], [11, 12], [11, 15], [11, 16], [12, 13], [12, 16], [12, 17], [13, 17],
    [15, 16], [16, 17], [17, 18], [18, 19],
  ],
  player: 0,
  rivals: {
    1: [{ capital: 19, extras: [14, 9, 4] }],
    2: [{ capital: 19, extras: [18, 14, 13] }, { capital: 4, extras: [3, 9, 8] }],
    3: [{ capital: 19, extras: [18, 14, 13] }, { capital: 4, extras: [3, 9, 8] }, { capital: 12, extras: [17, 11, 16] }],
  },
};

// ---------------------------------------------------------------------------
// The Narrows — 14 territories, a two-territory chokepoint
// ---------------------------------------------------------------------------

const NARROWS: MapLayout = {
  sites: [
    { id: 0,  x: 90,  y: 80,  name: 'Ironhold',  terrain: 'forest' },
    { id: 1,  x: 90,  y: 200, name: 'Millhaven', terrain: 'forest' },
    { id: 2,  x: 90,  y: 340, name: 'Southfen',  terrain: 'forest', garrison: -1 },
    { id: 3,  x: 200, y: 140, name: 'Ashford' },
    { id: 4,  x: 200, y: 270, name: 'Saltmere' },
    { id: 5,  x: 200, y: 375, name: 'Marshgate', garrison: -1 },
    { id: 6,  x: 300, y: 175, name: 'Thornpass', terrain: 'mountain', stronghold: true, garrison: 1 },
    { id: 7,  x: 300, y: 295, name: 'Stoneford', terrain: 'mountain', garrison: 1 },
    { id: 8,  x: 415, y: 80,  name: 'Dunegate' },
    { id: 9,  x: 415, y: 200, name: 'Ironpass' },
    { id: 10, x: 415, y: 340, name: 'Ashveil' },
    { id: 11, x: 535, y: 80,  name: 'Redfort',   terrain: 'coast' },
    { id: 12, x: 535, y: 210, name: 'Ashpeak',   terrain: 'coast' },
    { id: 13, x: 535, y: 350, name: 'Crimsonton' },
  ],
  edges: [
    [0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [3, 4], [4, 5], [2, 5],
    [3, 6], [4, 6], [4, 7], [5, 7],
    [6, 7],
    [6, 8], [6, 9], [7, 9], [7, 10],
    [8, 9], [9, 10], [8, 11], [9, 11], [9, 12], [10, 12], [10, 13], [11, 12], [12, 13],
  ],
  player: 0,
  rivals: {
    1: [{ capital: 12, extras: [11, 13, 9] }],
    2: [{ capital: 11, extras: [8, 9, 12] }, { capital: 13, extras: [10, 12, 9] }],
  },
};

// ---------------------------------------------------------------------------
// Crossroads — 16 territories, four arms and a contested centre
// ---------------------------------------------------------------------------

const CROSSROADS: MapLayout = {
  sites: [
    { id: 0,  x: 90,  y: 360, name: 'Ironhold' },
    { id: 1,  x: 175, y: 315, name: 'Southfen' },
    { id: 2,  x: 225, y: 260, name: 'Saltmere' },
    { id: 3,  x: 90,  y: 80,  name: 'Ashford',    terrain: 'forest' },
    { id: 4,  x: 175, y: 120, name: 'Millhaven',  terrain: 'forest' },
    { id: 5,  x: 230, y: 185, name: 'Greywall',   terrain: 'forest' },
    { id: 6,  x: 305, y: 190, name: 'Crossgate',  terrain: 'mountain', stronghold: true, garrison: 1 },
    { id: 7,  x: 375, y: 190, name: 'Midkeep',    terrain: 'mountain', garrison: 1 },
    { id: 8,  x: 305, y: 275, name: 'Thornfield', terrain: 'mountain', garrison: 1 },
    { id: 9,  x: 375, y: 275, name: 'Stonevale',  terrain: 'mountain', stronghold: true, garrison: 1 },
    { id: 10, x: 540, y: 360, name: 'Emberveil',  terrain: 'coast' },
    { id: 11, x: 455, y: 315, name: 'Cindervale', terrain: 'coast' },
    { id: 12, x: 400, y: 265, name: 'Ashveil',    terrain: 'coast' },
    { id: 13, x: 540, y: 80,  name: 'Redfort' },
    { id: 14, x: 455, y: 120, name: 'Crimsonton' },
    { id: 15, x: 400, y: 185, name: 'Ironpass' },
  ],
  edges: [
    [0, 1], [1, 2], [3, 4], [4, 5], [10, 11], [11, 12], [13, 14], [14, 15],
    [2, 6], [2, 8], [5, 6], [5, 7], [12, 8], [12, 9], [15, 7], [15, 9],
    [6, 7], [6, 8], [7, 9], [8, 9],
  ],
  player: 0,
  rivals: {
    1: [{ capital: 13, extras: [14, 15, 10] }],
    2: [{ capital: 13, extras: [14, 15, 7] }, { capital: 10, extras: [11, 12, 9] }],
    3: [{ capital: 13, extras: [14, 15, 7] }, { capital: 10, extras: [11, 12, 9] }, { capital: 3, extras: [4, 5, 6] }],
  },
};

// ---------------------------------------------------------------------------
// Frontier — 18 territories, staggered grid
// ---------------------------------------------------------------------------

const FRONTIER: MapLayout = {
  sites: [
    { id: 0,  x: 90,  y: 55,  name: 'Redfort',    terrain: 'desert' },
    { id: 1,  x: 230, y: 55,  name: 'Ashford' },
    { id: 2,  x: 365, y: 55,  name: 'Dunepass' },
    { id: 3,  x: 480, y: 55,  name: 'Ashpeak',    terrain: 'desert' },
    { id: 4,  x: 160, y: 150, name: 'Millhaven' },
    { id: 5,  x: 300, y: 150, name: 'Thornfield', terrain: 'forest', stronghold: true, garrison: 1 },
    { id: 6,  x: 430, y: 150, name: 'Ironpass',   terrain: 'forest' },
    { id: 7,  x: 90,  y: 245, name: 'Greywall' },
    { id: 8,  x: 230, y: 245, name: 'Midkeep',    garrison: 1 },
    { id: 9,  x: 365, y: 245, name: 'Saltmere' },
    { id: 10, x: 480, y: 245, name: 'Crimsonton' },
    { id: 11, x: 160, y: 335, name: 'Lowbridge' },
    { id: 12, x: 300, y: 335, name: 'Stonekeep',  terrain: 'forest', stronghold: true, garrison: 1 },
    { id: 13, x: 430, y: 335, name: 'Cindervale' },
    { id: 14, x: 90,  y: 390, name: 'Ironhold',   terrain: 'coast' },
    { id: 15, x: 230, y: 390, name: 'Southfen',   terrain: 'coast', garrison: -1 },
    { id: 16, x: 365, y: 390, name: 'Marshgate' },
    { id: 17, x: 480, y: 390, name: 'Emberveil' },
  ],
  edges: [
    [0, 1], [1, 2], [2, 3],
    [0, 4], [1, 4], [1, 5], [2, 5], [2, 6], [3, 6],
    [4, 5], [5, 6],
    [4, 7], [4, 8], [5, 8], [5, 9], [6, 9], [6, 10],
    [7, 8], [8, 9], [9, 10],
    [7, 11], [8, 11], [8, 12], [9, 12], [9, 13], [10, 13],
    [11, 12], [12, 13],
    [11, 14], [11, 15], [12, 15], [12, 16], [13, 16], [13, 17],
    [14, 15], [15, 16], [16, 17],
  ],
  player: 14,
  rivals: {
    1: [{ capital: 3, extras: [6, 2, 0] }],
    2: [{ capital: 0, extras: [1, 4, 7] }, { capital: 3, extras: [6, 2, 10] }],
    3: [{ capital: 0, extras: [1, 4, 7] }, { capital: 3, extras: [6, 2, 10] }, { capital: 17, extras: [13, 16, 12] }],
  },
};

// ---------------------------------------------------------------------------
// Grand Continent — 34 territories
// ---------------------------------------------------------------------------

function hexGridEdges(rowSizes: number[]): { coords: Array<{ row: number; col: number }>; edges: [number, number][] } {
  const coords: Array<{ row: number; col: number }> = [];
  const rowStart: number[] = [];
  rowSizes.forEach((size, row) => {
    rowStart.push(coords.length);
    for (let col = 0; col < size; col++) coords.push({ row, col });
  });
  const edges: [number, number][] = [];
  rowSizes.forEach((size, row) => {
    for (let col = 0; col < size - 1; col++) edges.push([rowStart[row] + col, rowStart[row] + col + 1]);
    if (row === rowSizes.length - 1) return;
    const nextSize = rowSizes[row + 1];
    for (let col = 0; col < size; col++) {
      const a = rowStart[row] + col;
      if (nextSize < size) {
        // wide row above a narrow row: col connects to next col-1 and col
        if (col - 1 >= 0) edges.push([a, rowStart[row + 1] + col - 1]);
        if (col < nextSize) edges.push([a, rowStart[row + 1] + col]);
      } else if (nextSize > size) {
        edges.push([a, rowStart[row + 1] + col]);
        edges.push([a, rowStart[row + 1] + col + 1]);
      } else {
        edges.push([a, rowStart[row + 1] + col]);
        if (col + 1 < nextSize) edges.push([a, rowStart[row + 1] + col + 1]);
      }
    }
  });
  return { coords, edges };
}

const GRAND_NAMES = [
  'Redfort', 'Ironwall', 'Stonegate', 'Duskpass', 'Tidewatch', 'Ashpeak',
  'Greyholm', 'Thornvale', 'Midridge', 'Saltcliff', 'Emberton',
  'Westmere', 'Coppergate', 'The Crossing', 'Silverholm', 'Dunehaven', 'Eastkeep',
  'Harrow', 'Goldvale', 'The Summit', 'Ironmarsh', 'Greenwatch',
  'Lowfen', 'Clayfield', 'Stonecroft', 'Ashveil', 'Thornford', 'Ashenmere',
  'Ironhold', 'Millhaven', 'Southfen', 'Marshgate', 'Cindervale', 'Emberveil',
];

const GRAND_TERRAIN: Record<number, TerrainType> = {
  0: 'mountain', 1: 'forest', 2: 'forest', 5: 'mountain', 7: 'forest', 8: 'forest',
  11: 'coast', 16: 'coast', 18: 'desert', 19: 'desert', 22: 'coast', 26: 'desert', 27: 'desert',
  28: 'coast', 29: 'coast', 33: 'desert',
};

const GRAND: MapLayout = (() => {
  const rowSizes = [6, 5, 6, 5, 6];
  const { coords, edges } = hexGridEdges(rowSizes);
  // The last row is a second wide row directly below the fifth, offset to sit between
  const evenX = [60, 185, 310, 435, 560, 685];
  const oddX = [122, 248, 372, 498, 623];
  const rowY = [45, 140, 230, 320, 410, 495];
  const sites: MapSite[] = coords.map((c, id) => ({
    id,
    x: (c.row % 2 === 0 ? evenX : oddX)[c.col],
    y: rowY[c.row],
    name: GRAND_NAMES[id],
    terrain: GRAND_TERRAIN[id],
    stronghold: id === 13 || id === 19 ? true : undefined,
  }));
  // Row 5 (ids 28-33): six more along the bottom, each touching the two above it
  const base = sites.length;
  for (let col = 0; col < 6; col++) {
    const id = base + col;
    sites.push({ id, x: evenX[col], y: rowY[5], name: GRAND_NAMES[id], terrain: GRAND_TERRAIN[id] });
    if (col > 0) edges.push([id - 1, id]);
  }
  // Row 4 (ids 22-27) to row 5 (ids 28-33)
  for (let col = 0; col < 6; col++) {
    edges.push([22 + col, 28 + col]);
    if (col + 1 < 6) edges.push([22 + col, 28 + col + 1]);
  }
  return {
    sites,
    edges,
    player: 28,
    rivals: {
      1: [{ capital: 5, extras: [4, 10, 16] }],
      2: [{ capital: 5, extras: [4, 10, 16] }, { capital: 0, extras: [1, 6, 11] }],
      3: [{ capital: 5, extras: [4, 10, 16] }, { capital: 0, extras: [1, 6, 11] }, { capital: 33, extras: [32, 27, 21] }],
    },
  };
})();

// ---------------------------------------------------------------------------
// Tutorial — 8 territories
// ---------------------------------------------------------------------------

const TUTORIAL: MapLayout = {
  sites: [
    { id: 0, x: 100, y: 180, name: 'Ironhold' },
    { id: 1, x: 230, y: 180, name: 'Meadowkeep' },
    { id: 2, x: 340, y: 120, name: 'Thornwood', terrain: 'forest' },
    { id: 3, x: 450, y: 120, name: 'Ridgepass', terrain: 'mountain' },
    { id: 4, x: 230, y: 280, name: 'Saltcove',  terrain: 'coast' },
    { id: 5, x: 450, y: 240, name: 'Ashfen' },
    { id: 6, x: 550, y: 180, name: 'Duskbridge' },
    { id: 7, x: 550, y: 280, name: 'Ashpeak' },
  ],
  edges: [[0, 1], [1, 2], [2, 3], [3, 5], [1, 4], [4, 5], [5, 6], [6, 7], [5, 7]],
  player: 0,
  rivals: { 1: [{ capital: 7, extras: [] }] },
};

// ---------------------------------------------------------------------------
// Random — 28 territories, generated from the game's seed
// ---------------------------------------------------------------------------

const RANDOM_NAMES = [
  'Ironhold', 'Ashford', 'Dunepass', 'Stormgate', 'Millhaven', 'Greywall', 'Thornfield', 'Ironpass',
  'Lowbridge', 'Saltmere', 'Midkeep', 'Ashveil', 'Emberveil', 'Southfen', 'Marshgate', 'Stonekeep',
  'Cindervale', 'Coppergate', 'Silverholm', 'Dunehaven', 'Eastkeep', 'Harrow', 'Goldvale', 'Ironmarsh',
  'Greenwatch', 'Lowfen', 'Clayfield', 'Stonecroft', 'Thornford', 'Ashenmere', 'Grimholt', 'Frostfall',
  'Oakridge', 'Windmere', 'Redmere', 'Southgate', 'Blackfen', 'Coldpass', 'Rivermere', 'Dunwall',
];

function isConnected(count: number, edges: [number, number][]): boolean {
  const adj: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of adj[n]) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  return seen.size === count;
}

function buildRandom(seed: number): MapLayout {
  let s = seed;
  const { coords, edges: allEdges } = hexGridEdges([6, 5, 6, 5, 6]);
  const evenX = [60, 185, 310, 435, 560, 685];
  const oddX = [122, 248, 372, 498, 623];
  const rowY = [50, 140, 230, 320, 410];

  const names = shuffle(s, RANDOM_NAMES.slice(1));
  s = names.seed;

  const sites: MapSite[] = coords.map((c, id) => {
    const jx = nextInt(s, -16, 16); s = jx.seed;
    const jy = nextInt(s, -12, 12); s = jy.seed;
    const roll = next(s); s = roll.seed;
    const r = roll.value;
    let terrain: TerrainType | undefined;
    if (c.row <= 1) terrain = r < 0.35 ? 'mountain' : r < 0.6 ? 'forest' : undefined;
    else if (c.row === 2) terrain = r < 0.2 ? 'forest' : r < 0.35 ? 'mountain' : r < 0.45 ? 'desert' : undefined;
    else terrain = r < 0.3 ? 'coast' : r < 0.4 ? 'desert' : r < 0.5 ? 'forest' : undefined;
    return {
      id,
      x: (c.row % 2 === 0 ? evenX : oddX)[c.col] + jx.value,
      y: rowY[c.row] + jy.value,
      name: id === 22 ? 'Ironhold' : names.items[id],
      terrain,
    };
  });

  // Two strongholds somewhere in the middle three rows
  const middle = sites.filter((_, id) => coords[id].row >= 1 && coords[id].row <= 3).map(x => x.id);
  const picks = shuffle(s, middle);
  s = picks.seed;
  for (const id of picks.items.slice(0, 2)) sites[id].stronghold = true;

  // Thin the mesh: drop roughly one edge in six, never disconnecting the map or leaving a
  // territory with fewer than two neighbours.
  const order = shuffle(s, allEdges.map((_, i) => i));
  s = order.seed;
  let edges = allEdges.slice();
  const starts = new Set([22, 5, 0, 27]);
  let dropped = 0;
  for (const i of order.items) {
    if (dropped >= Math.floor(allEdges.length / 6)) break;
    const [a, b] = allEdges[i];
    if (starts.has(a) || starts.has(b)) continue;
    const without = edges.filter(e => e !== allEdges[i]);
    const degree = (n: number) => without.filter(([x, y]) => x === n || y === n).length;
    if (degree(a) < 2 || degree(b) < 2) continue;
    if (!isConnected(sites.length, without)) continue;
    edges = without;
    dropped++;
  }

  return {
    sites,
    edges,
    player: 22,
    rivals: {
      1: [{ capital: 5, extras: [] }],
      2: [{ capital: 5, extras: [] }, { capital: 0, extras: [] }],
      3: [{ capital: 5, extras: [] }, { capital: 0, extras: [] }, { capital: 27, extras: [] }],
    },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const fixed = (layout: MapLayout) => () => layout;

export const MAP_DEFS: MapDef[] = [
  { id: 'tutorial',        name: 'Tutorial',        style: 'Guided',          maxRivals: 1, territories: 8,  viewBox: '40 60 580 280',  desc: 'Eight territories and a coach that walks you through attacking, recruiting, building and ending a turn.', build: fixed(TUTORIAL) },
  { id: 'heartlands',      name: 'Heartlands',      style: 'Balanced',        maxRivals: 3, territories: 20, viewBox: '20 0 580 420',   desc: 'The classic. You start in the north-west; rivals hold the east, the north-east and the centre.', build: fixed(HEARTLANDS) },
  { id: 'narrows',         name: 'The Narrows',     style: 'Chokepoint',      maxRivals: 2, territories: 14, viewBox: '40 30 560 380',  desc: 'Two flanks joined by a two-territory pass. Whoever holds the pass dictates the war.', build: fixed(NARROWS) },
  { id: 'crossroads',      name: 'Crossroads',      style: 'Central Control', maxRivals: 3, territories: 16, viewBox: '40 30 560 370',  desc: 'Four arms meet at a mountain centre. The middle pays, and everyone can reach it.', build: fixed(CROSSROADS) },
  { id: 'frontier',        name: 'Frontier',        style: 'Open Field',      maxRivals: 3, territories: 18, viewBox: '40 20 500 400',  desc: 'A staggered open grid. Few natural walls, so towers and timing matter.', build: fixed(FRONTIER) },
  { id: 'grand_continent', name: 'Grand Continent', style: 'Multi-Faction',   maxRivals: 3, territories: 34, viewBox: '10 0 740 540',   desc: 'Thirty-four territories and room for three rivals. A long game of economy and fronts.', build: fixed(GRAND) },
  { id: 'random',          name: 'Random Map',      style: 'Procedural',      maxRivals: 3, territories: 28, viewBox: '20 15 710 440',  desc: 'Generated from the game seed: terrain, names, strongholds and missing roads all vary.', build: buildRandom },
];

export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAP_DEFS.map(m => [m.id, m]));

export function mapDefFor(id: string): MapDef {
  return MAP_BY_ID[id] ?? MAP_BY_ID.heartlands;
}
