# The Thrash Margin portal — working notes

Seven games served from one deployment, one Postgres/Supabase instance, and one account system:
`packages/thrash-margin`, `packages/niccolo`, `packages/niccolo-rising`, `packages/steady-eddie`,
`packages/tea-race`, `packages/fireline`, and `packages/founders-ledger` (a CEO coaching game, opt-in: see below).
Each game's design document is at the repo root (`tea-race-design.md`, and so on) and carries its own
build log; read the relevant one before changing a game's rules.

---

## Invariants — do not break these

### 1. Every game requires a signed-in account. There is no guest path.

All seven lobbies gate on `if (!user)` and show a sign-in panel. **Do not add a guest, anonymous,
demo, or "try it without an account" route back in**, and do not relax the gate to make local
development or testing easier. A guest path existed once and was deliberately removed
(`7c0e0a0`); it is not an oversight and it is not a TODO.

The gate lives at:

| Game | File |
|---|---|
| Thrash Margin | `packages/thrash-margin/client/src/pages/Lobby.tsx` |
| Banco di Niccolò | `packages/niccolo/src/pages/Lobby.tsx` |
| Niccolò Rising | `packages/niccolo-rising/src/pages/Lobby.tsx` |
| Steady Eddie | `packages/steady-eddie/src/pages/Lobby.tsx` |
| The Tea Race | `packages/tea-race/src/pages/Lobby.tsx` |
| Fireline | `packages/fireline/src/pages/Lobby.tsx` |
| The Founder's Ledger | `packages/founders-ledger/src/App.tsx` |

**Where the gate is, and is not, enforced.** Be precise about this, because the two halves are
easy to confuse and only one of them is a security boundary:

- The lobby check is **presentational**. It reads `tm_user` from `localStorage`
  (`lib/portalAuth.ts`) and decides what to render. It is trivially satisfied client-side and
  protects nothing on its own. It still must stay: it is what stops the app inviting anyone to
  start a game they cannot save.
- The **actual boundary is server-side**, in `api/_lib/auth.ts`. `getUser(req)` requires an
  `Authorization: Bearer <jwt>` header and verifies it against `JWT_SECRET`; every game endpoint
  calls it and returns **401** otherwise. That is what protects the data, and it must never be
  removed, made optional, or given a bypass for any environment.

**Verifying the UI locally without weakening the gate.** Set the stored user in the browser
console — client-side only, grants no server access, and cloud saves will correctly 401:

```
localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }))
```

Use that for local UI checks. Never change the gate, add an env-var escape hatch, or stub
`getUser` to make a test pass.

### Game access is per account, and enforced in `api/play/[kind].ts`

Admins turn games on and off on the Admin page: per account, per game for every account, and a
"new accounts" setting copied onto each account when it registers (`portal_settings`
`new_account_games`). The value lives in `users.game_access` (NULL means every game, including ones
added later). `api/play/[kind].ts` refuses any game the account lacks with 403 before the game's own
handler runs; that is the boundary. The lobbies' `hasGameAccess` check and the welcome page hiding
cards are presentational, exactly like the sign-in gate. Logic: `packages/thrash-margin/api/_lib/access.ts`.

Accounts also carry a `users.status`: `active`, `pending` (registered while the Admin page's "require
approval" setting was on) or `suspended`. `getUser` refuses any session whose account is not active,
on every request, so suspension takes effect at once; suspending also stamps `password_changed_at`,
so reinstating does not revive an old session. Admin actions on accounts (approve, reject, suspend,
delete) never target the caller or an admin, and every one is written to the access history.

A game marked `optIn` in `shared/games.ts` (The Founder's Ledger) is the exception to "NULL means every
game": no account has it until an admin turns it on, so adding one never shows it to every account.
Its landing card is `hidden` in the HTML for the same reason. `npm run test:api` covers the rules.

### 2. `packages/tea-race/src/sim/`, `packages/niccolo-rising/src/sim/` and `packages/fireline/src/sim/` are pure

No `Math.random`, no clock. Dice come from `rng.ts` against the persisted `rngSeed`, and
`createdAt` is passed in by the caller. Niccolò Rising runs in real time, so every one of its
actions carries its own `at` timestamp and the reducer never reads a clock either. This is what
makes a game replay byte-identically and what makes `scripts/drive.ts` a real test rather than a
smoke test.

An **illegal action returns the same state object** (reference equality). The AI loop uses that to
detect a rejected move and the save hooks use it to skip a pointless write.

### 3. The faithful rulesets stay reachable

Optional rules live behind toggles, and every preset states every toggle explicitly — the harness
asserts it, so a newly added rule cannot leak into a faithful game by omission.

---

## Working practices that have earned their place

- **`npm run check` before pushing.** Every typecheck and every game's test suite in one command.
  The Vercel build runs it first and does not deploy on failure; GitHub Actions runs it on every
  push (`.github/workflows/ci.yml`).
- **`npm run test:api` after touching anything under `api/`.** The server code against a real
  Postgres that includes Supabase's own `auth.users` table, built from `db/schema.sql`, plus a second
  pass on a pre-existing database to test the API's automatic setup. Needs
  `API_TEST_DATABASE_URL` pointing at a local database (it is wiped). An admin bug once passed every
  test and failed live because the test database lacked Supabase's tables.
- **Shared portal code lives once, in `shared/portal/`** (server: auth, database, CORS, schema,
  saves, rate limits; browser: session, save queue). Each game gets a generated copy in its own
  `api/_lib/` and `src/lib/`; never edit a copy. Edit the original, run `npm run sync-shared`, and
  `npm run check` fails while any copy differs. Copies, not imports, because a cross-package import
  once broke production: Vercel left the file out of the deployed function (see PROGRESS.md).
- **Adding a game:** one entry in `packages/thrash-margin/shared/games.ts` (feedback, profile and
  admin read it), one line in `api/play/[kind].ts` (its saves endpoint), and its build in
  `scripts/build-portal.sh` and `scripts/check.sh`. No new Vercel function.
- **Read query values with `queryParam(req, name)`** (`api/_lib/query.ts`), never `req.query`.
  Vercel builds `req.query` with Node's deprecated `url.parse`, which logged a DeprecationWarning
  on every request that read it. Route segments (`[kind]`, `[mode]`, `[resource]`) arrive the same
  way. `npm run test:api` throws if any handler reads `req.query`.
- **Schema changes** go in `db/schema.sql` and, for the live database, in
  `packages/thrash-margin/api/_lib/schema.ts`, which applies them automatically on first use.
- **`npm run drive` before trusting anything.** ~370,000 assertions over 20 seeds in a couple of
  seconds. Use a wide seed set: pathologies in this codebase's history showed up in some seeds and
  not others, and a five-seed run once reported two bugs fixed while they were still there.
- **Fireline has its own harness: `npm run drive:fire`** (whole computer-against-computer battles over
  28 seeds, every order, the campaign's heroes, powers, objectives and mission AI modes, aircraft and
  research, and three- and four-sided battles; about 345,000 assertions, about 4 minutes; `-- --seeds 60` for a wider sweep, `-- --campaign` for the
  campaign sections alone). `npm run campaign:fire` checks progression and builds and runs all eight
  missions; both are in `npm run check`. `npm run ladder:fire` pits AI commanders over 150 seeds
  (about 10 minutes, so not in check); use it for any balance or AI change. Fireline is real time: it saves every 15 seconds of play rather than per action, and
  its guided tour runs on the live battle (see `fireline-design.md` §5).
- **Thrash Margin has its own harness: `npm run drive:tm`** (about 12,000 assertions, every map and
  difficulty). Its engine (`packages/thrash-margin/shared/sim/`) follows the same purity rule as the
  Tea Race's `sim/`: no `Math.random`, no clock, illegal actions return the same state object.
- **Typecheck before trusting any measurement taken mid-refactor.** `tsx` transpiles without
  typechecking, so a half-finished rename makes every game look broken and can cost half a session.
- **Win-rate comparisons need 150+ seeds.** At 20 the noise is about ±10 points and at 40 about ±8;
  three difficulty levels once read as non-monotonic purely from sampling.
- **Load the page after adding a React hook.** Hooks placed after an early return render
  conditionally; `tsc` and the harness both pass and the screen is blank.
- **`npm run tours` after touching any tutorial, tour, coach or onboarding screen.** Plays every
  game's tutorial in a real browser (`scripts/tours/<game>.cjs`, started by `scripts/tours/run.mjs`,
  which runs each game's Vite server itself); `--quick` is what CI runs, and naming games runs only
  those. Every tour driver waits 1.5s on each new step before acting and fails if the step moved:
  a step that completes itself is the bug that hides from a fast script, and it shipped once
  (Thrash Margin's attack step read as done on arrival because it watched the game log). Each
  driver also checks the save for the real effects of the run, and none of them may pass on timing
  luck. Thrash Margin's card also carries `data-tour-done` while it pauses after a finished step.
- **A guided tour is only verified by driving it in a browser.** All six tour cards carry
  `data-tour-target`, naming the element actually being ringed — the resolved one, where a step
  offers several candidates — so a script can walk every step by clicking what the card names
  rather than guessing from the copy. Niccolò Rising's card also carries `data-tour-manual`, for
  its one step that is read rather than acted on. Five classes of bug show up there and nowhere
  else: a step whose predicate reads true before the run begins, a step that can un-complete
  itself, a spotlight measured while a smooth scroll is still moving the target, a step pointing
  at a control the game has disabled until some other thing is done first, and a target that is
  simply off the bottom of the window because nothing scrolled to it. None are visible to `tsc`
  or to `npm run drive`, which never render anything. Banco di Niccolò's tour was the last to get
  the hooks and was carrying two of the five (see PROGRESS.md, 2026-11-08) after months of being
  played by hand without either being noticed.
- **Where a tour resumes is the caller's business, not the tour's.** Guessing it from the game
  state cannot work: predicates that are honest mid-run read true on an untouched board, so the
  guess opens past the welcome card. Four of the five walk their steps in order and stop at the
  first unfinished one, which never reaches the dishonest predicates; Niccolò always opens a fresh
  tour on the welcome card. All of them stay mounted through modals (a `hidden` prop, returned
  after every hook), so an interrupted run keeps its own place.
- **Light and dark mode: colours are CSS variables.** Each game's `theme.ts` hands out
  `var(--…)` strings; the values, one block per mode, are in that game's `styles.css` (portal
  chrome in `portal.css`, identical in every package). `lib/colorScheme.ts` stores the choice under
  `tm_theme`, shared by all five games and the landing page, and `theme-init.js` (an external file,
  because the CSP forbids inline scripts) applies it before first paint. Both live in
  `shared/portal/client/` and are copied out by `npm run sync-shared`. A new colour is a token in both blocks, never a hex literal in a component, and never
  hex alpha appended to a token (`${UI.bad}55` is invalid CSS). Check both modes in the browser.
- **Loading states use the shared loader**, `lib/Loading.tsx` (original in `shared/portal/client/`):
  `LoadingScreen` for a game screen waiting on its save, `LoadingRows` for a saves list,
  `BusyLabel` for a button whose request is in flight. Nothing shows for the first 300ms, a load
  still running at 8 seconds offers Try again, errors show at once with Try again (an expired
  sign-in gets Sign in again instead), reduced motion stops all movement. The standard and its
  reasons are in `loading-animations-plan.md`. Each `index.html` also carries a CSS-only loader
  inside `#root` for the bundle download, with colours copied from the game's tokens; keep it, and
  keep the colours in step, when editing those files.
- **`npm run check:loading` after touching a loading state** (the shared loader, a game screen's
  load branch, a lobby's saves list, an `index.html`, or a game's palette). Drives every game in
  Chromium with the API intercepted (the Founder's Ledger, which has no lobby, through its own
  routine), about 180 checks in a few minutes; starts and stops its
  own dev servers. Needs Playwright, so it is not part of `npm run check`.
- **Never `git add -A` without reading `git status` first.** A commit in this repo once swept four
  other games' uncommitted lobby changes in under an unrelated message. Stage deliberately.
