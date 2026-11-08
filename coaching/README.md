# The Founder's Ledger

A private CEO coaching game for Tom Stanley. It is not a portal game and is not deployed.

- `founders-ledger.html` is the source of the page published privately on claude.ai at
  https://claude.ai/artifact/6f9k1qFRKeYRbmipR8BrNj. That page is the live version.
- It runs on claude.ai's artifact runtime: saving to the account (`db`), and Claude writing the
  weekly call and the 2030 letter draft (`sample`). Opened anywhere else it saves to the browser only
  and falls back to the built-in call bank and a plain letter layout.
- `scripts/build-portal.sh` copies only `landing/` and the five game builds into `dist/`, so nothing
  in this folder is served by the portal. Keep it that way: every portal game must sit behind the
  sign-in gate (see CLAUDE.md, invariant 1), and this page has none.

To change the game, edit `founders-ledger.html` and republish it to the same artifact URL.
