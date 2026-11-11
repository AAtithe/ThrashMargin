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
