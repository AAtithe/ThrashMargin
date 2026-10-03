# The Thrash Margin portal — working notes

Five games served from one deployment, one Postgres/Supabase instance, and one account system:
`packages/thrash-margin`, `packages/niccolo`, `packages/niccolo-rising`, `packages/steady-eddie`,
`packages/tea-race`.
Each game's design document is at the repo root (`tea-race-design.md`, and so on) and carries its own
build log; read the relevant one before changing a game's rules.

---

## Invariants — do not break these

### 1. Every game requires a signed-in account. There is no guest path.

All five lobbies gate on `if (!user)` and show a sign-in panel. **Do not add a guest, anonymous,
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

### 2. `packages/tea-race/src/sim/` and `packages/niccolo-rising/src/sim/` are pure

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
- **Adding a game:** one entry in `packages/thrash-margin/shared/games.ts` (feedback, profile and
  admin read it), one line in `api/play/[kind].ts` (its saves endpoint), and its build in
  `scripts/build-portal.sh` and `scripts/check.sh`. No new Vercel function.
- **Schema changes** go in `db/schema.sql` and, for the live database, in
  `packages/thrash-margin/api/_lib/schema.ts`, which applies them automatically on first use.
- **`npm run drive` before trusting anything.** ~370,000 assertions over 20 seeds in a couple of
  seconds. Use a wide seed set: pathologies in this codebase's history showed up in some seeds and
  not others, and a five-seed run once reported two bugs fixed while they were still there.
- **Thrash Margin has its own harness: `npm run drive:tm`** (about 12,000 assertions, every map and
  difficulty). Its engine (`packages/thrash-margin/shared/sim/`) follows the same purity rule as the
  Tea Race's `sim/`: no `Math.random`, no clock, illegal actions return the same state object.
- **Typecheck before trusting any measurement taken mid-refactor.** `tsx` transpiles without
  typechecking, so a half-finished rename makes every game look broken and can cost half a session.
- **Win-rate comparisons need 150+ seeds.** At 20 the noise is about ±10 points and at 40 about ±8;
  three difficulty levels once read as non-monotonic purely from sampling.
- **Load the page after adding a React hook.** Hooks placed after an early return render
  conditionally; `tsc` and the harness both pass and the screen is blank.
- **Light and dark mode: colours are CSS variables.** Each game's `theme.ts` hands out
  `var(--…)` strings; the values, one block per mode, are in that game's `styles.css` (portal
  chrome in `portal.css`, identical in every package). `lib/colorScheme.ts` stores the choice under
  `tm_theme`, shared by all five games and the landing page, and each `index.html` applies it before
  first paint. A new colour is a token in both blocks, never a hex literal in a component, and never
  hex alpha appended to a token (`${UI.bad}55` is invalid CSS). Check both modes in the browser.
- **Never `git add -A` without reading `git status` first.** A commit in this repo once swept four
  other games' uncommitted lobby changes in under an unrelated message. Stage deliberately.
