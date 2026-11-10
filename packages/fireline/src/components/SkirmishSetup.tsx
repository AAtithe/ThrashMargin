import { useEffect, useMemo, useRef, useState } from 'react';
import { generateSkirmishMap, randomMapType } from '../sim/maps';
import type { GeneratedMap } from '../sim/map';
import { seedFromString } from '../sim/rng';
import {
  BUILD_MENU,
  BUILDINGS,
  DEFAULT_SETUP,
  GAME_SIZE_ORDER,
  GAME_SIZES,
  INFANTRY_MENU,
  LOBBY_DEFAULT_SIZE,
  MAP_TYPE_BLURBS,
  MAP_TYPE_BLURBS_SIDES,
  MAP_TYPE_NAMES,
  MAP_TYPES,
  POWERS,
  LONE_SIDE_CREDITS,
  SETUP_CREDIT_CHOICES,
  SIDE_COUNTS,
  SIDE_NAMES,
  SKIRMISH_POWERS,
  STANDARD_TECH,
  UNITS,
  VEHICLE_MENU,
  applySize,
  researchPaceText,
  type BuildingKind,
  type GameSize,
  type MapType,
  type OreLevel,
  type Owner,
  type ResearchMode,
  type SideMode,
  type SkirmishSetup,
  type SupportPower,
  type TechLevel,
  type UnitKind,
} from '../sim/rules';
import { paintMiniTerrain } from '../game/terrain';
import { teamsFor } from '../sim/sides';
import { TEAM, UI } from '../theme';
import { Label } from './ui';

/**
 * The skirmish's setup: map type (with a preview of each, drawn from the real generator and the
 * seed the battle will use), tech level, starting credits and ore. The lobby owns the values; the
 * battle is created from exactly what is shown here.
 */

const STORE_KEY = 'fireline_setup';

/** What the lobby offers a player who has never chosen: the default setup at the lobby's default size. */
const FIRST_SETUP: SkirmishSetup = applySize(DEFAULT_SETUP, LOBBY_DEFAULT_SIZE);

/**
 * The player's last setup, so the next battle starts from it. Per browser, and only a convenience.
 * A setup stored before game sizes existed keeps its credits and ore and gets the lobby's default size.
 */
export function readStoredSetup(): SkirmishSetup {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return FIRST_SETUP;
    const r = JSON.parse(raw) as Partial<SkirmishSetup>;
    return {
      map: r.map === 'random' || MAP_TYPES.includes(r.map as MapType) ? (r.map as SkirmishSetup['map']) : DEFAULT_SETUP.map,
      tech: r.tech === 'standard' || r.tech === 'advanced' ? r.tech : DEFAULT_SETUP.tech,
      credits: SETUP_CREDIT_CHOICES.includes(r.credits as number) ? (r.credits as number) : DEFAULT_SETUP.credits,
      ore: r.ore === 'poor' || r.ore === 'normal' || r.ore === 'rich' ? r.ore : DEFAULT_SETUP.ore,
      sides: r.sides === 3 || r.sides === 4 ? r.sides : 2,
      mode: (r.sides === 3 || r.sides === 4) && r.mode === 'teams' ? 'teams' : 'ffa',
      research: r.research === 'classic' || r.research === 'lines' ? r.research : DEFAULT_SETUP.research,
      size: GAME_SIZE_ORDER.includes(r.size as GameSize) ? (r.size as GameSize) : LOBBY_DEFAULT_SIZE,
    };
  } catch {
    return FIRST_SETUP;
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

export const ORE_TEXT: Record<OreLevel, { name: string; text: string }> = {
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

export const RESEARCH_TEXT: Record<ResearchMode, { name: string; text: string }> = {
  classic: { name: 'Classic', text: 'Five upgrades from the Research Lab, one at a time.' },
  lines: {
    name: 'Development lines',
    text: 'Five lines of three marks each, a doctrine to choose at the top of every line, and modules for your vehicles. The enemy researches them too.',
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
    for (const t of MAP_TYPES) out[t] = generateSkirmishMap(seed, t, value.ore, value.sides);
    return out;
  }, [seed, value.ore, value.sides]);
  const drawn = randomMapType(seed);
  const set = (patch: Partial<SkirmishSetup>) => onChange({ ...value, ...patch });

  const lines = value.tech === 'advanced' && value.research === 'lines';

  return (
    <>
      <div className="fl-setup-field">
        <Label>Game size</Label>
        {/* Customise sets the size alone: credits and ore stay as the player set them. */}
        <div className="fl-seg" role="radiogroup" aria-label="Game size">
          {GAME_SIZE_ORDER.map(k => (
            <button key={k} type="button" role="radio" aria-checked={value.size === k} data-testid={`setup-size-${k}`} onClick={() => set({ size: k })}>
              {GAME_SIZES[k].name}
            </button>
          ))}
        </div>
        <p className="fl-setup-note" data-testid="setup-size-note">
          {GAME_SIZES[value.size].tagline}
          {lines ? ` Research: ${researchPaceText(value.size).toLowerCase()}.` : ''}
        </p>
      </div>

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
                  {t === 'random' ? `Any of the six, chosen by the seed. This one draws ${MAP_TYPE_NAMES[drawn]}.` : value.sides > 2 ? MAP_TYPE_BLURBS_SIDES[t] : MAP_TYPE_BLURBS[t]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="fl-setup-note">
          {value.sides === 2
            ? "Previews show the real map for this seed: your base is blue, the enemy's red, ore gold. Every map is mirrored, so both sides start with the same ground and the same ore."
            : `Previews show the real map for this seed: each base in its side's colour, yours blue, ore gold. Every base's share of the map is the same share turned round the centre, so every side starts with ${value.sides === 4 ? 'the same' : 'close to the same'} ground and ore.`}
        </p>
      </div>

      <div className="fl-setup-row">
        <div className="fl-setup-field">
          <Label>Sides</Label>
          <div className="fl-seg" role="radiogroup" aria-label="Sides">
            {SIDE_COUNTS.map(n => (
              <button key={n} type="button" role="radio" aria-checked={value.sides === n} data-testid={`sides-${n}`} onClick={() => set({ sides: n, mode: n === 2 ? 'ffa' : value.mode })}>
                {n}
              </button>
            ))}
          </div>
          <p className="fl-setup-note">{value.sides === 2 ? 'You against one computer commander.' : `You and ${value.sides - 1} computer commanders, on a larger map.`}</p>
        </div>
        {value.sides > 2 && (
          <div className="fl-setup-field">
            <Label>Mode</Label>
            <div className="fl-seg" role="radiogroup" aria-label="Mode">
              {(['ffa', 'teams'] as SideMode[]).map(m => (
                <button key={m} type="button" role="radio" aria-checked={value.mode === m} data-testid={`mode-${m}`} onClick={() => set({ mode: m })}>
                  {m === 'ffa' ? 'Free for all' : 'Teams'}
                </button>
              ))}
            </div>
            <p className="fl-setup-note">{MODE_TEXT[value.sides === 4 ? 4 : 3][value.mode]}</p>
          </div>
        )}
      </div>
      <SideLine setup={value} />

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

      <div className="fl-setup-field" data-testid="setup-research">
        <Label>Research</Label>
        {/* Standard tech keeps the stored choice, so switching back to advanced restores it. */}
        <div className="fl-levels" role="radiogroup" aria-label="Research" aria-disabled={value.tech === 'standard' || undefined}>
          {(['classic', 'lines'] as ResearchMode[]).map(r => (
            <button
              key={r}
              type="button"
              role="radio"
              className="fl-level"
              aria-checked={value.tech === 'advanced' && value.research === r}
              disabled={value.tech === 'standard'}
              data-testid={`setup-research-${r}`}
              onClick={() => set({ research: r })}
            >
              <span className="fl-level-name">{RESEARCH_TEXT[r].name}</span>
              <span className="fl-level-facts">{RESEARCH_TEXT[r].text}</span>
            </button>
          ))}
        </div>
        {value.tech === 'standard' && <p className="fl-setup-note">Advanced tech only.</p>}
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
          <p className="fl-setup-note">
            {value.sides === 3 && value.mode === 'teams'
              ? `Every side starts with the same, except the ${SIDE_NAMES[1]}, alone against two, which starts with ${LONE_SIDE_CREDITS} times as much.`
              : value.sides === 2
                ? 'Both sides start with the same.'
                : 'Every side starts with the same.'}
          </p>
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

const MODE_TEXT: Record<3 | 4, Record<SideMode, string>> = {
  3: {
    ffa: 'Every side for itself. You win when every other side is out.',
    teams: 'Two against one: you and an ally against a commander with more starting credits.',
  },
  4: {
    ffa: 'Every side for itself. You win when every other side is out.',
    teams: 'Two against two: you and the ally beside you against the two across the map.',
  },
};

/** Who is in the battle and whose team each is on, every side named in its colour. */
function SideLine({ setup }: { setup: SkirmishSetup }) {
  if (setup.sides === 2) return null;
  const teams = teamsFor(setup.sides, setup.mode);
  const name = (o: Owner) => (
    <strong key={o} style={{ color: UI.side[o] }}>
      {SIDE_NAMES[o]}
      {o === 0 ? ' (you)' : ''}
    </strong>
  );
  const sidesList = (Array.from({ length: setup.sides }, (_, i) => i) as Owner[]);
  const join = (os: Owner[]) =>
    os.flatMap((o, i) => [i === 0 ? '' : i === os.length - 1 ? ' and ' : ', ', name(o)]);
  if (setup.mode === 'ffa')
    return (
      <p className="fl-setup-note fl-side-line" data-testid="side-line">
        Every side for itself: {join(sidesList)}.
      </p>
    );
  const ours = sidesList.filter(o => teams[o] === teams[0]);
  const theirs = sidesList.filter(o => teams[o] !== teams[0]);
  return (
    <p className="fl-setup-note fl-side-line" data-testid="side-line">
      Your team: {join(ours)}. Against you: {join(theirs)}.
    </p>
  );
}

/** A map drawn small: the terrain, the ore and both Command Yards. Canvas paint, so hex is fine here. */
function MapThumb({ map, label }: { map: GeneratedMap; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const S = map.w > 64 ? 1.5 : 2;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(paintMiniTerrain(map.tiles, map.w, map.h), 0, 0, map.w * S, map.h * S);
    ctx.fillStyle = '#d9b23a';
    for (let k = 0; k < map.ore.length; k++) {
      if (map.ore[k] > 0) ctx.fillRect((k % map.w) * S, ((k / map.w) | 0) * S, S, S);
    }
    map.starts.forEach((st, owner) => {
      const team = TEAM[owner as Owner];
      ctx.fillStyle = team.main;
      ctx.fillRect(st.x * S - 2, st.y * S - 2, 3 * S + 4, 3 * S + 4);
      ctx.strokeStyle = team.light;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(st.x * S - 2.5, st.y * S - 2.5, 3 * S + 5, 3 * S + 5);
    });
  }, [map]);
  const S = map.w > 64 ? 1.5 : 2;
  return <canvas ref={ref} width={map.w * S} height={map.h * S} className="fl-map-thumb" role="img" aria-label={label} />;
}
