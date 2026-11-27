import type { SkirmishSetup } from '../sim/rules';

/**
 * The economy, chosen on the lobby's first screen (2026-11-26). The four economy toggles nest
 * (each needs the one before), so the five steps of the ladder are the only sensible combinations:
 * picking one writes all four toggles. The same toggles stay in the customise step for anyone who
 * wants them there.
 */
export type EconomyLevel = 'classic' | 'industry' | 'supply' | 'territory' | 'production';

export const ECONOMY_LEVELS: { id: EconomyLevel; name: string; line: string }[] = [
  { id: 'classic', name: 'Classic', line: 'Ore into credits; credits buy everything.' },
  { id: 'industry', name: 'Industry', line: 'Fuel Wells and Foundries: vehicles cost alloys too.' },
  { id: 'supply', name: 'Supply lines', line: 'Producers deliver only when linked to a yard by Depots.' },
  { id: 'territory', name: 'Territory', line: 'Build inside your borders; buildings need crews.' },
  { id: 'production', name: 'Full economy', line: 'Farms, munitions, Supply Trucks, Technicians and Industry projects.' },
];

/** Which step of the ladder a setup is on. */
export function economyOf(s: Pick<SkirmishSetup, 'industry' | 'supply' | 'territory' | 'production'>): EconomyLevel {
  if (!s.industry) return 'classic';
  if (!s.supply) return 'industry';
  if (!s.territory) return 'supply';
  return s.production ? 'production' : 'territory';
}

/** The four toggles for a step of the ladder. */
export function economyToggles(level: EconomyLevel): Pick<SkirmishSetup, 'industry' | 'supply' | 'territory' | 'production'> {
  const i = ECONOMY_LEVELS.findIndex(l => l.id === level);
  return { industry: i >= 1, supply: i >= 2, territory: i >= 3, production: i >= 4 };
}

export default function EconomyPicker({ value, onPick }: { value: SkirmishSetup; onPick: (patch: ReturnType<typeof economyToggles>) => void }) {
  const current = economyOf(value);
  return (
    <div className="fl-levels fl-economy" role="group" aria-label="Economy" data-testid="economy-picker">
      {ECONOMY_LEVELS.map(l => (
        <button
          key={l.id}
          type="button"
          className="fl-level"
          aria-pressed={current === l.id}
          data-testid={`economy-${l.id}`}
          onClick={() => onPick(economyToggles(l.id))}
        >
          <span className="fl-level-name">{l.name}</span>
          <span className="fl-level-facts">{l.line}</span>
        </button>
      ))}
    </div>
  );
}
