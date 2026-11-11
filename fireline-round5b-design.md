# Fireline, round 5b: development lines and loadouts (the contract)

Renamed from `fireline-round5-design.md` at the merge with main (2026-11-11): main built its own
round 5 in parallel (the build window, larger maps, engineering vehicles, neutral sites and tier
three) under that name, and main's names won. Research now lives on the build window's Research
tab, and loadouts under the tree on its Vehicles tab.

Status (2026-11-10): contract written, nothing built yet. Agents implement strictly from this file.
Where the code and this file disagree on a name or a number, this file wins; where this file is
silent, follow the existing pattern of round 4 (`fireline-round4-design.md`, workstream A) and say
so in the build log.

Read first: `CLAUDE.md` (invariants), `fireline-design.md` section "2026-11-09: Air power and
research", `packages/fireline/src/sim/research.ts`, `src/sim/aiAir.ts`.

Repo rules that hold throughout:

- `src/sim/` is pure: no `Math.random`, no clock. Nothing in this round needs a die.
- One `cloneState` per legal action; an **illegal action returns the very same state object**.
- Optional rules live behind a toggle that **every preset states explicitly**.
- **Old saves load and play unchanged.** A save without the new fields plays exactly as before.
- Colours are CSS tokens, in both the light `:root` block and the `:root[data-theme="dark"]` block
  of `src/styles.css`. Never a hex literal in a component, never hex alpha appended to a token.
- British English. No em dashes anywhere (code comments, UI copy, docs).

All paths below are relative to `packages/fireline/` unless they start with `scripts/` at the repo
root or name a root document.

---

## 1. Summary

Research gains a second mode, **development lines**, selected by a new skirmish setup field:

```ts
export type ResearchMode = 'classic' | 'lines';
SkirmishSetup.research: ResearchMode
```

- `'classic'`: exactly today's five flat upgrades. Every campaign mission, every save without the
  field, `LEGACY_SETUP`, and every battle on standard tech.
- `'lines'`: five lines (Logistics, Armour, Engines, Weapons, Air), each with Mk I, Mk II and a
  Mk III doctrine fork of two branches. The five existing upgrades **are** the Mk I of their lines
  (same ids, same cost, same time, same effect). Researching unlocks **vehicle modules**, fitted
  per vehicle type through a loadout at the War Factory. `DEFAULT_SETUP` uses it.

Three player actions: `research` (existing, now also takes Mk II and Mk III ids), `doctrine` (new:
commit a line to one fork branch, free, permanent) and `loadout` (new: set the modules every new
unit of a vehicle type is built with).

---

## 2. Types and constants (`src/sim/rules.ts`)

Add a new section after the existing research constants (after `AIRFRAMES_REARM`), headed
`// ---- Development lines and loadouts (round 5; fireline-round5b-design.md) ----`.

### 2.1 Research mode and the setup field

```ts
export type ResearchMode = 'classic' | 'lines';
export const RESEARCH_MODES: ResearchMode[] = ['classic', 'lines'];
```

`SkirmishSetup` gains, as its **last** field (key order matters: `drive.ts` compares
`JSON.stringify(normaliseSetup({}))` with `JSON.stringify(DEFAULT_SETUP)`):

```ts
  /** 'classic': the five flat upgrades. 'lines': development lines, doctrines and loadouts. Advanced tech only. */
  research: ResearchMode;
```

```ts
export const DEFAULT_SETUP: SkirmishSetup = { map: 'random', tech: 'advanced', credits: 3000, ore: 'normal', sides: 2, mode: 'ffa', research: 'lines' };
export const LEGACY_SETUP:  SkirmishSetup = { map: 'classic', tech: 'standard', credits: 3000, ore: 'normal', sides: 2, mode: 'ffa', research: 'classic' };
```

### 2.2 Upgrade ids

`UpgradeId` is widened. The first five are unchanged and keep their specs exactly.

```ts
export type UpgradeId =
  // Classic, and Mk I of each line (unchanged):
  | 'plating' | 'calibration' | 'engines' | 'refining' | 'airframes'
  // Mk II:
  | 'plating2' | 'engines2' | 'refining2' | 'autoloaders' | 'avionics'
  // Mk III fork branches:
  | 'reactive' | 'composite'        // armour
  | 'fieldrepair' | 'motorised'     // engines
  | 'assembly' | 'salvage'          // logistics
  | 'heat' | 'highexplosive'        // weapons
  | 'hardened' | 'munitions';       // air

/** The five upgrades a 'classic' battle offers (unchanged list, unchanged order). */
export const UPGRADE_ORDER: UpgradeId[] = ['refining', 'plating', 'engines', 'calibration', 'airframes'];
/** True for an id a 'classic' battle offers. */
export const isClassicUpgrade = (id: UpgradeId): boolean => UPGRADE_ORDER.includes(id);
```

### 2.3 Lines

```ts
export type LineId = 'logistics' | 'armour' | 'engines' | 'weapons' | 'air';
/** Lines in the order the Research tree lists them (rows, top to bottom). */
export const LINE_ORDER: LineId[] = ['logistics', 'armour', 'engines', 'weapons', 'air'];

export interface LineSpec {
  name: string;
  /** Mk I, Mk II, then the two Mk III branches [left, right] as drawn. */
  marks: [UpgradeId, UpgradeId];
  fork: [UpgradeId, UpgradeId];
}

export const LINES: Record<LineId, LineSpec> = {
  logistics: { name: 'Logistics', marks: ['refining', 'refining2'],      fork: ['assembly', 'salvage'] },
  armour:    { name: 'Armour',    marks: ['plating', 'plating2'],        fork: ['reactive', 'composite'] },
  engines:   { name: 'Engines',   marks: ['engines', 'engines2'],        fork: ['fieldrepair', 'motorised'] },
  weapons:   { name: 'Weapons',   marks: ['calibration', 'autoloaders'], fork: ['heat', 'highexplosive'] },
  air:       { name: 'Air',       marks: ['airframes', 'avionics'],      fork: ['hardened', 'munitions'] },
};

/** Which line an upgrade belongs to and its mark (1, 2 or 3). Derived from LINES once at load. */
export const UPGRADE_LINE: Record<UpgradeId, { line: LineId; mark: 1 | 2 | 3 }>;
```

`UpgradeSpec` is unchanged in shape (`name`, `blurb`, `cost`, `ticks`, `requires`). The previous
mark is **not** listed in `requires` (that is buildings only); it is derived from `LINES`.

### 2.4 Upgrade specs (add to `UPGRADES`; the first five are untouched)

| id | Line, mark | Name | Cost | Ticks | requires (buildings) | Effect |
|---|---|---|---|---|---|---|
| `refining` | Logistics I | Refinery efficiency | 2000 | 700 | researchlab | Ore pays x1.15 (unchanged) |
| `refining2` | Logistics II | Ore processing | 2400 | 800 | researchlab, techcentre | Ore pays x1.25 in total (replaces x1.15) |
| `assembly` | Logistics III | Assembly lines | 2500 | 900 | researchlab, techcentre | Infantry, vehicle and air queues progress x1.15 (not the building queue) |
| `salvage` | Logistics III | Salvage crews | 2500 | 900 | researchlab, techcentre | Each enemy vehicle or aircraft this side destroys pays `floor(0.1 * UNITS[kind].cost)` credits |
| `plating` | Armour I | Armour plating | 1500 | 600 | researchlab | Vehicles' full health x1.2 (unchanged) |
| `plating2` | Armour II | Heavy plating | 2000 | 750 | researchlab, techcentre | Vehicles' full health a further x1.125 (x1.35 in total) |
| `reactive` | Armour III | Reactive armour | 2500 | 900 | researchlab, techcentre | Vehicles take x0.8 damage from `rocket`, `bomb` and `missile` |
| `composite` | Armour III | Composite armour | 2500 | 900 | researchlab, techcentre | Vehicles take x0.8 damage from `shell` and `artillery` |
| `engines` | Engines I | Engine tuning | 1200 | 500 | researchlab | Vehicles' speed x1.15 (unchanged) |
| `engines2` | Engines II | Turbochargers | 1800 | 700 | researchlab, techcentre | Vehicles' speed x1.25 in total (replaces x1.15) |
| `fieldrepair` | Engines III | Field workshops | 2200 | 800 | researchlab, techcentre | Every vehicle repairs out of combat as an elite unit does (see 4.6) |
| `motorised` | Engines III | Motorised infantry | 2200 | 800 | researchlab, techcentre | Infantry speed x1.15 |
| `calibration` | Weapons I | Weapon calibration | 2000 | 750 | researchlab, techcentre | Every weapon x1.15 damage (unchanged) |
| `autoloaders` | Weapons II | Autoloaders | 2400 | 800 | researchlab, techcentre | Ground vehicles' reload x0.9 (cooldown, rounded, at least 1) |
| `heat` | Weapons III | HEAT rounds | 2800 | 1000 | researchlab, techcentre | Every `shell` and `rocket` this side fires x1.1 damage (units, structures, Gunships) |
| `highexplosive` | Weapons III | High-explosive fill | 2800 | 1000 | researchlab, techcentre | Splash radius x1.25 on every splash weapon this side fires (units, structures, bombs) |
| `airframes` | Air I | Air frames | 1500 | 600 | researchlab, helipad | Aircraft health x1.25, rearm x0.6 (unchanged) |
| `avionics` | Air II | Avionics | 2000 | 750 | researchlab, helipad, techcentre | Aircraft speed x1.15 |
| `hardened` | Air III | Armoured cockpits | 2500 | 900 | researchlab, helipad, techcentre | Aircraft take x0.75 damage from `flak`, `aamissile` and `bullet` |
| `munitions` | Air III | Heavy munitions | 2500 | 900 | researchlab, helipad, techcentre | Aircraft weapons (Gunship rockets, bombs) x1.15 damage |

Blurbs, exact text (no em dashes):

```
refining2:     'Every load of ore pays 25% more, instead of 15%.'
assembly:      'Infantry, vehicles and aircraft are built 15% faster.'
salvage:       'Every enemy vehicle or aircraft you destroy pays a tenth of its cost.'
plating2:      'Vehicles have over a third more health than standard, instead of a fifth.'
reactive:      'Vehicles take a fifth less damage from rockets, bombs and missiles.'
composite:     'Vehicles take a fifth less damage from tank shells and artillery.'
engines2:      'Vehicles move 25% faster, instead of 15%.'
fieldrepair:   'Every vehicle patches itself up out of combat, as elite units do.'
motorised:     'Infantry move 15% faster.'
autoloaders:   'Vehicle weapons reload 10% faster.'
heat:          'Your shells and rockets hit 10% harder, on top of calibration.'
highexplosive: 'Every weapon with a blast hits a quarter wider.'
avionics:      'Aircraft fly 15% faster.'
hardened:      'Aircraft take a quarter less damage from flak, anti-air missiles and machine guns.'
munitions:     'Gunship rockets and bombs hit 15% harder.'
```

### 2.5 Effect constants

```ts
export const PLATING2_HP = 1.125;        // a step on top of PLATING_HP (applied by raiseHealth, as plating is)
export const ENGINES2_SPEED = 1.25;      // the total, replacing ENGINES_SPEED
export const REFINING2_INCOME = 1.25;    // the total, replacing REFINING_INCOME
export const REACTIVE_TAKEN = 0.8;
export const REACTIVE_KINDS: WeaponKind[] = ['rocket', 'bomb', 'missile'];
export const COMPOSITE_TAKEN = 0.8;
export const COMPOSITE_KINDS: WeaponKind[] = ['shell', 'artillery'];
export const MOTORISED_SPEED = 1.15;
export const ASSEMBLY_RATE = 1.15;
export const SALVAGE_SHARE = 0.1;
export const AUTOLOADER_RELOAD = 0.9;
export const HEAT_DAMAGE = 1.1;
export const HEAT_KINDS: WeaponKind[] = ['shell', 'rocket'];
export const HE_SPLASH = 1.25;
export const AVIONICS_SPEED = 1.15;
export const HARDENED_TAKEN = 0.75;
export const HARDENED_KINDS: WeaponKind[] = ['flak', 'aamissile', 'bullet'];
export const MUNITIONS_DAMAGE = 1.15;
```

### 2.6 Modules

Vehicles only. Infantry, aircraft and heroes are out of scope and never carry modules.

```ts
export type ModuleId = 'longbarrel' | 'smoke' | 'fueltank' | 'tracks' | 'orecage';
export const MODULE_ORDER: ModuleId[] = ['longbarrel', 'smoke', 'fueltank', 'tracks', 'orecage'];

export interface ModuleSpec {
  name: string;
  blurb: string;
  /** Added to the unit's price when it is queued with this module. */
  cost: number;
  /** The upgrade that unlocks it. */
  unlock: UpgradeId;
  /** Vehicle kinds it may be fitted to. */
  fits: UnitKind[];
}
```

| id | Name | Cost | Unlocked by | Effect | Fits |
|---|---|---|---|---|---|
| `longbarrel` | Long barrel | +150 | `calibration` | Weapon range +0.75 tiles (`minRange` unchanged) | buggy, tank, missilecarrier, bastion, flaktrack |
| `smoke` | Smoke launchers | +100 | `plating` | Takes x0.75 damage from every source while its order type is `'move'` | all eight vehicles |
| `fueltank` | Extra fuel tank | +75 | `engines` | Speed x1.1 | all eight vehicles |
| `tracks` | Reinforced tracks | +100 | `plating2` | Full health x1.1 | all eight vehicles |
| `orecage` | Ore cage | +150 | `refining` | Carries x1.25 ore (750 instead of `HAULER_CAPACITY` 600) | hauler |

"All eight vehicles" is `VEHICLE_MENU`: hauler, buggy, tank, artillery, missilecarrier, flametank,
bastion, flaktrack. The Ace (a hero vehicle) never carries modules.

Blurbs, exact text:

```
longbarrel: 'Reaches three quarters of a tile further.'
smoke:      'Takes a quarter less damage while on a move order.'
fueltank:   'Moves 10% faster.'
tracks:     'A tenth more health.'
orecage:    'Carries a quarter more ore each trip.'
```

```ts
export const LONG_BARREL_RANGE = 0.75;
export const SMOKE_TAKEN = 0.75;
export const FUEL_TANK_SPEED = 1.1;
export const TRACKS_HP = 1.1;
export const ORE_CAGE_CARGO = 1.25;

/** Module slots per vehicle kind. A kind not listed takes no modules. */
export const MODULE_SLOTS: Partial<Record<UnitKind, 1 | 2>> = {
  hauler: 1, buggy: 1, tank: 2, artillery: 1, missilecarrier: 1, flametank: 2, bastion: 2, flaktrack: 1,
};

/**
 * Each kind's weapon with a long barrel fitted: built once here, so the tick never allocates and a
 * unit's weapon object is stable from tick to tick. Only kinds that `longbarrel` fits.
 */
export const LONG_BARREL_WEAPON: Partial<Record<UnitKind, Weapon>>;
```

---

## 3. State (`src/sim/types.ts`)

All new fields are optional, so every existing save type-checks and loads.

```ts
// Unit
  /** Vehicles only, lines battles only: the modules it was built with. Absent: none. Never changes. */
  modules?: ModuleId[];

// QueueItem
  /** Vehicle queue, lines battles only: the loadout copied when it was queued. Absent: none. */
  modules?: ModuleId[];
  /** Credits paid for those modules on top of the unit's price; refunded with it. Absent: 0. */
  extra?: number;

// PlayerState
  /** Lines battles: the branch each line is committed to. Absent: none chosen. Permanent. */
  doctrines?: Partial<Record<LineId, UpgradeId>>;
  /** Lines battles: the loadout per vehicle kind. Absent or missing kind: no modules. */
  loadouts?: Partial<Record<UnitKind, ModuleId[]>>;

// GameAction: two new members
  | { type: 'doctrine'; line: LineId; branch: UpgradeId }
  | { type: 'loadout'; kind: UnitKind; modules: ModuleId[] }

// MissionSpec: one new required field
  /** Research mode for this mission. Always 'classic': missions never use development lines. */
  research: 'classic';
```

The existing `{ type: 'research'; upgrade: UpgradeId }` action is reused for every mark and branch.
`PlayerState.upgrades` and `PlayerState.research` keep their meaning and shape.

---

## 4. Simulation

### 4.1 Mode (`src/sim/state.ts`)

```ts
/** The research mode in force. A mission, a battle on standard tech and a save without the field: 'classic'. */
export const researchModeOf = (s: GameState): ResearchMode =>
  !s.mission && s.setup && s.setup.tech === 'advanced' && s.setup.research === 'lines' ? 'lines' : 'classic';
```

`normaliseSetup` adds, last:

```ts
const research: ResearchMode = tech === 'standard' ? 'classic' : r.research === 'classic' || r.research === 'lines' ? r.research : base.research;
return { map, tech, credits, ore, sides, mode, research };
```

So a save with a setup but no `research` field (normalised against `LEGACY_SETUP` in `migrate`)
reads `'classic'`; a new battle with a partial setup reads `DEFAULT_SETUP`'s `'lines'`; standard
tech is always `'classic'`.

### 4.2 Research rules (`src/sim/research.ts`)

`researchProblem(s, owner, id)` keeps every existing check and message, in this order, adding:

1. `'No such upgrade'` if not an `UpgradeId` (existing).
2. `'Not in this battle'` if the Lab is not allowed (existing) **or** mode is `'classic'` and
   `!isClassicUpgrade(id)`.
3. `'Already researched'` (existing).
4. New, lines mode only, mark 2: `'Needs Mk I'` unless `marks[0]` is in `p.upgrades`.
5. New, lines mode only, mark 3: `'Needs Mk II'` unless `marks[1]` is in `p.upgrades`; then
   `'Choose a doctrine first'` if `p.doctrines?.[line]` is absent; then `'Doctrine closed'` if
   `p.doctrines[line] !== id`.
6. `'Researching'` / `'Already researching'` (existing: still one at a time across all lines).
7. Building requirements, `'Needs a Research Lab'` / `'Needs: <kind>'` (existing).
8. `'Not enough credits'` (existing).

`doResearch`, `doCancelResearch` and `researchStep` are unchanged in behaviour (paid in full,
refunded in full, half speed on low power, paused with no Lab). `researchStep`'s completion applies
`hpMulFor`, which gains `plating2` (vehicles, `PLATING2_HP`). `upgradeNewUnit` is unchanged (it
loops over `p.upgrades` and so picks `plating2` up).

New:

```ts
/** Why this side cannot commit this line to this branch, or null. */
export function doctrineProblem(s, owner, line: LineId, branch: UpgradeId): string | null
//  'Not in this battle'   mode is not 'lines', or line not a LineId, or the Lab not allowed
//  'No such doctrine'     branch is not LINES[line].fork[0] or fork[1]
//  'Already chosen'       p.doctrines?.[line] is set (either branch)
//  'Needs Mk II'          LINES[line].marks[1] not in p.upgrades
export function doDoctrine(s, owner, line, branch): void
//  p.doctrines = { ...(p.doctrines ?? {}), [line]: branch }; free; side 0 logs
//  `${LINES[line].name} doctrine: ${UPGRADES[branch].name}.`
export const doctrineOf = (s, owner, line): UpgradeId | null
```

No Research Lab is needed to choose a doctrine (it is a decision, not work), only Mk II done.

Effect queries (all pure, all return 1 or the stated value, all `'classic'`-safe because the new
ids can never be in a classic side's `upgrades`):

```ts
damageMulOf(s, owner)                 // unchanged: calibration
vehicleSpeedOf(s, owner)              // engines2 ? ENGINES2_SPEED : engines ? ENGINES_SPEED : 1
incomeMulOf(s, owner)                 // refining2 ? REFINING2_INCOME : refining ? REFINING_INCOME : 1
rearmMulOf(s, owner)                  // unchanged: airframes
infantrySpeedOf(s, owner)             // motorised ? MOTORISED_SPEED : 1
buildRateOf(s, owner, cat)            // assembly && cat !== 'building' ? ASSEMBLY_RATE : 1
reloadMulOf(s, u)                     // autoloaders && vehicle ? AUTOLOADER_RELOAD : 1
kindDamageMulOf(s, owner, kind)       // heat && HEAT_KINDS.includes(kind) ? HEAT_DAMAGE : 1
splashMulOf(s, owner)                 // highexplosive ? HE_SPLASH : 1
airSpeedOf(s, owner)                  // avionics ? AVIONICS_SPEED : 1
airDamageMulOf(s, owner)              // munitions ? MUNITIONS_DAMAGE : 1
fieldRepairOf(s, owner)               // boolean: fieldrepair
salvageOf(s, owner)                   // boolean: salvage
/** Damage taken by this unit from this weapon kind: armour forks, cockpits, smoke. Product of all that apply. */
damageTakenMul(s, u, kind): number
//  vehicle && reactive  && REACTIVE_KINDS  -> x REACTIVE_TAKEN
//  vehicle && composite && COMPOSITE_KINDS -> x COMPOSITE_TAKEN
//  air     && hardened  && HARDENED_KINDS  -> x HARDENED_TAKEN
//  u.modules has 'smoke' && u.order.type === 'move' -> x SMOKE_TAKEN
```

`migrateResearch(p, mode)` gains a mode argument. In `'classic'` it also drops every
non-classic id from `upgrades`, clears `research` whose id is non-classic, and deletes `doctrines`
and `loadouts`. In `'lines'` it keeps valid ids, validates `doctrines` (each key a `LineId`, each
value one of that line's fork, otherwise dropped), drops from `upgrades` any branch that is not
its line's doctrine, and clears `research` on a branch that is not its line's doctrine. `migrateAir`
passes `researchModeOf(out)`; because `migrate` sets `out.setup` after `migrateAir` today, move
the setup normalisation **above** the `migrateAir(out)` call (no other behaviour changes).

### 4.3 Loadouts (new file `src/sim/loadout.ts`)

```ts
/** Why this side cannot set this loadout for this kind now, or null. */
export function loadoutProblem(s, owner, kind: UnitKind, modules: ModuleId[]): string | null
//  'Not in this battle'   mode is not 'lines', or !techAllowed(s, owner, kind)
//  'No modules'           MODULE_SLOTS[kind] absent
//  'Bad loadout'          not an array, an unknown id, a duplicate, or longer than the slots
//  'Does not fit'         a module whose `fits` lacks kind
//  'Not researched'       a module whose `unlock` is not in p.upgrades
//  'No change'            same modules, same order, as the current loadout (absent counts as [])
export function doLoadout(s, owner, kind, modules): void
//  p.loadouts = { ...(p.loadouts ?? {}), [kind]: [...modules] }  ([] is stored as [] , not deleted)
export const loadoutOf = (s, owner, kind): ModuleId[]          // [] when absent or mode is classic
export const loadoutCost = (mods: ModuleId[]): number          // sum of MODULES[m].cost
/** The full price of queuing one of this kind now: costFor plus the current loadout's modules. */
export function queueCostFor(s, owner, kind): number
/** Called right after upgradeNewUnit on a unit leaving the vehicle queue. */
export function fitModules(u: Unit, mods: ModuleId[] | undefined): void
//  no-op for empty/absent; sets u.modules = [...mods]; tracks: u.maxHp = round(maxHpOf(u) * TRACKS_HP), u.hp = u.maxHp
export const weaponOf = (u: Unit): Weapon | undefined
//  u.modules?.includes('longbarrel') ? LONG_BARREL_WEAPON[u.kind] ?? UNITS[u.kind].weapon : UNITS[u.kind].weapon
export const moduleSpeedOf = (u: Unit): number                 // fueltank ? FUEL_TANK_SPEED : 1
export const cargoMaxOf = (u: Unit): number                    // orecage ? round(HAULER_CAPACITY * ORE_CAGE_CARGO) : HAULER_CAPACITY
/** Repairs loadouts, queue items' modules and units' modules from a save. */
export function migrateLoadouts(s: GameState): void
```

**Existing units keep what they were built with.** Changing a loadout affects only units queued
after the change. A queued item keeps the modules (and the price) it was queued with.

`migrateLoadouts` (called from `migrateAir` after the players are repaired): in a `'classic'`
battle delete every `Unit.modules`, `QueueItem.modules` and `QueueItem.extra`. In `'lines'`:
units: keep only known, deduplicated ids that fit the kind, capped at the kind's slots, delete if
empty; queue items: same filter, and `extra` set to `loadoutCost(modules)` when not a finite number
>= 0; loadouts: same filter per kind, unknown kinds dropped. It never re-applies `tracks` health
(the unit's `maxHp` is already saved).

### 4.4 Commands (`src/sim/commands.ts`)

- `canQueue`: for category `'vehicle'`, the credit check becomes `p.credits >= queueCostFor(s, owner, kind)`.
  Other categories unchanged.
- `doQueue`: for `'vehicle'` with a non-empty `loadoutOf`, push
  `{ kind, progress: 0, modules: [...mods], extra: loadoutCost(mods) }` and charge
  `costFor + extra`. With an empty loadout the item is exactly `{ kind, progress: 0 }` as today.
- `doCancel`: refund `costFor(s, owner, kind) + (q[i].extra ?? 0)`.

### 4.5 Actions (`src/sim/actions.ts`)

```ts
case 'doctrine': {
  if (typeof a.line !== 'string' || typeof a.branch !== 'string' || doctrineProblem(s, 0, a.line, a.branch) !== null) return s;
  const c = cloneState(s); doDoctrine(c, 0, a.line, a.branch); return c;
}
case 'loadout': {
  if (typeof a.kind !== 'string' || !Array.isArray(a.modules) || loadoutProblem(s, 0, a.kind, a.modules) !== null) return s;
  const c = cloneState(s); doLoadout(c, 0, a.kind, a.modules); return c;
}
```

`'research'` is unchanged in code: `canResearch` now carries the mark and doctrine rules.
`cloneState` must deep-copy `doctrines`, `loadouts`, `Unit.modules` and `QueueItem.modules` (check
how it copies players and units today; if it uses structured cloning or JSON, nothing to do).

### 4.6 Where each effect is read (`src/sim/tick.ts`, `src/sim/air.ts`)

| Effect | Read at | Change |
|---|---|---|
| Vehicle speed (engines, engines2) | `step` builds `ctx.vehicleSpeed` from `vehicleSpeedOf` | none (the query changed) |
| Infantry speed (motorised) | `step`: add `ctx.infantrySpeed = sidesOf(s).map(o => infantrySpeedOf(s, o))`; `stepAlong` multiplies for category `'infantry'` | new |
| Fuel tank | `stepAlong`: `sp *= moduleSpeedOf(u)` for vehicles | new |
| Long barrel range | `updateUnit`: `const w = spec.weapon` becomes `const w = weaponOf(u)` (one line; every range read below it follows) | new |
| Autoloaders | `updateUnit`, where `u.cooldown` is set after `fire`: multiply by `reloadMulOf(s, u)`, round, at least 1 | new |
| Field workshops | `updateUnit`, the elite repair: condition `u.vet >= 2` becomes `(u.vet >= 2 \|\| (spec.category === 'vehicle' && fieldRepairOf(s, u.owner)))`; same share and interval; never twice | new |
| HEAT | `fire`: `damageMul *= kindDamageMulOf(s, owner, w.kind)` beside calibration | new |
| High-explosive | `fire`: `splash: (w.splash ?? 0) * splashMulOf(s, owner)`; `air.ts dropBomb`: same on the bomb's splash | new |
| Armour forks, cockpits, smoke | `hurt`: for a unit target, `raw *= damageTakenMul(s, t.unit, p.weapon)` before `DAMAGE_VS` | new |
| Salvage | `credit`: when `t.unit` is a vehicle or aircraft and `salvageOf(s, by)`, `s.players[by].credits += Math.floor(SALVAGE_SHARE * UNITS[t.unit.kind].cost)` (heroes cost 0, so pay 0). Applies whether or not there is a `killer` unit, so place it before `if (!killer) return` | new |
| Assembly | `production`: for categories other than `'building'`, `rate * buildRateOf(s, owner, cat)` | new |
| Refining, refining2 | harvest unload, `incomeMulOf` | none (the query changed) |
| Ore cage | harvest: the three `HAULER_CAPACITY` reads become `cargoMaxOf(u)` | new |
| Plating2, tracks | `researchStep` / `upgradeNewUnit` (plating2); `spawnFromQueue` calls `fitModules(u, head.modules)` right after `upgradeNewUnit(s, u)` (tracks) | new |
| Avionics | `air.ts fly`: `sp = UNITS[u.kind].speed * airSpeedOf(s, u.owner)`; `dropBomb`: `ahead` uses the same speed | new |
| Heavy munitions | `air.ts dropBomb` mul, and the Gunship's rocket shot (the `mul` it passes to `hooks.fire`): `* airDamageMulOf(s, u.owner)` | new |

Nothing else reads the new ids. Structures never carry modules. `spawnFromQueue` for the air
queue does not call `fitModules`.

---

## 5. The computer (`src/sim/aiAir.ts`, `src/sim/ai.ts`)

No designing: a fixed path and fixed loadouts per difficulty. In `'classic'` mode behaviour is
byte-identical to today (the `classic` lists are today's `research` lists).

`AirTactics.research` is split:

```ts
research: { classic: UpgradeId[]; lines: UpgradeId[] };
loadouts: Partial<Record<UnitKind, ModuleId[]>>;   // lines mode only
```

| Difficulty | `lines` research order |
|---|---|
| easy | `['refining']` |
| normal | `['refining', 'plating', 'calibration', 'airframes', 'engines', 'refining2', 'plating2', 'reactive']` |
| hard | `['refining', 'calibration', 'plating', 'engines', 'airframes', 'refining2', 'plating2', 'autoloaders', 'heat', 'composite', 'engines2']` |

| Difficulty | loadouts |
|---|---|
| easy | none |
| normal | `tank: ['longbarrel']`, `hauler: ['orecage']` |
| hard | `tank: ['longbarrel', 'tracks']`, `bastion: ['longbarrel', 'tracks']`, `flametank: ['tracks', 'smoke']`, `buggy: ['fueltank']`, `hauler: ['orecage']` |

Rules:

- Research stays inside step 4 of `airPlan`, under the same `!saving && !p.research && Lab`
  condition, the same `fund` call, the same `AIR_ORE_FLOOR`, `crisis` and `armyReady` gates. The
  next item is the first in the list not researched whose building requirements stand. When that
  item is a Mk III branch and the line has no doctrine, call `doDoctrine` for it first (it is free);
  if the line already holds the other branch (impossible for the computer, but defend), skip it.
- Loadouts: at the start of `airPlan`, right after the mission/tech early return, and before the
  `crisis`/`armyReady` return. Wanted loadout per kind: the table's modules filtered to those
  already unlocked, in table order (so a Hard tank goes `[]`, then `['longbarrel']` once calibration
  is done, then `['longbarrel', 'tracks']`). If `crisis` or the map's ore is below
  `AIR_ORE_FLOOR`, the wanted loadout is `[]` for every kind (last credits buy hulls, not modules).
  Set it with `doLoadout` only when `loadoutProblem` returns null (so no write when unchanged).
- Anywhere the commander checks credits before queuing a vehicle (`ai.ts`, around the two
  `doQueue(s, owner, 'vehicle', kind)` calls, and `aiAir.ts` Flak Tracks), compare against
  `queueCostFor` rather than `UNITS[kind].cost`.
- `fund()` in `aiAir.ts` refunds `costFor(s, owner, kind) + (q[i].extra ?? 0)`.

---

## 6. Interface

### 6.1 Research tree (`src/game/Sidebar.tsx`)

`ResearchBlock` keeps today's flat list exactly when `researchModeOf(state) === 'classic'`. In
`'lines'` it renders a tree (same `<section className="fl-research" data-testid="research">`):

- One row per line, in `LINE_ORDER`: `data-testid="line-<lineId>"`. Row label is the line name.
- Nodes left to right: Mk I, Mk II, then the two Mk III branches stacked as a pair (side by side
  if the sidebar is wide enough, otherwise one above the other). A thin connector between nodes
  (`--ui-line-connector`).
- Each node: `data-testid="research-<id>"`, `data-state` one of `done | running | ready | blocked | closed | choose`.
  Shows the short name and "Mk I", "Mk II", "Mk III". Hover or focus shows the blurb, cost, time
  and the problem text (`problemText`, extended for the new messages) in the row's caption line.
- `ready`: the cost as a button dispatching `{ type: 'research', upgrade: id }` (disabled exactly
  as today: only when the problem is something other than `'Not enough credits'`).
- `running`: progress bar and Cancel, as today.
- Fork before a doctrine is chosen and Mk II is done: both branches show `data-state="choose"` with
  an **Adopt** button (`data-testid="doctrine-<line>-<branch>"`) dispatching
  `{ type: 'doctrine', line, branch }`. Its title: "Adopt this doctrine. The other one closes for
  the rest of the battle." Before Mk II is done both are `blocked`.
- After a doctrine: the chosen branch behaves as an ordinary node; the other is `closed`: greyed
  (`--ui-line-closed`, `--ui-line-closed-bg`), struck through name, no button, caption "Closed:
  you adopted <name>."
- The chosen branch gets the doctrine accent border (`--ui-doctrine`).
- The low-power note in the heading is unchanged.

The Research Lab's stat tip row (line ~178) reads, in lines mode: "Development lines listed at the
foot of the Structures tab once it stands".

### 6.2 Loadout panel (`src/game/Sidebar.tsx`)

On the Vehicles tab, below the build buttons, only in `'lines'` mode and only once at least one
module is unlocked: `<section className="fl-loadout" data-testid="loadout" aria-label="Loadouts">`.

- Heading "Loadouts" and the line "New vehicles are built with these. Units already built keep theirs."
- One row per kind in `menuFor('vehicle', state)` that has `MODULE_SLOTS`: `data-testid="loadout-<kind>"`.
  The kind's name, then one chip per module that fits it, in `MODULE_ORDER`:
  `data-testid="module-<kind>-<module>"`, `aria-pressed` when fitted, disabled when not researched
  (title names the upgrade that unlocks it) or when the slots are full and it is not fitted.
  Clicking toggles it and dispatches `{ type: 'loadout', kind, modules }` with the new list in
  `MODULE_ORDER`. After the chips: "+N" credits when the loadout costs anything.
- Build buttons on the Vehicles tab show `queueCostFor(state, 0, kind)` as their price, and the
  build tip (`BuildTipFooter`) says "Includes N for modules" when N > 0.
- The selection panel, for a single selected vehicle with modules, lists their names (one line).

### 6.3 Skirmish setup (`src/components/SkirmishSetup.tsx`, and the lobby that holds it)

- `readStoredSetup` reads `research` (`'classic' | 'lines'`, otherwise `DEFAULT_SETUP.research`).
- A new choice group "Research", after Tech: two options, `data-testid="setup-research-classic"`
  and `data-testid="setup-research-lines"`.

```ts
export const RESEARCH_TEXT: Record<ResearchMode, { name: string; text: string }> = {
  classic: { name: 'Classic', text: 'Five upgrades from the Research Lab, one at a time.' },
  lines:   { name: 'Development lines', text: 'Five lines of three marks each, a doctrine to choose at the top of every line, and modules for your vehicles. The enemy researches them too.' },
};
```

- On standard tech the group is disabled and reads "Advanced tech only."; the stored value is
  kept so switching back to advanced restores it. The battle is created through `normaliseSetup`,
  which records `'classic'` for standard tech.

### 6.4 How to play (`src/pages/HowToPlay.tsx`)

After the paragraph that mentions the five upgrades (line ~211), add:

> With development lines (the default for a new advanced skirmish), research is five lines:
> Logistics, Armour, Engines, Weapons and Air. Each has three marks, researched in order. At the
> top of each line you adopt one of two doctrines and the other closes for the rest of the battle.
> Research also unlocks modules: on the Vehicles tab, set a loadout for each vehicle type, and every
> one built afterwards carries it, for a little more money.

### 6.5 Colour tokens (`src/styles.css`)

A new block after the round 4 block, headed `/* ---- Round 5: development lines and loadouts ---- */`,
with a light `:root` block and a `:root[data-theme="dark"]` block:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--ui-line-node-bg` | `#eef3f2` | `#1d2928` | a node |
| `--ui-line-node-rule` | `#a9c9cc` | `#2c4a4f` | a node's border |
| `--ui-line-connector` | `#9aa59e` | `#3b4d4a` | the line between nodes |
| `--ui-line-closed` | `#9aa3a0` | `#5c6a67` | a closed branch's text |
| `--ui-line-closed-bg` | `rgba(20, 28, 24, 0.05)` | `rgba(255, 255, 255, 0.03)` | a closed branch's fill |
| `--ui-doctrine` | `#a86a0c` | `#e0a645` | the adopted branch's border and the Adopt button |
| `--ui-doctrine-tint` | `rgba(168, 106, 12, 0.1)` | `rgba(224, 166, 69, 0.12)` | the adopted branch's fill |
| `--ui-loadout-bg` | `rgba(31, 124, 135, 0.05)` | `rgba(79, 179, 191, 0.05)` | the Loadouts panel |
| `--ui-loadout-chip` | `#e3ece9` | `#22302f` | a chip |
| `--ui-loadout-chip-on` | `#1f7c87` | `#4fb3bf` | a fitted chip's border and fill |
| `--ui-loadout-chip-on-text` | `#ffffff` | `#0f1716` | a fitted chip's text |

Check both modes in the browser. No `theme.ts` change (the canvas draws nothing new).

---

## 7. Campaign (`src/campaign/missions.ts`, `src/campaign/act2.ts`)

Every `MissionSpec` gains `research: 'classic'`, placed after `tech:` in each entry. The type makes
it required, so `tsc` fails on any mission that omits it. Missions keep their research exactly as
today (`researchModeOf` returns `'classic'` whenever `s.mission` is set, whatever the spec says).
`createMissionState` does not need to read it.

---

## 8. File-by-file change list

| File | Change |
|---|---|
| `src/sim/rules.ts` | Section 2: `ResearchMode`, `RESEARCH_MODES`, `SkirmishSetup.research`, both presets, widened `UpgradeId`, new `UPGRADES` entries, `isClassicUpgrade`, `LineId`, `LINE_ORDER`, `LINES`, `UPGRADE_LINE`, effect constants, `ModuleId`, `MODULE_ORDER`, `ModuleSpec`, `MODULES`, module constants, `MODULE_SLOTS`, `LONG_BARREL_WEAPON` |
| `src/sim/types.ts` | Section 3 fields; two `GameAction` members; `MissionSpec.research` |
| `src/sim/state.ts` | `researchModeOf`; `normaliseSetup` research field; in `migrate`, normalise the setup before `migrateAir` |
| `src/sim/research.ts` | Section 4.2: rules, doctrine functions, effect queries, `damageTakenMul`, `hpMulFor` plating2, `migrateResearch(p, mode)` |
| `src/sim/loadout.ts` (new) | Section 4.3 |
| `src/sim/commands.ts` | Section 4.4 |
| `src/sim/actions.ts` | Section 4.5 |
| `src/sim/tick.ts` | Section 4.6 rows marked "new" in `step`, `stepAlong`, `updateUnit`, `fire`, `hurt`, `credit`, `production`, harvest, `spawnFromQueue` |
| `src/sim/air.ts` | `fly`, `dropBomb`, the Gunship's shot multiplier; `migrateAir` passes the mode and calls `migrateLoadouts` |
| `src/sim/aiAir.ts` | Section 5: split research lists, loadouts, doctrine call, `fund` refund |
| `src/sim/ai.ts` | Section 5: vehicle credit checks use `queueCostFor` |
| `src/campaign/missions.ts`, `src/campaign/act2.ts` | `research: 'classic'` on every mission |
| `src/game/Sidebar.tsx` | Section 6.1 and 6.2 |
| `src/styles.css` | Section 6.5 tokens and the `.fl-line-*`, `.fl-loadout*` rules |
| `src/components/SkirmishSetup.tsx` | Section 6.3 |
| `src/pages/HowToPlay.tsx` | Section 6.4 |
| `scripts/drive-lines.ts` (new, in `packages/fireline/scripts/`) | Section 9; exports `sections` like `drive-air.ts` |
| `scripts/drive.ts` (fireline) | Import `sections as linesSections` from `./drive-lines` beside the air import and spread it after `airSections` |
| `scripts/drive-air.ts` (fireline) | Its `research` and `computer` sections pin `research: 'classic'` in `airArena`'s default setup, so they keep testing classic exactly |
| `scripts/campaign-check.ts` (fireline) | Assert every mission's `research === 'classic'` |
| `fireline-design.md` (root) | Build log entry "2026-11-10: Development lines and loadouts (round 5)" with the measured ladder numbers |

---

## 9. Harness (`packages/fireline/scripts/drive-lines.ts`)

Sections and the assertions each must make (every one with `ok(cond, label)`):

**Lines: rules and presets**
- `LEGACY_SETUP.research === 'classic'`, `DEFAULT_SETUP.research === 'lines'`; every key of
  `SkirmishSetup` is present in both presets (toggle-leak guard).
- `normaliseSetup({})` equals `DEFAULT_SETUP`; `normaliseSetup({ research: 'junk' })` takes the
  base's value; `normaliseSetup({ tech: 'standard', research: 'lines' }).research === 'classic'`;
  normalising against `LEGACY_SETUP` a setup with no `research` gives `'classic'`.
- Every mission in `MISSIONS` and act 2 has `research === 'classic'`.
- Every `UpgradeId` appears in exactly one line exactly once; `UPGRADE_LINE` agrees with `LINES`;
  every upgrade costs > 0, takes > 0 ticks, requires `'researchlab'`; air-line upgrades require
  `'helipad'`; the five classic specs are byte-identical to the round 4 values (cost, ticks, requires).
- Every module's `unlock` is a real upgrade, every `fits` kind is in `VEHICLE_MENU` and has slots;
  `LONG_BARREL_WEAPON[k].range === UNITS[k].weapon.range + 0.75` for every fitting kind, other
  fields equal.

**Lines: classic stays classic**
- In a classic advanced battle: researching each non-classic id is refused (same object);
  `doctrine` and `loadout` actions are refused (same object); the Mk I ids behave exactly as in
  `drive-air.ts`.
- In a mission state and a standard-tech skirmish: all three actions refused.

**Lines: marks and doctrines**
- Mk II refused before Mk I is done (same object), accepted after; Mk III refused before Mk II,
  refused with no doctrine, refused for the closed branch, accepted for the adopted one.
- `doctrine` refused before Mk II, refused for a branch of another line, refused a second time
  (either branch); accepted once; the other branch's `researchProblem` is `'Doctrine closed'` for
  the rest of the battle (tick 2000 more and check again).
- `doctrine` costs nothing and needs no Lab (Lab removed, Mk II done: accepted).
- Paid in full, refunded in full, one at a time across lines, half speed on low power, paused
  without a Lab: one representative per mark.
- Research and doctrine under way survive `migrate(JSON round trip)`.

**Lines: effects** (each measured in an arena against the same arena without the upgrade)
- plating2: a vehicle's full health is `round(round(hp * 1.2) * 1.125)`; existing damage kept.
- engines2: a vehicle's step is 1.25 times the base step; motorised: an infantry step 1.15 times.
- refining2: one unload pays 1.25 times.
- reactive: a tank takes 0.8 times from a rocket and the same from a shell; composite: the reverse;
  neither changes damage to infantry or structures.
- fieldrepair: a rookie vehicle out of combat regains `max(1, round(max * 0.01))` every 20 ticks;
  an elite vehicle is not repaired twice.
- autoloaders: a tank's cooldown after firing is `round(25 * 0.9)`.
- heat: a shell's projectile damage is `50 * 1.15 * 1.1` with calibration; a bullet's unchanged.
- highexplosive: an artillery shell's splash is `1.2 * 1.25`; a bomb's `1.3 * 1.25`.
- salvage: killing an enemy tank pays exactly 80 credits; killing an infantryman pays 0.
- assembly: a vehicle queue progresses 1.15 per tick at full power, 0.575 on low; the building
  queue unchanged.
- avionics: an aircraft's step is 1.15 times; hardened: flak damage to it is 0.75 times;
  munitions: a bomb's damage is 1.15 times.

**Lines: loadouts**
- `loadout` refused: unknown kind, a kind without slots (rifleman, gunship, ace), unknown module,
  duplicate, too many for the slots, a module that does not fit (orecage on a tank, longbarrel on
  artillery), an unresearched module, an unchanged loadout. Each returns the same object.
- Accepted loadout: queuing a tank charges `800 + 150 + 100`; the queue item records the modules
  and `extra: 250`; cancelling refunds exactly `1050`; changing the loadout after queuing does not
  change the queued item or its refund.
- A built tank carries the modules; `tracks` gives full health `round(maxHp * 1.1)` after plating;
  `longbarrel` fires at range 5.5 (4.75 + 0.75) and not at 5.6; `fueltank` steps 1.1 times; smoke
  takes 0.75 times damage on a `move` order and full damage when idle.
- An orecage hauler fills to 750 before returning.
- Units built before a loadout change keep their modules (none); research finishing later still
  raises their health (plating2) as it does every vehicle.
- Junk in a save (`modules: ['nonsense', 'tracks', 'tracks', 'smoke', 'fueltank']` on a tank,
  modules on a rifleman, `extra: -5`) is repaired by `migrate` as section 4.3 states; a classic save
  with modules has them removed.

**Lines: the computer**
- In a lines battle at each difficulty, autopilot both sides for 18,000 ticks on 6 seeds: the
  computer's researched ids are a prefix (in order, allowing skips only for unmet building
  requirements) of its difficulty's `lines` list; every branch it holds matches its doctrine; its
  loadouts only ever contain unlocked modules from its table.
- Starvation guard: in each of those battles the computer's armed ground unit count at tick 12,000
  is at least 80% of the same seed and difficulty in a `'classic'` battle (ladder-style A/B, same
  seed).
- Classic battles: the computer's actions and the final state are byte-identical to the same seed
  before this round (compare against a stored hash taken before the change, or run the classic
  path twice through the old and new list and compare the research sequence).

**Lines: replay and old saves**
- A lines battle with research, doctrines and loadouts on both sides replays byte-identically
  (two runs, same seed and actions, `JSON.stringify` equal).
- A save from before this round (strip `research` from setup, `doctrines`, `loadouts`, all
  `modules`, `extra`) loads, reads `'classic'`, and plays the next 3000 ticks byte-identically to
  the same state never saved.

**Ladder.** Run `npm run ladder:fire` at the default 150 seeds before the change (baseline) and
after, with a non-legacy map: `npm run ladder:fire -- --map random` (or `--map mix`). The ladder's
default map is `legacy`, which creates battles with no setup, so they are always classic and never
play development lines; `--research` (default `lines`) only applies once `--map` is not legacy. Required: Hard beats Normal beats Easy (monotonic); each pairing's win rate within 5 points
of baseline; median battle length up no more than 15%. Record both tables in the build log. If a
number fails, tune section 2.4 or section 5 numbers, never the classic five.

Also run: `npm run check`, `npm run drive:fire`, `npm run campaign:fire`, `npm run tours -- fireline`
(the tour uses a new advanced skirmish, now in lines mode), and load the page in both colour modes.

---

## 10. What stays unchanged

- The five classic upgrades: ids, names, blurbs, costs, times, requirements, effects, and the
  order `UPGRADE_ORDER` lists them.
- Classic battles, every campaign mission, every standard-tech skirmish and every existing save:
  same rules, same computer behaviour, same state shape (no new fields written).
- One research at a time per side; paid in full on start, refunded in full on cancel; half speed
  on low power; paused without a Lab.
- The computer's spending gates: `AIR_ORE_FLOOR`, `crisis`, `armyReady`, `fund` taking back only
  unstarted non-essential queue items, `lastStand`.
- Infantry, aircraft, heroes and structures never carry modules. Structures' weapons are touched
  only by calibration, HEAT and high-explosive, as weapons of the side.
- The sim stays pure and deterministic; no new random draws.
- No server, API or save-format version change: the new fields ride inside the existing
  `GameState` JSON.
- Perks (`costMul`) still apply to the unit's base price only; module costs are flat.

---

## 11. Acceptance

The round is done when all of these hold:

1. `npm run check` passes (typecheck, every harness including `drive-lines.ts`, campaign check).
2. A new advanced skirmish from the lobby defaults to Development lines; Classic is one click away;
   standard tech disables the choice.
3. In a lines battle, a player can research Logistics Mk I to Mk II, adopt a doctrine, see the
   other branch greyed and closed, research the adopted Mk III, and every step is refused by the
   sim when out of order (same state object).
4. A player can set a tank loadout of Long barrel and Reinforced tracks once both are researched,
   see the higher price on the build button, build one, and see it out-range an unmodified tank;
   tanks built earlier are unchanged.
5. The computer researches lines and fits modules at Normal and Hard without its army at tick
   12,000 falling below 80% of the classic battle's.
6. `npm run ladder:fire` at 150 seeds meets section 9's thresholds; numbers in the build log.
7. An old skirmish save and an in-progress campaign save load and play as before.
8. The Research tree and the Loadouts panel look right in light and dark mode, at the narrowest
   sidebar width, with no horizontal scroll; `npm run tours -- fireline` passes.

---

## 12. Build log

### 2026-11-10: the simulation (sections 2 to 5 and 7)

Built: `src/sim/rules.ts` (section 2 in full), `src/sim/types.ts` (section 3), `src/sim/state.ts`
(`researchModeOf`, `normaliseSetup` research field, setup normalised before `migrateAir`,
`cloneState` copies `doctrines` and `loadouts`), `src/sim/research.ts` (mark and doctrine rules,
`doctrineProblem`, `doDoctrine`, `doctrineOf`, every effect query, `damageTakenMul`, `hpMulFor`
plating2, `migrateResearch(p, mode)`), new `src/sim/loadout.ts` (section 4.3),
`src/sim/commands.ts` (4.4), `src/sim/actions.ts` (4.5), `src/sim/tick.ts` and `src/sim/air.ts`
(every row of 4.6), `src/sim/aiAir.ts` and `src/sim/ai.ts` (section 5), and `research: 'classic'`
on all fourteen missions (section 7). `readStoredSetup` in `src/components/SkirmishSetup.tsx` got
its one `research` line (6.3, first bullet) so the client typechecks; the rest of section 6 is
untouched.

Verified: classic battles are byte-identical to the build before this round. A scratch script
hashed the whole state every 600 ticks (with a `migrateState` round trip every 6000) over 24
autopiloted battles: no setup, advanced classic two- and three-sided, standard tech, each
difficulty, two seeds; every hash matched the pre-change tree. `npm run drive:fire`: every
summary line is unchanged; one assertion fails, `drive-air.ts` "every upgrade listed once"
(`new Set(UPGRADE_ORDER).size === Object.keys(UPGRADES).length`), which the widened `UPGRADES`
of section 2.4 breaks by design; the harness agent owns that file (section 8 has it pin classic).
`npm run campaign:fire`: 2595 assertions, 0 failures.

Deviations and notes:

- `migrateResearch` returns a third field, `doctrines` (`null` means delete), which `migrateAir`
  applies; in `'classic'` `migrateAir` also deletes `loadouts`, and `migrateLoadouts` runs right
  after the players are repaired. In `'lines'` a queue item whose modules all fail the filter loses
  both `modules` and `extra`.
- The computer's vehicle budget uses `vehiclePrice(s, owner, kind)` (exported from `aiAir.ts`):
  `UNITS[kind].cost + loadoutCost(loadoutOf(...))`, rather than `queueCostFor`. In a classic battle
  it is exactly the old `UNITS[kind].cost`, even for a side with a Procurement perk, which
  `queueCostFor` (built on `costFor`) would have changed. `canQueue` itself uses `queueCostFor`.
- Loadouts are set in `airPlan` right after the anti-air setup values (`crisis`, the ore sum) are
  known and before anything is queued; the ore sum moved up from below the anti-air step to do it
  (a read, so classic play is unchanged). They are skipped entirely in a classic battle.
- HEAT stacks with calibration by multiplying the shooter's multiplier, so a calibrated HEAT
  shell's projectile damage is `50 * (1.15 * 1.1)` in floating point, `63.24999999999999`;
  compare it with a tolerance, not `===`.
- Splash from High-explosive fill is applied in `fire` through a helper that leaves a weapon with
  no splash at 0; every new multiplier in the tick is applied only when it differs from 1, so a
  classic battle never multiplies by anything new.
- With today's commanders a lines battle seldom reaches Mk II before it is decided (most of the
  battles sampled ended between tick 8,000 and 17,000), so the computer's armed ground count at
  tick 12,000 matched its classic count exactly in all 18 battles sampled (3 difficulties, 6
  seeds). The ladder at 150 seeds has not been run yet.

### 2026-11-10: the interface (section 6)

Built: `src/game/Sidebar.tsx` (the Research tree in lines mode, `LineRow` and `LineNode`, with the
classic flat list unchanged; the Loadouts panel on the Vehicles tab; build buttons and the build
tip priced with `queueCostFor`, "Includes N for modules."; the selection panel's "Modules:" line;
the hauler's cargo line reads `cargoMaxOf`; the Research Lab's stat row in lines mode through a new
optional `research` argument to `statsOf` and prop on `StatTip`), `src/components/SkirmishSetup.tsx`
(the Research group and `RESEARCH_TEXT`), `src/pages/HowToPlay.tsx` (the paragraph of 6.4) and
`src/styles.css` (the 6.5 tokens in both blocks, the `.fl-line-*` and `.fl-loadout*` rules, and a
disabled style for `.fl-level`).

Notes: the caption line shows the pointed-at or focused node, otherwise the running one or the
next step; done and closed nodes take focus so the caption reads from the keyboard. Problem text
for the new refusals reads "Research Mk I first.", "Research Mk II first." and "Adopt a doctrine
first.". The fork pair sits side by side through a container query once the Research block is
420px wide, stacked otherwise. The renderer needed no `weaponOf` change: it draws no range rings,
and reads the weapon only for the firing animation's cooldown. (The renderer did need one change, made in the review fixes below:
the hauler's cargo bar and ore pile.)

Verified in Chromium (light and dark, 1400 and 1100 wide): the setup defaults to Development
lines, standard tech disables it with "Advanced tech only." and advanced restores it; in a battle
the tree shows five rows, Mk II and the fork start blocked, Logistics Mk I and Mk II research by
clicking, both branches then offer Adopt, adopting Assembly lines closes Salvage crews (struck
through, no button, "Closed: you adopted Assembly lines."), the adopted branch researches and
cancels; a tank loadout of Long barrel and Reinforced tracks raises the button from 800 to 1050,
fills both slots (Smoke launchers disabled), and the tank built carries both modules in the save.
No horizontal overflow, no page errors. `npm run tours -- --quick fireline` passes.

### 2026-11-10: review fixes

- **The ladder could not play lines by default.** `scripts/ai-ladder.ts` defaults to `--map
  legacy`, which creates battles with no setup, so they are always classic whatever `--research`
  says. The usage text now says `--research` needs a non-legacy `--map`, and section 9 gives the
  command (`npm run ladder:fire -- --map random`). The default was left alone: it is the ladder
  every earlier build log entry measured against.
- **The ore cage hauler's cargo bar overran its background.** `src/game/renderer.ts` divided cargo
  by a fixed 600 for both the selected hauler's bar and the ore pile pose; an ore cage hauler holds
  750, so the bar reached 1.25 times its background and the pile read full at 600. Both now use
  `cargoMaxOf(u)` from `src/sim/loadout.ts` (the bar also clamped at 1).
- **The `drive:fire` time in `CLAUDE.md` was out of date.** The two new heavy sections ("Lines: the
  computer" and "Lines: replay and old saves") add about 110 seconds. They were not trimmed: section
  9 sets the computer section at 6 seeds and 18,000 ticks. `CLAUDE.md` now gives the measured time
  and assertion count of the full run.
- Not changed: the reviewer's other checks (purity, same-object refusals, classic unchanged,
  missions pinned to classic, starvation guard, tokens in both blocks) held.

Ladder, 150 seeds, `--map random` (advanced tech, 3000 credits, normal ore), 1650 battles each.
Before: the tree at HEAD (classic research, the only mode it has), exported with `git archive` and
run on its own. After: this round, `--research lines`. The two tables are identical in every cell,
so one table serves for both:

| Side 0 | Side 1 | Side 0 wins | Side 1 wins | Unfinished | Median min |
|---|---|---|---|---|---|
| new hard | new normal | 67 (45%) | 81 (54%) | 2 | 24.6 |
| new normal | new hard | 12 (8%) | 137 (91%) | 1 | 19.2 |
| new normal | new easy | 150 (100%) | 0 (0%) | 0 | 15.6 |
| new easy | new normal | 2 (1%) | 148 (99%) | 0 | 19.5 |
| new normal | prev normal | 105 (70%) | 44 (29%) | 1 | 17.3 |
| prev normal | new normal | 34 (23%) | 114 (76%) | 2 | 16.9 |
| new hard | prev hard | 4 (3%) | 146 (97%) | 0 | 14.9 |
| prev hard | new hard | 2 (1%) | 148 (99%) | 0 | 14.8 |
| new hard | prev normal | 75 (50%) | 74 (49%) | 1 | 19.4 |
| prev hard | prev normal | 42 (28%) | 106 (71%) | 2 | 17.1 |
| new normal | new normal | 77 (51%) | 71 (47%) | 2 | 23.9 |

Summary lines, the same before and after: Hard beats Normal 68.0% both ways round, Normal beats
Easy 99.3%, Normal beats prev Normal 73.0%, Hard beats prev Hard 50.7%. Hard beats Normal beats
Easy (monotonic), every pairing is 0 points from baseline, median length up 0%.

Why identical: a per-battle comparison (the ladder's worker output, 150 seeds, both trees) found
Hard against Normal unchanged in every battle, and the Normal mirror changed in length in 6 of 150
battles and in winner in none. The development lines' Mk I nodes are the classic five, and at
3000 credits a battle is decided (median 15 to 25 minutes) before either side reaches Mk II or
fits a module that matters. So the thresholds pass, but this ladder says little about lines play
itself; a richer setup (`--credits 10000 --ore rich`) would exercise it, and is the place to look
if section 2.4 or section 5 numbers are ever tuned.

Gate after these fixes: `npm run check` "All checks passed" (fireline "345131 assertions, 0 failed,
328.8s"; campaign "2609 assertions, 0 failures"; the whole check 7m40s), so `CLAUDE.md` now says
about 5.5 minutes for `drive:fire`. `npm run tours -- --quick fireline`: "ok fireline".
