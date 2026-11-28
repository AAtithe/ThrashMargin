# Fireline round 8: the build window, rebuilt

Supersedes the layout half of `fireline-round5-design.md` section 3. Everything that section says
about opening, closing, focus, dragging, placement closing and reopening the window, the production
strip and the ids (`fl-build-<kind>`, `fl-tab-<tab>`, `fl-build-open`, `fl-build-close`) still holds.
Interface only: nothing under `src/sim/` changes, and every `drive:fire` line stays. Phones are out of
scope for this round: the touch sheet keeps working, but nothing here is designed for it.

## Why

The window was drawn for about ten items a tab. Structures reached 22, so eight had no hotkey, the
requirement lines crossed each other and the cards, the opening screen was almost all grey, the tree
scrolled both ways at 1280 wide, and the stat card covered the sidebar.

## 1. Two views

A switch in the title bar: **Build** (the default) and **Tech tree**. The choice is remembered per
viewer (`fl_build_view`).

- **Build** shows what can be built now as full-colour cards. Everything still locked sits below in
  **Coming next**: one row per set of missing structures that is a single step away ("Build a Tech
  Centre: unlocks Flame Tank, Bastion"), the row's own button queuing that structure. Items further up
  sit in a muted **Later** block as small chips, each naming what it needs. Every kind in the battle's
  list is on the tab in one of the three places, with its `fl-build-<kind>` id.
- **Tech tree** is round 5's tier layout, narrower cards so six tiers fit at 1280 wide. Lines are drawn
  only for the item under the pointer or focus: its whole chain back to tier 1, the rest dimmed.

## 2. Structure groups and hotkeys

Structures are shown in four labelled groups: Economy, Production, Defence, Intel and Tech
(`game/buildPlan.ts`, a table with a fallback from data for a kind it does not list: a weapon or a
wall is Defence, a producer is Production, positive power is Economy, the rest Intel and Tech).

One group is **active**: its heading is lit and its cards carry the hotkey letters. Q W E R T Y U I J K
L B N D apply to the active group in its list order, which never changes as things unlock, so a key
always means the same structure. Tab moves through the groups and then on to Infantry, Vehicles and
the rest; Shift+Tab goes back. Clicking a group's heading makes it active. The Build button reads
"Structures: Defence". Unit tabs keep one list, keyed as before.

## 3. Unlock moments

When a finished structure opens new items: a message names them ("Tech Centre ready: Flame Tank,
Bastion unlocked"), each tab holding a new item shows a dot until it is opened, and the new cards
glow briefly the first time they are seen. Reduced motion keeps the dot and the message and drops
the glow. Nothing fires for what stands when a battle loads.

## 4. Planning numbers

- An unaffordable card shows how long until it is affordable at the current income ("in 14s"), from
  the ore harvested over the last minute of battle time; with no income, "no income".
- Pointing at a structure previews its power on the sidebar's meter (the lamps it would light or
  draw, outlined) and the stat card's footer gives credits and power after buying it.

## 5. Roles and counters

Every unit card carries up to two role marks from its weapon against the armour table (`DAMAGE_VS`):
vs infantry, vs armour, vs air, vs structures, vs ships; a unit with no weapon is Support. The window
remembers which enemy unit kinds side 0 has seen this session; a unit that hits the armour class
most often seen at full effect or better carries **Counters scouted**.

## 6. Advisor

A ring on one sensible next item, with its reason in the stat card: power short, no refinery, no
barracks, fewer haulers than refineries, enemy aircraft seen with no anti-air, no war factory, money
piling up with no Tech Centre. Only something buildable and not already queued. A switch in the title
bar; on by default at Easy, off otherwise (`fl_advisor`).

## 7. Quick bar

Any item can be pinned with the corner button on its card. Up to six pins, kept per viewer (`fl_quickbar`), shown along the lower left of the battlefield
whether the window is open or not, each with its key: F1 F2 F3 F4 F6 F7 (F5 is left to the browser).
A slot queues or places exactly as its card does, and shows its progress.

## Tests

`scripts/tours/fireline-build-window.cjs` is rewritten for the new layout: every menu kind present in
Build view and locked exactly when it should be; Coming next names the right structure; the tree view
draws no lines until an item is pointed at, then exactly its chain; every structure has a hotkey within
its group and Tab walks the groups; a pin appears on the quick bar and its key queues; no sideways
scroll in the window at 1280 by 720; the stat card never overlaps the sidebar.

## Build log

**2026-11-26.** Built in one pass, all seven sections.

- New files: `src/game/buildPlan.ts` (groups, hotkey lists, the Tab walk, where each item sits, roles,
  counters, the advisor, the afford timer's words; pure) and `src/game/buildStores.ts` (income samples,
  enemy kinds seen, new unlocks, the power preview, the view, advisor and quick bar preferences), and
  `src/game/QuickBar.tsx`.
- `BuildWindow.tsx`: the view switch and advisor switch in the title bar, the Build view (`BuildList`),
  and the tree drawing only the pointed-at chain. The window's top edge is now a fraction of the field's
  height, so a short tab no longer moves it.
- `Sidebar.tsx`: `BuildButton` takes a size (card, mini, chip) and carries the afford timer, roles, the
  counter badge, the advisor ring, the glow and the pin; the stat card stays on the battlefield; the
  power meter previews the pointed-at structure; the Build button names the group.
- `GameScreen.tsx`: the group state, the hotkeys and Tab walk through `buildPlan.ts`, the quick bar keys,
  the unlock watch (a green toast; `showToast` gained a duration and a tone), and the income and scouting
  notes taken with each frame.
- "No income" shows only when no hauler is out: a hauler on its first trip read as no income for its
  first half minute.
- Verified: `npm run tours fireline` (guided tour and the rewritten build window check), the planet
  tour, `npm run check:ui fireline` (32 of 32), `npm run check`; screenshots at 1440 by 900 light and
  1280 by 720 dark.
- Not fixed here: `npm run tours fireline-touch` fails on the mission objectives panel on the iPhone SE
  and iPhone 13 landscape (panel 33px tall, rows covered). The same failures appear on the commit before
  this round, so they predate it; phones were out of scope.

**2026-11-28. The build rail and its pop-outs (desktop).**

- The floating, draggable window is gone on a desktop. A rail down the battlefield's left edge
  (`BuildRail` in `BuildWindow.tsx`, 76px, `RAIL_W`) carries one button per list: Structures, Infantry,
  Vehicles, Air, Naval and, with a Lab, Research. Each shows the list's art, its queue length, a dot for
  a new unlock and the advisor's ring. Pressing one slides the window out docked against the rail, full
  height, on that list; pressing the open list again puts it away. The rail buttons take over the ids
  the window's tabs had (`fl-tab-<list>`), so the tour, Tab walk and hotkeys are unchanged.
- Structures pops out once more: a column of its groups (Economy, Production, Defence, Intel and Tech,
  each saying how many items are ready to build), and beside it only the pressed group's items, with
  Coming next and Later kept to that group. The pressed group is still the one the hotkeys build from.
  The tech tree view shows every structure, as before.
- The guided tour rings a structure's group button before the structure when another group is showing
  (`windowed` in `GuidedTour.tsx`).
- The quick bar and the battle feed move right by the rail's width (`--fl-rail` on the battlefield).
- Phones and touch keep the full-screen sheet with tabs and all groups; nothing there changed.
- Tests: `fireline-build-window.cjs` checks the rail (on the field's left edge, the window docked
  against it and full height, a second press closes, Structures pops out its groups) and pops out each
  structure's group before checking it; the drag check is replaced by the sidebar check alone.
  `fireline.cjs` presses Production before queueing the Barracks mid-run.

**2026-11-28, later. Polish.**

- The docked window fits its content (8px from the top, at most the field's height) rather than running
  empty to the floor, and slides out on a springier curve. A change of list, view or group crossfades in.
- Resting the mouse on a structure group for 160ms pops it out, as a click does (mouse only).
- The rail marks the list the hotkeys act on with an accent bar; buttons and cards lift on hover. Every
  movement follows the game's Motion setting and the system's reduced motion.
- The quick bar's pins moved into the rail, under the lists, so the window never covers them.
- Verified: `npm run tours fireline` (guided run and build window, ok), `npm run tours fireline-touch
  --quick` (ok), `npm run check:ui fireline` (32 of 32). Not run here: the whole of `npm run check`,
  which stops in this container at Thrash Margin's missing install; Fireline's client and API typecheck
  clean, and no file under `src/sim/` changed.

**2026-11-28, later still. Research and Upgrades on the rail.**

- Research sits on the rail under a rule from the start of any battle that allows a Research Lab:
  greyed until the Lab stands, when it opens on what research needs and a button to the Lab (Structures,
  Intel and Tech). With development lines it pops out a column of the lines (each saying not started,
  Mk I done, researching with its percentage, choose a doctrine, complete) and the chosen line's nodes
  beside it. Classic research and the phone sheet keep the plain list.
- Upgrades (`Tab` gained `'upgrades'`; `tabsFor` offers it with structure upgrades on) pops out a column
  of the structure kinds you hold that have levels, and beside it every structure of the kind: level of
  maximum, the next level and what it does, the price, Upgrade or a progress bar and Cancel, and Show to
  centre the map on it. Until then it names the kinds that have levels. The selection panel's Upgrade
  stays as it was.
- The group hover now starts on a real pointer move, not on entering: opening Structures from Research
  slid a group under the resting mouse, which picked it.
- Tests: the build window check covers Research before its Lab and the hover opening a group.
  Verified: `npm run tours fireline` (ok), `fireline-touch --quick` (ok), `check:ui fireline` (32 of 32).
