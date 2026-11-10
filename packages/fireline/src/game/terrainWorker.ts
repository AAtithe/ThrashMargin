/**
 * Paints a battle's terrain off the main thread (fireline-round5-design.md, workstream B). Given
 * the tiles, the map type and the size, it runs paintTerrain on an OffscreenCanvas and sends back
 * the picture as an ImageBitmap. See paintTerrainOffThread in terrain.ts, which starts it and falls
 * back to painting on the page if anything here fails.
 */
import type { MapType } from '../sim/rules';
import { paintTerrain } from './terrain';

interface Job {
  tiles: string;
  mapType: MapType | undefined;
  mapW: number;
  mapH: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = e => {
  try {
    const { tiles, mapType, mapW, mapH } = e.data;
    const canvas = paintTerrain(tiles, mapType, mapW, mapH) as unknown as OffscreenCanvas;
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage(bitmap, [bitmap]);
  } catch (err) {
    scope.postMessage({ error: String(err) });
  }
};
