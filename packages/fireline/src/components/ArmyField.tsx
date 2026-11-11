/**
 * The lobby's Army row (fireline-round6-design.md, workstream A): one choice per seat, Meridian
 * Corps or Ashen Combine, each with its one-line doctrine. It writes `setup.factions`, always one
 * entry per seat: the setup is run through normaliseSetup first, so a change of sides resizes it.
 */
import { FACTION_DOCTRINES, FACTION_NAMES, FACTIONS, SIDE_NAMES, type Faction, type Owner, type SkirmishSetup } from '../sim/rules';
import { normaliseSetup } from '../sim/state';
import { UI } from '../theme';
import { Label } from './ui';

export default function ArmyField({ value, onPick }: { value: SkirmishSetup; onPick: (factions: Faction[]) => void }) {
  const seats = Array.from({ length: value.sides }, (_, i) => i as Owner);
  const factions = normaliseSetup(value).factions ?? seats.map((): Faction => 'meridian');
  const pick = (seat: Owner, f: Faction) => onPick(factions.map((x, i) => (i === seat ? f : x)));
  return (
    <div className="fl-setup-field fl-army-field" data-testid="army-field">
      <Label>Army</Label>
      <div className="fl-army-seats">
        {seats.map(seat => (
          <div key={seat} className="fl-army-seat">
            <span className="fl-army-seat-name" style={{ color: UI.side[seat] }}>
              {SIDE_NAMES[seat]}
              {seat === 0 ? ' (you)' : ''}
            </span>
            <div className="fl-seg" role="radiogroup" aria-label={`${SIDE_NAMES[seat]}'s army`}>
              {FACTIONS.map(f => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={factions[seat] === f}
                  data-army={f}
                  data-testid={`army-${seat}-${f}`}
                  title={FACTION_DOCTRINES[f]}
                  onClick={() => pick(seat, f)}
                >
                  {FACTION_NAMES[f]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {FACTIONS.map(f => (
        <p key={f} className="fl-setup-note fl-army-doctrine">
          <span className="fl-army-tag" data-army={f}>
            {FACTION_NAMES[f]}
          </span>{' '}
          {FACTION_DOCTRINES[f]}
        </p>
      ))}
    </div>
  );
}
