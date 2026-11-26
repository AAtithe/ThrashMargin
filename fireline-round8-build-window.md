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
- Verified: `npm run tours fireline` (guided tour and the rewritten build window check), the touch and
  planet tours, `npm run check:ui fireline`, `npm run check`; screenshots at 1440 by 900 light and 1280
  by 720 dark.
