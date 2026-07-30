#!/usr/bin/env node
/**
 * Export projected pixel positions for every place at a given canvas width.
 * Use this to overlay interactive hotspots on top of the rendered SVG.
 *
 *   node scripts/positions.mjs --width 5200
 *
 * Output: output/positions-<width>.json
 *   { width, height, places: [{ id, name, region, lon, lat, x, y, label:{x,y,anchor} }] }
 *
 * Because the projection is a pure function of (lon, lat, width), you can also
 * call createProjector at runtime instead of shipping this file. Do that if the
 * game canvas resizes.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMap } from '../src/renderMap.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (p) => JSON.parse(await readFile(resolve(root, p), 'utf8'));

const wIdx = process.argv.indexOf('--width');
const width = wIdx > -1 ? Number(process.argv[wIdx + 1]) : 5200;

const gazetteer = await json('data/gazetteer.json');
const geography = await json('data/geography.json');
const routes = await json('data/routes.json');

const { height, placed } = renderMap({ gazetteer, geography, routes, options: { width } });

const out = {
  width,
  height: Math.round(height),
  projection: 'donis-trapezoidal',
  places: placed.map((p) => ({
    id: p.id,
    name: p.name,
    region: p.region,
    lon: p.lon,
    lat: p.lat,
    x: Number(p.x.toFixed(2)),
    y: Number(p.y.toFixed(2)),
    label: { x: Number(p.tx.toFixed(2)), y: Number(p.ty.toFixed(2)), anchor: p.anchor, leader: !!p.lead }
  })),
  routes: routes.routes.map((r) => ({ id: r.id, name: r.name, colour: r.colour, via: r.via }))
};

const path = resolve(root, `output/positions-${width}.json`);
await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify(out, null, 2), 'utf8');
console.log(`wrote ${path} (${out.places.length} places)`);
