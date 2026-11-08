import type { HeroKind } from '../sim/rules';
import { TEAM } from '../theme';

/**
 * The campaign screens' canvas art. The real drawings live in `game/campaignArt.ts` (art
 * workstream); this bridge picks them up when that file exists and otherwise draws a plain stand-in,
 * so the interface builds and works on its own. `import.meta.glob` resolves at build time: with the
 * file present it is bundled like any import, without it the map below is simply empty.
 *
 * Every call into the real module is guarded, so a signature that drifts from the documented one
 * degrades to the stand-in instead of blanking the screen.
 */

/** One mission on the theatre map. */
export interface CampaignMapNode {
  id: string;
  /** 1-based position in the campaign. */
  order: number;
  title: string;
  state: 'locked' | 'open' | 'won';
  stars: number;
  maxStars: number;
  /** The node the pointer is over or the briefing is open for. */
  selected?: boolean;
}

type Ctx = CanvasRenderingContext2D;

/** The signatures documented in fireline-campaign-design.md, section 7 (R). */
interface CampaignArtModule {
  drawCampaignMap?: (ctx: Ctx, w: number, h: number, nodes: CampaignMapNode[]) => void;
  campaignNodePosition?: (index: number, count: number, w: number, h: number) => { x: number; y: number };
  drawRankInsignia?: (ctx: Ctx, rankIndex: number, x: number, y: number, size: number) => void;
  drawHeroPortrait?: (ctx: Ctx, hero: HeroKind, level: number, x: number, y: number, size: number, wounded: boolean) => void;
}

const found = import.meta.glob<CampaignArtModule>('../game/campaignArt.ts', { eager: true });
const art: CampaignArtModule = Object.values(found)[0] ?? {};

/** True when the art workstream's drawings are present in this build. */
export const hasCampaignArt = !!art.drawCampaignMap;

const warned = new Set<string>();
function guarded<T>(name: string, real: (() => T) | null, fallback: () => T): T {
  if (real) {
    try {
      return real();
    } catch (e) {
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`campaignArt.${name} failed; drawing the stand-in`, e);
      }
    }
  }
  return fallback();
}

/** Where node `index` of `count` sits on a map `w` by `h` CSS pixels. */
export function nodePosition(index: number, count: number, w: number, h: number): { x: number; y: number } {
  const own = () => {
    const t = count <= 1 ? 0.5 : index / (count - 1);
    const x = w * (0.08 + 0.84 * t);
    const y = h * (0.5 + 0.26 * Math.sin(t * Math.PI * 2.4 + 0.6));
    return { x, y };
  };
  const p = guarded('campaignNodePosition', art.campaignNodePosition ? () => art.campaignNodePosition!(index, count, w, h) : null, own);
  return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : own();
}

export function drawMap(ctx: Ctx, w: number, h: number, nodes: CampaignMapNode[]): void {
  guarded('drawCampaignMap', art.drawCampaignMap ? () => art.drawCampaignMap!(ctx, w, h, nodes) : null, () => fallbackMap(ctx, w, h, nodes));
}

export function drawInsignia(ctx: Ctx, rankIndex: number, x: number, y: number, size: number): void {
  guarded('drawRankInsignia', art.drawRankInsignia ? () => art.drawRankInsignia!(ctx, rankIndex, x, y, size) : null, () => fallbackInsignia(ctx, rankIndex, x, y, size));
}

export function drawPortrait(ctx: Ctx, hero: HeroKind, level: number, x: number, y: number, size: number, wounded: boolean): void {
  guarded('drawHeroPortrait', art.drawHeroPortrait ? () => art.drawHeroPortrait!(ctx, hero, level, x, y, size, wounded) : null, () =>
    fallbackPortrait(ctx, hero, level, x, y, size, wounded),
  );
}

// ---- Stand-ins -------------------------------------------------------------------------------
// Plain but legible: enough to play the campaign before the art lands. Canvas paint may use hex.

function fallbackMap(ctx: Ctx, w: number, h: number, nodes: CampaignMapNode[]) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#3c5230');
  g.addColorStop(1, '#55663a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A river and some contour lines, so it reads as ground and not a chart.
  ctx.strokeStyle = 'rgba(43, 90, 115, 0.85)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(w * 0.62, 0);
  ctx.bezierCurveTo(w * 0.5, h * 0.35, w * 0.72, h * 0.6, w * 0.58, h);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 7; i++) {
    ctx.beginPath();
    ctx.ellipse(w * 0.3, h * 0.4, i * w * 0.05, i * h * 0.07, 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  const pts = nodes.map((_, i) => nodePosition(i, nodes.length, w, h));
  // The front line between nodes: solid behind the last won mission, dashed ahead of it.
  ctx.lineWidth = 3;
  for (let i = 1; i < pts.length; i++) {
    ctx.setLineDash(nodes[i - 1].state === 'won' ? [] : [6, 6]);
    ctx.strokeStyle = nodes[i - 1].state === 'won' ? 'rgba(255, 214, 120, 0.9)' : 'rgba(240, 240, 230, 0.45)';
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  nodes.forEach((n, i) => {
    const { x, y } = pts[i];
    const r = n.selected ? 17 : 14;
    ctx.fillStyle = n.state === 'won' ? TEAM[0].main : n.state === 'open' ? '#e0a43a' : '#5d625f';
    ctx.strokeStyle = n.selected ? '#ffffff' : '#101412';
    ctx.lineWidth = n.selected ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = n.state === 'locked' ? '#c9ccc6' : '#101412';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n.order), x, y + 1);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#f4f7f3';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(n.title, x, y + r + 12);
    if (n.state === 'won') ctx.fillText('★'.repeat(n.stars) + '☆'.repeat(Math.max(0, n.maxStars - n.stars)), x, y - r - 9);
    ctx.shadowBlur = 0;
  });
}

function fallbackInsignia(ctx: Ctx, rankIndex: number, x: number, y: number, size: number) {
  ctx.fillStyle = '#1d2a33';
  ctx.strokeStyle = '#e0a43a';
  ctx.lineWidth = Math.max(1, size / 20);
  ctx.beginPath();
  ctx.moveTo(x + size * 0.1, y + size * 0.1);
  ctx.lineTo(x + size * 0.9, y + size * 0.1);
  ctx.lineTo(x + size * 0.9, y + size * 0.65);
  ctx.lineTo(x + size * 0.5, y + size * 0.92);
  ctx.lineTo(x + size * 0.1, y + size * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // One chevron per rank, up to three; stars above that.
  ctx.strokeStyle = '#e0a43a';
  ctx.lineWidth = size / 12;
  const chevrons = Math.min(3, rankIndex + 1);
  for (let i = 0; i < chevrons; i++) {
    const cy = y + size * (0.28 + i * 0.15);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.28, cy);
    ctx.lineTo(x + size * 0.5, cy + size * 0.1);
    ctx.lineTo(x + size * 0.72, cy);
    ctx.stroke();
  }
  if (rankIndex >= 3) {
    ctx.fillStyle = '#ffe08a';
    ctx.font = `${Math.round(size * 0.2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★'.repeat(rankIndex - 2), x + size / 2, y + size * 0.18);
  }
}

const HERO_TINT: Record<HeroKind, string> = { spy: '#4a5564', commando: '#5a6b3a', engineer: '#b08a2a', ace: '#3b7ddd' };
const HERO_LETTER: Record<HeroKind, string> = { spy: 'S', commando: 'C', engineer: 'E', ace: 'A' };

function fallbackPortrait(ctx: Ctx, hero: HeroKind, level: number, x: number, y: number, size: number, wounded: boolean) {
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, HERO_TINT[hero]);
  g.addColorStop(1, '#121618');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, size, size);
  // Head and shoulders.
  ctx.fillStyle = '#d8b48c';
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size * 0.4, size * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HERO_TINT[hero];
  ctx.beginPath();
  ctx.ellipse(x + size / 2, y + size * 0.95, size * 0.36, size * 0.3, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${Math.round(size * 0.22)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(HERO_LETTER[hero], x + size * 0.07, y + size * 0.05);
  ctx.textAlign = 'right';
  ctx.fillText(String(level), x + size * 0.93, y + size * 0.05);
  if (wounded) {
    ctx.fillStyle = 'rgba(200, 40, 30, 0.35)';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#ff6a52';
    ctx.lineWidth = Math.max(2, size / 14);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.68, y + size * 0.68);
    ctx.lineTo(x + size * 0.92, y + size * 0.68);
    ctx.moveTo(x + size * 0.8, y + size * 0.56);
    ctx.lineTo(x + size * 0.8, y + size * 0.8);
    ctx.stroke();
  }
}
