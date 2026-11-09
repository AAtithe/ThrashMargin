# Fireline — Campaign, Commander career and heroes

Status (2026-11-08): built and integrated. Section 8's checks pass; the build log is in
`fireline-design.md`. Mission AI modes (section 5) are in `ai.ts`.

The second mode of Fireline. Skirmish (one battle against the computer) stays exactly as it is.
The campaign adds what skirmish lacks: a reason to come back. Missions in sequence, a Commander
who ranks up and spends skill points, and four named heroes who level up and carry over.

The contract (types, rules data and function signatures every workstream codes against) is real
code, committed before any builder started:

| What | Where |
|---|---|
| Heroes, abilities, levels, support powers (data) | `src/sim/rules.ts`, bottom section, and the four hero entries in `UNITS` |
| Hero, mission, objective, outcome, perks, context types; new actions | `src/sim/types.ts` |
| Campaign state, perks, saves (types) | `src/campaign/types.ts` |
| Sim functions (stubs) | `src/sim/mission.ts` |
| Progression functions (stubs) | `src/campaign/progression.ts` |
| Missions (empty list) | `src/campaign/missions.ts` |
| Save helpers (stubs) | `src/campaign/save.ts` |

Names and shapes in those files are fixed. Numbers in `rules.ts` may be tuned by the simulation
workstream. Anything a workstream needs beyond the contract goes in its report as a follow-up.

---

## 1. The player's journey

1. Lobby: two panels. **Campaign** (start one, naming your Commander, or continue a saved one)
   and **Skirmish** (as now). Campaign saves are marked as such in the saves list.
2. **Campaign map**: a theatre map with the eight missions as nodes along a front line. Locked,
   open, won (with stars). A Commander card (rank insignia, name, xp bar, unspent points) and two
   buttons: **Commander** (skill tree) and **Heroes** (roster).
3. Click an open mission: **Briefing** (paragraphs, objectives, bonus objectives, heroes you will
   field, new tech, rewards). **Deploy** starts the battle.
4. **Battle** as in skirmish, plus: an objectives panel, a hero bar (portrait, health, level, xp,
   ability button with a cooldown sweep), a support-power bar, a mission timer when there is a limit.
5. **Debrief** when the mission ends: victory or defeat, stars, each objective ticked or not, xp
   earned and the Commander's xp bar filling, rank-ups and points gained, hero level-ups, wounded
   heroes, unlocks. **Back to the campaign map** (the outcome is applied and saved) or **Retry**.

## 2. The Commander

- Xp from missions: the mission's reward xp on a win, plus 25% per star beyond the first, plus a
  little per enemy destroyed. A loss still pays a quarter of the base reward, so a hard mission is
  never a dead end.
- Ranks: Lieutenant 0, Captain 300, Major 800, Colonel 1600, Brigadier 2800, General 4500.
  One skill point per rank gained, plus one point for each mission's first three-star finish.
- Skill tree, three branches (`PerkSpec` in `campaign/types.ts`):
  - Economy: Logistics (+10% harvest income per level, 3 levels), Surveyors (+500 starting
    credits per level, 2 levels).
  - Industry: Assembly (+10% production speed per level, 3 levels), Procurement (-5% cost per
    level, 2 levels, needs Assembly 1).
  - Command: Armour (+8% unit health per level, 3 levels), Recon sweep (unlocks the power),
    Artillery barrage (unlocks, needs Recon), Reinforcements (unlocks, needs Barrage),
    Staff work (-15% power cooldowns per level, 2 levels, needs Recon).
- `perkModifiers(campaign)` turns perks into `Perks`, which the simulation applies to side 0.

## 3. Heroes

Numbers in `rules.ts` (`UNITS.spy` and so on, `HERO_ABILITY`, the constants below them).

| Hero | Ability | Passive |
|---|---|---|
| The Spy | Infiltrate a structure: Refinery steals half their credits (max 1500); Generator blacks out their power 60s; Uplink reveals the map; Factory or Barracks stops production 45s; Command Yard reveals their base and halves their next wave | Invisible to the enemy unless an enemy unit or structure is within 2 tiles. Never auto-targets. |
| The Commando | Demolition charge on a structure: explodes 3s later, destroys it (Command Yard loses 60%) | Lethal to infantry at range 4.5 |
| The Engineer | Capture a structure (not a Command Yard) after 5s beside it; broken if he moves or is hurt | Repairs own vehicles within 1.5 tiles, 2 hp a tick. Unarmed |
| The Ace | Overdrive: 10s of +50% speed and two-thirds reload | Prototype tank, tougher and harder-hitting than a Battle Tank |

- Levels 1 to 5 from xp (`HERO_LEVEL_XP`), earned by kills in battle (a unit is worth cost/20,
  min 5; a structure 40) and carried between missions. Each level: +8% health, +8% damage, -6%
  ability cooldown. A level-up shows an effect and a log line.
- A hero who falls is out for the rest of that mission and starts the next one wounded (half
  health). A `keepAlive` objective on a hero fails the mission if that hero falls.
- Heroes are campaign-only. They are never in a build menu or a skirmish.

## 4. Support powers

Recon sweep (reveal radius 9 for 15s, shows Spies), Artillery barrage (8 shells over 4s, radius 3),
Reinforcements (4 riflemen and a tank at the map edge nearest your base). Unlocked by perks or a
mission's own `powers`; cooldowns in `POWERS`, shortened by Staff work. Used from the power bar by
clicking the button, then the map.

## 5. Missions

Specs in `campaign/missions.ts` (`MissionSpec`). Maps are generated from the mission's seed, as in
skirmish, so positions in specs must be checked against the generated map (passable, in bounds);
the campaign workstream's check script does that. Arc (titles and intent; the campaign workstream
writes the briefings and tunes the specs):

1. **First Light** — build a base and break a small Combine outpost. Base mission, no heroes,
   infantry and turrets only. Bonus: build two refineries. Unlocks the War Factory and tanks.
2. **The Quiet Man** — no base. The Spy and four riflemen. Infiltrate the outpost's Comms Uplink,
   then reach the extraction point. Spy must survive. Unlocks the Spy.
3. **Hold the Ford** — a base under siege: survive 8 minutes of raids. Bonus: lose no
   refinery; build three turrets. Unlocks the Comms Uplink and artillery.
4. **Demolition** — the Commando and a squad; destroy the three Generators powering an outpost,
   then reach extraction. Commando must survive. Unlocks the Commando.
5. **Borrowed Steel** — the Engineer captures an enemy War Factory; then destroy the outpost with
   what it builds. Unlocks the Engineer.
6. **Ace of Spades** — the Ace and a column must hold the ridge for 3 minutes, then destroy the
   outpost beyond it. Unlocks the Ace.
7. **Blackout** — a full base against a full Combine base: the Spy blacks out their Generator and
   the Commando brings down their War Factory before the main assault. Bonus: infiltrate their
   Command Yard.
8. **Fireline** — the finale on Hard: every hero, every power, destroy everything. Bonus: no hero
   falls; win inside 25 minutes.

Mission AI (`MissionSpec.enemy.ai`): normal (skirmish commander), defend (never sends waves or
raids, guards its base, rebuilds), raid (waves of 3 to 6, twice as often, the first at half the
skirmish timing), passive (makes no decisions; outposts and scripted units fight what comes in
range). An outpost with no Command Yard never queues a structure.

Victory and defeat in a mission are decided by `s.mission`, not the skirmish rule: won when every
primary objective is done; lost when an objective fails (a hero falls under `keepAlive`), the time
limit passes, or side 0 has no structures and no units left. In a no-base mission, side 0 losing
all its structures is not by itself a defeat.

## 6. Saves

A campaign is one save row: `CampaignSave` (`kind: 'campaign'`), holding the `CampaignState` and
the battle in progress (or null between missions). The server's list reads `state->>'name'` and
must also return `state->>'kind'` so the lobby can tell a campaign from a skirmish. Creating one is
`POST /api/play/fireline` with `{ mode: 'campaign', name, commander }`. The client is authoritative,
as everywhere on the portal. A skirmish save is unchanged; `migrateState` must still load every
skirmish save from before this work.

## 7. Workstreams, round 2 (campaign)

Each builder works in its own worktree, owns only its files, and reports follow-ups for others.

| Workstream | Owns |
|---|---|
| **S** Simulation | `src/sim/*` except `ai.ts`; `scripts/drive.ts` |
| **C** Campaign | `src/campaign/*`; `api/game/index.ts`; `src/hooks/useSaves.ts`; new `scripts/campaign-check.ts` |
| **R** Art and effects | `src/game/art.ts`, `renderer.ts`, `fx/*`, `icons.ts`, `sound.ts`; new `src/game/campaignArt.ts` |
| **U** Interface | `src/pages/*`, `src/components/*`, `src/game/Sidebar.tsx`, `Minimap.tsx`, `src/styles.css`, `scripts/tours/fireline.cjs` |
| **A** (later) Mission AI | `src/sim/ai.ts` |

Interfaces between them:
- **S** implements every function in `sim/mission.ts` and the new actions (`ability`, `power`) in
  `actions.ts`; applies `perks`, `allowed`, `blackoutUntil`, `recon`, sabotage; emits the new
  `Effect` kinds (`infiltrate`, `captured`, `charge`, `levelup`, `recon`, `barrage`, `reinforce`)
  for R to draw; keeps `migrateState` loading old skirmish saves.
- **C** implements `campaign/*` and the server create path, writes the eight missions, and checks
  every spec against its generated map; its check script calls `createMissionState` once S has
  landed (until then it validates statically and says so).
- **R** draws the heroes (distinct silhouettes; the Spy shimmering and half-transparent to its
  owner, not drawn for the enemy unless detected via `isDetected`), the new effects, a capture
  progress ring and a charge blinking on a structure, and exports from `campaignArt.ts`:
  `drawCampaignMap(ctx, w, h, nodes)`, `drawRankInsignia(ctx, rankIndex, x, y, size)` and
  `drawHeroPortrait(ctx, hero, level, x, y, size, wounded)`, plus ability and power sounds.
- **U** builds every screen in section 1 and the in-battle campaign HUD. Keys: Z X C V select hero
  1 to 4 (twice to jump to it), F uses the selected hero's ability (building-target abilities enter
  a targeting mode; click an enemy structure), power buttons enter a targeting mode for the map.
  These letters are free today; keep every existing key working.

## 8. Acceptance

- `npm run check` green; the drive harness covers every ability, power, stealth rule, objective
  kind, trigger, mission win and loss path, perk application and old-save migration.
- `scripts/campaign-check.ts`: progression maths (ranks, points, perk costs and requirements,
  outcome folding) and every mission spec valid against its map; once S lands, each mission's
  starting state builds and runs 2,000 ticks without error.
- A browser run through Lobby → new campaign → map → briefing → mission 1 → debrief → map, in
  light and dark, with screenshots; the guided first battle still passes in skirmish.
