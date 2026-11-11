# Fireline, round 6: the contract

Status (2026-11-11): contract written; the groundwork it stands on is in the tree (section 1). Four
workstreams build in parallel on top of it, each in its own worktree, then an integrator merges
them. As in rounds 4 and 5 (`fireline-round4-design.md`, `fireline-round5-design.md`, whose rules
all still hold), this file is what stops them colliding: the exact names each one adds, the files
each one owns, the lines each one may touch in a shared file, and how each one is tested.

The owner asked: "two types of armies, with slightly different characteristics, slightly different
planes; how can you build special characters in free play, or the engineer; generals too; and more
structure to unit formation." The plan is `fireline-round6-plan.md`; this file refines it against
the code. Four workstreams:

- **A. Two armies**: Meridian Corps (today's army, exactly) and Ashen Combine (lighter, faster,
  cheaper), one signature unit each, an aircraft variant or two, and the computer playing either.
- **B. Heroes in free play**: the campaign's Spy, Commando, Engineer and Ace recruitable in a
  skirmish behind a setup option, one of each, with a revive cooldown.
- **C. Generals**: a doctrine General per seat (a perks bundle), and a field General unit with a
  command aura behind a setup option.
- **D. Formations and squads**: line, column, wedge and box; a squad that keeps pace; the computer's
  waves in formation.

Read `fireline-design.md` (the build log, latest entries last), `fireline-round5-design.md` and
`fireline-round6-plan.md` first. The repo rules hold throughout: `src/sim/` is pure (no
`Math.random`, no clock, one `cloneState` per action, an illegal action returns the same state
object); every enemy question goes through `src/sim/sides.ts`; colours are tokens in both the light
and the dark block of `styles.css`, never hex in a component; British English, no em dashes, plain
and direct.

---

## 1. The groundwork (in the tree, changes nothing in play)

Every summary line of `npm run drive` is the same before and after it (section 1's last part).

| What | Where |
|---|---|
| `Faction = 'meridian' \| 'ashen'`, `FACTIONS`, `FACTION_NAMES` | `src/sim/rules.ts` (round 6 block at the end) |
| `UnitOverlay`, `BuildingOverlay`, `FactionOverlay`, `FactionMenu` (types); `FACTION_OVERLAY: Record<Faction, FactionOverlay>` and `FACTION_MENUS: Record<Faction, FactionMenu>`, both empty, **inside A's markers** | `src/sim/rules.ts` |
| `AirRole = 'strafe' \| 'bomb'` and `UnitSpec.airRole?`; the Gunship is `'strafe'`, the Bomber `'bomb'` | `src/sim/rules.ts` |
| `GeneralId = 'hale' \| 'voss' \| 'kade' \| 'ilse'`, `GENERAL_IDS`, `GENERAL_FACTION: Record<GeneralId, Faction>` (Hale and Voss Meridian, Kade and Ilse Ashen). The `GENERALS` table itself is C's | `src/sim/rules.ts` |
| `FormationShape = 'line' \| 'column' \| 'wedge' \| 'box'`, `FORMATION_SHAPES` | `src/sim/rules.ts` |
| `SkirmishSetup.factions?: Faction[]`, `.heroes?: boolean`, `.generals?: boolean`, `.generalPicks?: (GeneralId \| null)[]`; `DEFAULT_SETUP` and `LEGACY_SETUP` state each: `factions: ['meridian', 'meridian'], heroes: false, generals: false, generalPicks: [null, null]` | `src/sim/rules.ts` |
| `normaliseSetup` repairs the four: one entry per seat (`sides` long); an unknown army falls back to the base's at that seat, else `'meridian'`; `heroes` and `generals` on only when exactly `true`, off when exactly `false`, else the base's, else off; a pick that is not a `GeneralId` or `null` falls back to the base's, else `null`, and a General from another army than its seat's reads as `null` | `src/sim/state.ts` |
| `readStoredSetup` (the lobby's remembered setup) carries the four through `normaliseSetup`, so no workstream edits it | `src/components/SkirmishSetup.tsx` |
| `PlayerState.faction?: Faction`; `createInitialState` sets it on every player of a skirmish from `setup.factions`; a battle with no setup (and every mission) has none, which reads as `'meridian'` | `src/sim/types.ts`, `src/sim/state.ts` |
| **`src/sim/specs.ts`** (new, imports only `rules.ts` and types, so no cycle): `isFaction`, `factionOf(s, owner)`, `unitSpecFor(faction, kind)`, `buildingSpecFor(faction, kind)`, `unitSpec(s, owner, kind)`, `buildingSpec(s, owner, kind)`, `unitSpecOf(s, u)`, `buildingSpecOf(s, b)`, `kindSpec(s, owner, kind)` (cost, build time, requirements of either), `factionAllows(faction, kind)`, `menuOf(faction, category)`, `perksFor(s, owner)`. `state.ts` re-exports the spec and perk functions | `src/sim/specs.ts`, `src/sim/state.ts` |
| Every owner-aware lookup in `src/sim/` reads the per-side spec: about 120 in `tick.ts`, `ai.ts`, `aiAir.ts`, `aiEngineering.ts`, `aiSides.ts`, `aiSites.ts`, `air.ts`, `commands.ts`, `engineering.ts`, `mission.ts`, `research.ts`, `state.ts`. What stays global, by rule (below): identity fields, footprints, and catalogue code that knows no side | as listed |
| `unlocked`, `techAllowed` (now also `factionAllows`), `costFor`, `addUnit`, `addBuilding`, `powerOf`, `visibility`, research's `hpMulFor` (now `hpMulFor(s, id, u)`) and `upgradeNewUnit` read the per-side spec. **New: `buildTicksFor(s, owner, kind)`**, used by production, `readyStructure`, the sidebar and the renderer. `costOf(kind)` and `buildTicksOf(kind)` stay as the catalogue's (Meridian's) numbers | `src/sim/state.ts`, `src/sim/research.ts`, `src/sim/tick.ts`, `src/game/Sidebar.tsx`, `src/game/renderer.ts` |
| `addUnit` stores `maxHp` whenever full health differs from `UNITS[kind].hp` (a perk, or an army's overlay), so `maxHpOf(u)` and the renderer need no side | `src/sim/state.ts` |
| `airRoleOf(u)`; `updateAircraft`, `rearm` and `migrateAir` branch on the role, never on `'gunship'` or `'bomber'`; `aiAir.ts`'s strike code (which aircraft go on a strike) likewise. Which kind the computer *queues* still names `'gunship'` and `'bomber'` (A's) | `src/sim/air.ts`, `src/sim/aiAir.ts` |
| Per-side perks: `perksFor(s, owner)`; the six `owner === 0 && s.perks` checks (`addUnit`, `costFor`, production's build speed, the refinery's harvest, `heroMaxHp`, `doPower`) and the campaign HUD go through it. Storage below | `src/sim/specs.ts`, `src/sim/state.ts`, `src/sim/tick.ts`, `src/sim/mission.ts`, `src/components/CampaignHud.tsx` |
| `GameState.sidePerks?: Partial<Record<Owner, Perks>>` (sides 1 to 3) | `src/sim/types.ts` |
| `Unit.squad?: number`; `GameState.squads?: Squad[]`; `Squad = { id, leader, shape: FormationShape, members: number[] }`; read by nothing. `cloneState` copies squads one level deep (member lists too) | `src/sim/types.ts`, `src/sim/state.ts` |
| `migrateRound6` (called from `migrateState`): an unknown `faction` on a player is dropped; `sidePerks` keeps well-formed perks for sides 1 to n - 1 only (side 0 and junk dropped; none left: removed); `squads` keeps a squad with integer id (unique), integer leader among its integer members and a known shape (none left: removed); a unit's `squad` is dropped unless it names a kept squad | `src/sim/state.ts` |
| `GameAction`: `move` gains `formation?: FormationShape`, and `{ type: 'formation'; ids: number[]; shape: FormationShape }` is new. Until D handles them the reducer refuses both (a move that carries a `formation` returns the same state; `'formation'` falls to the default). No `recruit` action: recruiting a hero or a General goes through `'queue'`, as every unit does (section 4, 5) | `src/sim/types.ts`, `src/sim/actions.ts` |
| `keptBack(s, u)` in `ai.ts`: units the wave, raid and retreat code leave alone because a plan of their own commands them. Returns `false` (so `army` is every armed unit, as before); B's and C's lines go between their markers in it | `src/sim/ai.ts` |
| Harness stubs, each exporting `sections` as `drive-maps.ts` does, with the groundwork's assertions: `scripts/drive-factions.ts` (setups, per-side specs, old saves and missions), `scripts/drive-heroes.ts` (heroes stay out with heroes off), `scripts/drive-generals.ts` (perks for every side, `sidePerks` in saves), `scripts/drive-formations.ts` (squads in saves, the two refusals). Imported and run by `scripts/drive.ts` | `scripts/` |
| Marker comments (`round6:A` to `round6:D`, mostly `begin` and `end` pairs) at every place a workstream adds lines to a shared file | see section 2 |

### Rules the groundwork fixes, which every workstream keeps

- **Meridian is today's army, exactly.** `FACTION_OVERLAY.meridian` stays empty, and
  `FACTION_MENUS.meridian` only adds its signature Sapper (`add: { infantry: ['sapper'] }`, after
  workstream A; the integration settled it, since a signature unit must be in its army's `add` list
  for `factionAllows` to keep it Meridian's). `unitSpecFor('meridian', k)` returns the very object
  `UNITS[k]` (the harness asserts reference equality). `menuOf('meridian', c)` is `MENUS[c]` in
  order, then the Sapper on Infantry, then this round's recruits (the field General, then the
  heroes), which close every army's lists so that no key in use moves when Heroes or Generals are on.
- **An army changes numbers, never a kind's identity.** `UnitOverlay` cannot hold `category`, `hero`,
  `medic`, `mender`, `deploysTo`, `stealth` or `airRole`; `BuildingOverlay` cannot hold `w`, `h`,
  `wall` or `undeploysTo` (the types forbid it and the harness asserts it). So code that asks only
  those questions (the many `UNITS[u.kind].category` checks in hot loops, `isAir`, `isStructure`,
  occupancy and footprints, the Spy and stealth tests) keeps reading `UNITS` and `BUILDINGS`, and is
  right for every army. A different role is a different kind: the Ashen aircraft and signature
  units are new `UnitKind`s, not overlays.
- **Overlays merge shallowly.** An overlay's `weapon` replaces the whole `Weapon`; write it as
  `{ ...UNITS.tank.weapon!, range: 4.75 }`. Merged specs are cached per army and kind (constant
  data, so no battle state is held).
- **Signature items belong to their army.** A kind any army lists in `FACTION_MENUS[f].add` is fielded
  only by the armies that add it (`factionAllows`, inside `techAllowed`); `remove` takes a kind off
  an army's lists and out of its reach.
- **Old saves and setups.** A setup without the new fields reads as every seat Meridian, heroes off,
  Generals off, no doctrine General; a player without `faction` is Meridian; a state without
  `sidePerks` or `squads` has none. A save from before round 6 loads and plays byte-identically to
  the same battle saved now (asserted for two-, four-sided and legacy battles over 3,600 ticks).
- **Missions are untouched.** Nothing from this round appears in a mission: a mission state has no
  `faction`, `sidePerks` or `squads` (asserted for every mission in `MISSIONS`), no new kind joins
  `STANDARD_TECH` (so `techAllowed` keeps every new kind out of every mission and every
  standard-tech skirmish), and nothing new runs `if (s.mission)`. `s.perks` is still exactly the
  campaign's Commander perks in a mission.
- **Every new kind is advanced tech**, and reaches the build window only as data: a kind in a union,
  a spec in `UNITS` or `BUILDINGS`, and an entry in `MENUS` (via `BUILD_MENU`, `INFANTRY_MENU`,
  `VEHICLE_MENU`, `AIR_MENU`) or in an army's `FACTION_MENUS[f].add`.
- **Per-side perks: storage.** `s.perks` keeps meaning side 0's perks (the campaign's Commander perks,
  and from round 6 also a skirmish doctrine General's for side 0). Sides 1 to 3 keep theirs in
  `s.sidePerks[owner]`, which never holds side 0. Read both only through `perksFor(s, owner)`.
  Chosen over turning `s.perks` into a record because every campaign save, the campaign layer
  (`createMissionState`, `missionContext`), the campaign HUD and the harness's mission tests write
  and read `s.perks` as one `Perks`: they stay exactly as they are and need no migration. Perks are
  replaced whole, never edited in place (`cloneState` shares them).
- **No randomness from the battle's stream at setup.** Anything chosen at random when a battle is
  made (a computer seat's General, say) uses a generator seeded from `s.rngSeed` and a constant, never
  `s.rngSeed` itself, as `placeSites` does, so a setup option left at its default changes nothing.
- **Hotkeys.** Every letter already has a job: build keys Q W E R T Y U I J K L B N D; A, S, G, H,
  M, O, P; F (the selection's command in a skirmish, the hero's ability in a mission); Z X C V (the
  heroes, campaign only until B). Also taken: Tab, Space, Esc, Home, `?`, the backquote, 1 to 9
  (control groups). Free: **0**, **.** (period), **,** (comma), `/`, `;`, `'`, `[`, `]`, `-`, `=`,
  `\`. This round assigns: **B** Z X C V and F in a skirmish with heroes on (as in the campaign; F
  runs the ability only when the selection is exactly one hero, else the selection's command as
  today); **C** the **0** key, select your General (twice: jump to it), with Ctrl+0 left free;
  **D** the **period** (`e.code === 'Period'`), set the selection's formation, cycling line, column,
  wedge, box and none, with Shift+period cycling back. Nothing else takes a key.

### The non-regression rule for this round

These lines of `npm run drive` (run from `packages/fireline`) were measured before and after the
groundwork; the baseline file is `drive-baseline-summary.txt` in the coordinator's scratchpad, and
every summary line (every line starting with two spaces) is identical:

```
  mission battle 1: lost (Time ran out.) at tick 20000 (33.3 min), 167 kills, 164 losses
  mission battle 2: won at tick 7498 (12.5 min), 112 kills, 35 losses
  mission battle 3: won at tick 9738 (16.2 min), 137 kills, 62 losses
  26/28 battles finished, average 20.6 game minutes; side 0 won 15, side 1 won 11
  12/12 finished, average 26.2 game minutes; side 0 won 4, side 1 won 8
    classic: side 1 in 30 min, side 1 in 18 min
    river: side 1 in 25 min, side 0 in 25 min
    highlands: side 1 in 37 min, side 1 in 31 min
    lakes: side 1 in 21 min, side 0 in 32 min
    plains: side 1 in 18 min, side 0 in 17 min
    canyon: side 0 in 29 min, side 1 in 32 min
  units standing at the end with rank: 117 veterans, 38 elites; at least 562 survivors walked out of fallen structures
```

plus the sides block ("12/12 finished, average 21.8 game minutes" and its twelve lines), the air
battle, the engineering battle, the tier-three battle and the larger-maps lines. The assertion count
rose only by the groundwork's own assertions (section 7 has the numbers).

- **The mission lines, the standard-tech line and the campaign check are everyone's**: no workstream
  may change them. `npm run campaign-check` passes with all fourteen missions unchanged.
- **A** changes no line: every default battle is Meridian against Meridian, and Meridian's specs,
  menus and computer choices are today's. A's own balance battles live in `drive-factions.ts`.
- **B** changes no line: heroes are off by default.
- **C** changes no line: Generals are off and every doctrine pick is none by default.
- **D** may move the advanced-tech lines only (the "12/12" map-type line and its six map lines, the
  advanced battles in the sides block, the air, engineering, tier-three and larger-maps battles),
  because the computer's waves form up in advanced battles. Its computer formations run only when
  `adv` is true (never a mission, never standard tech), and a move without a `formation` is exactly
  today's spiral. D reports its new lines in its build-log entry.
- Each workstream's harness sections add at most 60 seconds to `npm run drive`.

Run `npm run drive` before you start and keep the output, so the comparison is exact.

---

## 2. Shared files and how each is touched

A shared file is edited only where this table says. "Marker" means a comment already in the file
reading `round6:A`, `round6:B`, `round6:C` or `round6:D`, either alone (put your lines directly
under it) or as a `begin` and `end` pair (put your lines between them; where the pair wraps existing
lines, you may change those lines). Never write under another workstream's marker, and leave every
marker in place, round 5's included.

| File | A (two armies) | B (heroes) | C (generals) | D (formations) |
|---|---|---|---|---|
| `src/sim/rules.ts` | `UnitKind` and `BuildingKind` markers; `UNITS`, `BUILDINGS` markers; its end-of-file block (`FACTION_OVERLAY`, `FACTION_MENUS`, doctrines, constants); `AIR_AMMO` and `REARM_TICKS` may gain entries for its new aircraft (one line each, appended inside the literal) | `BuildingKind` marker; `UNITS` and `BUILDINGS` markers; `BUILD_MENU`, `INFANTRY_MENU`, `VEHICLE_MENU`, `ALSO_PRODUCES` markers; its end-of-file block | `UnitKind`, `BuildingKind`, `UNITS`, `BUILDINGS`, `BUILD_MENU`, `INFANTRY_MENU` markers; its end-of-file block (`GENERALS`, aura numbers) | Its end-of-file block |
| `src/sim/types.ts` | `Effect['kind']`, `AiMemory` markers | `Unit`, `Building`, `PlayerState`, `AiMemory` markers | `Unit`, `Building`, `PlayerState`, `Effect['kind']`, `AiMemory` markers | `Unit`, `Squad`, `AiMemory`, `GameAction` (the `formation` action) markers |
| `src/sim/specs.ts` | Owner: the merge (`unitSpecFor`, `buildingSpecFor`, `menuOf`, `factionAllows`) may change, keeping every name and the rules of section 1 | None | None | None |
| `src/sim/state.ts` | None | `techAllowed` marker; the `costFor` marker (its `base` line); `migrateRound6` marker | `techAllowed` marker; `createInitialState` marker (doctrine perks: `s.perks` for side 0, `s.sidePerks` for the rest); the `costFor` and `addBuilding` markers; `migrateRound6` marker | `cloneState` marker; `migrateRound6` marker |
| `src/sim/tick.ts` | None (its numbers arrive through the specs) | The hero-tick marker in `step` (the `if (s.mission) heroes(s, ctx)` condition may widen) | The aura marker in `step` (one call line); the aura marker in `updateUnit`'s firing (damage and reload multipliers beside veterancy's, applied only inside an aura); production's build-speed marker | The keep-pace marker in `stepAlong` (one lookup capping a squad member's speed) |
| `src/sim/commands.ts` | None | `canQueue`'s hero marker (the refusal may relax with `setup.heroes`; the one-of-each limit) | `canQueue`'s General marker (one per side, the replacement cooldown) | `doMove`'s marker (slots from `slotsFor` when given a shape); its block after `formation()` (`slotsFor`, role order, the `formation` action's check and work, or a `formations.ts` of its own) |
| `src/sim/actions.ts` | None | Its case marker (none expected) | Its case marker (none expected) | The `move` case's marker (validate `formation`, pass it on) and the `'formation'` case marker |
| `src/sim/ai.ts` | The `round6:A` block in `commander` (the standard and advanced unit choices), and the lists inside `advancedUnits` and `nextStructure`, by army; Meridian's stay exactly as they are | `keptBack`'s marker; one call line after `sitesPlan` | `keptBack`'s marker; one call line after `sitesPlan` | The three wave `doMove` markers (gather, attack, regroup) |
| `src/sim/aiAir.ts` | Owner (per-army air counts; queue its aircraft by role) | None | None | None |
| `src/sim/aiSites.ts` | None | The `!UNITS[u.kind].hero` line in the capture-party filter (line 164) may change | None | None |
| `src/sim/air.ts` | Owner of anything an aircraft variant needs beyond its role (an incendiary patch on a new weapon kind, for instance) | None | None | None |
| `src/sim/mission.ts` | None | Owner of `heroMaxHp`, `setMaxHp` and the hero ability code, for anything a skirmish hero needs (the campaign's behaviour unchanged) | None | None |
| `src/sim/sides.ts`, `map.ts`, `maps.ts`, `grid.ts`, `sites.ts`, `engineering.ts` | None | None | None | None (D reads `grid.ts`, never edits) |
| `src/game/Sidebar.tsx` | Owner of the build lists and stat tips (`menuFor`, `nameOf`, `blurbOf`, `needsOf`, the stat tip): to `menuOf` and the per-side specs | Its marker in the selection panel | Its marker in the selection panel | Its marker beside Stance (the formation row) |
| `src/game/techTree.ts`, `src/game/BuildWindow.tsx` | Owner (`RULES_CATALOGUE` becomes a function of the army) | None | None | None |
| `src/game/art.ts` | Its markers in `drawUnit`'s and `drawBuilding`'s switches and its block at the end | Its marker in `drawBuilding` and its block at the end | Its markers in `drawUnit` and `drawBuilding` and its block at the end | None |
| `src/game/icons.ts` | Owner of new cases (army tint by token) | Its new structure's icon, appended | Its General's icon, appended | None |
| `src/game/renderer.ts` | Owner of any army tint | None | The aura ring (one call, after the units pass) | The squad's slot marks (one call, after the units pass) |
| `src/pages/GameScreen.tsx` | `costOf` in the "Insufficient funds" toast becomes `costFor` (one line) | The hero-keys block and the hero-bar block, between its markers; its key-table marker | The `0` key marker, the General button marker, its key-table marker | The period key marker; its key-table marker |
| `src/components/SkirmishSetup.tsx` | The Army row marker | The Heroes field marker | The Generals field marker | None |
| `src/pages/HowToPlay.tsx` | Under its marker; owner of the per-army stat tables | Under its marker | Under its marker | Under its marker; one Controls row (the period) |
| `src/styles.css` | Under its own heading at the end | Same | Same | Same |
| `scripts/drive.ts` | None (its import and section lines are in) | Same | Same | Same |
| `fireline-design.md` | Its own build-log entry, appended | Same | Same | Same |
| `fireline-improvements.md` | A line, ticked, with lines under it | Same | Same | Same |

New files each workstream owns outright:

- **A**: `scripts/drive-factions.ts` (keeping the groundwork's three sections), and an
  `src/sim/aiFactions.ts` if the per-army choices outgrow the marked lines; `scripts/ai-ladder.ts`'s
  `--factions` option.
- **B**: `src/sim/heroes.ts` (recruit limits, revive, the skirmish hero tick's extras),
  `src/sim/aiHeroes.ts` (`heroPlan`), `scripts/drive-heroes.ts` (keeping the groundwork's section).
- **C**: `src/sim/generals.ts` (doctrine perks, the aura scan, death and replacement),
  `src/sim/aiGenerals.ts` (`generalPlan`), `scripts/drive-generals.ts` (keeping the groundwork's section).
- **D**: `src/sim/formations.ts` (`slotsFor`, facing, squads), `scripts/drive-formations.ts`
  (replacing only the two refusal assertions between its markers).

Each `scripts/drive-*.ts` exports `export const sections: [string, (ok: Ok) => void][]` with
`type Ok = (cond: unknown, what: string) => void`, and copies any helper it needs from `drive.ts`
rather than exporting it.

### Overlaps, settled here

- **B and C both add a recruitable unit, a structure perhaps, art, a setup field and a button near the
  hero bar.** Each has its own markers in every one of those places (unions, `UNITS`, `BUILDINGS`,
  menus, `techAllowed`, `canQueue`, `keptBack`, the call lines in `ai.ts`, `art.ts`, the setup
  screen, the selection panel, `GameScreen.tsx`). B owns the hero bar itself; C's General gets a
  button of its own beside it (its marker follows B's block), not a slot in the hero bar.
- **C's field General leans on D's squads** ("a squad led by the General keeps formation tighter").
  C must not import D's code or read `s.squads` beyond the declared `Squad` type: C ships the
  doctrines, the unit, the aura, death and replacement, and the computer's General. The link (a
  squad whose leader is a General) is the integrator's, after both land (section 7).
- **A and C both touch prices.** A's army prices are in the specs; C's doctrine is a `Perks` bundle
  applied on top through `perksFor`. A General's "tanks and Bastions 10% cheaper" is not a whole-army
  `costMul`: C adds what it needs to `Perks` as optional fields (so every saved `Perks` stays valid)
  and reads them between its markers in `costFor` and `addBuilding` (`state.ts`) and in production's
  build speed (`tick.ts`), or in `generals.ts` helpers called from there.
- **A and D both touch the computer.** A owns which units are built; D owns how waves move. Neither
  edits the other's marked lines.
- **B's heroes and the computer's waves.** `keptBack` decides whether a hero joins the wave (the Ace
  may; the Spy and Engineer run their own errands). B decides, in `keptBack` and `heroPlan`.

---

## 3. Workstream A: two armies

Meridian Corps keeps today's exact stats. Ashen Combine is the variant: "slightly different", so
overlays of roughly 10 to 15 percent, plus one signature item each, plus its own aircraft.

### Rules (`src/sim/rules.ts`, inside A's markers)

- Doctrines on paper first, in the build log: Meridian heavier and slower (armour, range, static
  defence: the Bastion and Fortress as identity; air: today's Gunship and Bomber). Ashen lighter,
  faster, cheaper: about 10% less health, 10 to 15% more speed, 10% cheaper infantry and light
  vehicles, slightly shorter range on heavy guns.
- `FACTION_OVERLAY.ashen` holds the numbers (`units` and `buildings`, `UnitOverlay` and
  `BuildingOverlay`). `FACTION_OVERLAY.meridian` stays `{}`.
- Signature units, one each: new `UnitKind`s with specs in `UNITS` (between A's markers), listed in
  `FACTION_MENUS[f].add` for their army only (for example Meridian's Sapper squad that lays mines,
  Ashen's Raider bike, fast and fragile). Starting ids: `sapper`, `raider`. As built:
  `FACTION_MENUS.meridian.add.infantry` is `['sapper']` (so Meridian's menus are not quite empty;
  section 1 says so), and the Sapper carries satchel charges rather than mines.
- Aircraft: new kinds `kestrel` (`airRole: 'strafe'`: less health, more loads in `AIR_AMMO`, quicker
  rearm in `REARM_TICKS`) and `firebrand` (`airRole: 'bomb'`, trading splash for an incendiary patch;
  if that needs a new `WeaponKind` or effect, A adds it with its `DAMAGE_VS` row, `FLIGHT_TICKS` and
  `Effect['kind']`). Ashen's `FACTION_MENUS.ashen` removes `gunship` and `bomber` and adds both.
- Every new kind is advanced tech (not in `STANDARD_TECH`) and needs the same structures its
  Meridian counterpart does.

### Engine

Nothing to change in `tick.ts` or `air.ts` for numbers: they arrive through `unitSpecOf` and
`buildingSpecOf`. A new behaviour (the incendiary patch, the Sapper's mines) goes in a file of A's
own, called on a line A adds under a marker it asks the integrator for, or (preferred) folded into
an existing role. `migrateAir` already keeps any aircraft's ammunition sane by `ammoMax`.

### Interface

- Setup: an "Army" row per seat under A's marker in `SkirmishSetup.tsx`, each choice with a one-line
  doctrine; it writes `setup.factions` (on a change of `sides`, run the setup through
  `normaliseSetup` to resize the per-seat lists). Stored by `storeSetup`, read back by
  `readStoredSetup` already.
- Build window and sidebar: `menuFor` reads `menuOf(factionOf(state, 0), tab)`; names, costs,
  blurbs, requirements and stat tips read `unitSpec(state, 0, k)` / `buildingSpec(state, 0, k)` /
  `costFor`. `techTree.ts`'s `RULES_CATALOGUE` becomes `rulesCatalogue(faction)`; `BuildWindow.tsx`,
  `HowToPlay.tsx` (a per-army table), `selectionActions.ts` (identity fields only: no change needed)
  and `GameScreen.tsx`'s funds toast follow.
- Art: cases in `art.ts` for each new kind, and `icons.ts`; an army's tint is a token in both blocks
  of `styles.css` (`--army-ashen-*`), never hex.

### Computer

Per-army build mixes inside the `round6:A` block of `commander` and in `advancedUnits` and
`nextStructure`; per-army air counts and kinds in `aiAir.ts` (queue by role: an army's `'strafe'`
and `'bomb'` kinds from `menuOf`). Meridian's choices stay exactly as they are (the default battles
prove it). The frozen ladder commanders (`scripts/ai-prev.ts`, `scripts/ai-baseline.ts`) stay
Meridian and keep reading `UNITS`.

### Tests (`scripts/drive-factions.ts`)

- The groundwork's three sections stay. Add: the overlay merge (every Ashen number is the overlay's
  or the catalogue's), menus per army, signature items refused to the other army (`canQueue`),
  aircraft variants fight by role (a Kestrel strafes, a Firebrand bombs), an Ashen side's prices,
  build times, health and speed measured in a battle, old saves read Meridian, missions untouched.
- A whole Ashen-against-Meridian battle from each seat plays to a finish and replays
  byte-identically.
- `npm run ladder:fire -- --factions`: 150 or more seeds **from both seats** (the Normal mirror already
  shows about 75% for side 1 from seat alone). Target: Meridian against Ashen within 45 to 55% once
  seat is netted out. Reported in the build log.

---

## 4. Workstream B: heroes in free play

This reverses a documented campaign decision (`fireline-campaign-design.md`), so it ships behind a
setup option, off by default. The campaign stays exactly as it is.

### Rules (`src/sim/rules.ts`, inside B's markers)

- `setup.heroes` (groundwork) turns it on; only on advanced tech (`techAllowed`'s B marker refuses a
  hero in a skirmish unless `setup.heroes && setup.tech === 'advanced'`; a mission's own rules are
  untouched). Greyed on standard tech in the setup screen.
- Recruitment: a new structure, the Command Academy (`academy`, needs `techcentre`), or the Tech
  Centre itself as producer; B decides and states it. Through `'queue'` like any unit: heroes are
  `infantry` (Spy, Commando, Engineer) and `vehicle` (Ace) kinds already, listed under B's markers in
  `INFANTRY_MENU` and `VEHICLE_MENU` (techAllowed keeps them out of every list unless heroes are on).
  If the Academy is to produce them, B gives it a queue through `ALSO_PRODUCES` (its marker) or a
  rule of its own; B states which. Starting costs: Engineer 1000, Spy 1200, Commando 1800, Ace 2500.
  The campaign's hero specs keep their numbers (missions never price a hero), so a skirmish price is
  B's constant `HERO_RECRUIT_COST: Record<HeroKind, number>`, read in `costFor` between B's markers
  (around its `base` line), so `costFor` stays the one function that prices a queue.
- Limit: one of each hero per side, standing plus queued (the `fieldYardsOf` pattern).
- Revive: a fallen hero may be recruited again after `HERO_REVIVE_TICKS` (start 900, 90 seconds) at
  half cost; the timer lives on `PlayerState` (B's marker), repaired in `migrateRound6`.
- A recruited hero gets `hero: { level: 1, xp: 0, abilityCd: 0 }` (today only `mission.ts` builds
  one) and its full health from `heroMaxHp`.

### Engine

- The hero tick (`heroes(s, ctx)`) runs in a skirmish with heroes on (`tick.ts`'s B marker); every
  hero ability works there as in a mission, against any enemy side (through `sides.ts`).
- Ability targets, capture and the Spy's detection keep their mission rules.

### Interface

- Setup: "Heroes: Off / On" under B's marker.
- The hero bar, Z X C V and F show in a skirmish with heroes on (B's blocks in `GameScreen.tsx`);
  F runs the ability only when the selection is exactly one hero, else the selection's command as
  today.
- The build window: a tooltip on the Repair Truck and Forward Base Truck saying they are the free
  play engineering units ("the engineer" question), through the stat tip's blurb.

### Computer (`src/sim/aiHeroes.ts`, `heroPlan`)

Recruits heroes when on; `keptBack` returns true for those its plan commands. First behaviours:
the Engineer captures an undefended structure or neutral site; the Commando, escorted, goes for a
lone structure; the Ace joins the main wave (`keptBack` false for it); the Spy reveals before an
attack. All choices deterministic (seeded draws only).

### Tests (`scripts/drive-heroes.ts`)

The groundwork's section stays (with heroes off nothing changes). `drive.ts`'s campaign refusal
assertion (`drive.ts`, "Heroes are campaign characters") stays true for missions. Add: acceptance
with heroes on and advanced tech; refusal on standard tech; one of each; the revive timer and half
cost; a skirmish hero levels and uses its ability; save and replay byte-identical; the computer
recruits and uses heroes in a long battle with heroes on; missions unchanged.

---

## 5. Workstream C: generals

### Doctrine Generals (the first layer)

- `GENERALS: Record<GeneralId, GeneralSpec>` in C's block: name, army (must match
  `GENERAL_FACTION`), blurb, its perks and its one support-power tweak. Starting numbers:
  - Hale (Meridian, Fortress): structures +10% health, turrets build 20% faster.
  - Voss (Meridian, Armour): tanks and Bastions 10% cheaper, slower harvest.
  - Kade (Ashen, Blitz): vehicles +10% speed, power cooldowns 15% shorter.
  - Ilse (Ashen, Air): Helipad 25% cheaper, aircraft rearm 20% faster.
- `setup.generalPicks[seat]` chooses; `null` is none (and the default, so no line moves). A
  "Random" choice in the setup screen, if offered, is resolved when the battle is made, from a
  generator seeded from `s.rngSeed` and a constant (section 1). At `createInitialState` (C's marker)
  the pick becomes perks: side 0's in `s.perks`, others' in `s.sidePerks[owner]`; every reader goes
  through `perksFor`. Perks that are not one of today's six multipliers are new optional `Perks`
  fields (section 2, overlaps).

### The field General (the second layer, `setup.generals`)

- One General unit per side (`general`, C's `UnitKind`), recruited through `'queue'` (from the
  Barracks, or the HQ if C gives it a spawn rule of its own; C states which), one standing or queued
  per side (`canQueue`'s C marker).
- Command aura: friendly units within `GENERAL_AURA_RANGE` (start 6 tiles) deal +10% damage and fire
  10% faster. The scan runs every `GENERAL_AURA_TICKS` like the Medic's (`tick.ts`'s C marker in
  `step`) and marks units in range; the multipliers apply at C's marker in `updateUnit`'s firing,
  beside veterancy's, only for a marked unit. Two Generals' auras do not stack.
- If the General falls, the aura is lost and the doctrine perks halve (replaced, never edited in
  place) until a replacement is recruited, after `GENERAL_REPLACE_TICKS` (start 1200, 120 seconds).

### Interface

- Setup: a General choice per seat (only its army's two, and none) and "Generals: Off / On", under
  C's marker.
- A General button beside the hero bar (C's marker in `GameScreen.tsx`), the `0` key, the aura drawn
  as a ring (`renderer.ts`, one call), How to play's panel.

### Computer (`src/sim/aiGenerals.ts`, `generalPlan`)

Keeps its General with the main wave, behind the front rank, and retreats it below 40% health;
`keptBack` returns true for it.

### Tests (`scripts/drive-generals.ts`)

The groundwork's section stays. Add: each doctrine's perks on its side alone (`perksFor`); a pick
from the other army refused; the aura's numbers measured, not stacking; death, halved perks and
replacement; the computer's retreat rule; save and replay byte-identical; missions unchanged.

---

## 6. Workstream D: formations and squads

### Rules and engine (`src/sim/formations.ts`, D's markers)

- `slotsFor(shape, n, facing)`: integer offset tables for line, column, wedge and box. Facing is the
  group's centroid to the target, snapped to eight directions with no trigonometry (compare `dx`,
  `dy` and their ratio against 2.414 and 0.414 as integers or exact fractions), so replays stay
  exact.
- `move` with a `formation`: validated against `FORMATION_SHAPES` (anything else: the same state
  back); slots by role then id: armour in front, infantry behind, artillery and support at the rear,
  Medics and Repair Trucks in the middle. Without one: today's spiral, exactly.
- `{ type: 'formation', ids, shape }`: forms these units up where they stand (around their
  centroid), as a squad.
- Squads: units given a formation share a squad (`Unit.squad`, `s.squads`, ids from `s.nextId`).
  The leader paths; the others steer to the leader's position plus their slot, refreshed every
  `SQUAD_REFRESH_TICKS`. Keep pace: in `stepAlong`, a squad member's speed is capped at the squad's
  slowest member's (D's marker; one lookup, no pathing change). A squad dissolves when it is down to
  one member or its members are given other orders; `migrateRound6`'s D marker drops dead members
  and re-picks a fallen leader.
- Control groups: into the save (a `controlGroups?` field of D's, or client storage per save; D
  states which) and reachable on touch as a row of group chips in the selection panel.

### Interface

- A formation button row beside Stance in the sidebar (D's marker); on touch, in the selection
  panel. No two-finger rotate (it clashes with pinch zoom), no long-press (iOS).
- The period key cycles the selection's formation (section 1).

### Computer

The wave forms a wedge to attack and a box when regrouping (the three `doMove` markers in `ai.ts`),
only when `adv` is true.

### Tests (`scripts/drive-formations.ts`)

Slots deterministic and passable, no slot repeated, facing correct for all eight directions, a squad
arrives within N ticks of its slowest member, an invalid shape returns the same state, squads in
saves (the groundwork's checks), replay byte-identical. `npm run tours -- fireline-touch` still
passes.

---

## 7. Integration

Merge order **A, B, C, then D**. A, B and C move no harness line (section 1), so after each of
those three merges every summary line must still match the baseline exactly; D moves only the
advanced lines and is merged last so its numbers are measured once, on everything else. After each
merge: `npx tsc --noEmit -p packages/fireline`, `npm run drive` (compare with section 1 and each
workstream's stated changes), `npm run campaign-check`; at the end `npm run check`,
`npm run ladder:fire` over 150 seeds from both seats (faction balance and every AI change), `npm run
tours fireline fireline-touch`, `npm run check:loading` if a palette or loading state changed, and a
browser run of an Ashen-against-Meridian battle with heroes and Generals on, in light and dark mode,
on desktop and a phone.

Seams the integrator closes, none of which a workstream should pre-empt:

- **The General leads a formation** (C and D): a squad whose leader is a General keeps formation
  tighter and moves at the squad's pace without straggling; the computer's General leads its wave's
  squad.
- B's heroes and C's General both near the hero bar: one row, laid out together.
- A's armies and B's heroes: whether an Ashen side's heroes differ (the plan says no; the overlay
  could reach them, since a hero's identity fields are fixed but its numbers are not).
- A's Kestrel and Firebrand and C's Ilse (Air): the doctrine applies to the army's own aircraft,
  which it finds by `airRole`, never by kind name.
- D's formations and A's signature units: the role order in `slotsFor` must place the Sapper and the
  Raider (by category and spec, not by name).
- Build log entry in `fireline-design.md`; How to play updated for armies, heroes, Generals and
  formations.

### The groundwork's own numbers

`npm run drive` after the groundwork: every summary line identical to the baseline (diffed), 0
failed. The assertion count rose by the groundwork's own assertions only (the stubs' sections: setups,
per-side specs, old saves and missions, heroes off, perks for every side, squads and formation
orders), and the run takes about 4 seconds longer.
