/**
 * The campaign's theatre: one fictional country, divided into provinces and city regions, that the
 * Meridian Corps takes from the Ashen Combine region by region. Story missions are fought in some
 * regions; every other region holds a side battle (an engagement) the player may fight from the
 * map once it borders held ground. Pure data and pure functions: no DOM, no clock, no Math.random.
 *
 * Map space is (fx, fy) in 0..1: west at fx 0, east at fx 1, north at fy 0, south at fy 1. The art
 * (game/campaignArt.ts) draws the polygons below; the rules (campaign/territory.ts) read only ids,
 * acts, neighbours and mission ids. Region ids are saved: never rename one.
 *
 * CONTRACT between the geometry and the rules. The geometry owner fills in theatreRegions(); the
 * rules owner codes against the types only.
 */

export type RegionKind = 'province' | 'city';

export interface TheatreRegion {
  /** Stable and saved in CampaignState.engagements. Never rename. */
  id: string;
  /** Fictional place name, shown on the map and in the engagement briefing. */
  name: string;
  /** The act whose front this region belongs to: 0 the south, 1 the north. */
  act: 0 | 1;
  kind: RegionKind;
  /** Where the region's marker (objective or engagement) sits, in map space. */
  site: [number, number];
  /** Closed outline in map space, land only. Shared borders are identical point for point on both sides. */
  polygon: [number, number][];
  /** Ids of the regions sharing a border with this one. Symmetric. */
  neighbours: string[];
  /** The story mission fought here, if any. Every mission has exactly one region. */
  missionId?: string;
  /** Held by the Meridian Corps when the campaign begins. */
  home?: boolean;
}

/** Who holds a region now, as the map shows it. `open` is enemy ground with a battle the player can fight now. */
export type RegionControl = 'held' | 'enemy' | 'open';

/** Everything the map needs to draw one campaign's theatre. Built by territory.ts from a CampaignState. */
export interface TheatreView {
  /** The act whose front the map focuses on. */
  act: 0 | 1;
  control: Record<string, RegionControl>;
  missions: {
    id: string;
    order: number;
    title: string;
    regionId: string;
    state: 'locked' | 'open' | 'won';
    stars: number;
    maxStars: number;
  }[];
  /** One per region without a mission. `locked`: not yet reachable. */
  engagements: { regionId: string; state: 'locked' | 'open' | 'won'; stars: number }[];
  /** The region whose briefing is open. */
  selected?: string;
}

// ---- Placeholder geometry: replaced by the real country. Keep the signature. ----------------------

let cache: TheatreRegion[] | null = null;

/** Every region of the theatre, both acts. Deterministic; the same array on every call. */
export function theatreRegions(): TheatreRegion[] {
  if (cache) return cache;
  const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  cache = [
    { id: 'placeholder-home', name: 'Home', act: 0, kind: 'province', site: [0.1, 0.7], polygon: box(0, 0.5, 0.2, 1), neighbours: ['placeholder-a'], home: true },
    { id: 'placeholder-a', name: 'A', act: 0, kind: 'province', site: [0.3, 0.7], polygon: box(0.2, 0.5, 0.4, 1), neighbours: ['placeholder-home'] },
  ];
  return cache;
}

export function regionById(id: string): TheatreRegion | undefined {
  return theatreRegions().find(r => r.id === id);
}

/** The region a story mission is fought in. */
export function regionOfMission(missionId: string): TheatreRegion | undefined {
  return theatreRegions().find(r => r.missionId === missionId);
}
