#!/usr/bin/env node
/**
 * Sanity checks on the data. Run this after editing any JSON.
 *
 *   node scripts/validate.mjs
 *
 * Checks:
 *  1. Every place is inside the landmass or an island, and not inside a carved sea.
 *  2. Every place is inside the map domain.
 *  3. Every route id resolves to a real place.
 *  4. Reports label leader-line count as a crowding signal.
 *
 * Point-in-polygon is done in DEGREE space, which is correct because the
 * projection is monotonic in both axes. It does not depend on canvas size.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMap } from '../src/renderMap.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (p) => JSON.parse(await readFile(resolve(root, p), 'utf8'));

function inRing(lon, lat, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const gazetteer = await json('data/gazetteer.json');
const geography = await json('data/geography.json');
const routes = await json('data/routes.json');

const { lonMin, lonMax, latMin, latMax } = geography.domain;
const problems = [];

for (const p of gazetteer.places) {
  if (p.lon < lonMin || p.lon > lonMax || p.lat < latMin || p.lat > latMax) {
    problems.push(`${p.name} is outside the map domain`);
    continue;
  }
  const onMain = inRing(p.lon, p.lat, geography.landmass);
  const onIsle = geography.islands.find((i) => inRing(p.lon, p.lat, i.ring));
  const inSea = geography.seas.find((s) => inRing(p.lon, p.lat, s.ring));
  if (inSea && !onIsle) problems.push(`${p.name} falls inside ${inSea.name}`);
  else if (!onMain && !onIsle) problems.push(`${p.name} falls in open water`);
}

const ids = new Set(gazetteer.places.map((p) => p.id));
for (const r of routes.routes) {
  for (const v of r.via) if (!ids.has(v)) problems.push(`route ${r.id} references unknown place "${v}"`);
}

const { placed } = renderMap({ gazetteer, geography, routes, options: { width: 4200 } });
const leaders = placed.filter((p) => p.lead);

if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log('  - ' + p);
} else {
  console.log(`all ${gazetteer.places.length} places sit on land, all route ids resolve`);
}
console.log(`labels needing a leader line at 4200px: ${leaders.length}${leaders.length ? ' (' + leaders.map((l) => l.name).join(', ') + ')' : ''}`);
process.exit(problems.length ? 1 : 0);
