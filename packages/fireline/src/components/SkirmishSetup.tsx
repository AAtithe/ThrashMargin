import { siteSpots, type SiteSpot } from '../sim/sites';
import { SITE_ART } from '../game/art';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { generateSkirmishMap, randomMapType } from '../sim/maps';
import type { GeneratedMap } from '../sim/map';
import { seedFromString } from '../sim/rng';
import {
  BUILD_MENU,
  BUILDINGS,
  DEFAULT_SETUP,
  INFANTRY_MENU,
  MAP_TYPE_BLURBS,
  MAP_TYPE_BLURBS_SIDES,
  MAP_TYPE_NAMES,
  MAP_TYPES,
  POWERS,
  LONE_SIDE_CREDITS,
  MAP_SIZE_BLURBS,
  MAP_SIZE_NAMES,
  MAP_SIZE_TILES,
  MAP_SIZES,
  SETUP_CREDIT_CHOICES,
  SIDE_COUNTS,
  SIDE_NAMES,
  SKIRMISH_POWERS,
  STANDARD_TECH,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type MapSize,
  type MapType,
  type OreLevel,
  type Owner,
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
// round5:D. Neutral sites (fireline-round5-design.md, workstream D).
import { SITE_KINDS, SITES, SITES_PER_SIDE } from '../sim/rules';

/** For the Random card's line: the map types counted in words. */
const COUNT_WORDS: Record<number, string> = { 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };

/** What the Neutral sites field says each side gets at this map size. */
function sitesNote(setup: SkirmishSetup): string {
  if (!setup.sites) return 'No sites: ore is the only income.';
  const per = SITES_PER_SIDE[setup.size ?? 'standard'];
  const parts = SITE_KINDS.filter(k => per[k] > 0).map(k => `${per[k] === 1 ? 'an' : per[k]} ${SITES[k].name}${per[k] === 1 ? '' : 's'}`.replace(/^an (?=[^AEIOU])/, 'a '));
  const each = parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${each.charAt(0).toUpperCase()}${each.slice(1)} in every side's share of the map, neutral at the start. Infantry beside one for ten seconds take it.`;
}

/**
 * The skirmish's setup: map type (with a preview of each, drawn from the real generator and the
 * seed the battle will use), tech level, starting credits and ore. The lobby owns the values; the
 * battle is created from exactly what is shown here. It renders steps 2 to 4 of the lobby's
 * numbered skirmish orders (SetupStep); the lobby owns steps 1 and 5 around it.
 */

const STORE_KEY = 'fireline_setup';

/** The player's last setup, so the next battle starts from it. Per browser, and only a convenience. */
export function readStoredSetup(): SkirmishSetup {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    // Sites are on for a new lobby (the player asked for bases to fight over); DEFAULT_SETUP keeps
    // them off, because it also fills in setups saved before sites existed.
    if (!raw) return { ...DEFAULT_SETUP, sites: true };
    const r = JSON.parse(raw) as Partial<SkirmishSetup>;
    return {
      map: r.map === 'random' || MAP_TYPES.includes(r.map as MapType) ? (r.map as SkirmishSetup['map']) : DEFAULT_SETUP.map,
      tech: r.tech === 'standard' || r.tech === 'advanced' ? r.tech : DEFAULT_SETUP.tech,
      credits: SETUP_CREDIT_CHOICES.includes(r.credits as number) ? (r.credits as number) : DEFAULT_SETUP.credits,
      ore: r.ore === 'poor' || r.ore === 'normal' || r.ore === 'rich' ? r.ore : DEFAULT_SETUP.ore,
      sides: r.sides === 3 || r.sides === 4 ? r.sides : 2,
      mode: (r.sides === 3 || r.sides === 4) && r.mode === 'teams' ? 'teams' : 'ffa',
      size: MAP_SIZES.includes(r.size as MapSize) ? (r.size as MapSize) : 'standard',
      sites: r.sites !== false,
    };
  } catch {
    return { ...DEFAULT_SETUP, sites: true };
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
  seedSlot,
}: {
  value: SkirmishSetup;
  onChange: (v: SkirmishSetup) => void;
  /** The seed the battle will be created with (typed, or the lobby's fresh one). */
  seedText: string;
  /** The lobby's seed field, shown at the head of the Battlefield step since the seed draws the maps. */
  seedSlot?: ReactNode;
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
    for (const t of MAP_TYPES) out[t] = generateSkirmishMap(seed, t, value.ore, value.sides, value.size ?? 'standard');
    return out;
  }, [seed, value.ore, value.sides, value.size]);
  // The battle places sites from its own seed (rngSeed), which is this same number.
  const siteMarks = useMemo(() => {
    const out = {} as Record<MapType, SiteSpot[]>;
    for (const t of MAP_TYPES) out[t] = value.sites ? siteSpots(maps[t], { size: value.size ?? 'standard' }, seed) : [];
    return out;
  }, [maps, seed, value.sites, value.size]);
  const drawn = randomMapType(seed);
  const set = (patch: Partial<SkirmishSetup>) => onChange({ ...value, ...patch });

  return (
    <>
      <SetupStep n={2} title="Battlefield" hint="The seed draws the ground; pick the kind of country to fight over.">
        {seedSlot}
        <div className="fl-maps" role="radiogroup" aria-label="Battlefield">
          {(['random', ...MAP_TYPES] as SkirmishSetup['map'][]).map((t, i) => {
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
                <span className="fl-map-sheet">
                  <span className="fl-map-sheet-id" aria-hidden="true">
                    Sheet {String(i + 1).padStart(2, '0')}
                  </span>
                  <MapThumb map={maps[type]} sites={siteMarks[type]} label={`${t === 'random' ? 'Random: ' : ''}${MAP_TYPE_NAMES[type]} map preview`} />
                  <span className="fl-map-north" aria-hidden="true">N</span>
                </span>
                <span className="fl-map-name">{t === 'random' ? 'Random' : MAP_TYPE_NAMES[t]}</span>
                <span className="fl-map-blurb">
                  {t === 'random' ? `Any of the ${COUNT_WORDS[MAP_TYPES.length] ?? MAP_TYPES.length}, chosen by the seed. This one draws ${MAP_TYPE_NAMES[drawn]}.` : value.sides > 2 ? MAP_TYPE_BLURBS_SIDES[t] : MAP_TYPE_BLURBS[t]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="fl-setup-note">
          {value.sides === 2
            ? "Previews show the real map for this seed: your base is blue, the enemy's red, ore gold. Every map is mirrored, so both sides start with the same ground and the same ore."
            : `Previews show the real map for this seed: each base in its side's colour, yours blue, ore gold. Every base's share of the map is the same share turned round the centre, so every side starts with ${value.sides === 4 ? 'the same' : 'close to the same'} ground and ore.`}
          {value.sites ? ' Grey diamonds are the neutral sites any side can capture.' : ''}
        </p>
      </SetupStep>

      <SetupStep n={3} title="Forces" hint="Who takes the field, and with what.">
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
      </SetupStep>

      <SetupStep n={4} title="Terms of engagement" hint="Money, ore, room to manoeuvre and ground worth taking.">
        <div className="fl-setup-row fl-setup-terms">
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
          {/* round5:B. Larger maps (fireline-round5-design.md): the Map size field goes on the line below. */}
          <MapSizeField value={value} onPick={size => set({ size })} />
          {/* round5:D. Neutral sites (fireline-round5-design.md): the Neutral sites field goes on the line below. */}
          <div className="fl-setup-field">
            <Label>Neutral sites</Label>
            <div className="fl-seg" role="radiogroup" aria-label="Neutral sites">
              {[false, true].map(on => (
                <button key={on ? 'on' : 'off'} type="button" role="radio" aria-checked={!!value.sites === on} data-testid={`sites-${on ? 'on' : 'off'}`} onClick={() => set({ sites: on })}>
                  {on ? 'On' : 'Off'}
                </button>
              ))}
            </div>
            <p className="fl-setup-note">{sitesNote(value)}</p>
          </div>
        </div>
      </SetupStep>
    </>
  );
}

/**
 * One numbered step of the skirmish orders. The lobby lists them in an <ol>, so each is an <li>:
 * a numbered marker on a rail down the left, then the step's title, a line of guidance and its fields.
 */
export function SetupStep({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <li className="fl-step">
      <span className="fl-step-mark" aria-hidden="true">
        {n}
      </span>
      <div className="fl-step-body">
        <div className="fl-step-head">
          <h3 className="fl-step-title">{title}</h3>
          {hint && <p className="fl-step-hint">{hint}</p>}
        </div>
        {children}
      </div>
    </li>
  );
}

/** Round 5: the map's size, each with its tiles for this many sides and how long a battle runs. */
function MapSizeField({ value, onPick }: { value: SkirmishSetup; onPick: (size: MapSize) => void }) {
  const size = value.size ?? 'standard';
  const tiles = MAP_SIZE_TILES[size][value.sides];
  return (
    <div className="fl-setup-field">
      <Label>Map size</Label>
      <div className="fl-seg" role="radiogroup" aria-label="Map size">
        {MAP_SIZES.map(z => (
          <button key={z} type="button" role="radio" aria-checked={size === z} data-testid={`size-${z}`} onClick={() => onPick(z)}>
            {MAP_SIZE_NAMES[z]}
          </button>
        ))}
      </div>
      <p className="fl-setup-note" data-testid="size-note">
        {tiles} by {tiles} tiles for {value.sides} sides. {MAP_SIZE_BLURBS[size]}
      </p>
    </div>
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

/**
 * Pixels per tile in a map preview: 2 for the 64-tile map, 1.5 for 80 and 96, and on the larger
 * maps of round 5 whatever keeps the preview about 144 pixels across.
 */
const thumbScale = (w: number): number => (w <= 64 ? 2 : Math.min(1.5, 144 / w));

/** A map drawn small: the terrain, the ore and both Command Yards. Canvas paint, so hex is fine here. */
function MapThumb({ map, label, sites }: { map: GeneratedMap; label: string; sites: SiteSpot[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const S = thumbScale(map.w);
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
    // Neutral sites: a grey diamond with a light rim, each at the centre of its footprint.
    for (const p of sites) {
      const cx = (p.x + SITES[p.kind].w / 2) * S;
      const cy = (p.y + SITES[p.kind].h / 2) * S;
      const r = Math.max(2.5, S * 1.4);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fillStyle = SITE_ART.neutral;
      ctx.fill();
      ctx.strokeStyle = SITE_ART.neutralLight;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [map, sites]);
  const S = thumbScale(map.w);
  return <canvas ref={ref} width={map.w * S} height={map.h * S} className="fl-map-thumb" role="img" aria-label={label} />;
}
