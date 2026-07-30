#!/usr/bin/env node
/**
 * Render the Ptolemaic Niccolo map to an SVG file.
 *
 *   node scripts/render.mjs
 *   node scripts/render.mjs --width 6000 --out output/big.svg
 *   node scripts/render.mjs --width 1200 --max-rank 1 --no-hatch
 *   node scripts/render.mjs --convergence 0.8 --lat-stretch 1.3
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMap } from '../src/renderMap.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key.startsWith('no')) { o[key[2].toLowerCase() + key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { o[key] = isNaN(Number(next)) ? next : Number(next); i++; }
    else o[key] = true;
  }
  return o;
}

const a = args(process.argv);
const json = async (p) => JSON.parse(await readFile(resolve(root, p), 'utf8'));

const gazetteer = await json('data/gazetteer.json');
const geography = await json('data/geography.json');
const routes = await json('data/routes.json');

const options = {
  width: a.width ?? 4200,
  convergence: a.convergence ?? 0.55,
  latStretch: a.latStretch ?? 1.15,
  maxRank: a.maxRank ?? 3,
  hatch: a.hatch !== false,
  sketch: a.sketch !== false
};

const { svg, width, height, placed } = renderMap({ gazetteer, geography, routes, options });

const out = resolve(root, a.out ?? `output/niccolo-map-${width}.svg`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, svg, 'utf8');

const leaders = placed.filter((p) => p.lead).length;
console.log(`wrote ${out}`);
console.log(`canvas ${width} x ${Math.round(height)}  places ${placed.length}  leader lines ${leaders}`);
