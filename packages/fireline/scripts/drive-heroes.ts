/**
 * Heroes in free play (fireline-round6-design.md, workstream B). Its sections run inside
 * scripts/drive.ts and count in its totals. The groundwork's section states the rule B keeps: with
 * heroes off (every setup before round 6, and the default), no hero can be queued in a skirmish.
 * Workstream B adds its own sections after it and keeps it.
 */
import { canQueue } from '../src/sim/commands';
import { HERO_KINDS, UNITS } from '../src/sim/rules';
import { addBuilding, createInitialState } from '../src/sim/state';

type Ok = (cond: unknown, what: string) => void;

function heroesOff(ok: Ok): void {
  for (const setup of [{ tech: 'advanced' as const }, { tech: 'advanced' as const, heroes: false }, { tech: 'standard' as const, heroes: true }]) {
    const s = createInitialState('h', 'h', { seed: 'heroes-off', createdAt: 0, setup });
    ok(s.setup!.heroes === (setup.heroes ?? false), `setup ${JSON.stringify(setup)}: heroes recorded as ${setup.heroes ?? false}`);
    s.players[0].credits = 100000;
    for (const k of ['barracks', 'factory', 'techcentre'] as const) addBuilding(s, 0, k, 2 + 4 * ['barracks', 'factory', 'techcentre'].indexOf(k), 2);
    const off = !s.setup!.heroes || s.setup!.tech !== 'advanced';
    if (off) for (const h of HERO_KINDS) ok(!canQueue(s, 0, UNITS[h].category, h), `setup ${JSON.stringify(setup)}: ${h} cannot be queued`);
  }
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Round 6 groundwork: heroes stay out of a skirmish with heroes off', heroesOff],
  // round6:B begin. Heroes in free play: its sections, appended here.
  // round6:B end.
];
