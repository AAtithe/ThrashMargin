# The Founder's Ledger (claude.ai version)

A CEO coaching game for Tom Stanley.

- `founders-ledger.html` is the source of the page published privately on claude.ai at
  https://claude.ai/artifact/6f9k1qFRKeYRbmipR8BrNj. It runs on claude.ai's artifact runtime: saving
  to the account (`db`), and Claude writing the weekly call and the 2030 letter draft (`sample`).
- The portal version is `packages/founders-ledger`, served at `/founders-ledger/` behind sign-in and
  opt-in game access (see CLAUDE.md). Its engine (`src/ledger/engine.js`) began as this page's script.
  The two are separate copies: a coaching change made in one is not made in the other.
- Nothing in this folder is served: `scripts/build-portal.sh` does not copy it.
- The Reset (a three-minute loop for loud days: name it, sort it, one receipt from the ledger, one move)
  exists only in the portal version. It is played as often as a hard day needs, softly capped at six
  a day; its moves score 5 each and only three a day score, so the ledger never rewards reaching for it.
  The rules are in `packages/founders-ledger/scripts/drive.ts`.
- Also portal-only: daily system calls (24, operations and sales alternating, one a day; mastery
  rather than points), the phone-off day (plan, a brief to send the team, then a return log of what
  waited, what was handled and what stalled, each stall becoming a fix), and fear and reality in the
  Friday review. All three feed the Reset receipts and the momentum card on Today.
- The coach (Claude) on the portal: `packages/founders-ledger/api/game/coach.ts`, reached as
  `/api/play/founders-ledger?coach=<task>` behind sign-in and game access. Switched on by setting
  `ANTHROPIC_API_KEY` in the Vercel project's environment variables; without it the game runs on its
  built-in bank exactly as before. The prompts live on the server; the browser sends only the facts a
  task needs. Tasks: `readback` (Claude's read in the Reset and a suggested move), `pressure` (a call
  written from the player's own line), `call` (the weekly call from the closed week), `letterDraft`
  and `letterCoach`. The model named in coach.ts, with structured output and refusal fallback; 30 an
  hour and 120 a day per account. Words that suggest a crisis get a support card (Samaritans, GP,
  999) with no coaching and no model call. Covered by `npm run drive:fl` (prompts, checks, backstop)
  and `npm run test:api` (the whole path, against a local stand-in for the API).
