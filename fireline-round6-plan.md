# Fireline, round 6: armies, heroes in free play, generals and formations

Status (2026-11-11): built. The groundwork, the four workstreams and the integration have landed
(build log: `fireline-design.md`, "Round 6 integration"); the boxes below say what is done, and the
one left open says why. It was written from three
parallel audits of the code (factions and aircraft; heroes and engineers; formations and command),
and it follows the shape of round 5: a groundwork commit that changes nothing in play, then four
workstreams in parallel worktrees, then an integrator.

The owner asked: "two types of armies, with slightly different characteristics, slightly different
planes; how can you build special characters in free play, or the engineer; generals too; and more
structure to unit formation."

The repo rules hold throughout: `src/sim/` is pure (no `Math.random`, no clock, one `cloneState` per
action, an illegal action returns the same state object); every enemy question goes through
`sides.ts`; colours are tokens in both blocks of `styles.css`; British English, no em dashes.

---

## Where we stand today (what the audits found)

- **Every side plays the same army.** Sides differ only in seat, team, start, name (`SIDE_NAMES`:
  Meridian Corps, Ashen Combine, Verdant Front, Ochre Legion) and colour. Every stat is a global
  `UNITS[kind]` or `BUILDINGS[kind]` lookup, about 200 of them across `sim/` and `game/`.
- **Aircraft:** two, both from the Helipad: Gunship (1400, ground only) and Bomber (2000, splash).
  `air.ts:172-192` branches on those two kind names directly.
- **Heroes are deliberately campaign-only** (`fireline-campaign-design.md:76`). Spy, Commando,
  Engineer and Ace. Kept out of free play in six hard-coded places: `canQueue` refuses them
  (`commands.ts:54`), no menu lists them, they spawn only from `mission.ts:289-298`, the hero tick
  runs only `if (s.mission)` (`tick.ts:167`), the hero bar and Z/X/C/V keys show only in missions
  (`GameScreen.tsx:960, 966, 1610`), and `drive.ts:1120-1126` asserts the refusal.
- **"The engineer" in free play.** The campaign Engineer hero cannot be built anywhere. The Repair
  Truck and Forward Base Truck can be built in free play today, on advanced tech, from the War
  Factory (Repair Truck also needs a Repair Bay, Forward Base Truck a Comms Uplink).
- **Generals do not exist as units.** "General" is only the top campaign rank (4500 XP). The
  nearest machinery is commander perks (`Perks`, `types.ts:519`), applied to side 0 only through
  `owner === 0 && s.perks` checks in six places.
- **Formations do not exist.** A group move fills a fixed 13x13 nearest-first spiral
  (`commands.ts:284-313`) with no facing and no shape; each unit then paths at its own speed, so a
  group strings out. Control groups are client-only, keyboard-only and not saved. Stances
  (aggressive, guard, hold), attack-move and 12-deep waypoints already exist.
- **The computer** runs one attack wave per side (forming, gathering, attacking) with a regroup
  when strung out (`ai.ts:574-668`). It filters heroes out and names unit kinds directly in its
  build plans and in `aiAir.ts`.

---

## 0. Groundwork (one commit, changes nothing in play)

Every summary line of `npm run drive:fire` must read the same before and after.

- [x] Add `Faction = 'meridian' | 'ashen'` and `FACTIONS` in `rules.ts`. `PlayerState.faction?`
      in `types.ts`; absent reads as `'meridian'`.
- [x] Add `unitSpec(s, owner, kind)` and `buildingSpec(s, owner, kind)` in `state.ts`, returning
      the base spec for now. Replace the global `UNITS[`/`BUILDINGS[` lookups in `sim/` with them
      (tick 31, ai 27, mission 23, the rest). Mechanical; typecheck after every file.
- [x] Make `unlocked`, `techAllowed`, `costOf`, `buildTicksOf`, `hpMulFor` and `upgradeNewUnit`
      go through the per-side spec.
- [x] Generalise perks to per side: `s.perks` becomes `Partial<Record<owner, Perks>>`, with
      `migrateState` lifting an old single `perks` onto side 0. Replace the six
      `owner === 0 && s.perks` checks with `perksFor(s, owner)`.
- [x] `SkirmishSetup` gains optional `factions?: Faction[]` (one per seat), `heroes?: boolean`,
      `generals?: boolean`. `DEFAULT_SETUP` and `LEGACY_SETUP` state each explicitly;
      `normaliseSetup` repairs junk to the base's value, else off / `'meridian'`.
- [x] Unit gains optional `squad?: number`; `GameState.squads?` declared, read by nothing yet.
- [x] `GameAction` gains `formation` and `recruit` shapes; the reducer's default refuses them
      (same state back) until a workstream handles them.
- [x] Marker comments `round6:A` to `round6:D` at every place a workstream adds lines to a shared
      file. Write the contract file (`fireline-round6-design.md`) naming exact identifiers and file
      ownership, as round 5 did.
- [x] Harness: a fresh state passes `migrateState` unchanged; a pre-round-6 save loads and plays
      byte-identically; setup defaults and junk values are asserted in `scripts/drive-sides.ts`.

## A. Two armies

Principle: Meridian Corps keeps today's exact stats, so every mission, every old save and every
current harness number stays put. Ashen Combine is the variant. Differences are "slight", as asked:
overlays of roughly 10 to 15 percent, plus one signature item each, so neither army needs a new
manual.

- [x] Doctrines on paper first, agreed before code:
      - Meridian Corps: heavier and slower. Armour and range. Strong static defence, the Bastion and
        Fortress as identity. Air: today's Gunship and Bomber unchanged.
      - Ashen Combine: lighter, faster, cheaper. About 10% less hp, 10 to 15% more speed, 10%
        cheaper infantry and light vehicles, slightly shorter range on heavy guns. Air: a faster,
        lighter gunship (working name Kestrel: less hp, more loads, quicker rearm) and a bomber
        variant that trades splash for an incendiary patch (working name Firebrand).
- [x] One signature ground unit each (for example: Meridian gets a Sapper squad that lays mines;
      Ashen gets a Raider bike that is fast and fragile). One signature unit each, no more, this round.
- [x] Implement as data: `FACTION_OVERLAY: Record<Faction, Partial<Record<UnitKind | BuildingKind,
      Partial<Spec>>>>` and `FACTION_MENUS` adding or removing the signature items. `unitSpec` merges.
- [x] Rename the aircraft branches in `air.ts:172-192` from kind names to spec flags
      (`spec.air.role: 'strafe' | 'bomb'`) so variants work without new branches.
- [x] Art: new cases in `game/art.ts` for each new kind.
- [ ] Faction tint via tokens on the battlefield: not done; the canvas draws seat colours only (the
      lobby's army tags are tokens). Left for a later round.
- [x] Build window: `techTree.ts` reads a per-side catalogue (`RULES_CATALOGUE` becomes a function
      of faction). Sidebar and `HowToPlay` read the same.
- [x] Setup screen: an "Army" row per seat in `SkirmishSetup.tsx`, with a one-line doctrine under
      each choice. Store with `storeSetup`.
- [x] Computer: per-faction build mixes in `ai.ts:380-406, 925-963, 1068-1097` and per-faction air
      counts in `aiAir.ts`. Frozen ladder commanders in `ai-prev.ts`/`ai-baseline.ts` stay Meridian.
- [x] Tests: `scripts/drive-factions.ts` (overlay merge, menus, old saves read Meridian, missions
      untouched). `ladder:fire` gains `--factions`; balance judged over 150+ seeds **from both
      seats**, because the Normal mirror already shows about 75% for side 1 from seat alone. Target:
      Meridian against Ashen within 45 to 55% once seat is netted out.

## B. Heroes and engineers in free play

This reverses a documented campaign decision, so it ships behind a setup option, off by default.
The campaign stays exactly as it is.

- [x] Setup option "Heroes: off / on", advanced tech only, greyed on standard tech.
- [x] Recruitment: a new building, the Command Academy (requires Tech Centre), or the Tech Centre
      itself as producer. Each hero gets a real cost and build time (starting points: Engineer
      1000, Spy 1200, Commando 1800, Ace 2500).
- [x] Limit: one of each hero per side, counted standing plus queued (copy the `MAX_FIELD_YARDS`
      pattern at `commands.ts:65`).
- [x] Revive: a fallen hero can be recruited again after a cooldown (start at 90 seconds), at half
      cost. Reuse the campaign's "wounded" idea rather than inventing a new one.
- [x] Engine: relax `canQueue`'s refusal when `setup.heroes` is on; run the hero tick outside
      missions; give a built hero its `abilityCd` and level 1 (today only `mission.ts:294` does).
- [x] Interface: show the hero bar, Z/X/C/V and F-as-ability in a free play battle with heroes on.
      F's role in skirmish (selection command) must not clash: F runs the hero ability only when the
      selection is exactly one hero.
- [x] Computer: stop filtering heroes out (`ai.ts:373, 1063`, `aiSites.ts:163`). First behaviours:
      Engineer captures an undefended building or neutral site; Commando escorted to a lone
      structure; Ace joins the main wave; Spy reveals the map before an attack.
- [x] Clarify "the engineer" in the build window: a tooltip on the Repair Truck and Forward Base
      Truck explaining they are the free play engineering units, so the question does not recur.
- [x] Tests: update `drive.ts:1120-1126` to assert refusal with heroes off and acceptance with them
      on; one-per-side limit; revive timer; mission behaviour unchanged.

## C. Generals

Two layers. The first is cheap and carries most of the value; the second is the visible unit.

- [x] Doctrine generals (Hale's and Kade's perks refined as built: see the build log): at setup
      each side picks a General (two per army, four in all). Each is a
      `Perks` bundle plus one support-power tweak. Examples:
      - Meridian, General Hale (Fortress): +10% structure hp, turrets build 20% faster.
      - Meridian, General Voss (Armour): tanks and Bastions 10% cheaper, slower harvest.
      - Ashen, General Kade (Blitz): +10% vehicle speed, power cooldowns 15% shorter.
      - Ashen, General Ilse (Air): Helipad 25% cheaper, aircraft rearm 20% faster.
      Uses the per-side perks from groundwork. Computer picks by seeded rng, never `Math.random`.
- [x] Field general (setup option "Generals: off / on"): one General unit per side, recruited from
      the HQ, with a command aura (start: 6 tiles, +10% damage and +10% rate of fire for friendly
      units inside). Implement the aura like the medic scan (`tick.ts:767`, every N ticks) and apply
      it where veterancy is applied in `fire` (`tick.ts:717`). If the General falls, the aura is lost
      and the doctrine perks halve until a replacement is recruited (cooldown 120 seconds).
- [x] The General can lead a formation (see D): a squad led by the General keeps formation tighter
      and moves at the squad's pace without straggling.
- [x] Computer keeps its General with the main wave, behind the front rank, and retreats it below
      40% hp.
- [x] Tests: doctrine perks per side, aura stacking (does not stack with a second aura), death and
      replacement, AI retreat rule.

## D. Formations and squads

- [x] Replace the fixed spiral (`commands.ts:311`) with `slotsFor(shape, n, facing)` returning
      integer offset tables for line, column, wedge and box. Facing is group centroid to target,
      snapped to 8 directions with no trigonometry, so replays stay exact.
- [x] `move` gains optional `formation`, validated against an allow-list. Absent means today's
      spiral, so every existing replay and harness number is unchanged.
- [x] Slot order by role, then id: armour front, infantry behind, artillery and support at the
      rear, medics and repair trucks in the middle. This also closes the "fixed tie-break orders in
      formations" item in `fireline-improvements.md:131`.
- [x] Keep pace: units given a formation move share a `squad` id; in `stepAlong` (`tick.ts:354`)
      a squad member's speed is capped at the slowest member's. One lookup, no pathing change.
- [x] Squads persist: `s.squads: {id, leader, shape, members}[]`, normalised in `migrateState`.
      The leader paths; the others steer to leader plus offset, refreshed every few ticks.
- [x] Control groups move into the state (or client storage per save) and become reachable on
      touch: a row of group chips in the selection panel.
- [x] Interface: a formation button row beside Stance in the sidebar (`Sidebar.tsx:903`); on touch,
      in the selection panel, not the crowded command bar. No two-finger rotate (it clashes with
      pinch zoom) and no long-press (iOS). One desktop key, chosen from those still free.
- [x] Computer: waves (`ai.ts:600, 615, 647`) form a wedge to attack and a box when regrouping.
- [x] Tests: `scripts/drive-formations.ts`: slots deterministic and passable, no slot repeated,
      facing correct for all 8 directions, squad arrives within N ticks of its slowest member, an
      invalid shape returns the same state. `npm run tours -- fireline-touch` still passes.

## Integration and acceptance

- [x] `npm run check` green (typecheck, every harness including `drive:fire` and `campaign:fire`).
- [x] `npm run ladder:fire` over 150 seeds, both seats, for faction balance and for any AI change.
- [x] `npm run tours` for any tour or onboarding touched; `npm run check:loading` if a palette or
      loading state changed.
- [x] Both colour modes checked in the browser; every new colour is a token in both blocks.
- [x] A save from before round 6 loads and plays byte-identically; all eight missions build and run
      unchanged.
- [x] Build log entry in `fireline-design.md`; How to Play updated for armies, heroes, generals
      and formations.

## Suggested order

Groundwork first, alone, because all four workstreams depend on the per-side spec lookup and the
per-side perks. Then A, B, C and D in parallel worktrees. D is the most independent and can start
the moment groundwork lands. C's field general leans on D's squads, so C's doctrine layer goes first
and its unit second. A carries the most balance risk and should get the longest ladder time.
