import { useEffect, useMemo, useRef, useState } from 'react';
import { generateSkirmishMap, randomMapType } from '../sim/maps';
import type { GeneratedMap } from '../sim/map';
import { seedFromString } from '../sim/rng';
import {
  BUILD_MENU,
  BUILDINGS,
  DEFAULT_SETUP,
  INFANTRY_MENU,
  MAP_H,
  MAP_TYPE_BLURBS,
  MAP_TYPE_NAMES,
  MAP_TYPES,
  MAP_W,
  POWERS,
  SETUP_CREDIT_CHOICES,
  SKIRMISH_POWERS,
  STANDARD_TECH,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type MapType,
  type OreLevel,
  type SkirmishSetup,
  type SupportPower,
  type TechLevel,
  type UnitKind,
} from '../sim/rules';
import { paintMiniTerrain } from '../game/terrain';
import { TEAM } from '../theme';
import { Label } from './ui';

/**
 * The skirmish's setup: map type (with a preview of each, drawn from the real generator and the
 * seed the battle will use), tech level, starting credits and ore. The lobby owns the values; the
 * battle is created from exactly what is shown here.
 */

const STORE_KEY = 'fireline_setup';

/** The player's last setup, so the next battle starts from it. Per browser, and only a convenience. */
export function readStoredSetup(): SkirmishSetup {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_SETUP;
    const r = JSON.parse(raw) as Partial<SkirmishSetup>;
    return {
      map: r.map === 'random' || MAP_TYPES.includes(r.map as MapType) ? (r.map as SkirmishSetup['map']) : DEFAULT_SETUP.map,
      tech: r.tech === 'standard' || r.tech === 'advanced' ? r.tech : DEFAULT_SETUP.tech,
      credits: SETUP_CREDIT_CHOICES.includes(r.credits as number) ? (r.credits as number) : DEFAULT_SETUP.credits,
      ore: r.ore === 'poor' || r.ore === 'normal' || r.ore === 'rich' ? r.ore : DEFAULT_SETUP.ore,
    };
  } catch {
    return DEFAULT_SETUP;
  }
}

export function storeSetup(s: SkirmishSetup): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* Blocked storage: the next battle starts from the defaults. */
  }
}

const SEED_WORDS = ['ridge', 'ford', 'ember', 'quarry', 'harrow', 'cinder', 'basalt', 'marsh', 'outpost', 'flint', 'causeway', 'gorge'];

/** A fresh seed for a battle the player has not named one for. Shown, so the map can be drawn again. */
export function freshSeed(): string {
  return `${SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)]}-${1000 + Math.floor(Math.random() * 9000)}`;
}

/** The seed text exactly as createInitialState will read it. */
const seedNumber = (text: string) => seedFromString(text.trim().slice(0, 64));

const ORE_TEXT: Record<OreLevel, { name: string; text: string }> = {
  poor: { name: 'Poor', text: 'Thin fields: every hauler trip counts, and expansions matter early.' },
  normal: { name: 'Normal', text: 'The standard amount.' },
  rich: { name: 'Rich', text: 'Denser, wider fields: bigger armies, sooner.' },
};

const nameOf = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].name : UNITS[k as UnitKind].name);
/** What advanced tech adds, from the menus, so the list cannot drift from the rules. */
const ADVANCED_STRUCTURES = BUILD_MENU.filter(k => !STANDARD_TECH.includes(k)).map(nameOf);
const ADVANCED_UNITS = [...INFANTRY_MENU, ...VEHICLE_MENU].filter(k => !STANDARD_TECH.includes(k)).map(nameOf);
const ADVANCED_POWERS = (Object.entries(SKIRMISH_POWERS) as [SupportPower, BuildingKind][]).map(
  ([p, b]) => `${POWERS[p].name} (${BUILDINGS[b].name})`,
);

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export const TECH_TEXT: Record<TechLevel, { name: string; text: string }> = {
  standard: { name: 'Standard', text: 'The original six structures and six units. No support powers.' },
  advanced: {
    name: 'Advanced',
    text: `Adds the ${list(ADVANCED_UNITS)}; the ${list(ADVANCED_STRUCTURES)}; and support powers that come with structures: ${list(ADVANCED_POWERS)}. The enemy has them too.`,
  },
};

export default function SkirmishSetupPanel({
  value,
  onChange,
  seedText,
}: {
  value: SkirmishSetup;
  onChange: (v: SkirmishSetup) => void;
  /** The seed the battle will be created with (typed, or the lobby's fresh one). */
  seedText: string;
}) {
  // Six maps take a few tens of milliseconds: wait for the typing to settle before drawing them.
  const [settled, setSettled] = useState(seedText);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(seedText), 250);
    return () => window.clearTimeout(t);
  }, [seedText]);
  const seed = seedNumber(settled);
  const maps = useMemo(() => {
    const out = {} as Record<MapType, GeneratedMap>;
    for (const t of MAP_TYPES) out[t] = generateSkirmishMap(seed, t, value.ore);
    return out;
  }, [seed, value.ore]);
  const drawn = randomMapType(seed);
  const set = (patch: Partial<SkirmishSetup>) => onChange({ ...value, ...patch });

  return (
    <>
      <div className="fl-setup-field">
        <Label>Battlefield</Label>
        <div className="fl-maps" role="radiogroup" aria-label="Battlefield">
          {(['random', ...MAP_TYPES] as SkirmishSetup['map'][]).map(t => {
            const type = t === 'random' ? drawn : t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                className="fl-map"
                aria-checked={value.map === t}
                data-testid={`map-${t}`}
                onClick={() => set({ map: t })}
              >
                <MapThumb map={maps[type]} label={`${t === 'random' ? 'Random: ' : ''}${MAP_TYPE_NAMES[type]} map preview`} />
                <span className="fl-map-name">{t === 'random' ? 'Random' : MAP_TYPE_NAMES[t]}</span>
                <span className="fl-map-blurb">
                  {t === 'random' ? `Any of the six, chosen by the seed. This one draws ${MAP_TYPE_NAMES[drawn]}.` : MAP_TYPE_BLURBS[t]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="fl-setup-note">
          Previews show the real map for this seed: your base is blue, the enemy's red, ore gold. Every map is mirrored, so
          both sides start with the same ground and the same ore.
        </p>
      </div>

      <div className="fl-setup-field">
        <Label>Tech level</Label>
        <div className="fl-levels" role="radiogroup" aria-label="Tech level">
          {(['standard', 'advanced'] as TechLevel[]).map(t => (
            <button key={t} type="button" role="radio" className="fl-level" aria-checked={value.tech === t} data-testid={`tech-${t}`} onClick={() => set({ tech: t })}>
              <span className="fl-level-name">{TECH_TEXT[t].name}</span>
              <span className="fl-level-facts">{TECH_TEXT[t].text}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fl-setup-row">
        <div className="fl-setup-field">
          <Label>Starting credits</Label>
          <div className="fl-seg" role="radiogroup" aria-label="Starting credits">
            {SETUP_CREDIT_CHOICES.map(c => (
              <button key={c} type="button" role="radio" aria-checked={value.credits === c} data-testid={`credits-${c}`} onClick={() => set({ credits: c })}>
                {c.toLocaleString('en-GB')}
              </button>
            ))}
          </div>
          <p className="fl-setup-note">Both sides start with the same.</p>
        </div>
        <div className="fl-setup-field">
          <Label>Ore</Label>
          <div className="fl-seg" role="radiogroup" aria-label="Ore">
            {(['poor', 'normal', 'rich'] as OreLevel[]).map(o => (
              <button key={o} type="button" role="radio" aria-checked={value.ore === o} data-testid={`ore-${o}`} onClick={() => set({ ore: o })}>
                {ORE_TEXT[o].name}
              </button>
            ))}
          </div>
          <p className="fl-setup-note">{ORE_TEXT[value.ore].text}</p>
        </div>
      </div>
    </>
  );
}

/** A map drawn small: the terrain, the ore and both Command Yards. Canvas paint, so hex is fine here. */
function MapThumb({ map, label }: { map: GeneratedMap; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const S = 2;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(paintMiniTerrain(map.tiles), 0, 0, MAP_W * S, MAP_H * S);
    ctx.fillStyle = '#d9b23a';
    for (let k = 0; k < map.ore.length; k++) {
      if (map.ore[k] > 0) ctx.fillRect((k % MAP_W) * S, ((k / MAP_W) | 0) * S, S, S);
    }
    map.starts.forEach((st, owner) => {
      const team = TEAM[owner as 0 | 1];
      ctx.fillStyle = team.main;
      ctx.fillRect(st.x * S - 2, st.y * S - 2, 3 * S + 4, 3 * S + 4);
      ctx.strokeStyle = team.light;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(st.x * S - 2.5, st.y * S - 2.5, 3 * S + 5, 3 * S + 5);
    });
  }, [map]);
  return <canvas ref={ref} width={MAP_W * 2} height={MAP_H * 2} className="fl-map-thumb" role="img" aria-label={label} />;
}
