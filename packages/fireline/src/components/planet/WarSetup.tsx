/**
 * War for the Planet: the lobby's setup form (fireline-planet-design.md, section 17). W4.
 * Rendered by the lobby inside its signed-in branch only, like every other panel there. The
 * choices are sent to createPlanet; the server normalises every one of them again.
 */
import { useState } from 'react';
import type { NewPlanetRequest } from '../../hooks/useSaves';
import { BusyLabel } from '../../lib/Loading';
import { LENGTH_PRESETS, PRESETS } from '../../planet/rules';
import type { LengthPreset, PlanetOptions } from '../../planet/types';
import { hasSeenPlanetTour } from './PlanetTour';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty } from '../../sim/rules';

const PRESET_TEXT: Record<LengthPreset, { name: string; hours: string }> = {
  short: { name: 'Short', hours: 'about 3 hours' },
  long: { name: 'Long', hours: 'about 8 hours' },
  veryLong: { name: 'Very long', hours: '15 hours or more' },
};

type Rule = 'alliedVictory' | 'ironRule' | 'simulatedAutoResolve' | 'aiDiplomacy';
const RULES: { key: Rule; name: string; blurb: string }[] = [
  { key: 'alliedVictory', name: 'Allied victory', blurb: 'Win together when you and your allies hold the planet and you lead the alliance.' },
  { key: 'ironRule', name: 'Iron rule', blurb: 'A hero who falls in battle is lost for the rest of the war.' },
  { key: 'simulatedAutoResolve', name: 'Simulated battles', blurb: 'Offer Simulate beside Auto-resolve: the computer plays the whole battle out.' },
  { key: 'aiDiplomacy', name: 'Rival diplomacy', blurb: 'Computer factions make and break treaties with each other, not only with you.' },
];

const maxFactions = (o: PlanetOptions) => Math.max(3, Math.min(5, Math.floor(o.regions / 4)));

export default function WarSetup({
  defaultCommander,
  onBegin,
}: {
  defaultCommander: string;
  /** `guided`: open the guided first turn when the war loads (kept in this browser, not the save). */
  onBegin: (r: NewPlanetRequest, guided: boolean) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [commander, setCommander] = useState(defaultCommander);
  const [preset, setPreset] = useState<LengthPreset>('short');
  const [factions, setFactions] = useState<number>(PRESETS.short.factions);
  const [level, setLevel] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [seed, setSeed] = useState('');
  const [rules, setRules] = useState<Record<Rule, boolean>>(() => pick(PRESETS.short));
  const [busy, setBusy] = useState(false);
  // Ticked for anyone who has not yet finished or skipped a guided first turn in this browser.
  const [guided, setGuided] = useState(() => !hasSeenPlanetTour());
  const p = PRESETS[preset];
  const top = maxFactions(p);

  const choosePreset = (k: LengthPreset) => {
    setPreset(k);
    setFactions(PRESETS[k].factions);
    setRules(pick(PRESETS[k]));
  };

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onBegin({
        name: name.trim() || 'War for the Planet',
        commander: commander.trim() || 'Commander',
        seed: seed.trim(),
        preset,
        options: { factions: Math.min(factions, top), ...rules },
        difficulty: level,
      }, guided);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fl-war-setup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="war-setup">
      <p className="fl-small" style={{ margin: 0, maxWidth: '62ch' }}>
        A whole planet, held by you and two to four rival factions. Build up cities, trade, make and break treaties, and send your field army against one
        neighbouring region a turn. Every attack is a real Fireline battle on that region's ground: fight it yourself or auto-resolve it. Your army, heroes and
        research carry from battle to battle.
      </p>
      <div className="fl-campaign-form">
        <label className="fl-pl-field">
          Commander's name
          <input className="fl-pl-input" value={commander} placeholder="Commander" maxLength={32} onChange={e => setCommander(e.target.value)} data-testid="war-commander" />
        </label>
        <label className="fl-pl-field">
          Name this war
          <input className="fl-pl-input" value={name} placeholder="War for the Planet" maxLength={40} onChange={e => setName(e.target.value)} data-testid="war-name" />
        </label>
      </div>
      <div className="fl-pl-field">
        Length
        <div className="fl-pl-presets" role="group" aria-label="Length of the war">
          {LENGTH_PRESETS.map(k => {
            const o = PRESETS[k];
            return (
              <button key={k} type="button" className="fl-pl-preset" aria-pressed={preset === k} onClick={() => choosePreset(k)} data-testid={`war-preset-${k}`}>
                <strong>{PRESET_TEXT[k].name}</strong>
                <span>
                  {o.regions} regions on {o.continents} continents, {o.factions} factions
                </span>
                <span>
                  {o.turnLimit} turns, {PRESET_TEXT[k].hours}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="fl-pl-row">
        <div className="fl-pl-field">
          Factions, you included
          <div className="fl-pl-row" role="group" aria-label="Factions">
            {[3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                className="fl-pl-btn"
                aria-pressed={Math.min(factions, top) === n}
                disabled={n > top}
                aria-describedby={n > top ? 'fl-war-factions-why' : undefined}
                onClick={() => setFactions(n)}
                data-testid={`war-factions-${n}`}
              >
                {n}
              </button>
            ))}
          </div>
          {top < 5 && (
            <span className="fl-pl-why" id="fl-war-factions-why">
              A planet of {p.regions} regions has room for {top} factions.
            </span>
          )}
        </div>
        <div className="fl-pl-field">
          Difficulty
          <div className="fl-pl-row" role="group" aria-label="Difficulty">
            {(Object.keys(DIFFICULTIES) as Difficulty[]).map(d => (
              <button key={d} type="button" className="fl-pl-btn" aria-pressed={level === d} onClick={() => setLevel(d)} data-testid={`war-level-${d}`}>
                {DIFFICULTIES[d].label}
              </button>
            ))}
          </div>
        </div>
        <label className="fl-pl-field">
          Seed (optional)
          <input className="fl-pl-input" value={seed} placeholder="A fresh planet" maxLength={64} onChange={e => setSeed(e.target.value)} data-testid="war-seed" />
        </label>
      </div>
      <div className="fl-pl-checks" role="group" aria-label="Optional rules">
        {RULES.map(r => (
          <label key={r.key}>
            <input type="checkbox" checked={rules[r.key]} onChange={e => setRules({ ...rules, [r.key]: e.target.checked })} data-testid={`war-rule-${r.key}`} />
            <span>
              <strong>{r.name}</strong>
              {rules[r.key] === p[r.key] ? '' : ' (changed)'}
              <br />
              <span className="fl-small">{r.blurb}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="fl-pl-checks" role="group" aria-label="Tutorial">
        <label>
          <input type="checkbox" checked={guided} onChange={e => setGuided(e.target.checked)} data-testid="war-guided" />
          <span>
            <strong>Guided first turn</strong>
            <br />
            <span className="fl-small">A tutorial on this war: the map, a build, a recruit, a move, a treaty, trade and the turn report, one step at a time. Tour on the war screen reopens it.</span>
          </span>
        </label>
      </div>
      <div>
        <button type="button" className="fl-camp-btn primary" disabled={busy} onClick={begin} data-testid="begin-war">
          {busy ? <BusyLabel>Growing a planet…</BusyLabel> : 'Begin the war →'}
        </button>
      </div>
    </div>
  );
}

function pick(o: PlanetOptions): Record<Rule, boolean> {
  return { alliedVictory: o.alliedVictory, ironRule: o.ironRule, simulatedAutoResolve: o.simulatedAutoResolve, aiDiplomacy: o.aiDiplomacy };
}
