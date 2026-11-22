import type { ReactNode } from 'react';
import type { SkirmishSetup } from '../sim/rules';
import { Label } from './ui';

/**
 * Round 7 (fireline-round7-structures.md): the lobby's two structure options, Structure upgrades and
 * Strategic structures. Both Off or On, both greyed on standard tech (normaliseSetup turns them off
 * there), both on for a new skirmish.
 */

function upgradesNote(setup: SkirmishSetup): string {
  if (setup.tech !== 'advanced') return 'Advanced tech only.';
  if (!setup.structureUpgrades) return 'Off: every structure stays as built.';
  return 'On: turrets, Generators, Refineries, Barracks, War Factories, sensors and the Command Yard can be raised a level. The work costs credits and time, and the structure takes a quarter more damage until it is done.';
}

function strategicNote(setup: SkirmishSetup): string {
  if (setup.tech !== 'advanced') return 'Advanced tech only.';
  if (!setup.strategicBuildings) return 'Off: no Bunkers, Supply Caches, Intelligence Centres or Decoys.';
  return 'On: Fortified Bunkers to shelter infantry, Supply Caches to mend troops far from home, an Intelligence Centre to read the enemy, and Decoys to draw their fire.';
}

function Toggle({ label, testid, on, disabled, onPick, note }: { label: string; testid: string; on: boolean; disabled: boolean; onPick: (on: boolean) => void; note: ReactNode }) {
  return (
    <div className="fl-setup-field" data-testid={`${testid}-field`} data-disabled={disabled ? '1' : '0'}>
      <Label>{label}</Label>
      <div className="fl-seg" role="radiogroup" aria-label={label}>
        {[false, true].map(v => (
          <button key={v ? 'on' : 'off'} type="button" role="radio" aria-checked={!disabled && on === v} disabled={disabled} data-testid={`${testid}-${v ? 'on' : 'off'}`} onClick={() => onPick(v)}>
            {v ? 'On' : 'Off'}
          </button>
        ))}
      </div>
      <p className="fl-setup-note">{note}</p>
    </div>
  );
}

export function StructuresSetup({ value, set }: { value: SkirmishSetup; set: (patch: Partial<SkirmishSetup>) => void }) {
  const adv = value.tech === 'advanced';
  return (
    <>
      <Toggle label="Structure upgrades" testid="upgrades" on={!!value.structureUpgrades} disabled={!adv} onPick={v => set({ structureUpgrades: v })} note={upgradesNote(value)} />
      <Toggle label="Strategic structures" testid="strategic" on={!!value.strategicBuildings} disabled={!adv} onPick={v => set({ strategicBuildings: v })} note={strategicNote(value)} />
    </>
  );
}
