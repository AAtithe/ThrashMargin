import { CITIES, ROUTES, findCity } from '../sim/content';
import type { Vessel } from '../sim/types';

const INK = '#4a3d28';
const PARCHMENT = '#c9b88a';
const GOLD = '#e8d5a3';
const SHIP_COLOR = '#b5451a';
const COURIER_COLOR = '#3a6b5a';
const VOID_COLOR = '#0e0b07';
const SEA_COLOR = '#182430';
const LAND_COLOR = '#241c12';

/**
 * Stylized landmasses, hand-fitted around the existing city x/y coordinates (viewBox 0 0 780 560)
 * rather than traced from a real coastline — the design doc's aesthetic direction is "manuscript
 * and counting-house, ink on paper," not cartographic accuracy. Each blob is drawn in the same
 * fill/stroke and overlaps its neighbour enough to read as one continuous coastline. Grouped
 * roughly as: Britain, the Low Countries, Burgundy/Savoy/France, Italy, the Pontic coast near
 * Trebizond (Chapter 2), and Cyprus (Chapter 3) — every city in `content/cities/*.json` sits on
 * one of these.
 */
const LANDMASSES = [
  // Britain — London.
  'M 95,18 C 60,20 35,45 32,85 C 30,120 45,150 80,160 C 115,170 155,160 172,125 C 188,95 180,55 150,32 C 132,20 115,16 95,18 Z',
  // Low Countries / northern France — Calais, Bruges, Ghent, Antwerp, reaching toward Dijon.
  'M 190,100 C 175,130 180,170 210,190 C 230,205 260,195 280,175 C 300,155 330,150 350,170 C 370,190 375,230 360,270 C 350,295 340,310 345,330 C 350,350 330,355 310,340 C 290,325 270,300 250,280 C 220,255 190,230 180,195 C 170,160 175,120 190,100 Z',
  // Burgundy / Savoy / France — Dijon, Geneva, Lyon.
  'M 300,270 C 340,260 380,275 400,300 C 420,325 425,360 410,390 C 395,415 365,425 335,415 C 305,405 280,385 275,355 C 270,325 275,290 300,270 Z',
  // Italy — Milan, Genoa, Florence, Venice, Naples.
  'M 430,410 C 470,395 520,400 560,420 C 600,435 630,430 650,455 C 665,475 655,495 630,505 C 600,517 580,545 550,560 C 525,572 500,565 490,545 C 480,525 460,530 445,510 C 425,485 415,450 420,425 C 422,418 425,413 430,410 Z',
  // Pontic coast — Trebizond (Chapter 2).
  'M 650,320 C 670,300 710,295 740,310 C 765,322 775,345 765,365 C 750,385 715,395 685,385 C 660,377 645,350 650,320 Z',
  // Cyprus — Famagusta, Kouklia (Chapter 3).
  'M 660,465 C 675,455 705,452 725,460 C 745,468 748,485 735,495 C 715,505 685,503 668,492 C 655,483 652,472 660,465 Z',
];

/** A jagged ridge line hinting at the Alps between Burgundy/Savoy and Italy — the same divide the
 * Geneva-Milan route's own `seasonal` flag already treats as a real crossing, not flavour text. */
const ALPS_RIDGE = 'M 405,392 L 420,372 L 435,394 L 450,374 L 462,398';

function vesselPoint(v: Vessel): { x: number; y: number } | null {
  const at = findCity(v.location);
  if (!at) return null;
  if (!v.destination) return { x: at.x, y: at.y };

  const to = findCity(v.destination);
  const route = ROUTES.find(r => r.id === v.routeId);
  if (!to || !route) return { x: at.x, y: at.y };

  const traveled = (route.distanceWeeks - v.weeksRemaining) / route.distanceWeeks;
  return {
    x: at.x + (to.x - at.x) * traveled,
    y: at.y + (to.y - at.y) * traveled,
  };
}

interface MapViewProps {
  vessels: Vessel[];
  selectedVesselId: string | null;
  /** Clicking any city — reachable or not — calls this to preview it; dispatching the selected
   * vessel there is a separate, explicit confirmation in the sidebar, not the click itself. */
  onSelectCity: (cityId: string) => void;
  /** cityId -> weeks since the player's known report on that city was true; null if no report yet. */
  cityInfoAge: Record<string, number | null>;
  /** The city currently shown in the sidebar's preview panel, if any — highlighted distinctly
   * from "reachable" so the player can see which marker their click actually landed on. */
  previewedCityId?: string | null;
}

/** Fog by information age: fresh news reads solid, old or absent news fades the city out. */
function fogOpacity(age: number | null): number {
  if (age === null) return 0.35;
  if (age <= 2) return 1;
  return Math.max(0.5, 1 - age * 0.04);
}

/** A simple compass rose in the map's one empty corner — decoration only, no gameplay meaning. */
function CompassRose() {
  return (
    <g transform="translate(735,55)" opacity={0.55}>
      <circle r={26} fill="none" stroke={GOLD} strokeWidth={1} />
      <circle r={2} fill={GOLD} />
      <line x1={0} y1={-24} x2={0} y2={24} stroke={GOLD} strokeWidth={1} />
      <line x1={-24} y1={0} x2={24} y2={0} stroke={GOLD} strokeWidth={1} />
      <path d="M 0,-24 L 5,-9 L 0,0 L -5,-9 Z" fill={GOLD} />
      <text y={-32} textAnchor="middle" fontSize={10} fill={GOLD} fontFamily="Georgia, serif">
        N
      </text>
    </g>
  );
}

/** A handful of faint rhumb lines in the open sea, the way a portolan chart radiates bearing
 * lines from a few fixed points — decorative texture, not a real navigation aid. */
function RhumbLines() {
  const origins = [
    { x: 250, y: 460 },
    { x: 560, y: 200 },
  ];
  return (
    <g stroke={GOLD} strokeWidth={0.5} opacity={0.1}>
      {origins.flatMap((o, oi) =>
        Array.from({ length: 8 }, (_, i) => {
          const angle = (Math.PI / 4) * i;
          const len = 700;
          return (
            <line
              key={`${oi}-${i}`}
              x1={o.x} y1={o.y}
              x2={o.x + Math.cos(angle) * len} y2={o.y + Math.sin(angle) * len}
            />
          );
        }),
      )}
    </g>
  );
}

export default function MapView({ vessels, selectedVesselId, onSelectCity, cityInfoAge, previewedCityId }: MapViewProps) {
  const selected = vessels.find(v => v.id === selectedVesselId) ?? null;

  return (
    <svg viewBox="0 0 780 560" style={{ width: '100%', height: '100%', background: VOID_COLOR }}>
      <rect x={0} y={0} width={780} height={560} fill={SEA_COLOR} />
      <RhumbLines />
      {LANDMASSES.map((d, i) => (
        <path key={i} d={d} fill={LAND_COLOR} stroke={INK} strokeWidth={1.5} opacity={0.95} />
      ))}
      <path d={ALPS_RIDGE} fill="none" stroke={INK} strokeWidth={1.5} opacity={0.8} strokeLinejoin="round" />
      <CompassRose />

      {ROUTES.map(r => {
        const from = findCity(r.from)!;
        const to = findCity(r.to)!;
        return (
          <line
            key={r.id}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={GOLD}
            strokeWidth={1.25}
            strokeDasharray={r.type === 'sea' ? '5 4' : undefined}
            opacity={0.5}
          />
        );
      })}

      {CITIES.map(c => {
        const reachable = selected
          ? ROUTES.some(r => {
              if (selected.kind === 'courier' && r.type !== 'land') return false;
              return (r.from === selected.location && r.to === c.id) ||
                     (r.to === selected.location && r.from === c.id);
            })
          : false;
        const opacity = fogOpacity(cityInfoAge[c.id] ?? null);
        const isPreviewed = c.id === previewedCityId;
        return (
          <g
            key={c.id}
            id={`city-node-${c.id}`}
            onClick={() => onSelectCity(c.id)}
            style={{ cursor: 'pointer' }}
          >
            {isPreviewed && (
              <circle
                cx={c.x} cy={c.y} r={(c.port ? 7 : 5.5) + 4}
                fill="none"
                stroke={GOLD}
                strokeWidth={1.5}
              />
            )}
            <circle
              cx={c.x} cy={c.y} r={c.port ? 7 : 5.5}
              fill={reachable ? GOLD : PARCHMENT}
              fillOpacity={opacity}
              stroke={INK}
              strokeWidth={1.5}
            />
            <text x={c.x + 10} y={c.y + 4} fontSize={12} fill={PARCHMENT} fillOpacity={opacity} fontFamily="Georgia, serif">
              {c.name}
            </text>
          </g>
        );
      })}

      {vessels.map(v => {
        const p = vesselPoint(v);
        if (!p) return null;
        const color = v.kind === 'ship' ? SHIP_COLOR : COURIER_COLOR;
        const isSelected = v.id === selectedVesselId;
        return (
          <g key={v.id}>
            <circle
              cx={p.x} cy={p.y} r={isSelected ? 8 : 6}
              fill={color}
              stroke={isSelected ? GOLD : '#000'}
              strokeWidth={isSelected ? 2 : 1}
            />
          </g>
        );
      })}

      <rect x={6} y={6} width={768} height={548} fill="none" stroke={INK} strokeWidth={2} opacity={0.8} />
      <rect x={11} y={11} width={758} height={538} fill="none" stroke={INK} strokeWidth={1} opacity={0.45} />
    </svg>
  );
}
