/**
 * Turn events, drawn at the start of a human faction's turn when events are enabled.
 *
 * Every draw and every target pick goes through the seeded stream. A choice event becomes a
 * `pendingEvent`, which must be answered before the turn can end; the prototype instead silently
 * took the first option on End Turn, which for the merchant and the rebels meant paying gold the
 * player never agreed to spend.
 */
import { nextInt } from './rng';
import { troopCapOf } from './rules';
import type { EventTone, FactionId, GameState, Resources } from './types';
import { NEUTRAL } from './types';

export interface EventChoice {
  label: string;
  desc: string;
  cost?: Partial<Resources>;
  apply: (state: GameState, faction: FactionId) => GameState;
}

export interface EventDef {
  id: string;
  title: string;
  tone: EventTone;
  weight: number;
  /** First turn the event can appear on, so nobody loses troops to plague on turn 2. */
  fromTurn?: number;
  text: string;
  /** Immediate effect. Returns the message to show, or null if the event had nothing to act on. */
  apply?: (state: GameState, faction: FactionId, seed: number) => { state: GameState; seed: number; message: string };
  choices?: EventChoice[];
}

function addResources(state: GameState, faction: FactionId, delta: Partial<Resources>): GameState {
  const f = state.factions[faction];
  const r = { ...f.resources };
  for (const [k, v] of Object.entries(delta) as Array<[keyof Resources, number]>) r[k] = Math.max(0, r[k] + v);
  return { ...state, factions: { ...state.factions, [faction]: { ...f, resources: r } } };
}

function pick<T>(seed: number, items: T[]): { seed: number; item: T | null } {
  if (!items.length) return { seed, item: null };
  const r = nextInt(seed, 0, items.length - 1);
  return { seed: r.seed, item: items[r.value] };
}

function changeTroops(state: GameState, id: number, delta: number, floor = 1): GameState {
  const nodes = state.nodes.map(n => (n.id === id ? { ...n, troops: Math.max(floor, n.troops + delta) } : n));
  return { ...state, nodes };
}

export const EVENTS: EventDef[] = [
  {
    id: 'trade_windfall', title: 'Trade Windfall', tone: 'positive', weight: 3,
    text: 'A caravan route opens through your lands.',
    apply: (s, f, seed) => ({ state: addResources(s, f, { gold: 12 }), seed, message: 'Merchants pay their tolls: +12 gold.' }),
  },
  {
    id: 'harvest', title: 'Harvest Season', tone: 'positive', weight: 3,
    text: 'The fields came in heavy this year.',
    apply: (s, f, seed) => ({ state: addResources(s, f, { food: 10 }), seed, message: 'A bumper crop: +10 food.' }),
  },
  {
    id: 'ore_strike', title: 'Rich Ore Strike', tone: 'positive', weight: 3,
    text: 'Miners break into a fresh seam.',
    apply: (s, f, seed) => ({ state: addResources(s, f, { mat: 8 }), seed, message: 'A rich vein: +8 materials.' }),
  },
  {
    id: 'enemy_unrest', title: 'Unrest Abroad', tone: 'positive', weight: 2, fromTurn: 4,
    text: 'Agitators stir trouble in a rival garrison.',
    apply: (s, f, seed) => {
      const targets = s.nodes.filter(n => n.owner !== f && n.owner !== NEUTRAL && n.troops > 2);
      const p = pick(seed, targets);
      if (!p.item) return { state: s, seed: p.seed, message: 'The agitators found no garrison worth stirring.' };
      return { state: changeTroops(s, p.item.id, -3), seed: p.seed, message: `Strife in ${p.item.name}: its garrison loses 3 troops.` };
    },
  },
  {
    id: 'plague', title: 'Plague', tone: 'negative', weight: 2, fromTurn: 5,
    text: 'Sickness spreads through a crowded barracks.',
    apply: (s, f, seed) => {
      const targets = s.nodes.filter(n => n.owner === f && n.troops > 3);
      const p = pick(seed, targets);
      if (!p.item) return { state: s, seed: p.seed, message: 'The plague burns out before it reaches your garrisons.' };
      return { state: changeTroops(s, p.item.id, -3), seed: p.seed, message: `Disease sweeps ${p.item.name}: 3 troops lost.` };
    },
  },
  {
    id: 'crop_blight', title: 'Crop Blight', tone: 'negative', weight: 2, fromTurn: 3,
    text: 'Blight rots the stores.',
    apply: (s, f, seed) => ({ state: addResources(s, f, { food: -8 }), seed, message: 'The stores spoil: -8 food.' }),
  },
  {
    id: 'supply_crisis', title: 'Supply Crisis', tone: 'negative', weight: 2, fromTurn: 3,
    text: 'Bandits raid the material convoys.',
    apply: (s, f, seed) => ({ state: addResources(s, f, { mat: -6 }), seed, message: 'Convoys lost: -6 materials.' }),
  },
  {
    id: 'border_unrest', title: 'Militia Rising', tone: 'neutral', weight: 2,
    text: 'Free towns arm themselves against all comers.',
    apply: (s, _f, seed) => {
      const p = pick(seed, s.nodes.filter(n => n.owner === NEUTRAL));
      if (!p.item) return { state: s, seed: p.seed, message: 'No free towns remain to arm.' };
      return { state: changeTroops(s, p.item.id, 2, 0), seed: p.seed, message: `${p.item.name} raises a militia: +2 neutral troops.` };
    },
  },
  {
    id: 'wandering_merchant', title: 'Wandering Merchant', tone: 'neutral', weight: 2,
    text: 'A merchant arrives with goods to sell, and is not staying long.',
    choices: [
      { label: 'Buy food', desc: '15 gold for 20 food', cost: { gold: 15 }, apply: (s, f) => addResources(s, f, { gold: -15, food: 20 }) },
      { label: 'Buy materials', desc: '12 gold for 12 materials', cost: { gold: 12 }, apply: (s, f) => addResources(s, f, { gold: -12, mat: 12 }) },
      { label: 'Send them away', desc: 'No effect', apply: s => s },
    ],
  },
  {
    id: 'rebel_offer', title: 'Rebel Defectors', tone: 'positive', weight: 1, fromTurn: 3,
    text: 'Deserters from a rival army offer their swords, for a price.',
    choices: [
      {
        label: 'Hire them', desc: '20 gold for 5 troops at your capital', cost: { gold: 20 },
        apply: (s, f) => {
          const cap = s.nodes.find(n => n.owner === f && n.capital);
          if (!cap) return s;
          const room = Math.max(0, troopCapOf(cap) - cap.troops);
          return changeTroops(addResources(s, f, { gold: -20 }), cap.id, Math.min(5, room), 0);
        },
      },
      { label: 'Decline', desc: 'No effect', apply: s => s },
    ],
  },
  {
    id: 'ancient_vault', title: 'Ancient Vault', tone: 'positive', weight: 1,
    text: 'Your scouts uncover a sealed vault beneath an old keep.',
    choices: [
      { label: 'Take the gold', desc: '+25 gold', apply: (s, f) => addResources(s, f, { gold: 25 }) },
      { label: 'Take the materials', desc: '+18 materials', apply: (s, f) => addResources(s, f, { mat: 18 }) },
    ],
  },
  {
    id: 'calm', title: 'A Quiet Season', tone: 'neutral', weight: 6,
    text: 'Nothing of note.',
    apply: (s, _f, seed) => ({ state: s, seed, message: 'The realm is quiet.' }),
  },
];

export const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(EVENTS.map(e => [e.id, e]));

/** Weighted draw from the events eligible this turn. */
export function drawEvent(seed: number, turn: number): { seed: number; event: EventDef } {
  const pool = EVENTS.filter(e => (e.fromTurn ?? 1) <= turn);
  const total = pool.reduce((s, e) => s + e.weight, 0);
  const r = nextInt(seed, 0, total - 1);
  let acc = 0;
  for (const e of pool) {
    acc += e.weight;
    if (r.value < acc) return { seed: r.seed, event: e };
  }
  return { seed: r.seed, event: pool[pool.length - 1] };
}

export function canAfford(resources: Resources, cost?: Partial<Resources>): boolean {
  if (!cost) return true;
  return (Object.entries(cost) as Array<[keyof Resources, number]>).every(([k, v]) => resources[k] >= v);
}
