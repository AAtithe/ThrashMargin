import { createProjector, ringToPath, smoothPath } from './projection.js';

/** Hand-sketched pen-and-ink palette on white paper. */
export const INK = {
  paper: '#ffffff',
  coast: '#4a4030',
  coastGhost: '#6b6050',
  hatch: '#bdb199',
  grid: '#c9c0ad',
  city: '#a8562a',
  text: '#3c3325',
  faint: '#8a7f68',
  sea: '#9a8f76',
  river: '#8a8778',
  relief: '#5d5344',
  frame: '#4a4030'
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Approximate text width. Good enough for collision avoidance at any size. */
function textWidth(str, fontSize) {
  return str.length * fontSize * 0.47;
}

function overlaps(a, b, pad) {
  return !(a.x2 + pad < b.x1 || b.x2 + pad < a.x1 || a.y2 + pad < b.y1 || b.y2 + pad < a.y1);
}

/**
 * Greedy label placer. Tries anchor positions in order of preference and takes
 * the first that clears everything already placed. Falls back to the first
 * candidate so a label is never silently dropped.
 */
function placeLabels(items, boxes, pad) {
  const out = [];
  for (const it of items) {
    const w = textWidth(it.text, it.fontSize);
    const h = it.fontSize;
    const r = it.dotR;
    const gap = r + it.fontSize * 0.45;
    const long = it.fontSize * 2.2;

    const candidates = [
      { dx: gap, dy: h * 0.32, anchor: 'start', lead: false },
      { dx: -gap, dy: h * 0.32, anchor: 'end', lead: false },
      { dx: 0, dy: -gap - h * 0.15, anchor: 'middle', lead: false },
      { dx: 0, dy: gap + h * 0.85, anchor: 'middle', lead: false },
      { dx: long, dy: -long * 0.6, anchor: 'start', lead: true },
      { dx: -long, dy: -long * 0.6, anchor: 'end', lead: true },
      { dx: long, dy: long * 0.75, anchor: 'start', lead: true },
      { dx: -long, dy: long * 0.75, anchor: 'end', lead: true },
      { dx: long * 1.7, dy: -long * 1.1, anchor: 'start', lead: true },
      { dx: -long * 1.7, dy: -long * 1.1, anchor: 'end', lead: true },
      { dx: long * 1.7, dy: long * 1.3, anchor: 'start', lead: true },
      { dx: -long * 1.7, dy: long * 1.3, anchor: 'end', lead: true }
    ];

    let chosen = null;
    for (const c of candidates) {
      const tx = it.x + c.dx;
      const ty = it.y + c.dy;
      const x1 = c.anchor === 'start' ? tx : c.anchor === 'end' ? tx - w : tx - w / 2;
      const box = { x1, y1: ty - h * 0.8, x2: x1 + w, y2: ty + h * 0.25 };
      if (!boxes.some((b) => overlaps(box, b, pad))) {
        chosen = { ...c, tx, ty, box };
        break;
      }
    }
    if (!chosen) {
      const c = candidates[0];
      const tx = it.x + c.dx, ty = it.y + c.dy;
      chosen = { ...c, tx, ty, box: { x1: tx, y1: ty - h * 0.8, x2: tx + w, y2: ty + h * 0.25 } };
    }
    boxes.push(chosen.box);
    out.push({ ...it, ...chosen });
  }
  return out;
}

/** Caterpillar mountain chain along a projected polyline. */
function reliefPath(pts, hump) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.round(len / (hump * 2)));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      d += ` M ${px.toFixed(2)} ${py.toFixed(2)} q ${(hump * 0.5).toFixed(2)} ${(-hump * 1.5).toFixed(2)} ${hump.toFixed(2)} 0`;
    }
  }
  return d.trim();
}

/**
 * Render the map as a standalone SVG string.
 *
 * @param {object} args
 * @param {object} args.gazetteer  parsed data/gazetteer.json
 * @param {object} args.geography  parsed data/geography.json
 * @param {object} args.routes     parsed data/routes.json
 * @param {object} [args.options]
 * @param {number} [args.options.width]         canvas width, default 1400
 * @param {number} [args.options.convergence]   0..1, default 0.55
 * @param {number} [args.options.latStretch]    default 1.15
 * @param {boolean}[args.options.sketch]        doubled ghost strokes, default true
 * @param {boolean}[args.options.hatch]         hachured land fill, default true
 * @param {object} [args.options.layers]        per-layer on/off
 * @param {number} [args.options.maxRank]       hide places above this rank
 * @param {string} [args.options.title]
 * @param {string} [args.options.subtitle]
 * @returns {{svg:string, width:number, height:number, projector:object, placed:Array}}
 */
export function renderMap({ gazetteer, geography, routes, options = {} }) {
  const o = {
    width: 1400,
    convergence: 0.55,
    latStretch: 1.15,
    sketch: true,
    hatch: true,
    maxRank: 3,
    title: 'The World of Niccolo',
    subtitle: 'Ad mentem Ptolemaei, orbis terrarum, MCDLX',
    fontStack: "'EB Garamond', Georgia, 'Times New Roman', serif",
    layers: {},
    ...options
  };
  const L = {
    graticule: true, land: true, seas: true, islands: true, rivers: true,
    mountains: true, routes: true, cities: true, labels: true,
    regionLabels: true, seaLabels: true, compass: true, cartouche: true,
    legend: true, frame: true,
    ...o.layers
  };

  const P = createProjector({
    width: o.width,
    domain: geography.domain,
    convergence: o.convergence,
    latStretch: o.latStretch,
    margin: o.margin
  });
  const { project, scale } = P;
  const W = P.width, H = P.height;

  // Design values authored against 1400px, scaled by the projector.
  const s = {
    coast: Math.max(0.8, scale(1.5)),
    ghost: Math.max(0.4, scale(0.8)),
    grid: Math.max(0.3, scale(0.55)),
    river: Math.max(0.5, scale(1.2)),
    route: Math.max(0.8, scale(2.0)),
    dash: scale(9),
    gap: scale(7),
    dotR: Math.max(2, scale(4.4)),
    city: Math.max(9, scale(20)),
    region: Math.max(8, scale(18)),
    seaLbl: Math.max(8, scale(19)),
    hatchGap: Math.max(4, scale(11)),
    hump: Math.max(3, scale(9)),
    pad: Math.max(2, scale(5)),
    off: Math.max(1, scale(2.4))
  };

  const parts = [];
  const push = (x) => parts.push(x);

  push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img">`);
  push(`<title>${esc(o.title)} — Ptolemaic projection, circa 1460</title>`);
  push(`<desc>Pen and ink world map on the Donis trapezoidal projection using Ptolemy's own coordinates. ${gazetteer.places.length} places plotted.</desc>`);
  push(`<style>@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&amp;display=swap');
.f{font-family:${o.fontStack}}
.ct{font-size:${s.city.toFixed(1)}px;fill:${INK.text}}
.rg{font-size:${s.region.toFixed(1)}px;fill:${INK.faint};font-style:italic}
.sl{font-size:${s.seaLbl.toFixed(1)}px;fill:${INK.sea};font-style:italic;letter-spacing:${scale(2).toFixed(2)}px}</style>`);

  push(`<defs>`);
  push(`<pattern id="hx" width="${s.hatchGap.toFixed(2)}" height="${s.hatchGap.toFixed(2)}" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="${s.hatchGap.toFixed(2)}" stroke="${INK.hatch}" stroke-width="${Math.max(0.35, scale(0.9)).toFixed(2)}"/></pattern>`);
  const nl = P.neatline();
  push(`<clipPath id="sheet"><path d="M ${nl.map((p) => p.map((v) => v.toFixed(2)).join(' ')).join(' L ')} Z"/></clipPath>`);
  push(`</defs>`);

  push(`<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="${INK.paper}"/>`);

  const landFill = o.hatch ? 'url(#hx)' : 'none';
  const ghost = (id) => (o.sketch
    ? `<use href="#${id}" fill="none" stroke="${INK.coastGhost}" stroke-width="${s.ghost.toFixed(2)}" opacity="0.6" transform="translate(${s.off.toFixed(2)},${(s.off * 0.7).toFixed(2)})"/>`
    : '');

  push(`<g clip-path="url(#sheet)">`);

  if (L.graticule) {
    const g = P.graticule(10, 10);
    const lines = [...g.meridians, ...g.parallels]
      .map((seg) => `M ${seg[0][0].toFixed(2)} ${seg[0][1].toFixed(2)} L ${seg[1][0].toFixed(2)} ${seg[1][1].toFixed(2)}`)
      .join(' ');
    push(`<path d="${lines}" fill="none" stroke="${INK.grid}" stroke-width="${s.grid.toFixed(2)}" stroke-dasharray="${scale(12).toFixed(1)} ${scale(6).toFixed(1)}"/>`);
  }

  if (L.land) {
    const d = ringToPath(geography.landmass, project);
    push(`<path id="ld" d="${d}" fill="${landFill}" stroke="${INK.coast}" stroke-width="${s.coast.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    push(ghost('ld'));
  }

  if (L.seas) {
    geography.seas.forEach((sea, i) => {
      const id = `sea${i}`;
      push(`<path id="${id}" d="${ringToPath(sea.ring, project)}" fill="${INK.paper}" stroke="${INK.coast}" stroke-width="${(s.coast * 0.85).toFixed(2)}" stroke-linejoin="round"/>`);
      push(ghost(id));
    });
  }

  if (L.islands) {
    geography.islands.forEach((isl, i) => {
      const id = `isl${i}`;
      push(`<path id="${id}" d="${ringToPath(isl.ring, project)}" fill="${landFill}" stroke="${INK.coast}" stroke-width="${(s.coast * 0.85).toFixed(2)}" stroke-linejoin="round"/>`);
      push(ghost(id));
    });
  }

  if (L.rivers) {
    const d = geography.rivers
      .map((r) => smoothPath(r.line.map(([lo, la]) => project(lo, la)), 0.4))
      .join(' ');
    push(`<path d="${d}" fill="none" stroke="${INK.river}" stroke-width="${s.river.toFixed(2)}" stroke-linecap="round"/>`);
    (geography.lakes || []).forEach((lk) => {
      const [cxp, cyp] = project(lk.centre[0], lk.centre[1]);
      const [ex] = project(lk.centre[0] + lk.rLon, lk.centre[1]);
      const [, ey] = project(lk.centre[0], lk.centre[1] - lk.rLat);
      push(`<ellipse cx="${cxp.toFixed(2)}" cy="${cyp.toFixed(2)}" rx="${Math.abs(ex - cxp).toFixed(2)}" ry="${Math.abs(ey - cyp).toFixed(2)}" fill="${INK.paper}" stroke="${INK.coastGhost}" stroke-width="${(s.coast * 0.6).toFixed(2)}"/>`);
    });
  }

  if (L.mountains) {
    const d = geography.mountains
      .map((m) => reliefPath(m.line.map(([lo, la]) => project(lo, la)), s.hump))
      .join(' ');
    push(`<path d="${d}" fill="none" stroke="${INK.relief}" stroke-width="${(s.river * 0.9).toFixed(2)}" stroke-linecap="round"/>`);
  }

  const byId = new Map(gazetteer.places.map((p) => [p.id, p]));

  if (L.routes) {
    for (const r of routes.routes) {
      const pts = r.via.map((id) => byId.get(id)).filter(Boolean).map((p) => project(p.lon, p.lat));
      if (pts.length < 2) continue;
      push(`<path d="${smoothPath(pts, 0.35)}" fill="none" stroke="${r.colour}" stroke-width="${s.route.toFixed(2)}" stroke-dasharray="${s.dash.toFixed(1)} ${s.gap.toFixed(1)}" stroke-linecap="round" opacity="0.85"/>`);
    }
  }

  push(`</g>`);

  const places = gazetteer.places.filter((p) => (p.rank || 1) <= o.maxRank);
  const boxes = [];

  if (L.seaLabels || L.regionLabels) {
    for (const lb of geography.labels) {
      if (lb.kind === 'sea' && !L.seaLabels) continue;
      if (lb.kind === 'region' && !L.regionLabels) continue;
      const [x, y] = project(lb.at[0], lb.at[1]);
      const fs = lb.kind === 'sea' ? s.seaLbl : s.region;
      const w = textWidth(lb.text, fs) * (lb.kind === 'sea' ? 1.25 : 1);
      boxes.push({ x1: x - w / 2, y1: y - fs * 0.8, x2: x + w / 2, y2: y + fs * 0.25 });
      push(`<text class="f ${lb.kind === 'sea' ? 'sl' : 'rg'}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle">${esc(lb.text)}</text>`);
    }
  }

  let placed = [];
  if (L.cities) {
    const items = places.map((p) => {
      const [x, y] = project(p.lon, p.lat);
      return { ...p, x, y, text: p.name, fontSize: s.city, dotR: s.dotR };
    });
    // Dots reserve their own space so labels never sit on a marker.
    for (const it of items) {
      boxes.push({ x1: it.x - s.dotR, y1: it.y - s.dotR, x2: it.x + s.dotR, y2: it.y + s.dotR });
    }
    placed = L.labels ? placeLabels(items, boxes, s.pad) : items.map((i) => ({ ...i, tx: i.x, ty: i.y, anchor: 'start', lead: false }));

    if (L.labels) {
      const leads = placed.filter((p) => p.lead)
        .map((p) => `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} L ${p.tx.toFixed(2)} ${(p.ty - s.city * 0.28).toFixed(2)}`)
        .join(' ');
      if (leads) push(`<path d="${leads}" fill="none" stroke="${INK.faint}" stroke-width="${s.grid.toFixed(2)}" stroke-dasharray="${scale(3).toFixed(1)} ${scale(3).toFixed(1)}" opacity="0.85"/>`);
    }

    const dots = items.map((it) => `<circle cx="${it.x.toFixed(2)}" cy="${it.y.toFixed(2)}" r="${s.dotR.toFixed(2)}"/>`).join('');
    push(`<g fill="${INK.city}" stroke="${INK.paper}" stroke-width="${(s.dotR * 0.28).toFixed(2)}">${dots}</g>`);

    if (L.labels) {
      const txt = placed.map((p) =>
        `<text class="f ct" x="${p.tx.toFixed(2)}" y="${p.ty.toFixed(2)}" text-anchor="${p.anchor}">${esc(p.name)}</text>`
      ).join('');
      push(`<g>${txt}</g>`);
    }
  }

  // Compass rose, bottom right of the lower margin band.
  if (L.compass) {
    const r = scale(52);
    const cx2 = W - P.opts.margin.right * 0.5 - r;
    const cy2 = H - P.opts.margin.bottom * 0.45;
    push(`<g transform="translate(${cx2.toFixed(2)},${cy2.toFixed(2)})" fill="none">
<circle r="${r.toFixed(1)}" stroke="${INK.frame}" stroke-width="${s.coast.toFixed(2)}"/>
<circle r="${(r * 0.68).toFixed(1)}" stroke="${INK.faint}" stroke-width="${s.grid.toFixed(2)}"/>
<polygon points="0,${(-r * 1.18).toFixed(1)} ${(r * 0.18).toFixed(1)},${(-r * 0.14).toFixed(1)} 0,0 ${(-r * 0.18).toFixed(1)},${(-r * 0.14).toFixed(1)}" fill="${INK.city}"/>
<polygon points="0,${(r * 1.18).toFixed(1)} ${(r * 0.18).toFixed(1)},${(r * 0.14).toFixed(1)} 0,0 ${(-r * 0.18).toFixed(1)},${(r * 0.14).toFixed(1)}" fill="${INK.faint}"/>
<polygon points="${(r * 1.18).toFixed(1)},0 ${(r * 0.14).toFixed(1)},${(r * 0.18).toFixed(1)} 0,0 ${(r * 0.14).toFixed(1)},${(-r * 0.18).toFixed(1)}" fill="${INK.faint}"/>
<polygon points="${(-r * 1.18).toFixed(1)},0 ${(-r * 0.14).toFixed(1)},${(r * 0.18).toFixed(1)} 0,0 ${(-r * 0.14).toFixed(1)},${(-r * 0.18).toFixed(1)}" fill="${INK.faint}"/>
<text class="f rg" x="0" y="${(-r * 1.35).toFixed(1)}" text-anchor="middle" fill="${INK.faint}">N</text>
</g>`);
  }

  if (L.cartouche) {
    const bw = scale(430), bh = scale(112);
    const bx = P.opts.margin.left * 0.6, by = H - P.opts.margin.bottom * 0.75;
    push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${INK.paper}" stroke="${INK.frame}" stroke-width="${s.coast.toFixed(2)}"/>`);
    push(`<text class="f" x="${(bx + bw / 2).toFixed(1)}" y="${(by + bh * 0.46).toFixed(1)}" text-anchor="middle" font-size="${scale(34).toFixed(1)}" fill="${INK.text}" letter-spacing="${scale(1.6).toFixed(2)}">${esc(o.title)}</text>`);
    push(`<text class="f" x="${(bx + bw / 2).toFixed(1)}" y="${(by + bh * 0.78).toFixed(1)}" text-anchor="middle" font-size="${scale(17).toFixed(1)}" fill="${INK.faint}" font-style="italic">${esc(o.subtitle)}</text>`);
  }

  if (L.legend) {
    const shown = routes.routes.filter((r) => r.legend);
    const rowH = scale(30);
    const bw = scale(380), bh = rowH * shown.length + scale(24);
    const bx = P.opts.margin.left * 0.6 + scale(460), by = H - P.opts.margin.bottom * 0.75;
    push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${INK.paper}" stroke="${INK.frame}" stroke-width="${(s.coast * 0.7).toFixed(2)}"/>`);
    shown.forEach((r, i) => {
      const ly = by + scale(12) + rowH * (i + 0.5);
      push(`<line x1="${(bx + scale(16)).toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(bx + scale(62)).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${r.colour}" stroke-width="${s.route.toFixed(2)}" stroke-dasharray="${s.dash.toFixed(1)} ${s.gap.toFixed(1)}"/>`);
      push(`<text class="f ct" x="${(bx + scale(76)).toFixed(1)}" y="${(ly + s.city * 0.34).toFixed(1)}">${esc(r.name)}</text>`);
    });
  }

  if (L.frame) {
    const d = `M ${nl.map((p) => p.map((v) => v.toFixed(2)).join(' ')).join(' L ')} Z`;
    push(`<path d="${d}" fill="none" stroke="${INK.frame}" stroke-width="${(s.coast * 1.8).toFixed(2)}"/>`);
    push(`<path d="${d}" fill="none" stroke="${INK.faint}" stroke-width="${s.grid.toFixed(2)}" transform="translate(${(s.off * 2.6).toFixed(2)},${(s.off * 2.6).toFixed(2)}) scale(0.9955)" transform-origin="${(W / 2).toFixed(1)} ${(H / 2).toFixed(1)}"/>`);
  }

  push(`</svg>`);
  return { svg: parts.join('\n'), width: W, height: H, projector: P, placed };
}
