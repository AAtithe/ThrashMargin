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
  // The glyphs compare the four cards with each other: map side against the largest, length against the longest.
  const tilesOf = (id: GamePace) => MAP_SIZE_TILES[GAME_PACES[id].preset.size][value.sides];
  const maxTiles = Math.max(...GAME_PACE_ORDER.map(tilesOf));
  const maxMinutes = Math.max(...GAME_PACE_ORDER.map(id => GAME_PACES[id].minutes[1]));
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
              <SizeGlyph map={tilesOf(id) / maxTiles} length={spec.minutes[1] / maxMinutes} />
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

/** A card's picture: the map as a square inside the largest map's frame, and the battle's length as a bar. */
function SizeGlyph({ map, length }: { map: number; length: number }) {
  const side = 30 * map;
  const off = 1 + (30 - side) / 2;
  return (
    <span className="fl-size-glyph" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="40" height="40" focusable="false">
        <rect className="fl-size-glyph-frame" x="1" y="1" width="30" height="30" />
        <rect className="fl-size-glyph-map" x={off} y={off} width={side} height={side} />
      </svg>
      <span className="fl-size-glyph-len">
        <span style={{ width: `${Math.round(length * 100)}%` }} />
      </span>
    </span>
  );
}
