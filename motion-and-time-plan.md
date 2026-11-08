# Motion and time: plan and todo list

Owner's brief (2026-11-08): *"add time elements to the game so you feel it less like you have to just
click away, with small animations. Scope it out and build it by game, write a todo list so nothing is
missed."*

## The principle

Every simulation in the portal resolves an action instantly and must stay pure (CLAUDE.md invariant 2).
So time is added **in the presentation layer only**: the state changes at once and is saved at once;
the screen then takes a moment to show what happened. Three rules hold everywhere:

1. **Never touch a `sim/` folder or the Thrash Margin engine.** No `Math.random`, no clock, no new
   actions. The harnesses (`npm run drive`, `drive:tm`) must pass unchanged.
2. **Never delay a save or block input.** Playback is visual. Any sequence longer than about a second
   can be skipped with a click or a key, and the end-turn / roll buttons are never locked behind it
   for longer than the playback itself.
3. **Respect the pace setting.** `Motion: full / quick / off` in every header, stored as `tm_motion`
   and shared across the portal; the OS reduced-motion preference defaults it to off. With motion off
   every screen must look exactly as it does today.

## Shared foundation (done first, one commit)

- [x] `shared/portal/client/motion.ts`, copied into every game by `npm run sync-shared`:
  `usePace`, `paced`, `useCountUp`, `useSkipOnInput`, `pause`,
  `easeOut`, and shared keyframes (`tm-anim-pop / fade / rise / float / pulse / shake / tumble /
  glow`) whose durations scale with the pace.
- [x] `MotionToggle` beside the light/dark toggle in every portal nav and in-game header.
- [x] `initMotion()` in every `main.tsx`.
- [x] Shared keyframes prefixed `tm-motion-` after the unprefixed names overrode two of Thrash
      Margin's own; floating markers hidden when motion is off or the OS asks for reduced motion.
- [x] `useProgress` and `useSequence` removed: on the render where their key changed they returned
      the previous run's finished value (a one-frame flash of the end state). No game used them;
      each wrote a key-aware local version (Banco `motionKit.tsx`, Steady Eddie `usePlayback.ts`,
      Thrash Margin `useBeats.ts`). Consolidating those into one shared helper is a follow-up.

## Thrash Margin (`packages/thrash-margin/client`)

- [x] AI turns replayed: after End Turn, show each AI faction's moves in sequence (faction banner,
      territories changing hands highlighted one by one, battles flashed) instead of a single jump.
- [x] Battle feedback: attacker/defender losses shown, a shake on a lost territory, a pop on a captured one.
- [x] Gold, food and action points count up or down rather than snapping.
- [x] Income and upkeep at turn end shown as floating `+/-` markers.
- [x] Toasts and modals enter with a short rise/pop.

## Banco di Niccolò (`packages/niccolo`)

- [x] Week advance has a short passage-of-time beat: the date turns over visibly.
- [x] Ships and couriers glide along their routes on the map between weeks instead of jumping.
- [x] Cash, credit and ledger figures count up or down.
- [x] New news and events arrive staggered rather than all at once.
- [x] Trades (buy/sell) give immediate feedback: a floating amount, a pulse on the cargo line.

## Niccolò Rising (`packages/niccolo-rising`)

Already real time; the job is to make the time visible.
- [x] Bars (energy, nerve and similar) fill smoothly between ticks instead of stepping.
- [x] Timed actions (courses, journeys, work) show a live, smoothly moving progress bar and countdown.
- [x] Action results: floating gains and losses, a pulse on what changed, a shake on a failure.
- [x] Money and stats count up.
- [x] New log or message lines rise in.

## The Tea Race (`packages/tea-race`)

- [x] Dice roll: the die tumbles briefly before the result shows.
- [x] Ships sail along the path on the map node by node instead of jumping to the destination.
- [x] AI opponents' turns replayed in sequence (roll, move, trade) with a skip control.
- [x] Cash and share counts count up; sales and purchases give a floating amount.
- [x] Event cards and port panels enter with a short animation.

## Steady Eddie (`packages/steady-eddie`)

Fork of The Tea Race; same list, haulage vocabulary.
- [x] Dice roll tumble.
- [x] Lorry drives along the road on the map node by node.
- [x] AI hauliers' turns replayed in sequence with a skip control.
- [x] Cash and share counts count up; deliveries give a floating amount.
- [x] Event cards and depot panels enter with a short animation.

## Done means, per game

- [x] `npm run check` passes (typecheck, every harness, shared copies in sync).
- [x] Loaded in a browser at all three paces, in light and dark mode, with no console errors and no
      blank screen (hooks placed before any early return).
- [x] With `Motion: off` the game looks and behaves as before.
- [x] Every new colour is a theme token in both blocks of the game's `styles.css`.
- [x] A short entry in the game's design document build log.

## Follow-up round (2026-11-08): done

- [x] Shared key-aware clocks: `useTween`, `useTweenOnChange`, `useSteps`, `useStagger` in
      `motion.ts`. Thrash Margin's `useBeats.ts` and Steady Eddie's `usePlayback.ts` are deleted;
      Banco, The Tea Race and Niccolò Rising use the shared clocks. They start at 0 on mount (no
      frame of the end state) and keep their place when the pace moves between full and quick.
- [x] Shared floating amounts: `useFloats`, `FloatText` (optional `className`), `signed`,
      `replayClass`. Every game's HTML floats use them.
- [x] Steady Eddie's replay budgeted: mean round 5.5s to 2.9s, worst 12.6s to 3.8s (three rivals,
      full pace, 60 seeds x 40 rounds). Hard cap 3.8s a round.
- [x] Niccolò Rising's Infirmary and Steen statuses record `since` (the action's `at`); the bar
      resumes after a reload. Older saves fall back to timing from first sight.
- [x] Steady Eddie hot seat: the hand-over card no longer covers a running replay; it waits for
      the replay to end or be skipped.
- [x] Fixed on the way: Thrash Margin's guided turn restarted from its welcome card after the
      dispatch (from `main`'s tour work); Steady Eddie's guided run dimmed the replay; The Tea Race
      and Steady Eddie could queue the same event card twice after a replay.

## The rule those last three bugs share

Three separate bugs were one mistake: two things that each want the whole screen (a replay, a
modal, a guided tour, a hand-over card) were allowed on screen together, or one was unmounted to
make room and lost its place. For any new screen element that owns the display:

1. Decide its order against the others explicitly: hand-over card, then replay, then dispatch or
   event, then guided tour. A later one waits for an earlier one to finish or be skipped.
2. Hide, never unmount, anything that holds progress (a tour, a replay). Pass a `hidden` prop.
3. Anything that consumes a log by a "seen" marker must tolerate the board going backwards (a
   replay rewinds the view), so de-duplicate by `seq`.

## Still open

- Owner decision: The Tea Race keeps its 700ms ship glide at pace `off`, because off was defined as
  "as before". Change the `glide` condition in `ShipMarker` if off should mean no movement.
- Steady Eddie with four or five rivals: most rounds hit the 3.8s cap and the shortest step drops to
  about 0.15s. Play-test a big table.
- Map floats stay local in Thrash Margin and Steady Eddie: they are SVG `<text>` tied to a territory
  or depot, which `FloatText` (an HTML span) and `useFloats` (no per-item payload) cannot carry.
  Worth a shared SVG float only if a third map needs one.
- Banco keeps `useWeekStagger`, a thin wrapper that fixes the reveal length at the week turn, skips
  on input and plays nothing on first mount. Fold into `useStagger` only if another game needs it.
- The Tea Race's `TumblingDice` keeps its own timer; it could now move to `useTween`.
