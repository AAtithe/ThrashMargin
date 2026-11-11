/**
 * Formations and squads (fireline-round6-design.md, workstream D). Its sections run inside
 * scripts/drive.ts and count in its totals. The groundwork's section covers what is declared before
 * D builds anything: squads in saves, and the reducer refusing what nothing handles yet. Workstream D
 * replaces the refusal assertions marked below once it handles them, and adds its own sections.
 */
import { processAction } from '../src/sim/actions';
import { FORMATION_SHAPES } from '../src/sim/rules';
import { createInitialState, migrateState } from '../src/sim/state';
import type { GameAction, GameState, Squad } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

function groundwork(ok: Ok): void {
  ok(FORMATION_SHAPES.join() === 'line,column,wedge,box', 'four formation shapes');
  const s = createInitialState('f', 'f', { seed: 'formations', createdAt: 0, setup: { tech: 'advanced' } });
  ok(s.squads === undefined && s.units.every(u => u.squad === undefined), 'a fresh battle has no squads');
  const ids = s.units.filter(u => u.owner === 0).map(u => u.id);
  const c = s.units.find(u => u.owner === 0)!;
  // A plain move is exactly as before.
  ok(processAction(s, { type: 'move', ids, x: c.x + 3, y: c.y }) !== s, 'a move without a formation is legal');
  // round6:D begin. Formations and squads: D replaces the two refusals below with its own tests.
  for (const shape of FORMATION_SHAPES) {
    ok(processAction(s, { type: 'move', ids, x: c.x + 3, y: c.y, formation: shape }) === s, `a move in a ${shape} is refused until workstream D handles it`);
    ok(processAction(s, { type: 'formation', ids, shape }) === s, `forming a ${shape} is refused until workstream D handles it`);
  }
  // round6:D end.
  ok(processAction(s, { type: 'formation', ids, shape: 'moon' } as unknown as GameAction) === s, 'an unknown shape is refused');
  // Saves: well-formed squads kept, junk dropped, a unit's squad kept only when it names a kept squad.
  const raw = copy(s);
  const good: Squad = { id: 9001, leader: ids[0], shape: 'wedge', members: ids.slice() };
  raw.squads = [
    good,
    { id: 9002, leader: ids[1], shape: 'moon' as never, members: [ids[1]] },
    { id: 9003, leader: 77777, shape: 'box', members: [ids[1]] },
    { id: 9001, leader: ids[0], shape: 'line', members: [ids[0]] },
    null as never,
    { id: 'x' as never, leader: ids[0], shape: 'line', members: [ids[0]] },
  ];
  raw.units[0].squad = 9001;
  raw.units[1].squad = 9002;
  raw.units[2].squad = 'x' as never;
  const m = migrateState(raw)!;
  ok(!!m.squads && m.squads.length === 1 && JSON.stringify(m.squads[0]) === JSON.stringify(good), 'migrateState keeps the well-formed squad alone');
  ok(m.units[0].squad === 9001 && m.units[1].squad === undefined && m.units[2].squad === undefined, "a unit's squad is kept only when it names a kept squad");
  const junk = copy(s) as unknown as Record<string, unknown>;
  junk.squads = { a: 1 };
  ok(migrateState(junk)!.squads === undefined, 'squads that are not a list are dropped');
  ok(JSON.stringify(migrateState(copy(m))) === JSON.stringify(m), 'a state with squads passes migrateState unchanged');
  // The one copy an action makes copies the squads' member lists too.
  const withSquad = copy(m);
  const after = processAction(withSquad, { type: 'tick' });
  ok(after.squads !== withSquad.squads && after.squads![0].members !== withSquad.squads![0].members, 'cloneState copies squads one level deep');
  ok(JSON.stringify(after.squads) === JSON.stringify(withSquad.squads), 'and nothing changes them yet');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Round 6 groundwork: squads and formation orders', groundwork],
  // round6:D begin. Formations and squads: its sections, appended here.
  // round6:D end.
];
