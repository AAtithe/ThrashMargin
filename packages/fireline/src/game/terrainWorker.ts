/**
 * Paints a battle's ground off the main thread, a chunk at a time (terrainStore.ts). The first
 * message gives the map; the painter is built from it once (createTerrainPainter: the fields,
 * noise and lists every chunk shares), and each later message asks for one region, which comes
 * back as an ImageBitmap with the request's id. A failure is reported with the id, and the store
 * paints on the page instead.
 */
import type { MapType } from '../sim/rules';
import { createTerrainPainter, type TerrainPainter } from './terrain';

type Message =
  | { type: 'init'; tiles: string; mapType: MapType | undefined; mapW: number; mapH: number }
  | { type: 'paint'; id: number; x: number; y: number; w: number; h: number };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Message>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let painter: TerrainPainter | null = null;
let init: Extract<Message, { type: 'init' }> | null = null;

scope.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'init') {
    init = msg;
    painter = null;
    return;
  }
  try {
    if (!painter && init) painter = createTerrainPainter(init.tiles, init.mapType, init.mapW, init.mapH);
    if (!painter) throw new Error('no map');
    const canvas = painter.paint(msg.x, msg.y, msg.w, msg.h) as unknown as OffscreenCanvas;
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ id: msg.id, bitmap }, [bitmap]);
  } catch (err) {
    scope.postMessage({ id: msg.id, error: String(err) });
  }
};
