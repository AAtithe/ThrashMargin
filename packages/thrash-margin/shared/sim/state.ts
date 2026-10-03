/**
 * Building a new game, cleaning untrusted configuration, and upgrading old saves.
 */
import {
  AI_AP_CAP, DEFAULT_CONFIG, DIFFICULTY, FACTION_NAMES, PRESETS, TECH_BY_ID, UNLIMITED_AP,
} from './content';
import { EVENT_BY_ID } from './events';
import { mapDefFor, MAP_BY_ID, type StartSite } from './maps';
import { seedFromString } from './rng';
import { neighboursOf } from './rules';
import type {
  BuildingType, Difficulty, FactionId, FactionState, FactionStats, GameConfig, GameState, LogEntry,
  Resources, Territory, TurnReport,
} from './types';
import { NEUTRAL, PLAYER } from './types';

export const SAVE_VERSION = 2;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);

/**
 * Builds a complete, in-range config from anything. The API passes the request body straight
 * here, and old saves carry keys the prototype used (aggro, growth, buildChance) that no longer
 * mean anything; both are handled by only ever copying known keys through a clamp.
 */
export function sanitizeConfig(input: Partial<GameConfig> | Record<string, unknown> | undefined): GameConfig {
  const c = (input ?? {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  const diff: Difficulty = (['easy', 'normal', 'hard', 'brutal'] as const).includes(c.diff as Difficulty) ? (c.diff as Difficulty) : d.diff;
  const mapId = typeof c.mapId === 'string' && MAP_BY_ID[c.mapId] ? c.mapId : d.mapId;
  const ap = clamp(c.apPerTurn, 2, UNLIMITED_AP, d.apPerTurn);
  const cfg: GameConfig = {
    diff,
    mapId,
    enemyFactions: Math.round(clamp(c.enemyFactions, 1, Math.max(1, mapDefFor(mapId).maxRivals), d.enemyFactions)),
    enemyTerritories: Math.round(clamp(c.enemyTerritories, 1, 4, d.enemyTerritories)),
    enemyTroopScale: clamp(c.enemyTroopScale, 0.25, 3, d.enemyTroopScale),
    enemyStartBuildings: bool(c.enemyStartBuildings, d.enemyStartBuildings),
    startGold: Math.round(clamp(c.startGold, 0, 500, d.startGold)),
    startFood: Math.round(clamp(c.startFood, 0, 500, d.startFood)),
    startMat: Math.round(clamp(c.startMat, 0, 500, d.startMat)),
    recruitCost: Math.round(clamp(c.recruitCost, 1, 20, d.recruitCost)),
    upkeep: Math.round(clamp(c.upkeep, 0, 4, d.upkeep)),
    playerBonus: clamp(c.playerBonus, -0.5, 1, d.playerBonus),
    neutralStr: Math.round(clamp(c.neutralStr, 1, 12, d.neutralStr)),
    apPerTurn: ap >= UNLIMITED_AP ? UNLIMITED_AP : Math.round(ap),
    fogOfWar: bool(c.fogOfWar, d.fogOfWar),
    enableEvents: bool(c.enableEvents, d.enableEvents),
    enableDiplomacy: bool(c.enableDiplomacy, d.enableDiplomacy),
    enableTechTree: bool(c.enableTechTree, d.enableTechTree),
    enableAltVictory: bool(c.enableAltVictory, d.enableAltVictory),
    enableStrongholds: bool(c.enableStrongholds, d.enableStrongholds),
    enableSpies: bool(c.enableSpies, d.enableSpies),
    altVictoryGold: Math.round(clamp(c.altVictoryGold, 100, 5000, d.altVictoryGold)),
    hotseat: bool(c.hotseat, d.hotseat),
  };
  if (typeof c.campaignScenario === 'number') cfg.campaignScenario = Math.round(clamp(c.campaignScenario, 0, 9, 0));
  if (typeof c.campaignBonusGold === 'number') cfg.campaignBonusGold = Math.round(clamp(c.campaignBonusGold, 0, 1000, 0));
  if (Array.isArray(c.campaignBonusTechs)) cfg.campaignBonusTechs = (c.campaignBonusTechs as unknown[]).filter((t): t is string => typeof t === 'string' && !!TECH_BY_ID[t]);
  return cfg;
}

/** The preset for a difficulty, laid over the defaults, as a complete config. */
export function presetConfig(diff: Difficulty, overrides: Partial<GameConfig> = {}): GameConfig {
  return sanitizeConfig({ ...DEFAULT_CONFIG, ...PRESETS[diff], ...overrides });
}

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export const emptyStats = (): FactionStats => ({
  battlesWon: 0, battlesLost: 0, captures: 0, annexed: 0, ceasefires: 0, troopsLost: 0, capitalsTaken: 0, starved: 0,
});

function newFaction(id: FactionId, human: boolean, resources: Resources, research: string[]): FactionState {
  return {
    id,
    name: human && id !== PLAYER ? `${FACTION_NAMES[id]} (Player ${id})` : FACTION_NAMES[id],
    human,
    resources,
    research,
    ceasefires: {},
    revealed: {},
    eliminated: false,
    traded: { food: 0, mat: 0 },
    stats: emptyStats(),
  };
}

export function emptyReport(faction: FactionId, fromTurn: number): TurnReport {
  return { faction, fromTurn, income: null, attacksSuffered: [], headlines: [], event: null };
}

/** Action points a faction gets at the start of its turn. */
export function apFor(state: Pick<GameState, 'config' | 'factions'>, faction: FactionId): number {
  const f = state.factions[faction];
  const bonus = f?.research.includes('grand_strategy') ? 1 : 0;
  const base = state.config.apPerTurn;
  if (f?.human) return base >= UNLIMITED_AP ? UNLIMITED_AP : base + bonus;
  const aiBase = base >= UNLIMITED_AP ? 5 : base;
  return Math.max(2, Math.min(AI_AP_CAP, aiBase + DIFFICULTY[state.config.diff].apBonus)) + bonus;
}

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------

const CAPITAL_KITS: BuildingType[][] = [['farm', 'tower'], ['mine', 'barracks'], ['farm', 'market']];

export interface NewGameOptions {
  seed: number;
  createdAt: number;
  name?: string;
}

/** Start sites with their extras resolved: listed ones first, then nearest free territory. */
function resolveExtras(sites: number, edges: [number, number][], starts: StartSite[], want: number, reserved: Set<number>): number[][] {
  const taken = new Set(reserved);
  starts.forEach(s => taken.add(s.capital));
  const out: number[][] = starts.map(() => []);
  const graph = { edges };
  // Round-robin by rank so no faction hoovers up a contested territory another lists first.
  for (let rank = 0; rank < want; rank++) {
    starts.forEach((s, k) => {
      const listed = s.extras.find(id => !taken.has(id));
      let pick = listed;
      if (pick === undefined) {
        // Nearest unclaimed territory by hops from this faction's capital
        const seen = new Set([s.capital]);
        let frontier = [s.capital];
        while (frontier.length && pick === undefined) {
          const next: number[] = [];
          for (const n of frontier) for (const m of neighboursOf(graph, n)) if (!seen.has(m)) { seen.add(m); next.push(m); }
          next.sort((a, b) => a - b);
          pick = next.find(id => !taken.has(id));
          frontier = next;
        }
      }
      if (pick !== undefined && pick < sites) { taken.add(pick); out[k].push(pick); }
    });
  }
  return out;
}

export function createInitialState(id: string, config: Partial<GameConfig>, opts: NewGameOptions): GameState {
  const cfg = sanitizeConfig(config);
  const def = mapDefFor(cfg.mapId);
  const layout = def.build(opts.seed >>> 0);
  const rivals = Math.min(cfg.enemyFactions, def.maxRivals);
  cfg.enemyFactions = rivals;
  const ns = cfg.mapId === 'tutorial' ? Math.min(cfg.neutralStr, 3) : cfg.neutralStr;

  const nodes: Territory[] = layout.sites.map(site => {
    const stronghold = cfg.enableStrongholds && !!site.stronghold;
    return {
      id: site.id, x: site.x, y: site.y, name: site.name,
      owner: NEUTRAL,
      troops: stronghold ? ns * 2 : Math.max(1, ns + (site.garrison ?? 0)),
      capital: false,
      lv: 1,
      buildings: [],
      ...(site.terrain && site.terrain !== 'plains' ? { terrain: site.terrain } : {}),
      ...(stronghold ? { stronghold: true } : {}),
    };
  });

  // The tutorial's first neutral comes with a farm already standing, so there is something to see.
  if (cfg.mapId === 'tutorial') nodes[1].buildings = ['farm'];

  const human = (f: FactionId) => f === PLAYER || (cfg.hotseat && f === 2);
  const playerCap = nodes[layout.player];
  Object.assign(playerCap, { owner: PLAYER, troops: 8, capital: true, lv: 2 });

  const starts = layout.rivals[rivals] ?? layout.rivals[1];
  const aiStarts = starts.map((s, k) => (human(k + 2) ? { ...s, extras: [] } : s));
  const reserved = new Set([layout.player, ...neighboursOf(layout, layout.player)]);
  const extras = resolveExtras(nodes.length, layout.edges, aiStarts, cfg.enemyTerritories - 1, reserved);
  const scale = cfg.enemyTroopScale;

  aiStarts.forEach((s, k) => {
    const f = k + 2;
    const cap = nodes[s.capital];
    if (human(f)) {
      Object.assign(cap, { owner: f, troops: 8, capital: true, lv: 2, buildings: [] });
      return;
    }
    Object.assign(cap, {
      owner: f, troops: Math.max(3, Math.round(6 * scale)), capital: true, lv: 2,
      buildings: cfg.enemyStartBuildings ? [...CAPITAL_KITS[k % CAPITAL_KITS.length]] : [],
    });
    extras[k].forEach((id, i) => {
      Object.assign(nodes[id], {
        owner: f, troops: Math.max(2, Math.round(3 * scale)), lv: 1, stronghold: nodes[id].stronghold,
        buildings: cfg.enemyStartBuildings && i === 0 ? ['farm'] : [],
      });
    });
  });

  const startRes = (bonus = 0): Resources => ({
    gold: cfg.startGold + bonus, food: cfg.startFood, mat: cfg.startMat, influence: 0, population: 0,
  });
  const bonusTechs = cfg.enableTechTree ? (cfg.campaignBonusTechs ?? []) : [];

  const factions: Record<number, FactionState> = {
    [PLAYER]: newFaction(PLAYER, true, startRes(cfg.campaignBonusGold ?? 0), [...bonusTechs]),
  };
  for (let k = 0; k < rivals; k++) {
    const f = k + 2;
    factions[f] = newFaction(f, human(f), startRes(), []);
  }

  const base = {
    config: cfg,
    factions,
  };

  const log: LogEntry[] = [{
    turn: 1, faction: NEUTRAL, kind: 'system',
    message: `${def.name}: ${rivals} rival${rivals === 1 ? '' : 's'} on ${cfg.diff}. The campaign begins.`,
  }];

  return {
    version: 2,
    id,
    ...(opts.name ? { name: opts.name } : {}),
    createdAt: opts.createdAt,
    rngSeed: opts.seed >>> 0,
    turn: 1,
    status: 'active',
    winner: null,
    nodes,
    edges: layout.edges.map(([a, b]) => [a, b] as [number, number]),
    config: cfg,
    factions,
    activeFaction: PLAYER,
    actionsLeft: apFor(base, PLAYER),
    log,
    pendingEvent: null,
    lastEvent: null,
    reports: {},
    history: [],
    achievements: [],
  };
}

// ---------------------------------------------------------------------------
// Old saves
// ---------------------------------------------------------------------------

/** Picks the territory a faction should treat as its seat: richest, then strongest, then lowest id. */
export function bestSeat(nodes: Territory[], faction: FactionId): Territory | null {
  const owned = nodes.filter(n => n.owner === faction);
  if (!owned.length) return null;
  return owned.slice().sort((a, b) => b.lv - a.lv || b.buildings.length - a.buildings.length || b.troops - a.troops || a.id - b.id)[0];
}

/** One capital per living faction: keep the first, demote any others, appoint one if missing. */
export function normaliseCapitals(nodes: Territory[]): Territory[] {
  const out = nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const seen = new Set<number>();
  for (const n of out) {
    if (!n.capital) continue;
    if (n.owner === NEUTRAL || seen.has(n.owner)) n.capital = false;
    else seen.add(n.owner);
  }
  const owners = new Set(out.filter(n => n.owner !== NEUTRAL).map(n => n.owner));
  for (const f of owners) {
    if (seen.has(f)) continue;
    const seat = bestSeat(out, f);
    if (seat) seat.capital = true;
  }
  return out;
}

type V1State = Record<string, any>;

/**
 * Brings any stored state up to the current save format. Version 2 saves pass through untouched.
 * A version 1 save (no `version` field) gets factions built from its single treasury, a seed
 * derived from its id, one capital per faction, and its log and history reshaped.
 */
export function migrateState(raw: unknown): GameState {
  const s = raw as V1State;
  if (s && s.version === SAVE_VERSION) return s as GameState;

  const cfg = sanitizeConfig(s.config ?? {});
  const nodes: Territory[] = normaliseCapitals((s.nodes ?? []).map((n: V1State) => ({
    id: n.id, x: n.x, y: n.y, name: n.name, owner: n.owner, troops: Math.max(0, Math.round(n.troops ?? 0)),
    capital: !!n.capital, lv: n.lv ?? 1, buildings: Array.isArray(n.buildings) ? n.buildings : [],
    ...(n.terrain ? { terrain: n.terrain } : {}),
    ...(n.stronghold ? { stronghold: true } : {}),
  })));
  const ownerIds = new Set<number>(nodes.map(n => n.owner).filter(o => o !== NEUTRAL));
  const maxRival = Math.max(1 + cfg.enemyFactions, ...ownerIds);
  cfg.enemyFactions = Math.max(1, Math.min(3, maxRival - 1));

  const human = (f: FactionId) => f === PLAYER || (cfg.hotseat && f === 2);
  const oldRes = s.resources ?? {};
  const turn = s.turn ?? 1;
  const factions: Record<number, FactionState> = {};
  for (let f = PLAYER; f <= 1 + cfg.enemyFactions; f++) {
    const res: Resources = f === PLAYER
      ? { gold: oldRes.gold ?? 0, food: oldRes.food ?? 0, mat: oldRes.mat ?? 0, influence: oldRes.influence ?? 0, population: oldRes.population ?? 0 }
      : { gold: cfg.startGold, food: cfg.startFood, mat: cfg.startMat, influence: 0, population: 0 };
    const fs = newFaction(f, human(f), res, f === PLAYER ? (s.research ?? []).filter((t: string) => TECH_BY_ID[t]) : []);
    fs.eliminated = !nodes.some(n => n.owner === f);
    factions[f] = fs;
  }
  for (const [other, turns] of Object.entries(s.ceasefires ?? {})) {
    const o = Number(other);
    if (factions[o] && Number(turns) > 0) {
      factions[PLAYER].ceasefires[o] = Number(turns);
      factions[o].ceasefires[PLAYER] = Number(turns);
    }
  }
  for (const id of s.revealed ?? []) factions[PLAYER].revealed[id] = turn + 2;

  const toneOf = (t: string) => (t === 'positive' || t === 'negative' ? t : 'neutral') as 'positive' | 'negative' | 'neutral';
  const pendingDef = s.pendingEvent ? EVENT_BY_ID[s.pendingEvent.id] : undefined;
  const status = s.status === 'victory' || s.status === 'defeated' ? s.status : 'active';

  return {
    version: 2,
    id: s.id,
    ...(s.name ? { name: s.name } : {}),
    createdAt: s.log?.[s.log.length - 1]?.timestamp ?? 0,
    rngSeed: seedFromString(String(s.id)),
    turn,
    status,
    winner: status === 'victory' ? PLAYER : null,
    ...(s.victoryType ? { victoryType: s.victoryType } : {}),
    ...(s.researchBranch ? { researchBranch: s.researchBranch } : {}),
    nodes,
    edges: s.edges ?? [],
    config: cfg,
    factions,
    activeFaction: s.activePlayer && factions[s.activePlayer]?.human ? s.activePlayer : PLAYER,
    actionsLeft: typeof s.actionsLeft === 'number' ? s.actionsLeft : apFor({ config: cfg, factions }, PLAYER),
    log: (s.log ?? []).slice(0, 200).map((l: V1State) => ({
      turn: l.turn ?? turn, faction: NEUTRAL, kind: 'system' as const,
      message: String(l.message ?? '').replace(/^[^\w(]+/u, ''),
    })),
    pendingEvent: pendingDef?.choices ? {
      id: pendingDef.id, faction: PLAYER, title: pendingDef.title, tone: pendingDef.tone, text: pendingDef.text,
      choices: pendingDef.choices.map(c => ({ label: c.label, desc: c.desc, ...(c.cost ? { cost: c.cost } : {}) })),
    } : null,
    lastEvent: s.lastEvent ? { id: s.lastEvent.id, title: s.lastEvent.title, message: s.lastEvent.message, tone: toneOf(s.lastEvent.type) } : null,
    reports: {},
    history: (s.history ?? []).map((h: V1State) => ({
      turn: h.turn, factions: { [PLAYER]: { territories: h.territories ?? 0, troops: h.troops ?? 0, gold: h.gold ?? 0 } },
    })),
    achievements: Array.isArray(s.achievements) ? s.achievements : [],
  };
}
