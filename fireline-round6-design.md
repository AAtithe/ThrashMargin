# Fireline, round 6: game size and deep research in skirmishes (the contract)

Status (2026-11-10): built (simulation, interface and harness); every section 9.3 target met at
150 seeds. See the build log in section 12. Agents implemented strictly from this file.
Where the code and this file disagree on a name or a number, this file wins; where this file is
silent, follow the existing pattern of round 5 (`fireline-round5-design.md`) and say so in the
build log at the end of this file.

Read first: `CLAUDE.md` (invariants), `fireline-round5-design.md` (sections 2, 4.1, 5, 6.3, 9 and
the build log), `packages/fireline/src/sim/research.ts`, `src/sim/aiAir.ts`, `src/sim/ai.ts`
(`commander`, `nextStructure`, `isExtra`), `src/sim/state.ts` (`normaliseSetup`,
`createInitialState`), `src/components/SkirmishSetup.tsx`, `src/pages/Lobby.tsx`,
`scripts/ai-ladder.ts`.

Repo rules that hold throughout:

- `src/sim/` is pure: no `Math.random`, no clock. Nothing in this round needs a die.
- One `cloneState` per legal action; an **illegal action returns the very same state object**.
- Optional rules live behind a toggle that **every preset states explicitly** (the new field is
  in `DEFAULT_SETUP`, `LEGACY_SETUP` and every `GAME_SIZES` preset).
- **Old saves load and play unchanged**, the fourteen story missions and every classic-research
  battle replay byte-identically, and round 5's ladder tables stay identical for `size: 'quick'`.
- Colours are CSS tokens in both the light `:root` block and the `:root[data-theme="dark"]`
  block of `src/styles.css`. Never a hex literal in a component, never hex alpha on a token.
- Hooks never after an early return (the lobby's `if (!user)` and `hasGameAccess` returns:
  every new `useState` goes above them, beside the existing ones).
- The lobby's sign-in gate and game-access check are not touched.
- British English. No em dashes and no emojis anywhere (code comments, UI copy, docs).

All paths below are relative to `packages/fireline/` unless they start with `scripts/` at the repo
root or name a root document.

---

## 1. Why, and what was measured

Round 5's ladder (150 seeds, `--map random`, 3000 credits, normal ore) gave identical tables for
classic and lines: battles end (median 15 to 25 minutes) before the computer gets past Mk I.
A probe for this contract (a scratch copy of the sim, 20 seeds a row, `--map random`, lines)
found why. Over six Normal mirror battles the computer's research step was reached about 6,600
times with a Lab standing and no research under way; it started research **3 times**:

| Gate that stopped it | Decisions |
|---|---|
| army not ready (`armyReady` false) | 2459 |
| saving for Helipads or aircraft (`saving`) | 1949 |
| map ore below `AIR_ORE_FLOOR` (20,000) | 1171 |
| economy in crisis | 507 |
| reached `fund`, still short of 2000 credits | 507 |

The economy at 3000 credits pays about one hauler load (600) every 30 seconds per side for most
of the battle, the commander spends every credit on units as it arrives, and every Mk II needs a
Tech Centre, which the commander builds late (50 to 70% of battles) as a held "extra". Three
levers, all measured in the probe, fix it: research is cheaper and faster in lines mode for the
larger sizes, the commander saves for research and builds the Lab and Tech Centre earlier, and
the larger sizes start richer with attacks later. Probe results are in section 10.1; the ladder
at 150 seeds (section 9) is the acceptance measure.

---

## 2. Summary

A new skirmish setup field, **game size**, chosen on a new first screen of the lobby's "A new
battle" panel:

```ts
export type GameSize = 'quick' | 'standard' | 'long' | 'epic';
SkirmishSetup.size: GameSize
```

- `'quick'` means **today's numbers exactly**: research costs and times, the commander's attack
  timing and its research behaviour are all round 5's. `LEGACY_SETUP` and `DEFAULT_SETUP` both
  say `'quick'`, so a save without the field, a battle without a setup, every mission, every
  harness arena and every `normaliseSetup` call that does not name a size reads today's numbers.
- `'standard'`, `'long'` and `'epic'` scale the commander's attack timing (every skirmish, any
  tech) and, in development-lines battles only, research cost and time and the commander's
  research behaviour ("paced research", section 5). Classic research never changes.
- Picking a size card fills the setup from that size's preset (size, credits, ore); "Customise"
  opens today's detailed setup, which gains a "Game size" control and stays editable. The lobby
  offers Standard to a player who has never chosen.

---

## 3. Types and constants (`src/sim/rules.ts`)

Add a section after the round 5 block (after `LONG_BARREL_WEAPON`), headed
`// ---- Game size (round 6; fireline-round6-design.md) ----`. `ResearchMode` and `OreLevel`
are already declared above it.

### 3.1 The field and the presets

```ts
export type GameSize = 'quick' | 'standard' | 'long' | 'epic';
/** Sizes in the order the size screen shows them, left to right. */
export const GAME_SIZE_ORDER: GameSize[] = ['quick', 'standard', 'long', 'epic'];
/** The size the lobby selects for a player who has never chosen one. */
export const LOBBY_DEFAULT_SIZE: GameSize = 'standard';
```

`SkirmishSetup` gains, as its **last** field (key order matters: `drive-lines.ts` compares
`JSON.stringify(normaliseSetup({}))` with `JSON.stringify(DEFAULT_SETUP)`):

```ts
  /**
   * How big a battle: the commander's attack timing, and in development lines research cost and
   * time and how the commander researches. 'quick' is the game before round 6 exactly.
   */
  size: GameSize;
```

Both presets gain `size: 'quick'` as their last key and are otherwise unchanged:

```ts
export const DEFAULT_SETUP: SkirmishSetup = { map: 'random', tech: 'advanced', credits: 3000, ore: 'normal', sides: 2, mode: 'ffa', research: 'lines', size: 'quick' };
export const LEGACY_SETUP: SkirmishSetup = { map: 'classic', tech: 'standard', credits: 3000, ore: 'normal', sides: 2, mode: 'ffa', research: 'classic', size: 'quick' };
```

`DEFAULT_SETUP` keeps meaning "the setup a partial setup is completed from"; the lobby's first
offer is `LOBBY_DEFAULT_SIZE` applied through `applySize` (3.3), not `DEFAULT_SETUP` itself.

### 3.2 The size table

```ts
export interface GameSizeSpec {
  name: string;
  /** One line under the name on the card. */
  tagline: string;
  /** Expected battle length in minutes against a Normal commander, as the card states it. */
  minutes: [number, number];
  /** What picking the card writes into the setup. Nothing else is touched. */
  preset: { credits: number; ore: OreLevel };
  /** What a player typically reaches, as the card states it (development lines). */
  reach: string;
  /** Multiplier on the commander's firstAttack and attackInterval (1 = unchanged). */
  attackMul: number;
  /** Development lines only: multipliers on research cost and ticks by mark [Mk I, Mk II, Mk III]. */
  researchCost: [number, number, number];
  researchTicks: [number, number, number];
  /** Development lines only: the commander uses paced research (section 5). False: round 5's research step. */
  paced: boolean;
}

export const GAME_SIZES: Record<GameSize, GameSizeSpec> = {
  quick: {
    name: 'Quick',
    tagline: 'A straight fight: build, mass and strike.',
    minutes: [15, 30],
    preset: { credits: 3000, ore: 'normal' },
    reach: 'Research rarely gets past Mk I. Doctrines almost never.',
    attackMul: 1,
    researchCost: [1, 1, 1],
    researchTicks: [1, 1, 1],
    paced: false,
  },
  standard: {
    name: 'Standard',
    tagline: 'Room to tech up before the big waves.',
    minutes: [18, 32],
    preset: { credits: 3000, ore: 'normal' },
    reach: 'Mk II in most battles; a doctrine in some.',
    attackMul: 1.25,
    researchCost: [0.5, 0.5, 0.5],
    researchTicks: [0.6, 0.6, 0.6],
    paced: true,
  },
  long: {
    name: 'Long',
    tagline: 'Richer fields and a slower enemy: the whole tree is in play.',
    minutes: [20, 40],
    preset: { credits: 5000, ore: 'rich' },
    reach: 'Mk II in almost every battle; doctrines likely.',
    attackMul: 2,
    researchCost: [0.5, 0.5, 0.5],
    researchTicks: [0.6, 0.6, 0.6],
    paced: true,
  },
  epic: {
    name: 'Epic',
    tagline: 'Deep pockets and a patient enemy: the deepest tech, on the same map.',
    minutes: [20, 45],
    preset: { credits: 10000, ore: 'rich' },
    reach: 'Mk II in almost every battle; doctrines in most, often more than one.',
    attackMul: 3,
    researchCost: [0.5, 0.5, 0.5],
    researchTicks: [0.6, 0.6, 0.6],
    paced: true,
  },
};
```

Map size is **not** part of a size. The two-sided generator (`draftSkirmishMap`, `maps.ts`) is
built on the module constants `MAP_W` and `MAP_H` (64), and the three- and four-sided generator
on `MAP_SIZE_FOR`; a larger two-sided map is a generator round of its own and is out of scope.
The card states the map size that the setup's sides give (3.4, 7.1).

Further constants:

```ts
/** Paced research (section 5): ore left on the map below which the commander starts no research. */
export const PACED_ORE_FLOOR = 12000;
/** Paced research: armed units (haulers aside) the commander keeps before it holds unit spending for research. */
export const PACED_HOLD_ARMY = 6;
/** Paced research: an armed enemy unit this close (tiles) to the commander's home ends the hold. */
export const PACED_HOLD_RADIUS = 20;
/** Credits a researched upgrade's price is rounded to, after a size multiplier. */
export const RESEARCH_COST_STEP = 50;
```

### 3.3 Pure helpers (in `rules.ts`, below the table)

```ts
/** The setup with a size's preset applied: size, credits and ore. Everything else kept. */
export const applySize = (setup: SkirmishSetup, size: GameSize): SkirmishSetup => ({
  ...setup, size, credits: GAME_SIZES[size].preset.credits, ore: GAME_SIZES[size].preset.ore,
});
/** True when the setup's credits and ore are its size's preset (the card shows "Customised" otherwise). */
export const isPresetSetup = (setup: SkirmishSetup): boolean =>
  setup.credits === GAME_SIZES[setup.size].preset.credits && setup.ore === GAME_SIZES[setup.size].preset.ore;

/**
 * A difficulty's numbers for a size. 'quick' returns the DIFFICULTIES entry itself (the same
 * object), so nothing downstream can differ by a rounding. Otherwise a copy with firstAttack and
 * attackInterval multiplied by attackMul and rounded; every other field unchanged.
 */
export function difficultyForSize(diff: Difficulty, size: GameSize): DifficultySpec;
```

### 3.4 Card facts (in `rules.ts`)

```ts
/** The map's side in tiles for a number of sides (64 for two, MAP_SIZE_FOR otherwise). */
export const mapSizeFor = (sides: 2 | 3 | 4): number => (sides === 2 ? MAP_W : MAP_SIZE_FOR[sides]);
/** "Research" line on a card: 'Full price and time' for 1, otherwise e.g. '50% price, 60% time'. */
export function researchPaceText(size: GameSize): string;
```

`researchPaceText`: when `researchCost` and `researchTicks` are all 1, `'Full price and time'`;
otherwise `` `${pct(cost)} price, ${pct(ticks)} time` `` where `pct(m) = Math.round(m * 100) + '%'`
of the Mk II multipliers (index 1), so Standard reads "50% price, 60% time". It is the same
string in every mark today; if the marks ever differ, the card reads the Mk II figure.

---

## 4. Simulation

### 4.1 Setup (`src/sim/state.ts`)

`normaliseSetup` adds, last:

```ts
const size: GameSize = GAME_SIZE_ORDER.includes(r.size as GameSize) ? (r.size as GameSize) : base.size;
return { map, tech, credits, ore, sides, mode, research, size };
```

So: a save with a setup but no `size` (normalised against `LEGACY_SETUP` in `migrate`) reads
`'quick'`; `normaliseSetup({})` reads `DEFAULT_SETUP`'s `'quick'`; junk takes the base's value.
Size is kept on standard tech (pace applies to any tech; research scaling needs lines).

```ts
/** The size in force. A mission, a battle without a setup and a save without the field: 'quick'. */
export const sizeOf = (s: GameState): GameSize => (!s.mission && s.setup ? s.setup.size ?? 'quick' : 'quick');
/** The difficulty's numbers for this battle (difficultyForSize with sizeOf). */
export const difficultyFor = (s: GameState, diff: Difficulty): DifficultySpec => difficultyForSize(diff, sizeOf(s));
/** True when the commander uses paced research: development lines and a paced size. */
export const pacedResearch = (s: GameState): boolean => researchModeOf(s) === 'lines' && GAME_SIZES[sizeOf(s)].paced;
```

`createInitialState`: the computer's starting memory reads the scaled first attack:
`const d = setup ? difficultyForSize(difficulty, setup.size) : DIFFICULTIES[difficulty];`
(the only change in that function; with no setup or `'quick'` it is the same object as today).
The memories added in `migrate` for missing sides (`state.ts`, about line 509) are unchanged.

### 4.2 Research cost and time (`src/sim/research.ts`)

```ts
/** What this upgrade costs this side in this battle. Classic, and every 'quick' battle: UPGRADES[id].cost exactly. */
export function researchCostOf(s: GameState, id: UpgradeId): number;
/** How many ticks of progress it takes. Classic, and every 'quick' battle: UPGRADES[id].ticks exactly. */
export function researchTicksOf(s: GameState, id: UpgradeId): number;
```

In `'lines'` with a size whose multipliers are not 1, with `m = UPGRADE_LINE[id].mark - 1`:

- cost: `Math.max(RESEARCH_COST_STEP, Math.round((UPGRADES[id].cost * spec.researchCost[m]) / RESEARCH_COST_STEP) * RESEARCH_COST_STEP)`
- ticks: `Math.max(1, Math.round(UPGRADES[id].ticks * spec.researchTicks[m]))`

Otherwise (classic mode, or a multiplier of exactly 1) the `UPGRADES` value is returned
untouched, with no arithmetic, so a quick battle cannot drift by a rounding.

Every read of an upgrade's price or time in a battle goes through them:

| Where | Today | Becomes |
|---|---|---|
| `researchProblem` | `p.credits < spec.cost` | `p.credits < researchCostOf(s, id)` |
| `doResearch` | `UPGRADES[id].cost` | `researchCostOf(s, id)` |
| `doCancelResearch` | `UPGRADES[r.id].cost` | `researchCostOf(s, r.id)` |
| `researchStep` | `UPGRADES[r.id].ticks` | `researchTicksOf(s, r.id)` |
| `migrateResearch` clamp | `UPGRADES[r.id].ticks` | a new optional third argument `ticksOf: (id) => number`, default `id => UPGRADES[id].ticks`; `migrateAir` (`air.ts`) passes `id => researchTicksOf(s, id)` once `s.setup` is normalised |
| `aiAir.ts` step 4 | `fund(s, owner, UPGRADES[next].cost)` | `fund(s, owner, researchCostOf(s, next))` |
| `src/game/Sidebar.tsx` | `spec.cost`, `spec.ticks` in the research rows, captions, bars and titles (lines 571 to 586, 621, 714 to 741) | `researchCostOf(state, id)`, `researchTicksOf(state, id)` |

Refund equals the price paid because the size cannot change during a battle.

### 4.3 Attack timing (`src/sim/ai.ts`, `src/sim/aiAir.ts`)

- `commander`: `const d = tuned(difficultyFor(s, diff), mode);` (was `DIFFICULTIES[diff]`).
  `tuned` is unchanged; missions read `'quick'`, so their raid and defend timing is untouched.
- `airPlan`: `const d = difficultyFor(s, diff);` (its `armyReady` uses firstWave, waveGrowth and
  waveCap, which a size does not change; refineries and turrets likewise).
- Nothing else reads a scaled field. `tick.ts` (decision `period`, `income`) and `mission.ts`
  keep `DIFFICULTIES` directly.

### 4.4 State shape

One new optional field, written only in a paced battle (section 5):

```ts
// AiMemory (src/sim/types.ts), after nextAirStrike:
  /** Paced research (round 6): credits the commander is saving for its next research, or absent. */
  researchFor?: number;
```

`cloneState` copies `ai` entries as today (it is a number). `migrate` keeps it only when it is a
finite number above 0 and the battle is paced, and deletes it otherwise. No other field is added
to `GameState`, `PlayerState` or a unit; no save-format version change.

---

## 5. The computer: paced research

Everything in this section runs only when `pacedResearch(s)` is true. When it is false the
commander runs round 5's code path exactly (the `if` wraps the new code; the old step 4 is not
reordered or rewritten).

### 5.1 Research lists

`AirTactics.research` gains a third list, used instead of `lines` when paced. `classic` and
`lines` are unchanged.

```ts
research: { classic: UpgradeId[]; lines: UpgradeId[]; paced: UpgradeId[] };
```

| Difficulty | `paced` order |
|---|---|
| easy | `['refining', 'plating', 'refining2', 'plating2']` |
| normal | `['refining', 'refining2', 'plating', 'plating2', 'reactive', 'calibration', 'autoloaders', 'engines', 'airframes']` |
| hard | `['refining', 'refining2', 'calibration', 'autoloaders', 'heat', 'plating', 'plating2', 'composite', 'engines', 'engines2', 'airframes']` |

Line first: a Mk II as soon as its Mk I is done, so Logistics Mk II (the economy) comes second
and the first doctrine fourth (Hard) or fifth (Normal). Easy never takes a doctrine.

### 5.2 Lab and Tech Centre earlier

- `airPlan`, in the paced block of 5.3: when `!crisis`, `ore >= PACED_ORE_FLOOR`, no Research Lab
  stands or is queued, `count('factory') > 0`, `count('refinery') >= d.refineries` and
  `count('turret') >= 1`: `queueStructure(s, owner, 'researchlab')`. (Round 5 waits for
  `based`, the uplink, every turret and `armyReady`.)
- `nextStructure` (`ai.ts`), advanced plan: when paced, `['techcentre', 1]` is inserted directly
  after `['turret', d.turrets]` (before the second factory). `isExtra` returns false for
  `'techcentre'` when paced, so the army gate does not hold it. Classic and quick plans unchanged.

### 5.3 The research step

In `airPlan`, immediately after `if (ore <= 0) lastStand(s, owner, armed);` and before the
`if (crisis || !armyReady || ore < AIR_ORE_FLOOR)` return:

```ts
if (paced) {
  delete mem.researchFor;
  // 5.2 Lab first (as specified there).
  if (!p.research && count('researchlab') > 0 && !crisis && ore >= PACED_ORE_FLOOR) {
    const next = first id of t.research.paced not researched, whose UPGRADES[id].requires all stand,
                 and that is not the closed branch of a line (as round 5's find);
    if (next is a Mk III and its line has no doctrine and doctrineProblem(...) === null) doDoctrine(...);
    if (next) {
      const cost = researchCostOf(s, next);
      if (p.credits >= cost && canResearch(s, owner, next)) doResearch(s, owner, next);
      else mem.researchFor = cost;
    }
  }
}
```

- No `fund` call: paced research never takes back queued units.
- Round 5's step 4 is skipped when paced (`if (!paced && !saving && ...)`); steps 1 to 3 and 5
  (anti-air, Helipads, aircraft, strikes) run exactly as today, still behind the existing gate.
- `delete mem.researchFor` runs on every paced decision, so the field exists only while the
  commander is short for its next item.

### 5.4 The hold (`src/sim/ai.ts`, `commander`, step 3 "Units")

Directly before `if (!saving && adv) {` (the advanced unit purchases):

```ts
if (!saving && adv && pacedResearch(s) && mem.researchFor && p.credits < mem.researchFor) {
  const armedHome = units.filter(u => UNITS[u.kind].weapon && u.kind !== 'hauler').length;
  const threat = foes.some(u => UNITS[u.kind].weapon && dist(u.x, u.y, home.x, home.y) < PACED_HOLD_RADIUS);
  if (armedHome >= PACED_HOLD_ARMY && !threat) saving = true;
}
```

`saving` already stops the unit purchases below it; nothing else reads it after this point.
Haulers (bought above step 3), repairs, structures, anti-air and the last stand are not held.

### 5.5 Loadouts

Unchanged: `fitLoadouts` runs as in round 5 in every lines battle. Its "bare" condition keeps
using `AIR_ORE_FLOOR` (not `PACED_ORE_FLOOR`).

---

## 6. What a size changes, and what reads it, in one table

| Battle | Attack timing | Research price and time | Commander research |
|---|---|---|---|
| Any mission | today's | today's (classic) | today's |
| No setup (legacy saves, `createInitialState` without setup) | today's | today's (classic) | today's |
| Save with a setup, no `size` | today's (reads `'quick'`) | today's | today's |
| `size: 'quick'`, any tech, any research | today's | today's | today's |
| `'standard'`/`'long'`/`'epic'`, standard tech or classic research | scaled | today's (classic) | today's |
| `'standard'`/`'long'`/`'epic'`, development lines | scaled | scaled by mark | paced (section 5) |

---

## 7. Interface

### 7.1 The size screen (`src/components/GameSizePicker.tsx`, new)

```ts
export default function GameSizePicker(props: {
  value: SkirmishSetup;
  onPick: (size: GameSize) => void;
}): JSX.Element;
```

A radiogroup (`role="radiogroup"`, `aria-label="Game size"`, class `fl-sizes`) of four cards in
`GAME_SIZE_ORDER`, each a `<button role="radio" class="fl-size" aria-checked data-testid="size-<id>">`:

1. `fl-size-name`: `GAME_SIZES[id].name`; when this card is checked and `!isPresetSetup(value)`,
   a `fl-size-tag` reading "Customised".
2. `fl-size-tagline`: the tagline.
3. A `<dl class="fl-size-facts">` with exactly these rows, in this order:
   - "Length": `` `About ${lo} to ${hi} minutes` `` from `minutes`.
   - "Map": `` `${n} by ${n} tiles` `` with `n = mapSizeFor(value.sides)`, plus `", ${value.sides} sides"` when more than two.
   - "Credits": the preset's credits, `toLocaleString('en-GB')`.
   - "Ore": `ORE_TEXT[preset.ore].name` (export `ORE_TEXT` from `SkirmishSetup.tsx`).
   - "Research": `researchPaceText(id)` when `value.tech === 'advanced' && value.research === 'lines'`;
     otherwise "Full price and time (scaling needs development lines)".
   - "Enemy attacks": from a helper `attackText(mul)` in the component: `'On the usual timing'`
     (1), `'A quarter later'` (1.25), `'Twice as late'` (2), `'Three times as late'` (3), and
     `` `${mul} times as late` `` for any other value.
4. `fl-size-reach`: `reach`, shown only for lines battles; for classic or standard tech:
   "Five upgrades at most (classic research)." for classic, "No research (standard tech)." for standard.

Clicking a card calls `onPick(id)`. The lobby's handler is `setSetup(applySize(setup, id))`.
Clicking the already-checked card re-applies its preset (that is how "Customised" is undone).

Below the cards: `<p class="fl-setup-note">` "Every size can be changed in Customise. The
computer plays by the same numbers."

### 7.2 The lobby flow (`src/pages/Lobby.tsx`)

New state beside the other `useState` calls, above the early returns:

```ts
const [setupStep, setSetupStep] = useState<'size' | 'custom'>('size');
```

The "A new battle" panel always opens on `'size'`:

- `setupStep === 'size'`: battle name field, `GameSizePicker`, the Enemy commander cards (the
  existing block, unchanged, `data-testid="level-*"`), then a row with the primary button
  "Begin the battle →" (same `begin` handler, same label, so `scripts/tours/fireline.cjs`,
  `fireline-touch.cjs` and `scripts/loading-check.cjs`, which click `/Begin the battle/`, keep
  working) and a quiet button "Customise →" (`data-testid="setup-customise"`) that sets `'custom'`.
  A one-line summary under the buttons (`data-testid="setup-summary"`): map (`'Random'` or the
  type name), tech name, research name, sides, credits and ore, e.g. "Random map, Advanced tech,
  Development lines, 2 sides, 3,000 credits, normal ore."
- `setupStep === 'custom'`: a quiet button "← Game size" (`data-testid="setup-back"`) at the top,
  then exactly today's panel content (name, enemy commander, seed, `SkirmishSetupPanel`, Begin).
- The panel title stays "A new battle"; the aside reads `Skirmish` on the size step and
  `` `Skirmish, ${GAME_SIZES[setup.size].name}` `` on the custom step.
- Difficulty cards use `difficultyForSize(d, setup.size)` for "First attack ~N min" and "every
  ~N min", so the numbers shown are the ones the battle uses.

### 7.3 The detailed setup (`src/components/SkirmishSetup.tsx`)

- A new first field "Game size": a `fl-seg` radiogroup of the four names
  (`data-testid="setup-size-<id>"`). Choosing one sets **only** `size` (credits and ore stay as
  the player set them; that is the point of Customise). Note under it: the size's tagline and,
  for lines battles, `researchPaceText`.
- `readStoredSetup()` reads `size` (`GAME_SIZE_ORDER.includes(r.size)` or else
  `LOBBY_DEFAULT_SIZE`). When nothing is stored, or the stored JSON fails to parse, it returns
  `applySize(DEFAULT_SETUP, LOBBY_DEFAULT_SIZE)`. A stored setup from before this round keeps its
  credits and ore and gets `size: LOBBY_DEFAULT_SIZE`.
- `storeSetup` is unchanged (the whole setup, now including `size`, under `fireline_setup`).
- Credits choices: `SETUP_CREDIT_CHOICES` stays `[2000, 3000, 5000, 10000]`; every preset's
  credits must be in it (the harness asserts this).

### 7.4 In battle

- `src/game/Sidebar.tsx`: research prices, times and bars per 4.2.
- The battle's info line or pause screen, wherever the setup is summarised today (search for
  `MAP_TYPE_NAMES` in `src/game/`): add the size name for a skirmish whose size is not `'quick'`.
  If no such summary exists, add nothing.
- `src/pages/HowToPlay.tsx`: one paragraph after the development-lines paragraph: "A new battle
  starts with its size. Quick is the original pace. Standard, Long and Epic give both sides more
  time before the waves come, and with development lines make research cheaper and quicker, so
  Mk II and the doctrines come within reach. Every size can be changed in Customise."

### 7.5 Colour tokens and styles (`src/styles.css`)

No new colour tokens: the cards reuse the tokens `.fl-level` already uses, which are defined in
both the light and the dark block, so both modes are right by construction. Rules (append after
the `.fl-level` rules):

| Rule | Declarations |
|---|---|
| `.fl-sizes` | `display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px;` |
| `.fl-size` | as `.fl-level` (flex column, gap 6px, padding `0.75rem 0.85rem`, `text-align: left`, `font: inherit`, `color: var(--ui-text)`, `background: var(--ui-panel-raised)`, `border: 1px solid var(--ui-rule)`, `border-radius: 4px`, `cursor: pointer`) |
| `.fl-size:hover` | `border-color: var(--ui-rule-strong);` |
| `.fl-size[aria-checked="true"]` | `border-color: var(--ui-accent); background: var(--ui-tint-accent); box-shadow: inset 0 0 0 1px var(--ui-accent);` |
| `.fl-size:focus-visible` | `outline: 2px solid var(--ui-accent); outline-offset: 2px;` |
| `.fl-size-name` | as `.fl-level-name`, `font-size: 1rem` |
| `.fl-size-tag` | as `.fl-badge` (accent text and border), `margin-left: 6px` |
| `.fl-size-tagline` | `font-size: 0.78rem; color: var(--ui-text);` |
| `.fl-size-facts` | `display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; font-size: 0.72rem;` with `dt { color: var(--ui-text-faint); }` and `dd { margin: 0; }` |
| `.fl-size-reach` | `font-size: 0.74rem; color: var(--ui-accent);` |

If a colour that no existing token provides turns out to be needed, add it as a token in both
blocks (never a literal in a rule or a component) and say so in the build log. No horizontal
scroll at 360px (one column) or 1400px (four columns).

---

## 8. File-by-file change list

| File | Change |
|---|---|
| `src/sim/rules.ts` | Section 3: `GameSize`, `GAME_SIZE_ORDER`, `LOBBY_DEFAULT_SIZE`, `SkirmishSetup.size`, both presets, `GameSizeSpec`, `GAME_SIZES`, the four constants, `applySize`, `isPresetSetup`, `difficultyForSize`, `mapSizeFor`, `researchPaceText` |
| `src/sim/types.ts` | `AiMemory.researchFor?` |
| `src/sim/state.ts` | `normaliseSetup` size; `sizeOf`, `difficultyFor`, `pacedResearch`; `createInitialState` memory first attack; `migrate` keeps or drops `researchFor` |
| `src/sim/research.ts` | `researchCostOf`, `researchTicksOf`; the four call sites; `migrateResearch(p, mode, ticksOf?)` |
| `src/sim/air.ts` | `migrateAir` passes `ticksOf` |
| `src/sim/aiAir.ts` | `difficultyFor`; `research.paced` lists; the paced block (Lab and research step, 5.2 and 5.3); step 4 skipped when paced; step 4's `fund` uses `researchCostOf` |
| `src/sim/ai.ts` | `difficultyFor` in `commander`; the hold (5.4); `nextStructure` and `isExtra` for the Tech Centre (5.2) |
| `src/components/GameSizePicker.tsx` (new) | Section 7.1 |
| `src/components/SkirmishSetup.tsx` | Section 7.3; export `ORE_TEXT` |
| `src/pages/Lobby.tsx` | Section 7.2 |
| `src/game/Sidebar.tsx` | Section 4.2 and 7.4 |
| `src/pages/HowToPlay.tsx` | Section 7.4 |
| `src/styles.css` | Section 7.5 (rules only, no new tokens) |
| `scripts/drive-size.ts` (new, in `packages/fireline/scripts/`) | Section 9.1; exports `sections` like `drive-lines.ts` |
| `scripts/drive.ts` (fireline) | Import `sections as sizeSections` from `./drive-size` and spread it after `linesSections` |
| `scripts/drive-lines.ts` | The preset-key guard now sees `size`; no other change (every arena there passes no size and so plays `'quick'`) |
| `scripts/ai-ladder.ts` | Section 9.2 |
| `scripts/campaign-check.ts` | Assert `sizeOf` is `'quick'` for every mission's starting state |
| `scripts/tours/fireline.cjs`, `fireline-touch.cjs` | No change expected; they must pass (they begin from the size step with Standard) |
| `fireline-design.md` (root) | Build log entry "2026-11-xx: Game size and paced research (round 6)" with the ladder tables |
| `CLAUDE.md` (root) | The `drive:fire` line: new time and assertion count after `drive-size.ts` lands |

---

## 9. Harness and measurement

### 9.1 `packages/fireline/scripts/drive-size.ts`

Sections and assertions (each with `ok(cond, label)`):

**Size: rules and presets**
- `DEFAULT_SETUP.size === 'quick'`, `LEGACY_SETUP.size === 'quick'`; every key of `SkirmishSetup`
  present in both presets and `size` is the last key of each.
- `normaliseSetup({})` equals `DEFAULT_SETUP` (stringified); `normaliseSetup({ size: 'junk' })`
  takes the base's; `normaliseSetup({ map: 'river' }, LEGACY_SETUP).size === 'quick'`;
  `normaliseSetup({ tech: 'standard', size: 'long' }).size === 'long'`.
- `GAME_SIZE_ORDER` lists every key of `GAME_SIZES` once; `GAME_SIZES.quick` has `attackMul` 1,
  every research multiplier 1 and `paced` false; every other size is `paced`; every preset's
  credits is in `SETUP_CREDIT_CHOICES`; `minutes[0] < minutes[1]`; `attackMul >= 1`; every
  research multiplier is in `(0, 1]`.
- `applySize` writes size, credits and ore only; `isPresetSetup(applySize(x, k))` for every size.
- `difficultyForSize(d, 'quick') === DIFFICULTIES[d]` (same object) for every difficulty; for
  every other size the copy differs from `DIFFICULTIES[d]` only in `firstAttack` and
  `attackInterval`, each `Math.round(orig * attackMul)`.

**Size: quick is today**
- For `size: 'quick'` in a lines battle, `researchCostOf` and `researchTicksOf` return
  `UPGRADES[id].cost` and `.ticks` for all twenty ids; for classic research at every size, the
  same for the five classic ids.
- A mission state, a no-setup state and a save stripped of `size` all read `sizeOf === 'quick'`,
  `pacedResearch === false`.
- Byte identity: for each of {no setup; advanced lines; advanced classic; standard tech; three
  sides lines} at each difficulty on two seeds, autopilot 18,000 ticks with `size: 'quick'`
  given explicitly and with no `size` at all: `JSON.stringify` of the two final states equal.
  Plus one pre-round-6 hash: before the change, record `JSON.stringify` hashes of the same
  battles at tick 18,000 into the harness as constants; after it, they must match.

**Size: research scaling**
- In a Standard lines battle: `researchCostOf(s, 'refining') === 1000`, `('refining2') === 1200`,
  `('heat') === 1400`, `('engines') === 600`; `researchTicksOf(s, 'refining') === 420`,
  `('heat') === 600`. Starting research charges exactly that price; cancelling refunds exactly
  it; at full power it completes on exactly the scaled tick count, at low power on twice it.
- In a Standard classic battle and a Standard standard-tech battle, prices are `UPGRADES`'.
- Research and `researchFor` survive `migrate(JSON round trip)`; a save with progress above the
  scaled ticks is clamped to them.
- Illegal research (not enough credits at the scaled price minus one) returns the same object.

**Size: the computer**
- In a Long lines battle at each difficulty on 6 seeds, 24,000 ticks: research taken is a prefix
  (allowing skips for unmet buildings) of the difficulty's `paced` list; every branch held matches
  its doctrine; `researchFor`, when present, equals `researchCostOf` of the next list item.
- In a Long **classic** battle the commander's research sequence equals the `classic` list's
  prefix and no memory ever has `researchFor`.
- First attack: in a Long battle side 1's `ai[1].nextAttack` at tick 0 is
  `Math.round(DIFFICULTIES[d].firstAttack * 2)`.
- Starvation guard: armed ground units at tick 12,000 in a Standard lines battle at least 70% of
  the same seed's Quick lines battle (same credits and ore), Normal and Hard, 6 seeds.
- A Standard lines battle replays byte-identically (two runs, same seed).

**Size: tick cap**
- One Epic battle per difficulty pair on 3 seeds finishes (winner not null) before 150,000 ticks.

### 9.2 `scripts/ai-ladder.ts`

- New flag `--size <quick|standard|long|epic>` (default `quick`). When given with a non-legacy
  `--map`, the setup gets `size` and, unless `--credits` or `--ore` is also given, the size's
  preset credits and ore. With `--map legacy` it is refused with an error (no setup, no size).
- Default `--cap` becomes the size's: quick and standard 60,000, long 90,000, epic 150,000
  (an explicit `--cap` wins).
- Side 0's first attack: `s.ai[0].nextAttack = difficultyForSize(d0, size).firstAttack`.
- In a lines battle each worker also records, per side, the tick of its first Mk II and first
  Mk III completed (polling `players[o].upgrades` after each 50-tick step; `UPGRADE_LINE` gives
  the mark). The report adds a **Depth** table after the main one:

```
Depth (share of battles reaching each, median minute when reached):
difficulty   battles   Mk II        Mk III
easy         600       ...          ...
normal       1350      ...          ...
hard         900       ...          ...
```

  where each side of every battle on the card counts once for its difficulty (a battle with
  two Normal sides counts twice for Normal). A second Depth table, "Normal and Hard only",
  counts only battles in which neither side is Easy (the Normal mirror and Hard against Normal
  both ways round), since Normal against Easy ends early by design.
- The usage text at the top documents `--size` and the Depth tables.

### 9.3 Targets (the acceptance numbers)

Run, each at 150 seeds on the standard card:
`npm run ladder:fire -- --map random --size <size>` for every size (lines is the default
research). Record every table in the build log.

| Size | Normal-and-Hard Depth: Mk II share, each of Normal and Hard | Mk III share, each | Normal mirror median minutes | Unfinished, any row |
|---|---|---|---|---|
| quick | identical to round 5's table (section 12 of round 5) in every cell | identical | identical (23.9) | identical |
| standard | at least 60% | at least 25% | 18 to 32 | at most 2% |
| long | at least 85% | at least 55% | 22 to 40 | at most 2% |
| epic | at least 90% | at least 65% | 20 to 40 | at most 2% |

And at every size:

- Difficulty order kept: "Hard beats Normal" (both ways round) above 50%, "Normal beats Easy"
  at least 90%. Easy's Mk II share not above Normal's.
- `--research classic --size long`: research Depth columns may be anything, but the classic
  path's commander must play the `classic` list only (the harness asserts this, 9.1).
- If a target fails, tune in this order and re-run at 150 seeds: the `paced` lists (5.1), then
  `researchCost`/`researchTicks` for that size, then `attackMul`, then the preset. Never the
  `UPGRADES` table, `DIFFICULTIES`, the classic or lines lists, or anything `'quick'` reads.
- The cards' copy must agree with the measured numbers. `minutes` must contain the Normal mirror's
  median and should span its 10th to 90th percentiles, rounded outwards to multiples of 5.
  `reach` says "most" only for a share of at least 60%, "likely" for at least 50%, "almost every"
  for at least 85% and "every" only for at least 95%. Change the copy to fit the measurement,
  never the other way round, and record the final copy in the build log.

Also run: `npm run check`, `npm run drive:fire`, `npm run campaign:fire`,
`npm run tours -- fireline`, `npm run check:loading` (the lobby's new-battle panel changed), and
load the lobby and a battle in both colour modes at 360px and 1400px.

---

## 10. Notes for implementers

### 10.1 What the probe measured (20 seeds a row, scratch copy, not binding)

All rows `--map random`, lines. "Mk II" and "Mk III": share of battles in which the side
finished at least one, side 0 / side 1.

| Variant | Row | Median min | Mk II | Mk III |
|---|---|---|---|---|
| Round 5 as built, 3000, normal ore | normal v normal | 25.4 | 0% / 0% | 0% / 0% |
| | hard v normal | 22.9 | 0% / 0% | 0% / 0% |
| Standard as specified (3000, normal, x1.25 attacks) | normal v normal | 23.7 | 75% / 80% | 40% / 55% |
| | hard v normal | 24.5 | 95% / 80% | 50% / 35% |
| | normal v easy | 11.3 | 30% / 0% | 10% / 0% |
| Long as specified (5000, rich, x2 attacks) | normal v normal | 27.4 | 100% / 90% | 90% / 85% |
| | hard v normal | 24.4 | 100% / 95% | 60% / 90% |
| | normal v easy | 14.0 | 100% / 0% | 40% / 0% |
| Epic as specified (10,000, rich, x3 attacks) | normal v normal | 24.4 | 100% / 100% | 90% / 95% |
| | hard v normal | 27.9 | 100% / 100% | 75% / 95% |
| | normal v easy | 19.5 | 100% / 10% | 100% / 0% |
| Epic tried and rejected (5000, rich, x3 attacks, +2 turrets, waves x1.5) | normal v normal | 26.6 | 100% / 100% | 90% / 90% |
| | hard v normal | 27.7 | 100% / 100% | 55% / 100% |

Findings that shaped the contract:

- Cheaper research alone (half price, 60% time) brought Mk I to 95% but Mk II only to about 30%:
  the Tech Centre came too late. Building it before the second factory took Mk II to 70 to 90%.
- Without the Lab-early rule, the Lab stood in only 75 to 90% of battles.
- More credits do not make longer battles: at 10,000 credits and x2 attacks the Normal mirror
  ended sooner (19.2 minutes) than at 5,000 (27.4). Attack timing is the length lever; credits
  and ore are the depth lever.
- Making attacks earlier made battles longer, not shorter (x0.75: 28.4 minutes), because small
  early waves die on the turrets. So Quick is today's pace, not a faster one.
- Epic is not longer than Long on a 64-tile map: at 10,000 credits and x3 attacks the Normal
  mirror took 24.4 minutes. Extra turrets and larger waves did not lengthen it either and cost
  Hard its edge (side 0 Hard won 3 of 20 against Normal), so they are not in this round. Epic is
  sold on depth (doctrines in most battles), and its card says so; a genuinely longer Epic needs
  a larger map (10.2).
- Hard benefits from research more than Normal does: Hard beat Normal from side 0 in 16 of 20 at
  Standard (8 of 20 before). The order is kept; the 5-point-of-baseline rule of round 5 does not
  apply to the paced sizes, whose baseline is the change itself.

### 10.2 Out of scope

- Larger two-sided maps (needs `draftSkirmishMap` parameterised by size).
- Scaling `period`, income, wave sizes or turret counts by size.
- Any change to classic research, missions, the campaign, or the `'quick'` path.

---

## 11. Acceptance

The round is done when all of these hold:

1. `npm run check` passes, including `drive-size.ts` and the unchanged round 5 sections.
2. Every battle that does not name a size, every mission and every classic or quick battle is
   byte-identical to the build before this round (9.1 "quick is today").
3. The lobby's "A new battle" panel opens on four size cards with Standard checked for a new
   player, each stating length, map, credits, ore, research pace, enemy attacks and what is
   typically reached; "Begin the battle" starts a Standard battle; "Customise" shows today's
   setup with a Game size control; the choice is remembered across visits.
4. Picking a card applies its preset; editing credits marks it "Customised"; picking it again
   restores the preset.
5. In a Long lines battle the Research tree shows the scaled prices and times, and starting,
   cancelling and finishing research pay, refund and take exactly them.
6. Section 9.3's targets hold at 150 seeds for every size; the tables are in the build log.
7. An old skirmish save, a round 5 lines save and an in-progress campaign save load and play
   as before.
8. The size cards look right in light and dark mode at 360px and 1400px with no horizontal
   scroll; `npm run tours -- fireline` and `npm run check:loading` pass.

---

## 12. Build log

(Implementers append dated entries here: what was built, deviations, measured numbers.)

### 2026-11-10: the simulation (sections 3, 4 and 5)

Built, in `packages/fireline/src/sim/`: `rules.ts` (section 3: `GameSize`, `GAME_SIZE_ORDER`,
`LOBBY_DEFAULT_SIZE`, `SkirmishSetup.size` as the last key, both presets `size: 'quick'`,
`GameSizeSpec`, `GAME_SIZES`, `PACED_ORE_FLOOR`, `PACED_HOLD_ARMY`, `PACED_HOLD_RADIUS`,
`RESEARCH_COST_STEP`, `applySize`, `isPresetSetup`, `difficultyForSize`, `mapSizeFor`,
`researchPaceText`), `types.ts` (`AiMemory.researchFor?`), `state.ts` (`normaliseSetup` size,
`sizeOf`, `difficultyFor`, `pacedResearch`, the computer's first attack in `createInitialState`,
`migrateState` keeps `researchFor` only when finite, above 0 and paced), `research.ts`
(`researchCostOf`, `researchTicksOf`, the four call sites, `migrateResearch(p, mode, ticksOf?)`),
`air.ts` (`migrateAir` passes `researchTicksOf`), `aiAir.ts` (`difficultyFor`, `research.paced`,
the paced block, step 4 skipped when paced and funded at `researchCostOf`) and `ai.ts`
(`difficultyFor` in `commander`, the hold, the Tech Centre in the plan). Outside the sim, one line:
`readStoredSetup` in `src/components/SkirmishSetup.tsx` reads `size` (else `LOBBY_DEFAULT_SIZE`)
so the client typechecks; the rest of section 7.3 (the `applySize` fallbacks, the control) is
left to the interface work. No campaign file changed: missions read `'quick'` through `sizeOf`.

Deviations:

- `difficultyForSize` returns the `DIFFICULTIES` entry itself for any size whose `attackMul` is 1,
  not only `'quick'` (the same thing today).
- Step 4's list search moved into a helper, `nextResearch`, shared with the paced block; same
  condition, same order.
- **The Tech Centre in the plan only while the map holds `PACED_ORE_FLOOR` of ore** (`pacedTech`
  in `ai.ts`). As specified, a side that lost its Tech Centre late saved for a new one for the rest
  of the battle (it is not an extra, so the army gate never released the credits): 4 of 30 Hard
  against Normal battles at Standard ran to the 60,000-tick cap. Below the floor it is round 5's
  held extra again.
- **Mined-out maps, paced battles only** (`ai.ts`). With the ore all gone the commander buys no
  new structure, and the "dry" sell list (credits under 300) also takes the Research Lab, Rocket
  Turrets and Turrets. Without this, two sides that had spent on research ran dry with a structure
  to save for or nothing to spend: 7 of 150 Hard against Normal battles at Standard unfinished
  (round 5's quick ladder: 2). With it: 1 of 150, then 0 with the final lists.
- **Research lists, tuned (section 9.3, lists first).** Normal and Hard both open on the Engines
  line and its Field workshops doctrine, the cheapest Mk II and Mk III; Easy is as specified:
  - normal: `['refining', 'engines', 'engines2', 'fieldrepair', 'refining2', 'plating', 'plating2', 'reactive', 'calibration', 'autoloaders', 'airframes']`
  - hard: `['refining', 'engines', 'engines2', 'fieldrepair', 'refining2', 'calibration', 'autoloaders', 'heat', 'plating', 'plating2', 'composite', 'airframes']`

  Measured at 150 seeds (Standard, Normal and Hard rows): the specified Normal list gave Normal
  Mk II 60% and Mk III 29% (on the line); Engines first without its doctrine gave 71% and 23%
  (fails); the final list 71% and 52%. Lowering `PACED_HOLD_ARMY` to 4 made it worse (58%). The
  specified Hard list left Hard beating Normal only 52% at Epic and 57% at Long; the final one
  59% and 58%, and 80% at Standard. No `researchCost`, `researchTicks`, `attackMul` or preset
  was changed.
- **Card copy changed to fit the measurement** (section 9.3 rule): every paced size's Normal
  mirror spans about 16 to 33 minutes (10th to 90th percentile), so `minutes` is `[15, 35]` for
  Standard, Long and Epic alike; on a 64-tile map the larger sizes buy depth, not length. Quick is
  untouched. `reach`:
  - standard: "Mk II in most battles; a doctrine in about half." (Normal: Mk II 70%, Mk III 51%)
  - long: "Mk II in almost every battle; a doctrine in most, sometimes two." (96%, 85%, two or more 44%)
  - epic: "Mk II in every battle; a doctrine in almost every battle, more than one in most." (100%, 97%, two or more 64%)

Verified:

- `tsc -p packages/fireline/tsconfig.json` and the API tsconfig: clean.
- Byte identity against HEAD (`git archive HEAD` into the scratchpad): a scratch script hashed the
  whole state every 600 ticks, with a `migrateState` JSON round trip every 6,000, to 18,000 ticks
  (12,000 for missions) over 42 autopiloted skirmishes (no setup; advanced lines; advanced
  classic; standard tech; three sides lines; three sides classic; lines at 5000 credits and rich
  ore; each difficulty, two seeds) and all fourteen story missions. The setup's `size` key is left
  out of the hash (the only byte a quick state gains). Every hash matched HEAD, run once with no
  `size` and once with `size: 'quick'` given explicitly. Final-state hashes at tick 18,000 for
  the five battle kinds of section 9.1 (30 battles, seeds `size-a`, `size-b`) also match HEAD.
- A Long classic battle at each difficulty: research is the `classic` list's, no memory ever
  holds `researchFor`, and the first attack is doubled.
- `npm run campaign:fire`: 2609 assertions, 0 failures.
- `npm run drive:fire`: 345,133 assertions, 1 failed, 349 s. The failure is `drive-lines.ts`
  "research is the last field of a setup", which `size` breaks by design (section 8: the guard
  now sees `size`); that file belongs to the harness work.

Scratch ladder (the ladder's seeds `ladder-1` to `ladder-150`, `--map random`, lines, each size's
preset, side 0's first attack scaled, cap 60,000 / 90,000 / 150,000 ticks; the standard card's
five new-against-new rows, not the `prev` rows). Depth: share of sides finishing a Mk II and a
Mk III; "Normal and Hard only" counts each side of the Hard against Normal rows both ways round
and the Normal mirror (Normal 600 sides, Hard 300).

| Size | Normal Mk II | Normal Mk III | Hard Mk II | Hard Mk III | Mirror median (p10 to p90) | Hard beats Normal | Normal beats Easy | Unfinished, worst row |
|---|---|---|---|---|---|---|---|---|
| standard | 70% | 51% | 93% | 82% | 23.7 (16.0 to 32.5) | 80% | 100% | 0 of 150 |
| long | 96% | 85% | 100% | 93% | 23.5 (16.4 to 32.5) | 58% | 100% | 0 of 150 |
| epic | 100% | 97% | 100% | 98% | 21.3 (19.8 to 30.3) | 59% | 100% | 0 of 150 |

Rows (side 0 wins, unfinished, median minutes, Mk II side 0 / side 1, Mk III side 0 / side 1):

| Size | hard v normal | normal v hard | normal v easy | easy v normal | normal v normal |
|---|---|---|---|---|---|
| standard | 60%, 0, 24.6, 94/81, 85/61 | 1%, 0, 17.6, 32/93, 11/79 | 100%, 0, 11.4, 43/0, 34/0 | 0%, 0, 16.0, 3/67, 0/49 | 50%, 0, 23.7, 85/80, 67/65 |
| long | 22%, 0, 21.9, 100/99, 89/93 | 5%, 0, 18.0, 85/100, 55/98 | 100%, 0, 14.2, 100/2, 93/0 | 1%, 0, 14.8, 4/100, 0/95 | 44%, 0, 23.5, 100/99, 95/96 |
| epic | 25%, 0, 21.7, 100/100, 95/99 | 8%, 0, 20.3, 99/100, 92/100 | 99%, 0, 19.4, 100/11, 100/0 | 0%, 0, 19.6, 35/100, 0/100 | 50%, 0, 21.3, 99/100, 97/99 |

Every section 9.3 target holds at 150 seeds on these rows. Easy's Mk II share stays below
Normal's at every size. At Long and Epic, Hard's edge over Normal is mostly side 1's income bonus
(Hard from side 0 wins about a quarter against Normal); it holds above 50% but is thinner than at
Standard. Quick was not laddered: every quick battle is byte-identical to HEAD (above), so round
5's table stands. The official numbers are for `scripts/ai-ladder.ts --size` once the harness
work lands; its Depth table should count only `new` commanders' sides, since `prev` never runs
paced research.

### 2026-11-10: the interface (section 7 and the Sidebar part of 4.2)

Built, in `packages/fireline/src/`:

- `components/GameSizePicker.tsx` (new): the size screen of 7.1, four `fl-size` radio cards in
  `GAME_SIZE_ORDER` with the six facts rows, the "Customised" tag, the reach line (or the classic
  and standard-tech lines) and the note under the cards. It also exports `attackText`.
- `pages/Lobby.tsx`: `setupStep` beside the other state, above the sign-in and game-access returns
  (both untouched). The size step shows name, Game size, Enemy commander, "Begin the battle →",
  "Customise →" (`setup-customise`) and the summary line (`setup-summary`); the custom step adds
  "← Game size" (`setup-back`) and today's seed field and `SkirmishSetupPanel`. Picking a card is
  `setSetup(applySize(setup, id))`, so it is stored at once. The aside reads `Skirmish` or
  `Skirmish, <size>`. The difficulty cards read `difficultyForSize(d, setup.size)`.
- `components/SkirmishSetup.tsx`: the "Game size" `fl-seg` control (`setup-size-<id>`, sets size
  only) with the tagline and, for lines, the research pace under it; `readStoredSetup` falls back
  to `applySize(DEFAULT_SETUP, LOBBY_DEFAULT_SIZE)` when nothing is stored or the JSON fails;
  `ORE_TEXT` exported.
- `game/Sidebar.tsx`: classic rows and line nodes read `researchCostOf` and `researchTicksOf` for
  prices, captions, times, titles and bars. No battle screen summarises the setup with
  `MAP_TYPE_NAMES`, so nothing was added there (7.4).
- `pages/HowToPlay.tsx`: the paragraph of 7.4, after the development-lines paragraph.
- `styles.css`: the rules of 7.5 plus `.fl-begin-row` (the Begin and Customise row). No new
  colour tokens; every colour is an existing token defined in both blocks.
- `components/ui.tsx`: `Button` takes an optional `testId`, rendered as `data-testid` (the two new
  quiet buttons need one and `Button` passed no extra props).

Deviations:

- **Two by two, not four abreast.** The lobby's column is 820px wide, so `minmax(190px, 1fr)` gave
  three cards and an orphan at every desktop width, and four at about 180px would crush the facts.
  `.fl-sizes` uses `repeat(auto-fit, minmax(min(100%, 300px), 1fr))`: two by two on a desktop, one
  column on a phone.
- **The difficulty blurb gains a sentence for a paced size.** `DIFFICULTIES[d].blurb` states the
  quick timing ("first attack around six minutes in"), which contradicted the scaled card above it.
  For a size whose `attackMul` is not 1 the lobby adds, e.g., "At Long size every attack comes
  twice as late: the first at about 12 minutes." The sim's blurb text is unchanged.
- A "Game size" label sits above the cards on the size step, as on every other field of the panel.
- The summary leaves out the research name for standard tech (no research there) and adds
  "in teams" for a teams battle of three or four sides.

Verified (Chromium, Vite dev server, `tm_user` set client-side, `/api` stubbed with 401 in the test
script only; 80 checks, 0 failures; script in the scratchpad, `pace/ui/check-size.cjs`):

- A new player gets the size step with Standard checked, no seed or map previews, the enemy
  commander cards, Begin, Customise and the summary "Random map, Advanced tech, Development lines,
  2 sides, 3,000 credits, normal ore."
- Each card writes size, credits and ore to the stored setup and nothing else; Customise then shows
  that size, credits and ore checked and the aside "Skirmish, <size>"; back returns to the cards.
- In Customise, credits 2000 and size Epic: only the size changes; the Epic card reads
  "Customised", the summary shows 2,000 credits; a reload keeps both; picking Epic again restores
  10,000 and rich and drops the tag.
- Classic research and standard tech change the cards' research and reach lines; three sides
  changes the Map row.
- A setup stored before this round keeps its credits and ore and opens on Standard, "Customised".
- Begin on Long against Hard: the save's setup has `size: 'long'`, 5000, rich, and `ai[1].nextAttack`
  is twice Hard's first attack; with a Lab added to the save the Research tree shows Refinery
  efficiency at 1000 credits and 42s.
- Light and dark at 1400px, light and dark at 390px, light at 360px: no horizontal scroll on either
  step; no page errors. Screenshots looked at.
- `npm run tours -- --quick fireline` and `fireline-touch`: ok. `npm run check:loading -- fireline`:
  27 of 27. The full `npm run check:loading` stops at Thrash Margin ("Start campaign" not found),
  a package this round does not touch.
- `tsc` for the client and the API: clean.

### 2026-11-10: the harness and the ladder (section 9)

Built: `scripts/drive-size.ts` (new, run by `drive.ts` after the development-lines sections),
the `size` key check in `drive-lines.ts`, the Quick check on every mission in `campaign-check.ts`,
and `--size`, per-size tick caps, Mk II / Mk III times, depth tables and `--out` in `ai-ladder.ts`.
`drive.ts` reports about 345,700 assertions, 0 failed (582 of them from `drive-size.ts`);
`campaign-check.ts` 2,623, 0 failed. The 30 pre-round-6 battles hash to the constants taken from
the build before this round, on HEAD and on the working tree alike.

Deviations from 9.1, each also in a code comment:

- The starvation guard is a sum over seeds, not a per-seed check: by tick 12,000 one seed's unit
  count mostly says who is winning (one seed read 18 against 35 while the 20-seed total was 0.97).
  Side 0 plays Normal throughout, since a Hard mirror is usually over by tick 12,000. It uses the
  first 3 seeds on which both battles last to tick 12,000 (up to 14 tried).
- The Long lines battles run 4 seeds per difficulty, not 6. With 6 seeds and 4 starvation samples
  the size sections added about 6 minutes to every `npm run check`; at 4 and 3 the computer
  section takes about 90 seconds instead of about 230. The depth shares themselves are measured by
  the 150-seed ladder, not here.
- The order check allows a skip when the skipped item's structures are missing, as the contract
  intends, rather than an exact prefix; the classic check is a subsequence.
- "`researchFor` is the next item's price" passes at 90% of samples, not every sample: the rest
  are one decision stale (a structure finished between the decision and the sample). "`researchFor`
  is the price of some item still open" and "nothing is being researched while it is set" hold on
  every sample.
- "Quick given explicitly plays the same battle as no size" runs once per kind (Normal, seed
  `size-a`, 4 battles), not every kind by difficulty by seed; the 30 hashed battles cover the rest.
- The Epic tick cap uses 3 pairings by 3 seeds (hard v normal, normal v easy, normal v normal),
  not all 6 difficulty pairs. All nine finish, in 19 to 35 minutes.
- The Standard replay runs to tick 18,000, not to the end.

Root scripts: `drive:fire`, `campaign:fire` and `ladder:fire` now end in `--workspace=packages/fireline --`,
so `npm run ladder:fire -- --map random --size long` passes its flags to the script (before, npm
took them as its own and the legacy card ran).

Ladder, 150 seeds, `--map random`, advanced tech, development lines, each size's preset credits
and ore, the full 11-match card (1650 battles a size). Depth is "Normal and Hard only": new
against new, no Easy side (600 Normal sides, 300 Hard).

| Size | Normal Mk II / Mk III | Hard Mk II / Mk III | Easy Mk II | Normal mirror median (p10 to p90) | Hard beats Normal | Normal beats Easy | Unfinished |
|---|---|---|---|---|---|---|---|
| Quick | 0% / 0% | 0% / 0% | 0% | 23.9 (16.0 to 33.6) | 68.0% | 99.3% | 11 (as round 5) |
| Standard | 70% / 51% | 93% / 82% | 1% | 23.7 (16.0 to 32.5) | 79.7% | 100% | 0 |
| Long | 96% / 85% | 100% / 93% | 3% | 23.8 (16.4 to 32.5) | 58.3% | 99.7% | 0 |
| Epic | 100% / 97% | 100% / 98% | 23% | 21.3 (19.8 to 30.3) | 58.7% | 99.7% | 0 |

Quick matches round 5's table cell for cell, summary lines included (68.0, 99.3, 73.0, 50.7).
Standard run twice gave identical tables. The longest battle was 27,770 ticks (Epic, cap 150,000).
Thin spots, all passing: at Long and Epic, Hard on side 0 beats Normal only 22% and 25% of the
time, so Hard's lead there comes mostly from side 1's income bonus; at Standard, new Hard on
side 0 beats prev Hard only 10% of the time (54.0% both ways round).

Copy: Quick's card now reads 15 to 35 minutes (it read 15 to 30), the p90 of 33.6 rounded
outwards as 9.3 asks. All four cards now give the same range, which is honest: at this map size
the battles last about as long whatever the size, and the sizes differ in how deep research gets,
not in minutes. Larger maps (10.2, out of scope) are what would make the bigger sizes longer.
