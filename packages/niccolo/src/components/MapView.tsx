import { CITIES, ROUTES, findCity } from '../sim/content';
import type { Vessel } from '../sim/types';

const INK = '#4a3d28';
const PARCHMENT = '#c9b88a';
const GOLD = '#e8d5a3';
const SHIP_COLOR = '#b5451a';
const COURIER_COLOR = '#3a6b5a';

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
  onSelectCity: (cityId: string) => void;
  /** cityId -> weeks since the player's known report on that city was true; null if no report yet. */
  cityInfoAge: Record<string, number | null>;
}

/** Fog by information age: fresh news reads solid, old or absent news fades the city out. */
function fogOpacity(age: number | null): number {
  if (age === null) return 0.35;
  if (age <= 2) return 1;
  return Math.max(0.5, 1 - age * 0.04);
}

export default function MapView({ vessels, selectedVesselId, onSelectCity, cityInfoAge }: MapViewProps) {
  const selected = vessels.find(v => v.id === selectedVesselId) ?? null;

  return (
    <svg viewBox="0 0 660 560" style={{ width: '100%', height: '100%', background: '#0e0b07' }}>
      {ROUTES.map(r => {
        const from = findCity(r.from)!;
        const to = findCity(r.to)!;
        return (
          <line
            key={r.id}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={INK}
            strokeWidth={1.5}
            strokeDasharray={r.type === 'sea' ? '5 4' : undefined}
            opacity={0.7}
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
        return (
          <g key={c.id} onClick={() => reachable && onSelectCity(c.id)} style={{ cursor: reachable ? 'pointer' : 'default' }}>
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
    </svg>
  );
}
