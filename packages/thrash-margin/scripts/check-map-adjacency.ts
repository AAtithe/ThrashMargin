/**
 * One-off dev report: for each of the 7 maps, how many gameplay-adjacent territory
 * pairs (the `edges` list the engine uses for attack/move validity) are NOT also
 * geometric neighbours in the Voronoi tessellation the new organic-region renderer
 * generates from the same node positions.
 *
 * Those pairs need an explicit "route connector" (a drawn dashed line + glyph)
 * since the regions won't otherwise touch on screen. Run with:
 *   npx tsx packages/thrash-margin/scripts/check-map-adjacency.ts
 * Re-run only if a map's node positions or edges change.
 */
import { MAP_DEFS, DEFAULT_CONFIG, createInitialState } from '../shared/engine-reference';
import { computeMapGeometry } from '../client/src/map/regionGeometry';

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

for (const def of MAP_DEFS) {
  const state = createInitialState('report', { ...DEFAULT_CONFIG, mapId: def.id });
  const { nodes, edges } = state;
  const geometry = computeMapGeometry(nodes, edges, def.viewBox);

  let touching = 0;
  let needsRoute = 0;
  for (const [a, b] of edges) {
    if (geometry.geometricEdgeSet.has(edgeKey(a, b))) touching++;
    else needsRoute++;
  }

  console.log(
    `${def.name.padEnd(18)} territories=${String(nodes.length).padEnd(3)} edges=${String(edges.length).padEnd(3)} ` +
    `touching=${String(touching).padEnd(3)} needs-route-connector=${needsRoute}`
  );
}
