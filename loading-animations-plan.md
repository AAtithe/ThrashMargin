# Loading animations: plan, standard and checklist

Every game in the portal has three moments where the player waits:

1. **Bundle download.** The browser has the HTML but not yet the JavaScript. Before this work the
   screen was blank, because every `index.html` had an empty `<div id="root">`.
2. **Save fetch.** The game screen is mounted and waiting for `GET /api/play/<kind>?id=…`. Before
   this work each game showed one line of text, and a failure swapped the words and nothing else.
3. **Game creation and the saves list.** The lobby's Begin button while `POST` is in flight, and the
   saves list before the first `GET /api/play/<kind>` has answered (an empty list read as "you have
   no games").

Each item below is ticked only once it is built and checked. The build log at the end records what
was verified and how.

---

## Phase 1. The standard

- [x] 1.1 Three moments named and each one covered (above).
- [x] 1.2 **Delay before showing: 300ms.** Pure CSS (`animation-delay`), so no timer hook and no
      state. A load that finishes inside 300ms shows nothing at all; a spinner that flashes for
      100ms makes the app feel slower than no spinner.
- [x] 1.3 **No minimum display time.** Holding a loaded game back so an animation can finish costs
      the player time for nothing. The 300ms delay already removes the flicker case.
- [x] 1.3a **Handover.** A loader that replaces a visible one (Banco di Niccolò: code chunk, then
      save) shows at once, so two stages read as one load. A loader that was never visible does not
      count, so a fast first stage cannot make the second one flash.
- [x] 1.4 **Errors show at once**, with no delay, a distinct glyph in the game's `bad` colour,
      `role="alert"`, and a Retry button beside Back to the lobby.
- [x] 1.5 One motif per game, behaviour shared:
      | Game | Motif |
      |---|---|
      | Thrash Margin | three linked territories, a pulse running along the line |
      | Banco di Niccolò | an open ledger, a page turning |
      | Niccolò Rising | a coin dropping onto a stack |
      | Steady Eddie | a lorry on a moving road, wheels turning |
      | The Tea Race | a clipper riding the swell |
- [x] 1.6 In-world captions kept ("Loading the voyage…" and so on), shown under the motif.

## Phase 2. One shared component

- [x] 2.1 `shared/portal/client/Loading.tsx`: `LoadingScreen`, `LoadingRows` (skeleton) and
      `BusyLabel` (button). Added to `CLIENT` in `scripts/sync-shared.mjs`; copies generated into
      every game's `lib/`. Never edit a copy.
- [x] 2.2 CSS and inline SVG only. No GIF, no Lottie, no new dependency.
- [x] 2.3 Colours are tokens only (`var(--ui-…)` with a `var(--portal-…)` fallback). No hex
      literal in the component.
- [x] 2.4 `prefers-reduced-motion: reduce` stops every movement; the loader still appears, still,
      and still after 300ms (a class rule outranks each game's global `* { animation: none }`).
- [x] 2.5 Banco di Niccolò's `styles.css` gains the reduced-motion block the other four already had.
- [x] 2.6 Accessibility: `role="status"`, `aria-live="polite"`, `aria-busy` while loading; the
      motif SVG is `aria-hidden`; the caption is the accessible text.
- [x] 2.7 The keyframes ship in a `<style>` element the component renders. The CSP allows inline
      styles (`style-src 'self' 'unsafe-inline'`) and forbids inline scripts, and this needs none.

## Phase 3. The blank screen before React loads

- [x] 3.1 A static CSS-only loader inside `<div id="root">` in all five `index.html` files. React's
      `createRoot().render()` replaces it on mount, so it costs nothing afterwards.
- [x] 3.2 No script. Colours defined for light and dark under `:root[data-theme="dark"]`, which
      `theme-init.js` sets before first paint, so a dark-mode player gets no white flash.
- [x] 3.3 Same 300ms delay as the in-app loader.

## Phase 4. Wiring, game by game

Game screen loaders (with Retry):
- [x] 4.1 Thrash Margin, `client/src/pages/Game.tsx`. Also fixes a flash of "Campaign not found."
      on the first render, before the load had started.
- [x] 4.2 Banco di Niccolò, `src/pages/GameScreen.tsx`.
- [x] 4.3 Banco di Niccolò, the lazy-load `Suspense` fallback in `src/main.tsx`, using the same
      component, so the two stages read as one load.
- [x] 4.4 Niccolò Rising, `src/pages/GameScreen.tsx` (`!view` branch).
- [x] 4.5 Steady Eddie, `src/pages/GameScreen.tsx`.
- [x] 4.6 The Tea Race, `src/pages/GameScreen.tsx`.

Lobby Begin buttons:
- [x] 4.7 Thrash Margin: Start campaign, Play the tutorial, campaign acts.
- [x] 4.8 Banco di Niccolò: Begin.
- [x] 4.9 Niccolò Rising: Begin.
- [x] 4.10 Steady Eddie: Begin with N hauliers.
- [x] 4.11 The Tea Race: Begin with N captains.

Lobby saves lists:
- [x] 4.12 `savesLoaded` added to every game's cloud hook (true after the first list request
      answers, success or failure) and local hook (always true), and to the hook types.
- [x] 4.13 Skeleton rows while `!savesLoaded`, in all five lobbies.

Guard rails:
- [x] 4.14 The `if (!user)` sign-in gate untouched in all five lobbies; no loader in front of it.
- [x] 4.15 No hook placed after an early return.

## Phase 5. Verify

- [x] 5.1 `npm run sync-shared`, then `npm run check`.
- [x] 5.2 Every game loaded in a browser: loader visible on a slow save fetch, light and dark.
- [x] 5.3 Reduced motion: loader appears with no movement.
- [x] 5.4 Failed load (forced 500): error view, Retry re-fetches and opens the game.
- [x] 5.5 Static bundle loader checked in a built page with the bundle held back.
- [x] 5.6 Screenshots of every loader in both modes.
- [x] 5.7 Guided tours still offered once the game opens.

## Phase 6. Ship

- [x] 6.1 Staged file by file after reading `git status`; no `git add -A`.
- [x] 6.2 Pushed to `claude/tender-ride-j92cj0`.

## Phase 7. Improvements after review

The first build covered the happy path and a failed load. Reviewing it as a player found four gaps.

- [x] 7.1 **A hung load was a dead end.** Retry and Back only appeared once a request failed; a
      request that never answers spun forever. After 8 seconds the loader now says the load is
      slow and offers the same actions. Pure CSS: the actions are hidden with `visibility` (so not
      focusable) until the reveal, and reduced motion keeps the 8 seconds.
- [x] 7.2 **An expired sign-in offered "Try again", which can never work,** and the hooks' message
      says "use Sign out above" on full-screen loaders that have no nav bar. Every game screen now
      shows "Your sign-in has expired. Sign in again to open this game." (`SIGN_IN_AGAIN` in the
      shared component) with one button, Sign in again, which clears the stored session and returns
      to the lobby's sign-in panel. Each hook's `SESSION_EXPIRED` is exported for the comparison;
      the lobbies keep the original message, where the nav bar is present. The gate is unchanged.
- [x] 7.3 **The component's own comment was wrong** ("no timer, no state and no hook") after the
      handover record was added. Corrected.
- [x] 7.4 **The browser checks lived only in a scratch folder.** Now `scripts/loading-check.cjs`,
      run with `npm run check:loading` (or `-- <game>` for one). It starts and stops the five dev
      servers itself, intercepts every API call, and covers everything in Phase 5 plus 7.1, 7.2,
      the Niccolò handover and the Begin buttons. Not in `npm run check`, which runs without a
      browser on Vercel and in CI.
- [x] 7.5 **The static loader's colours are copied by hand** from each game's tokens, because the
      stylesheet has not arrived when it shows. The harness now compares them with the live tokens
      after load, in both modes, so a palette change that forgets `index.html` fails the check.
- [x] 7.6 The harness was proved able to fail: with the Tea Race's dark boot colour changed and the
      slow timer cut to 1 second, it reported exactly those two failures (24/26), and passed again
      once both were put back.

---

## Out of scope, deliberately

- The landing page (`landing/`) is static HTML and has no load to cover.
- Mid-game saves already report through each game's save status line; no animation added there.
- Admin, Profile and Feedback pages (Thrash Margin package) are portal chrome, not games.

## Build log

**2026-11-08.** All phases built and verified in one pass.

- `npm run check`: all typechecks, the save queue test and every game's suite pass (Tea Race
  450,229 checks, Steady Eddie 361,127, Niccolò Rising 10.4m assertions, Thrash Margin 11,931,
  Niccolò 85).
- Browser harness (Playwright against each game's Vite dev server, API intercepted, no server):
  95 of 95 checks across the five games. Per game: guided tour still offered after opening; loader
  invisible at 120ms and fully visible at about 1s, in light and dark; game opens when the save
  arrives; lobby placeholder rows shown while the list is slow and gone once it answers, in both
  modes; a 500 shows the error view with `role="alert"`; Try again re-fetches and opens the game;
  reduced motion shows the loader with zero running animations; the static loader is visible with
  the correct background in both modes while `main.tsx` is held back; no page errors.
- Begin buttons: one busy ring, on the button pressed only, in all five lobbies.
- Niccolò handover, sampled every 50ms with a 1s code chunk and a 1.5s save: one fade-in, then
  steady to the end. The first version blinked here, because React renders the new loader before it
  runs the old one's cleanup; fixed with a registry of live loaders.
- Findings fixed along the way: Thrash Margin showed "Campaign not found." for the first frame of
  every load; Niccolò Rising's long caption ran off the screen until the caption was width-limited.
- Not changed: the `if (!user)` gate in every lobby, `api/_lib/auth.ts`, and anything under any
  `sim/`. Harness and screenshots were kept out of the repo (scratch files for this session).

**2026-11-08, improvements (Phase 7).** `npm run check` passes. `npm run check:loading`: 131 of 131
across the five games (26 per game, plus the Niccolò handover). One harness defect found on the way
and fixed: stopping `npx` left Vite running and holding its port, so the next run could not start;
servers now run in their own process group and the whole group is stopped.
