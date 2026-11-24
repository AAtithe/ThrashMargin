# Fireline round 7: the after-action review (build log)

The workstream: feedback after a battle that shows what happened and where it turned, the way
management accounts show a business. A compact record kept by the pure sim, a pure reading of it
into turning points, and a Review screen with charts, an events timeline and the turning points.
For the integrator to merge into `fireline-design.md`; that file is not edited here.

## 1. Recording (`src/sim/history.ts`)

`GameState.history?: BattleHistory` (types.ts, inside `round7:review` markers).

- **Who gets one.** `createInitialState` (every skirmish and every planet battle, which is built
  on it) and `createMissionState` set `s.history = newHistory(sides)`. Nothing else does.
- **Old saves.** `migrateState` never starts one: a save from before the review has no history,
  never gains one, and plays on byte-identically (harness). Starting one mid-battle would give a
  record with a false start and income baselines, so the decision is to leave old saves alone. A
  save that has a history keeps it if well formed (`migrateHistory`), else drops it; a junk
  first-look block (`seen`) is dropped and taken afresh on the next tick, keeping the samples.
- **Never changes play.** Nothing in the battle reads `s.history`. It is written by one call at the
  foot of `step` (`recordHistory`) and three one-line hooks that only read: `noteKill` in `credit`,
  `noteUnitDeath` and `noteBuildingDeath` in `removeDead` (the unit hook sits before `lostAboard`,
  which empties a carrier, so riders lost aboard are counted). `cloneState` copies the history, so a
  tick never touches its input. It does not take ids, dice or log lines.
- **Cadence.** Every `HISTORY_SAMPLE_TICKS` = 30 seconds of game time (300 ticks), at exactly those
  ticks. The battle so far adds a last sample computed from the state at read time
  (`decodeHistory(h, s)`), so a review from the pause menu or at the end includes the partial interval.
- **Per side per sample** (17 fields): credits held; income in the interval (harvested credits,
  which include Logistics, plus Derrick pay as `sites.ts` pays it, plus Salvage crews' pay); army
  value (list price of every living unit except Ore Haulers, aircraft and ships included); structure
  value (every standing structure, walls included); units and structures lost and killed in the
  interval by category (infantry, vehicle, air, naval, structure; walls not counted); power made and
  used (`powerOf`); ore control.
- **Ore control, the map measure.** Of every tile holding ore at the sample, the share (in
  thousandths) whose nearest structure (not a wall) within 12 tiles belongs to the side; ties go to
  the lower side. It is honest and cheap (each structure marks a 25 by 25 box): it is the ore a side
  can mine without marching for it. On maps where the ore runs out it falls to nothing for everyone,
  which is what happened.
- **Events**, with their tick: the first structure of each kind per side, and every Refinery (so
  "rebuilt" can be read); every structure lost (kind); research finished (from `upgrades`, each tick);
  support powers used (a power's cooldown rising); heroes and the field General falling (riders
  aboard included); a side's first capture of each site (sites change hands back and forth in big
  battles, 322 times in one Epic battle, so only the first is kept); and, once a sample window
  holds five or more unit losses for a side, a "heavy losses" event: the kind whose losses cost most
  (count times list price), how many of it, how many units in all, and the kind that killed most
  (`defences` for structures).
- **Encoding.** Each series is a string of small integers, five bits a character with a continuation
  bit, 64 JSON-safe characters. Income is stored in tens of credits, other money in fifties. Credits,
  army, structures, power and ore are stored as zigzag deltas. The ten loss and kill counts share one
  column: a mask of the non-zero ones, then each of them less one. Events are one comma-separated
  string, `tick36.side code word`, the words being indexes into a per-battle dictionary of kind names
  (`dict`). An event budget (`EVENTS_SOFT` 4,000 characters, then only losses, research and commanders;
  `EVENTS_MAX` 5,500) bounds the worst case; when it bites, `capped` records the tick and the Review
  screen says so.

### Size

| Battle | Samples | History |
|---|---|---|
| Epic, huge map, four sides FFA (seed epic-1), ended at 50:13 | 100 | 10,943 B |
| Epic, huge map, four sides as teams (seed epic-2), ended at 73:56, events at their budget | 147 | 15,676 B |
| The same, projected to 85 minutes (samples grow, events are capped) | 170 | about 17,900 B |
| Harness: a far busier 85 minutes (every number moving each sample, 3,000 events) | 170 | 17,494 B |

Measured late in a real Epic battle: about 14 bytes a side a sample. Before the event budget and
the first-capture rule for sites, the teams battle above came to 17,762 B at 74 minutes (322 site
events); the size section of the harness now holds the busy case under 20 KB, and `npm run drive --
--deep` plays a full 85-minute Epic battle and asserts it.

Both Epic battles end with the same winner at the same tick as before the recorder changed: the
history never feeds back into play. Neither Epic battle measured lasted 85 minutes (the computer
finishes them first); the 85-minute bound is the projection above and the busier synthetic case.
Measurement script: an Epic autopilot battle run with `createInitialState` and `processAction`
ticks of 300, reading `historyBytes`.

## 2. Turning points (`src/sim/review.ts`)

`turningPoints(history | decoded, context)` is pure and returns a headline, the lead changes and at
most six findings, most important first. Each finding has its time (and end, for a stretch), a tone,
a title, the text with its cause where the events show one, and one line of advice. The review is
told from side 0's seat; allies are neither for nor against, and "the enemy" at a moment is the
enemy side leading on that measure.

| Rule | Fires when | Cause read from |
|---|---|---|
| income | your income (two-minute average) falls under 75% of the leading enemy's for three samples, having been level | Refineries lost in the four minutes before (with "your second Refinery" and the time to rebuild), heavy Hauler losses, or Refineries built by each side |
| army | the share of army value that is yours moves 20 points or more within two minutes, both armies together at least a quarter of the battle's largest and 1,500 credits moving | the heavy-loss event in the window ("you lost 9 Battle Tanks to Artillery"); advice fits what killed you (artillery, aircraft, defences, rocket infantry) |
| army (good) | the same, your way | kills in the window |
| research | eight minutes or more without research (from the Research Lab) while the enemy finishes two or more, or no lab at all against an enemy researching | the enemy's count |
| tech | your War Factory, Research Lab, Tech Centre, Helipad, Strike Command or Prototype Works three minutes or more after the first enemy's (never having one counts only for the Factory and the Lab) | the times |
| float | over 3,000 credits held for two minutes or more | the peak |
| power | power used over power made for two samples or more | |
| raid | three or more of your structures lost within two minutes | the kinds |
| commander | your General or a hero falls | |
| earned | out-earned by 30% over the battle, or out-earning by 20% | the totals |

The headline reads the lead on army plus structures, from three minutes in (the opening riflemen are
noise), a change counting once it holds for a minute and a half: "You led on army and structures
until 16:30. The lead changed hands 3 times; from 27:00 Ashen Combine held it to the end. Ashen
Combine won."

Thresholds were tuned on real battles: the first cut made early rifleman trades the top finding.

## 3. The Review screen (`src/components/Review.tsx`)

`ReviewButton` opens the screen as a portal over everything, from: the skirmish end card ("Review the
battle"), the Paused card and the compact battle menu ("Review so far"), the campaign debrief, and a
planet battle's result card (before it folds back into the war). While open it takes every key
(Escape closes it), so the battle's shortcuts stay still.

Desktop first: the headline, a side legend (colour and each side's own mark, so nothing is colour
alone), the turning points on the left, six line charts on the right (income a minute as a two-minute
average, army value, structure value, units and structures lost as a running total, credits held, ore
within reach), each with numbered dashed rules where the turning points fall, a hover crosshair and
tooltip, and a plain-words caption (each side's peak and where it ended) that is also the chart's
accessible name. Below, an events timeline: one lane per side drawn as marks, and the list, filtered
to key events, yours, or everything. Inline SVG from theme tokens only (`--ui-side-*`, `--ui-team`,
`--ui-enemy`, rules and text tokens); styles in `styles.css` inside `round7:review` markers. Checked in
light and dark at 1440.

War for the Planet: the strategic save never holds the history (the battle state is dropped when it
folds back). A fought battle's report carries up to three turning-point lines (`BattleReport.review`,
each at most 160 characters); the reducer puts them on that battle's journal entry and takes them off
every other (`attachReview`, entries replaced, never edited), save migration keeps them on the newest
entry only, and the Journal tab shows them under "Turning points". Worst case measured: 550 bytes of
the 48 KB strategic budget. A malformed `review` makes the report refused.

## 4. Harness (`scripts/drive-review.ts`, in `npm run drive`)

About 170 assertions in about four minutes on a loaded machine:

- a history on new skirmishes, missions and planet battles; none on an old save, which plays on
  exactly as the same battle recording; a save with one migrates to itself; junk dropped;
- the encoding round-trips random samples and events;
- an 18-minute battle ticked one tick at a time: one sample every 300 ticks exactly; credits, army,
  structure value and power recomputed independently; income equal to harvested credits plus Derrick
  pay counted tick by tick; units lost by category equal to units that vanished (boarding carriers and
  Base Trucks deploying accounted for); ore control equal to a brute-force count;
- recording never changes play: ten setups (legacy, plains, random, sites, three sides, four as
  teams, heroes and Generals, development lines, standard tech, rich and long) played with and without
  the history and compared whole, plus three battles to their winner compared the same way;
- replay: the same history byte for byte however ticks are batched (600, 150, 37);
- every rule on constructed histories, firing when it should and not just short of it; ordering,
  determinism, frozen input, no dashes, the raw history reading exactly as its series;
- size: a huge four-sided Epic battle measured, and the busier 85-minute case under 20 KB;
- the planet journal lines: newest only, cut to length, round trip, budget.

Pinned hashes in `drive-planet-battle.ts` and `drive-size.ts` date from before the history; both
now leave the `history` key out (marked), the same way they leave out other later additions.

## 5. Results

- `npx tsc --noEmit -p packages/fireline/tsconfig.json`: clean.
- `npm run drive:fire`: 401,847 assertions, 0 failed (1,518 s on a machine shared with four other
  builders). The review sections took about 70 s of that.
- `npm run campaign:fire`: 7,699 assertions, 0 failures.
- `npm run drive:planet`: 35,255 assertions passed, 0 failed (budgets included; run before the last
  two commits, which touch no planet code).
- `node scripts/ui-check.cjs fireline`: 32 of 32 UI checks passed. It does not open the Review screen.
- The Review screen loaded in Chromium through Playwright, using the `tm_user` local sign-in and a
  local save: a finished two-sided battle from its end card in light and dark at 1440, a three-sided
  battle in progress from the Paused card ("Review so far") in dark, and the finished battle at 375.
  No sideways scroll and no errors from the review. The one console warning, a duplicate React key,
  comes from the battle's existing log feed.

## Known gaps

- Income per sample swings with Haulers' trips; the charts and the income rule use a two-minute
  average.
- Losses are counted by category, not by value; the army rule's cause comes from heavy-loss events,
  which name only the costliest kind in a 30-second window.
- Spy theft is not income (it is a transfer); Salvage pay is.
- The Review screen is desktop first; at phone width it stacks into one column and scrolls.
- The planet battle's Review button was checked by code and harness, not driven in a browser.
