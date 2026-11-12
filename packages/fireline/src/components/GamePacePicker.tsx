import { GAME_PACE_ORDER, GAME_PACES, MAP_SIZE_NAMES, MAP_SIZE_TILES, isPresetSetup, researchPaceText, type GamePace, type SkirmishSetup } from '../sim/rules';
import { ORE_TEXT } from './SkirmishSetup';

/**
 * The first screen of a new skirmish: how big a battle (fireline-round6b-design.md, section 7.1).
 * Each card states what picking it writes into the setup and what it changes; the lobby applies
 * the preset with applyPace. Clicking the card already chosen re-applies its preset, which is how
 * a "Customised" setup goes back to the card's numbers.
 */

/** "Enemy attacks" on a card, from the pace's attack multiplier. */
export function attackText(mul: number): string {
  if (mul === 1) return 'On the usual timing';
  if (mul === 1.25) return 'A quarter later';
  if (mul === 2) return 'Twice as late';
  if (mul === 3) return 'Three times as late';
  return `${mul} times as late`;
}

export default function GamePacePicker({ value, onPick }: { value: SkirmishSetup; onPick: (pace: GamePace) => void }) {
  const lines = value.tech === 'advanced' && value.research === 'lines';
  const mapText = (id: GamePace) => {
    const z = GAME_PACES[id].preset.size;
    const n = MAP_SIZE_TILES[z][value.sides];
    return `${MAP_SIZE_NAMES[z]}, ${n} by ${n} tiles${value.sides > 2 ? `, ${value.sides} sides` : ''}`;
  };
  const customised = !isPresetSetup(value);
  return (
    <>
      <div className="fl-sizes" role="radiogroup" aria-label="Game size">
        {GAME_PACE_ORDER.map(id => {
          const spec = GAME_PACES[id];
          const checked = value.pace === id;
          return (
            <button key={id} type="button" role="radio" className="fl-size" aria-checked={checked} data-testid={`size-${id}`} onClick={() => onPick(id)}>
              <span className="fl-size-name">
                {spec.name}
                {checked && customised && <span className="fl-size-tag">Customised</span>}
              </span>
              <span className="fl-size-tagline">{spec.tagline}</span>
              <dl className="fl-size-facts">
                <dt>Length</dt>
                <dd>{`About ${spec.minutes[0]} to ${spec.minutes[1]} minutes`}</dd>
                <dt>Map</dt>
                <dd>{mapText(id)}</dd>
                <dt>Credits</dt>
                <dd>{spec.preset.credits.toLocaleString('en-GB')}</dd>
                <dt>Ore</dt>
                <dd>{ORE_TEXT[spec.preset.ore].name}</dd>
                <dt>Research</dt>
                <dd>{lines ? researchPaceText(id) : 'Full price and time (scaling needs development lines)'}</dd>
                <dt>Enemy attacks</dt>
                <dd>{attackText(spec.attackMul)}</dd>
              </dl>
              <span className="fl-size-reach">
                {lines ? spec.reach : value.tech === 'standard' ? 'No research (standard tech).' : 'Five upgrades at most (classic research).'}
              </span>
            </button>
          );
        })}
      </div>
      <p className="fl-setup-note">Every size can be changed in Customise. The computer plays by the same numbers.</p>
    </>
  );
}
