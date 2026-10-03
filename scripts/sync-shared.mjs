#!/usr/bin/env node
// Copies the portal's shared code (shared/portal/) into each game.
//
//   npm run sync-shared          write the copies
//   npm run sync-shared -- --check   fail if any copy differs (scripts/check.sh runs this)
//
// Why copies rather than imports: importing across package boundaries once broke production.
// Vercel's function file tracing left the cross-package file out of the deployed bundle
// (FUNCTION_INVOCATION_FAILED, see PROGRESS.md). Each game therefore keeps its own files and
// deploys exactly as before; this script makes sure they are all the same file, so a change is
// made once, in shared/portal/, and cannot be missed in one game.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = ['auth.ts', 'cors.ts', 'db.ts', 'rateLimit.ts', 'saves.ts', 'schema.ts'];
const CLIENT = ['session.ts', 'saveQueue.ts', 'colorScheme.ts'];
const GAMES = [
  { server: 'packages/thrash-margin/api/_lib', client: 'packages/thrash-margin/client/src/lib', public: 'packages/thrash-margin/client/public' },
  { server: 'packages/niccolo/api/_lib', client: 'packages/niccolo/src/lib', public: 'packages/niccolo/public' },
  { server: 'packages/niccolo-rising/api/_lib', client: 'packages/niccolo-rising/src/lib', public: 'packages/niccolo-rising/public' },
  { server: 'packages/tea-race/api/_lib', client: 'packages/tea-race/src/lib', public: 'packages/tea-race/public' },
  { server: 'packages/steady-eddie/api/_lib', client: 'packages/steady-eddie/src/lib', public: 'packages/steady-eddie/public' },
];
// Served as a plain file (index.html loads it before first paint), so it goes in each game's Vite
// public folder and beside the landing page rather than into src/.
const PUBLIC = ['theme-init.js'];

const check = process.argv.includes('--check');
const banner = src =>
  `// GENERATED from ${src} by scripts/sync-shared.mjs. Do not edit this copy: edit the original,\n` +
  `// then run \`npm run sync-shared\`. \`npm run check\` fails while any copy differs.\n`;

const jobs = [];
for (const g of GAMES) {
  for (const f of SERVER) jobs.push([`shared/portal/server/${f}`, `${g.server}/${f}`]);
  for (const f of CLIENT) jobs.push([`shared/portal/client/${f}`, `${g.client}/${f}`]);
  for (const f of PUBLIC) jobs.push([`shared/portal/client/${f}`, `${g.public}/${f}`]);
}
for (const f of PUBLIC) jobs.push([`shared/portal/client/${f}`, `landing/${f}`]);

const stale = [];
for (const [src, dest] of jobs) {
  const want = banner(src) + readFileSync(path.join(ROOT, src), 'utf8');
  const destPath = path.join(ROOT, dest);
  const have = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
  if (have === want) continue;
  if (check) stale.push(dest);
  else {
    mkdirSync(path.dirname(destPath), { recursive: true });
    writeFileSync(destPath, want);
  }
}

if (check && stale.length) {
  console.error('Shared code copies differ from shared/portal/. Run `npm run sync-shared`:');
  for (const s of stale) console.error('  ' + s);
  process.exit(1);
}
console.log(check ? `shared code: all ${jobs.length} copies match` : `shared code: ${jobs.length} copies written`);
