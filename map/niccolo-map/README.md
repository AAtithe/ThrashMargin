# Niccolo map

A data-driven, resolution-independent world map of the House of Niccolo, drawn on the Donis trapezoidal projection using Ptolemy's own coordinates as a 1460s cartographer would have had them. Pen and ink on white paper.

Nothing in this repo stores pixels. Geography is held in Ptolemaic degrees and projected at render time, so the same data produces a 680px thumbnail or an 8000px game asset with identical geometry.

## Quick start

```bash
node scripts/validate.mjs                          # check the data
node scripts/render.mjs --width 5200               # write output/niccolo-map-5200.svg
node scripts/positions.mjs --width 5200            # write pixel positions for hotspots
```

No dependencies. Node 18+, ESM only.

## Coordinate system

This is the part to understand before editing anything.

- **Longitude** is degrees **east of the Fortunate Isles** (the Canaries), which is Ptolemy's prime meridian. It is not Greenwich. Alexandria is 60.5, Rome 36.67, London 20.
- **Latitude** is degrees north, using Ptolemy's figures, which overstate northern latitudes. London is 54, not 51.5.
- The domain is set in `data/geography.json` under `domain`: longitude 0 to 95, latitude 4 to 66.

Longitudes are inflated relative to reality because Ptolemy used 500 stadia to the degree instead of roughly 700. Gibraltar to Antioch spans about 61 degrees here against 41 in reality, which is why the Mediterranean is roughly 40 percent too long. That is deliberate. Every place carries `modernLon` / `modernLat` alongside, unused by the renderer, so you can swap in a geographically correct projection later without re-authoring the gazetteer.

Each place records a `source`:

- `ptolemy` — the figure is from the Geography's gazetteer.
- `interpolated` — the town postdates Ptolemy or falls outside his tables, so it is placed on his framework the way 1460s cartographers bolted Portuguese discoveries onto inherited sheets. Bruges, Venice, Antwerp, Ghent, Dijon, Danzig, Tabriz, Madeira, the Gambia and Timbuktu are all in this category.

## The projection

`src/projection.js` implements the Donis trapezoidal projection used by Nicolaus Germanus.

- Parallels are straight, evenly spaced horizontal lines.
- Meridians are straight lines converging toward the pole.
- The sheet border is therefore a **trapezoid**, wider at the bottom. That is correct, not a bug.

Three knobs:

| Option | Default | Effect |
| --- | --- | --- |
| `convergence` | 0.55 | 0 gives a rectangular grid, 1 gives full cosine convergence. Full cosine is geometrically correct for a sphere but fans the sheet out harder than any surviving Ptolemy sheet. 0.55 matches the printed Ulm and Rome editions. |
| `latStretch` | 1.15 | Vertical exaggeration. Above 1 gives northern Europe more room, which matters because most of the plot happens between Bruges and Venice. |
| `refLat` | 36 | The parallel at which east-west scale is unmodified. Ptolemy uses Rhodes. |

`createProjector({ width })` returns `project(lon, lat)`, `unproject(x, y)`, `neatline()`, `graticule()` and a `scale()` helper. `unproject` is exact, so a click on the canvas resolves back to Ptolemaic degrees.

## Files

```
data/gazetteer.json     30 places: id, name, region, Ptolemaic lon/lat, source, rank, note
data/geography.json     landmass ring, carved seas, islands, rivers, lakes, mountains, labels
data/routes.json        trade routes as ordered arrays of gazetteer ids
src/projection.js       Donis projection, ring-to-path, Catmull-Rom smoothing
src/renderMap.js        returns { svg, width, height, projector, placed }
scripts/render.mjs      CLI renderer
scripts/positions.mjs   exports projected pixel positions for game hotspots
scripts/validate.mjs    point-in-polygon check that every place is on land
```

## How to extend

**Add a city.** Append to `data/gazetteer.json`. Give it Ptolemaic degrees. Then run `node scripts/validate.mjs`, which does a point-in-polygon test against the landmass and islands and will tell you if the place has landed in the sea. Labels are placed automatically.

**Add a trade route.** Append to `data/routes.json` with an ordered list of place ids. No code change. Set `legend: true` to have it appear in the key.

**Change the coastline.** Edit the `landmass` ring in `data/geography.json`. The Mediterranean is traced as a gulf of the outer ocean rather than a separate polygon, which is how Ptolemy renders it, so the ring runs down the Atlantic coast of Iberia, all the way round the Mediterranean, and back out through the Strait before continuing down Africa. Enclosed water bodies (Black Sea, Caspian, Red Sea, Persian Gulf, Baltic) are in `seas` and are drawn on top in paper colour.

**Change ranks.** Every place has a `rank` from 1 to 3. `--max-rank 1` renders only the primary set, which is how you keep a small canvas legible.

**Toggle layers.** Pass `options.layers` to `renderMap`, e.g. `{ mountains: false, seaLabels: false }`. Available: `graticule, land, seas, islands, rivers, mountains, routes, cities, labels, regionLabels, seaLabels, compass, cartouche, legend, frame`.

## Using it in the game

Two viable patterns.

**Static background plus overlay.** Render the SVG once at your target size, use it as a background layer, and drive interaction from `scripts/positions.mjs` output. Each place gives you `x`, `y` and the resolved label position and anchor.

**Live projection.** Import `createProjector` at runtime and call it whenever the canvas resizes. `project` and `unproject` are pure and cheap, so hit-testing, panning and zooming can all be done in degree space. This is the better option if the map is a real screen rather than an asset.

For zoomable regional sheets, keep the data and narrow the domain. A Flanders sheet would be `domain: { lonMin: 14, lonMax: 34, latMin: 46, latMax: 58 }` with `convergence: 0.9`, which is exactly what Nicolaus Germanus did for his regional plates. The trapezoid becomes much shallower at regional scale, which is the whole reason the Donis projection existed.

## Label placement

`renderMap` runs a greedy placer that tries twelve anchor positions per label in order of preference and takes the first that clears everything already placed, adding a dashed leader line when it has to reach. It never silently drops a label. The `placed` array reports which labels needed a leader, and `scripts/validate.mjs` prints the count as a crowding signal. If that count climbs after you add cities, either raise the canvas width or push some places to a higher rank.

## Known liberties

- Ptolemy has no entry for Bruges, Ghent, Antwerp, Venice, Dijon, Danzig, Caffa as a Genoese port, Tabriz, Madeira, the Gambia or Timbuktu. These are interpolated onto his framework.
- Ptolemy's Carthage latitude of 32 degrees 40 minutes is so far south it distorts the Sicilian channel badly, so the Tunisian coast here is softened to 34 degrees.
- The West African coast in Ptolemy trends south-east. The Portuguese reach of the mid 1450s has been fitted onto it running south, which is the compromise the period maps themselves made.
- Island outlines are deliberately coarse. They read as pen strokes, not survey data.
