/**
 * What a long battle's save is made of (Grand War G0, fireline-grand-war-design.md). Headless: a
 * computer-only four-sided Continental battle with the full economy, played to --to minutes; at each
 * --every minutes prints the packed save's size and its largest top-level fields.
 *
 *   tsx scripts/save-size.ts --to 60 --every 10 --seed size-1
 */
import { processAction } from '../src/sim/actions';
import { packState } from '../src/sim/pack';
import { createInitialState } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const TO = Number(arg('to', '60'));
const EVERY = Number(arg('every', '10'));
const SEED = arg('seed', 'size-1');
const SIDES = Number(arg('sides', '4')) as 2 | 3 | 4;

export function grandSetupState(seed: string, sides: 2 | 3 | 4 = 4): GameState {
  return createInitialState(`size-${seed}`, seed, {
    seed,
    difficulty: 'normal',
    createdAt: 0,
    autopilot: true,
    setup: {
      map: 'random', tech: 'advanced', sides, mode: 'ffa', size: 'continental', research: 'lines', pace: 'long',
      sites: true, industry: true, supply: true, territory: true, production: true, upkeep: true, seasons: true,
    },
  });
}

const kb = (x: unknown): number => JSON.stringify(x ?? null).length / 1024;

function report(s: GameState): void {
  const packed = packState(s) as unknown as Record<string, unknown>;
  const rows = Object.entries(packed).map(([k, v]) => [k, kb(v)] as const).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`minute ${(s.tick / 600).toFixed(0)}: ${kb(packed).toFixed(0)} KB, ${s.units.length} units, ${s.buildings.length} structures; ` + rows.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '));
}

if (process.argv[1]?.endsWith('save-size.ts')) {
  let s = grandSetupState(SEED, SIDES);
  report(s);
  for (let m = EVERY; m <= TO && s.winner === null; m += EVERY) {
    while (s.winner === null && s.tick < m * 600) s = processAction(s, { type: 'tick', n: 50 });
    report(s);
  }
  if (s.winner !== null) console.log(`ended at minute ${(s.tick / 600).toFixed(1)}`);
}
