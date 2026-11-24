# Fireline round 7: structure upgrades and strategic structures

Build log for the round-7 structures workstream, for the integrator to merge into `fireline-design.md`.
Every addition to a shared file is wrapped in `// round7:structures begin` / `end` (or carries a
`round7:structures` comment on a one-line change).

**Base.** The worktree was cut from `main` at f0c993e, which predates the industry, supply-lines and
territory work the brief describes. It was fast-forwarded to `claude/admiring-sagan-r2d60p` (572ac12,
the main checkout's branch, 29 commits ahead, a strict descendant) before any work began.

## The two toggles

- `setup.structureUpgrades` and `setup.strategicBuildings`, after `territory` in every setup.
- **Absent reads as off, whatever the base.** `normaliseSetup` keeps each only when it is exactly
  `true` and the tech is advanced, never from the base, so every older save, every partial setup
  (the harness's and the ladder's) and every standard-tech battle plays exactly as before.
- `DEFAULT_SETUP` states both **on** (the lobby offers them on); `LEGACY_SETUP` states both off;
  `buildPlanetBattle` states both off (another workstream turns them on for planet wars); a mission
  has no setup, and `upgradesOn` / `strategicOn` refuse a mission even with the flags forced on.
- Consequence: `normaliseSetup({})` is no longer exactly `DEFAULT_SETUP`. The four tests that said so
  (`drive.ts`, `drive-lines.ts`, `drive-size.ts`, `drive-factions.ts`) now compare with
  `{ ...DEFAULT_SETUP, structureUpgrades: false, strategicBuildings: false }` and say why.
- Lobby: two Off/On rows under Generals in step 3 (`src/components/StructuresSetup.tsx`), greyed on
  standard tech; the orders summary names both. A setup stored before them reads as on (the default).

## A. Structure upgrades

A structure in `STRUCTURE_LEVELS` (rules.ts) may be raised a level with `{ type: 'upgradeStructure', id }`
and the work stopped with `{ type: 'cancelUpgrade', id }`. `Building.level` (absent reads 1) and
`Building.upgrade` (`{ progress, credits, alloys? }`, the work under way and what it cost).

- **Paid at once**, in credits; with industry on, 25% of the price in alloys (`UPGRADE_ALLOY_SHARE`).
- **Takes time**: a tick of work a tick, half a tick while the side is short of power.
- **Keeps working** at its current level meanwhile, but takes **25% more damage** (`UPGRADE_DAMAGE_TAKEN`)
  until it is done: the risk the player accepts. Destroyed mid-upgrade, the price is lost.
- **Cancel** (or sell) pays every credit and alloy back. One upgrade per structure at a time.
- A finished level adds its extra health on top of what the structure has (damage taken stays taken).
- Numbers are read through `buildingSpecOf` (specs.ts, `levelledSpec`, cached per army, kind and
  level), so health, weapons, power and sight follow everywhere at once; the spec's `cost` counts every
  level paid, so selling and repairs value it. Production speed, unloading and income are read in
  tick.ts (`levelRateOf`, `unloadMulOf`, `loadIncomeMulOf`).
- Refused with the same state: toggle off, not yours, no such id, a kind without levels, already
  upgrading, at the top, short of credits or alloys; cancel with nothing under way.

### The levels, and why each is a trade against another copy

Every multiple is the total at that level against level 1.

| Structure | Level | Price | Time | What it gives | Against another copy |
|---|---|---|---|---|---|
| Gun Turret (600) | Mk II | 350 | 9 s | +0.75 range (6.25, outranging tanks by 1.5), health x1.4 | A second turret doubles the fire but draws 25 power and needs ground; Mk II adds no fire, only reach and staying power |
| | Mk III | 450 | 12 s | damage x1.35, health x1.8, 10 more power drawn | 800 for both levels against 600 for a copy: one strong point, one target |
| Rocket Turret (900) | Mk II | 550 | 11 s | reload x0.75 (a third more fire), health x1.4 | +33% fire for 550 and no power, against +100% for 900 and 40 power |
| Flak Cannon (700) | Mk II | 400 | 9 s | +1.5 range (9), health x1.35 | Covers more sky from one place; a copy covers a second place |
| Generator (300) | Advanced | 300 | 12 s | +70 power on the same ground, health x1.3 | Less power per credit than a copy (+100 for 300), but no ground or crew, and all of it lost with one hit structure |
| Refinery (1500) | Expanded | 700 | 15 s | unloads x1.5, +10% from every load, health x1.25 | A copy brings a hauler and a second dock; the upgrade pays back over long games only |
| Barracks (400) | Level 2 | 250 | 8 s | trains x1.3, health x1.25 | A second Barracks is a second line (x2) for 400, 20 power and 2 crew |
| | Level 3 | 350 | 10 s | trains x1.6, health x1.5 | |
| War Factory (1800) | Level 2 | 800 | 15 s | builds x1.3, health x1.2 | A second factory is x2 for 1,800, 40 power and 4 crew; both levels give x1.6 for 1,800 and nothing else |
| | Level 3 | 1000 | 18 s | builds x1.6, health x1.4 | |
| Comms Uplink (1000) | Level 2 | 450 | 10 s | +6 sight | Sight only; the AI sees the whole map, so this is for the player |
| Watchtower (450) | Level 2 | 250 | 6 s | +4 sight, damage x1.5, health x1.4 | Does not push the border out as a second tower would |
| Command Yard (3000) | Level 2 | 1000 | 24 s | structures built x1.25, health x1.35 | The only way to build structures faster |
| | Level 3 | 1400 | 30 s | x1.5, health x1.7 | |

## B. Strategic structures

All four advanced tech only, refused by `techAllowed` without `strategicBuildings`, appended to the end
of `BUILD_MENU` (so nothing already listed moves).

| Structure | Size | Cost | Time | Health | Power | Needs |
|---|---|---|---|---|---|---|
| Fortified Bunker | 2x2 | 700 | 11 s | 1,600 | 0 | Barracks |
| Supply Cache | 1x1 | 250 | 4.5 s | 350 | 0 | Barracks |
| Intelligence Centre | 2x2 | 2,200 | 20 s | 900 | -100 | Comms Uplink |
| Decoy | 2x2 | 200 | 4 s | 250 | 0 | Generator |

- **Fortified Bunker: safety against presence.** `{ type: 'garrison', ids, bunker }` sends infantry
  (not heroes or the General) walking to it (`Unit.entering`; any other order cancels the walk); within
  1.2 tiles they go in, up to 6 (`Building.garrison`, the units as they were, off the field). Inside they
  are untouchable: no artillery, bomb, missile or splash reaches them, and no order can (a move naming
  them is refused). Each fires its own weapon from the centre at 2/3 damage, +1 range, on its own
  reload, rank counting. A Medic inside tends the others. `{ type: 'ungarrison', id }` puts everyone
  out on the ground round it. Sold: out unhurt. Destroyed: they stagger out at half their health
  (anyone with no ground to stand on is lost). Taken by an Engineer: its old garrison is put out. No
  crew walks out of a Bunker. Right-click your Bunker with infantry selected to send them in.
- **Supply Cache: reach against over-extension.** Every 2 s, your (and allies') infantry within 5 tiles
  regain 4 health and vehicles 6. It may be placed near your base as usual **or within 4 tiles of any of
  your ground units**, borders or not: the one structure an army can carry forward. Enemy infantry within
  1.5 tiles with none of yours there take it over in 8 s (the neutral sites' capture rule: contested
  pauses, unattended winds back). At most 4 held and queued. An outpost: keeps no side alive, extends no
  base, sends out no crew.
- **Intelligence Centre: information against army spending.** While standing and powered: an
  Intelligence panel in the sidebar lists every enemy's research (with progress) and every production
  queue (head item and progress, then the rest); enemy structures within 28 tiles are revealed in your
  visibility (and so the explored map); and Decoys within 28 tiles are seen for what they are, by you and
  your allies. Short of power it goes dark.
- **Decoy: deception against economy.** Passes, to every side not on its owner's team, for a structure
  of the owner's choice (`{ type: 'disguise', id, as }`; a Generator until told otherwise). Its owner
  sees the disguise half transparent with a dashed outline. Worth nothing: an outpost, no crew.
  The disguise must be a structure the owner could build in this battle, so a Fuel Well with industry
  off cannot give it away.
  - **Changed from the brief: 2x2, not 1x1.** A 1x1 Decoy cannot look like any structure the computer
    aims its strikes at (all of those are 2x2 or 3x3), and a player would see through it at once. At
    2x2 it passes for any 2x2 structure (Generator, Barracks, Uplink, Tech Centre, Repair Bay, Helipad,
    Research Lab, Fortress, Academy, Bunker, Intelligence Centre, and the economy's when on).
  - **How the computer is fooled.** `apparentKind` / `apparentSpecOf` / `apparentHp` (structures.ts):
    the kind, spec and health a viewer takes a structure to have. Used in the barrage and missile aim
    (`blastWorth`, by the disguise's price and health), the wave's target choice (`pickTarget`), focus
    fire (`focusFire`), the bombers' target (with strategic structures on, a cluster also counts by its
    apparent worth, so a fake Tech Centre draws them), and every unit's and turret's own target pick
    (`acquire`: an armed-looking Decoy, a Fortress, is shot first, as an armed structure is). For every
    other structure these return the structure itself, so nothing changes without Decoys.

## C. The computer (src/sim/aiStructures.ts)

Easy does none of it. Normal and Hard:
- **Upgrades when rich**: with credits beyond a reserve (Normal 1,400, Hard 1,000) plus the price, one
  upgrade at a time (Hard two): a Generator first while power is tight, then the turret of lowest level
  (Normal stops at Mk II), Rocket Turrets, a Refinery; Hard also the War Factory, Flak and, after 30
  minutes, the Command Yard. Never on a structure hit in the last 15 s (it would take more damage).
- **Bunker under artillery pressure**: enemy guns of range 7 or more within 18 tiles of home mark
  pressure; a Bunker joins its plan toward the enemy, and idle infantry at home (not in a wave or raid)
  are sent in. After a minute of quiet they are let out to rejoin the waves.
- **Supply Cache with a forward wave on large and huge maps**: one (two on huge) placed beside the wave's
  middle while it is gathering or attacking.

Hard also builds an **Intelligence Centre** at the Long and Epic paces, and **two Decoys** once a Tech
Centre or Strike Command stands, six tiles to the side of its key structures (so one blast never takes
both), passing for a Tech Centre, then a Research Lab. The extras (Intelligence Centre, Decoys) wait for
the army at home like the other extras.

## D. Screen

- Selection panel: level and the next (price, time, what it gives), the work's progress bar and the
  damage warning, a Bunker's garrison, a Cache being taken, the Intelligence Centre's state, a Decoy's
  look (a select box). Buttons are selection actions: Upgrade, Cancel upgrade, Unload (selectionActions.ts).
  An enemy Decoy shows as its disguise, name, health and stat card.
- Battlefield: gold chevrons for a level, a hazard-striped bar along the foot while upgrading, a
  garrison badge, a capture bar; enemy Decoys drawn as the disguise; art for the four structures (a
  sandbagged pillbox whose slits flash, crates under a tarpaulin with a mending cross, a block with a
  turning dish that stops when unpowered, an inflatable for the build icon).
- Intelligence panel under the Industry gauge. Stat cards list every level and the four structures'
  numbers (structureStats.ts). How to play: an "Upgrades and strategic structures" section.

## E. Checks

`scripts/drive-structures.ts`, twelve sections in `npm run drive` (167 assertions): the setup (presets,
absent off, standard tech off, missions and planet battles); off is the battle as before (absent, off
and standard tech give identical hashes, no round-7 field ever appears); upgrading (price, time, half
speed short of power, cancel, alloys, every refusal, sell mid-upgrade, Mk III); each level measured
(every level's numbers, Mk II reaching a tank Mk I cannot, +70 power, refinery unload ticks and credits,
production x1.3 and x1.6 for Barracks, War Factory and Command Yard, more tiles in sight, 25% more damage
during work, still firing, lost when destroyed); the Bunker (refusals, six go in, orders refused, a
barrage hurting nobody inside against the same six in the open, firing out at 2/3, unload, falling,
selling, capture); the Cache (placement by troops, mending rates, capture and defence, the limit,
outposts not keeping a side alive); the Intelligence Centre (reveal, dark short of power); the Decoy
(refusals, the computer's missile and barrage aimed at a fake Tech Centre and not when its own
Intelligence Centre covers it, enemy artillery firing at a fake Fortress, no crew); the computer's
decisions; three whole battles; replays and saves (byte-identical twice and through a save, an old save
byte for byte, junk repaired, off drops every field); save size on a huge four-sided map.

Toggles off are verified byte-identical against the base tree: a scratch bisect ran the drive-lines
replay battle tick by tick on both trees for 14,000 ticks with no difference. (It found one real bug
first: a dangling `else` in the bomber edit had changed the bombers' choice with the toggles off.)

Existing tests updated to name the new fields and menu entries: `drive-factions.ts` (menu ending),
`drive-lines.ts` and `drive-size.ts` (field order), the four "empty setup is the default" checks,
`drive-size.ts` and `drive-planet-battle.ts` hash strippers, `campaign-check.ts` skirmish-only list.
`scripts/ai-ladder.ts` takes `--structure-upgrades` and `--strategic`.

## F. Results

- `npm run drive:fire`: 402,071 assertions, none failed (167 of them `drive-structures.ts`; 1,720 s on a
  shared machine). `npm run campaign:fire`: 7,699 of 7,699. `npm run drive:planet`: 35,255 of 35,255.
- **Ladder** (`--map random --pace long --seeds 150 --jobs 2`, seat 0 wins / seat 1 wins / unfinished,
  median minutes), with `--structure-upgrades --strategic` against without:

| Match | On | Off |
|---|---|---|
| Hard v Normal | 27% / 72% / 2, median 28.4 | 32% / 67% / 2, median 26.2 |
| Normal v Hard | 8% / 92% / 0, median 24.3 | 3% / 97% / 1, median 20.4 |
| Hard beats Normal, both ways | 59.3% (95% interval 54 to 65) | 64.3% (59 to 70) |

  Read plainly: the difficulty order holds, every row moves within the noise 150 seeds allow (about
  plus or minus 8 points), and battles run two to four minutes longer at the median, which is what a
  long game should gain from turrets that grow and Bunkers that hold. Nothing stalls: unfinished
  battles at the 90,000-tick cap are 2 of 300 either way. Depth with them on: Mk II research reached by
  89% of Normal and 94% of Hard sides (median minute 9.8 and 9.9), so the upgrade spending does not
  starve research.
- **Tuning made.** The first upgrade reserve (Normal 2,200, Hard 1,600 credits) left the computer almost
  never rich enough: in the harness's three whole battles only one side upgraded at all. Lowered to
  1,400 and 1,000, both commanders upgrade in every battle while research depth stays as above.
- **A bug found by the off-equals-before check.** A dangling `else` in the bombers' new branch skipped
  the original scoring with the toggles off, so the drive-lines replay battle diverged at tick 4,464. Fixed
  with braces; a tick-by-tick comparison against the base tree then matched for 14,000 ticks.

## Known gaps

- Not run here: `npm run check:ui`, `npm run tours` and `npm run check:loading` need Playwright, which is
  not installed in this environment. Nothing has been looked at in a browser: the new art, chevrons,
  Intelligence panel, Decoy select box and lobby rows are typechecked only. The build-window tour should
  pass as is (the new structures are listed with the lobby's default, which has them on), but it is unrun.
- The bombers' choice of target is fooled through `apparentSpecOf`, but no harness section stages a
  bomber strike; the barrage, missile and artillery cases are measured.
- The ladder covered Hard against Normal only (both seats, both conditions), not the full card; Easy is
  untouched by design, and the frozen previous commander was not run.
- The computer never builds a Supply Cache on a standard map, and its Bunker waits for artillery
  pressure, so on most standard-size battles it uses upgrades alone.
