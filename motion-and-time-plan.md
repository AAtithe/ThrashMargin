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
  `usePace`, `paced`, `useCountUp`, `useProgress`, `useSequence`, `useSkipOnInput`, `pause`,
  `easeOut`, and shared keyframes (`tm-anim-pop / fade / rise / float / pulse / shake / tumble /
  glow`) whose durations scale with the pace.
- [x] `MotionToggle` beside the light/dark toggle in every portal nav and in-game header.
- [x] `initMotion()` in every `main.tsx`.
- [x] Shared keyframes prefixed `tm-motion-` after the unprefixed names overrode two of Thrash
      Margin's own; floating markers hidden when motion is off or the OS asks for reduced motion.

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

- [ ] Dice roll: the die tumbles briefly before the result shows.
- [ ] Ships sail along the path on the map node by node instead of jumping to the destination.
- [ ] AI opponents' turns replayed in sequence (roll, move, trade) with a skip control.
- [ ] Cash and share counts count up; sales and purchases give a floating amount.
- [ ] Event cards and port panels enter with a short animation.

## Steady Eddie (`packages/steady-eddie`)

Fork of The Tea Race; same list, haulage vocabulary.
- [ ] Dice roll tumble.
- [ ] Lorry drives along the road on the map node by node.
- [ ] AI hauliers' turns replayed in sequence with a skip control.
- [ ] Cash and share counts count up; deliveries give a floating amount.
- [ ] Event cards and depot panels enter with a short animation.

## Done means, per game

- [ ] `npm run check` passes (typecheck, every harness, shared copies in sync).
- [ ] Loaded in a browser at all three paces, in light and dark mode, with no console errors and no
      blank screen (hooks placed before any early return).
- [ ] With `Motion: off` the game looks and behaves as before.
- [ ] Every new colour is a theme token in both blocks of the game's `styles.css`.
- [ ] A short entry in the game's design document build log.
