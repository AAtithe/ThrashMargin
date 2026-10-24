import { useState } from 'react';
import { SEASON_NAMES, seasonOf, voyageYear } from '../sim/weather';
import { FONT, UI, money } from '../theme';
import { Vignette, type VignetteKind } from './Art';
import type { Captain, GameState, LogEntry } from '../sim/types';

/**
 * The Shipping Gazette: what the rest of the table did while you were waiting.
 *
 * Computer turns resolve in an instant, so everything a rival did reached you as a stack of cards
 * or a scroll of log — the race was hard to follow. This reads the same log at the top of your turn
 * and prints it as a front page: one headline, the rest as news in brief. Nothing here is new
 * information, only an editor's ordering of it.
 */

interface Story {
  /** The log entry it was written from, so the event cards can stand aside for it. */
  seq: number;
  weight: number;
  art: VignetteKind;
  headline: string;
  text: string;
  colour: string;
}

/** Turn one log entry into a story, or nothing if it is not news. */
function story(e: LogEntry, nameOf: (id: string | null) => string): Omit<Story, 'seq'> | null {
  const who = nameOf(e.captainId);
  const d = e.data ?? {};
  switch (e.kind) {
    case 'teaRace':
      if (d.rank === 1) return { weight: 100, art: 'teaRace', headline: `${who} wins the Tea Race`, text: e.text, colour: UI.brass };
      if (d.rank === 2) return { weight: 60, art: 'teaRace', headline: `${who} second in the Tea Race`, text: e.text, colour: UI.brass };
      if (d.opened) return { weight: 70, art: 'teaRace', headline: 'The new season’s tea is down', text: e.text, colour: UI.brass };
      return null;
    case 'declare':
      return { weight: 95, art: 'declare', headline: `${who} claims the company`, text: e.text, colour: UI.warn };
    case 'deliver': {
      const payout = Number(d.payout ?? 0);
      return {
        weight: 20 + Math.min(50, payout / 25),
        art: 'deliver',
        headline: `${who} ${d.rank === 1 ? 'first home' : 'second home'}, ${money(payout)}`,
        text: e.text,
        colour: UI.good,
      };
    }
    case 'piracy':
      return { weight: 45, art: 'piracy', headline: `${who} boarded by pirates`, text: e.text, colour: UI.bad };
    case 'storm':
      return { weight: 15, art: 'storm', headline: `Heavy weather for ${who}`, text: e.text, colour: UI.warn };
    case 'event':
      return d.ended ? null : { weight: 50, art: 'event', headline: e.text.split('.')[0], text: e.text, colour: UI.warn };
    case 'share':
      return { weight: 30, art: 'declare', headline: `${who} buys into the company`, text: e.text, colour: UI.verdigris };
    case 'charter':
      return d.reward !== undefined
        ? { weight: 25, art: 'contract', headline: `${who}'s owners are pleased`, text: e.text, colour: UI.brass }
        : null;
    case 'era':
      return { weight: 110, art: 'event', headline: e.text.split('.')[0].replace('A new era: ', 'A new era — '), text: e.text, colour: UI.brass };
    case 'career':
      return d.level !== undefined
        ? { weight: 28, art: 'declare', headline: `${who} rises to level ${d.level}`, text: e.text, colour: UI.verdigris }
        : null;
    case 'renown':
      return { weight: 35, art: 'crackOn', headline: `${who}'s ship makes her name`, text: e.text, colour: UI.brass };
    case 'crackOn':
    case 'encounter':
      return d.damaged ? { weight: 18, art: 'spar', headline: `${who} carries away a spar`, text: e.text, colour: UI.bad } : null;
    case 'ship':
      return d.sold
        ? { weight: 25, art: 'repair', headline: `${who} sells a ship to the yard`, text: e.text, colour: UI.warn }
        : { weight: 22, art: 'trader', headline: `${who} buys a new hull`, text: e.text, colour: UI.verdigris };
    default:
      return null;
  }
}

/**
 * Everything since the viewer last acted, other than their own doings, as a front page. Null when
 * nothing worth printing happened.
 */
export function frontPage(state: GameState, viewer: Captain): Story[] {
  // Since the viewer's previous turn, not their last action, so the paper stays on the table after
  // they roll rather than vanishing under their own first move.
  let lastOwn = -1;
  for (const e of state.log) if (e.captainId === viewer.id && e.turn < state.turn && e.seq > lastOwn) lastOwn = e.seq;
  if (lastOwn < 0) return [];
  const nameOf = (id: string | null) => {
    const c = state.captains.find(x => x.id === id);
    return c ? c.name : 'The exchange';
  };
  return state.log
    // Round-turn news (the race opening, world events) is stamped with the new turn, so the
    // world's own entries are let through whatever their turn.
    .filter(e => e.seq > lastOwn && e.captainId !== viewer.id && (e.turn < state.turn || e.captainId === null))
    .map(e => {
      const st = story(e, nameOf);
      return st ? { ...st, seq: e.seq } : null;
    })
    .filter((x): x is Story => x !== null)
    .sort((a, b) => b.weight - a.weight);
}

export default function ShippingGazette({ state, viewer }: { state: GameState; viewer: Captain }) {
  // Folded per turn: a new turn prints a new paper.
  const [foldedOn, setFoldedOn] = useState<number | null>(null);
  if (foldedOn === state.turn) return null;
  const stories = frontPage(state, viewer);
  if (stories.length === 0) return null;

  const [lead, ...rest] = stories;
  const brief = rest.slice(0, 5);

  return (
    <article style={paper} aria-label="The Shipping Gazette">
      <header style={{ textAlign: 'center', borderBottom: `3px double ${UI.text}`, paddingBottom: '0.3rem' }}>
        <div style={{ fontFamily: FONT.display, fontSize: '1.35rem', letterSpacing: '0.12em', color: UI.text }}>
          THE SHIPPING GAZETTE
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT.data, fontSize: '0.6rem', letterSpacing: '0.12em', color: UI.textFaint, textTransform: 'uppercase' }}>
          <span>Round {state.round}</span>
          <span>{SEASON_NAMES[seasonOf(state.round)]}, year {voyageYear(state.round)}</span>
          <span>For {viewer.name}</span>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
        <Vignette kind={lead.art} size={64} colour={lead.colour} style={{ border: `1px solid ${UI.rule}`, background: UI.panel }} />
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontFamily: FONT.display, fontSize: '1.15rem', margin: '0 0 0.2rem', color: UI.text, lineHeight: 1.2 }}>
            {lead.headline}
          </h3>
          <p style={{ fontFamily: FONT.body, fontSize: '0.8rem', lineHeight: 1.45, margin: 0, color: UI.textSoft }}>{lead.text}</p>
        </div>
      </div>

      {brief.length > 0 && (
        <div style={columns}>
          {brief.map((s, i) => (
            <div key={i} style={{ breakInside: 'avoid', marginBottom: '0.45rem' }}>
              <div style={{ fontFamily: FONT.data, fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: s.colour }}>
                {s.headline}
              </div>
              <div style={{ fontFamily: FONT.body, fontSize: '0.74rem', lineHeight: 1.4, color: UI.textSoft }}>{s.text}</div>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={() => setFoldedOn(state.turn)} style={fold}>
        {rest.length > brief.length ? `${rest.length - brief.length} more in the chronicle · ` : ''}Fold the paper
      </button>
    </article>
  );
}

const paper: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  border: `1px solid ${UI.ruleStrong}`,
  background: UI.panel,
  padding: '0.75rem 0.9rem',
  boxShadow: `0 4px 14px ${UI.shadow}`,
};

const columns: React.CSSProperties = {
  columnWidth: '15rem',
  columnGap: '1.1rem',
  columnRule: `1px solid ${UI.rule}`,
  borderTop: `1px solid ${UI.rule}`,
  paddingTop: '0.5rem',
};

const fold: React.CSSProperties = {
  alignSelf: 'flex-end',
  background: 'transparent',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  color: UI.textFaint,
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '0.25rem 0.55rem',
  cursor: 'pointer',
};
