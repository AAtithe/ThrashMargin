import { useState } from 'react';

const TUTORIAL_SEEN_KEY = 'niccolo_tutorial_seen';
const CHAPTER0_TUTORIAL_SEEN_KEY = 'niccolo_chapter0_tutorial_seen';

/** Whether the main (post-Chapter-0) tutorial has been dismissed before, in this browser — a
 * local UI preference, not campaign state, so it lives in localStorage rather than GameState/saves. */
export function hasSeenTutorial(): boolean {
  return !!localStorage.getItem(TUTORIAL_SEEN_KEY);
}

/** Whether the separate, shorter Chapter 0 tutorial has been dismissed before. Tracked apart from
 * `hasSeenTutorial` since the two describe different resources (nothing yet vs. a ship and 40f)
 * and a player can legitimately need to see both, once each, in the same browser. */
export function hasSeenChapter0Tutorial(): boolean {
  return !!localStorage.getItem(CHAPTER0_TUTORIAL_SEEN_KEY);
}

const BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 6, 4, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: '2rem',
};

const CARD: React.CSSProperties = {
  background: '#17130d',
  border: '1px solid #4a3d28',
  boxShadow: '0 0 0 1px #0e0b07, 0 8px 40px rgba(0,0,0,0.6)',
  maxWidth: '34rem',
  padding: '1.8rem',
  fontFamily: '"Georgia", "Times New Roman", serif',
  color: '#c9b88a',
};

const STEP_LABEL: React.CSSProperties = {
  fontSize: '0.7rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.5rem',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.3rem',
  letterSpacing: '0.05em',
  color: '#e8d5a3',
  margin: '0 0 1rem',
};

const BODY: React.CSSProperties = {
  fontSize: '0.95rem',
  lineHeight: 1.65,
  margin: '0 0 1.6rem',
  color: '#c9b88a',
};

const FOOTER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
};

const DOTS: React.CSSProperties = {
  display: 'flex',
  gap: '0.35rem',
};

const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.5rem 0.9rem',
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  letterSpacing: '0.03em',
  cursor: 'pointer',
};

// Override the full `border` shorthand, not just `borderColor` — mixing a shorthand and a longhand
// for the same property across renders of the same element is a real React warning ("Removing
// borderColor border"), not just a lint nag.
const PRIMARY_BUTTON: React.CSSProperties = {
  ...BUTTON,
  border: '1px solid #e8d5a3',
  color: '#e8d5a3',
};

const GHOST_BUTTON: React.CSSProperties = {
  ...BUTTON,
  border: 'none',
  color: '#6a5a40',
  padding: '0.5rem 0.3rem',
};

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'The house you are building',
    body:
      "Bruges, 14 March 1460. You hold 40 florins, a ship, a courier, and a handful of officers already on the payroll. Everything else — every florin of profit, every obligation on the ledger, every officer's loyalty — is yours to build or lose from here. There is no scripted victory; the campaign simply keeps running until it doesn't.",
  },
  {
    title: 'The map',
    body:
      "Select a vessel from the sidebar, then click a lit city to send it there. Couriers travel by land only; the ship can also cross the sea routes (the dashed lines). A vessel already under way can't be redirected — check how many weeks are left before you commit it.",
  },
  {
    title: 'Buying and selling',
    body:
      'Dock a cargo vessel at a city with a market and the Market panel opens: buy low, carry it somewhere it sells dear. Every trade nudges that city\'s price against you a little — buying enough wool drives the price up, selling drives it down — and prices drift back toward normal over time if you leave a market alone.',
  },
  {
    title: 'Information is not the same as truth',
    body:
      "Except at Bruges — home, where you always know the truth — every price you see for a city is a report, current as of whenever it was written, not as of now. A report takes real weeks to reach you, and a city you haven't visited in a while may have moved on from what you last heard. The Dispatches panel shows each city's report age and lets you pay to speed up its courier line.",
  },
  {
    title: 'Credit is leverage, not free money',
    body:
      "The Ledger lets you write bills of exchange (borrow now, owe more later, in a foreign currency whose exchange rate can move against you), take deposits, and lend to merchants or princes. Every obligation lands on the maturity ladder. If a payment comes due and you can't cover it — even after your ships are forced to sell their cargo at a loss — the house goes insolvent and the campaign ends.",
  },
  {
    title: 'Your household',
    body:
      "Officers can be assigned aboard a vessel (a trade discount), to negotiate at a city (a better rate on credit written there), or to investigate a city (faster reports). Keep their wages paid — miss a week's payroll and loyalty drops hard for everyone. Some choices cost Conscience instead of cash; it doesn't come back.",
  },
  {
    title: 'The sea is not free of risk',
    body:
      'Cargo under way can be lost to storms or piracy — sea routes more than land, seasonal routes more still. At Bruges, Venice, or Genoa you can insure a cargo before it departs; the premium reflects the route and how stale your own word from the destination is. Insured losses pay out in cash. Uninsured ones do not.',
  },
  {
    title: 'The campaign is also a story',
    body:
      "Scripted events will interrupt play with a real choice — take the commission, or refuse it; back a claimant, or stay neutral. Choices set flags permanently and can chain into later events, sometimes chapters later. There is no undo. When you're ready, close this and advance the clock.",
  },
];

const CHAPTER0_STEPS: Step[] = [
  {
    title: 'You are Claes',
    body:
      "Bruges, 14 March 1460. No florins, no ship — just a dispatch rider for carrying messages and a handcart Julius has just lent you for carrying a little cargo alongside them. Scripted events (the cards that interrupt play) are most of what drives Chapter 0: read them, choose, and they'll tell you plainly what to do next.",
  },
  {
    title: 'The handcart trades for real',
    body:
      "It only holds 3 units, but it's a real cargo hold: dock it at a city with a market and the Market panel opens exactly as it will later for a full ship — buy what's cheap, sell what's dear, or just sell whatever an event has handed you. Select it from the Vessels list in the sidebar, then click a city on the map to send it there.",
  },
  {
    title: 'Waiting is part of it',
    body:
      "Some events wait on a flag from an earlier choice, or on a vessel actually reaching a city — nothing happens until you advance the week (or the handcart arrives) to let it catch up. If nothing's pending and you're not sure what to do, that usually just means: send the handcart where the last event pointed, then advance the week.",
  },
  {
    title: 'This all carries over',
    body:
      "Once Marian judges you ready, she hands you a real ship, a real stake, and the household you've been quietly building — Julius, Godscalc, and whoever else has joined along the way. Everything you've learned here (the map, the market, information lag) works exactly the same from then on, just at a larger scale.",
  },
];

interface TutorialOverlayProps {
  onClose: () => void;
  /** Chapter 0 (no ship, no capital yet) needs its own shorter walkthrough — the main one below
   * describes resources ("You hold 40 florins, a ship...") that aren't true yet during the
   * prologue. Selects both the step content and which "seen" flag gets set on close. */
  variant?: 'main' | 'chapter0';
  /** Only passed by GameScreen, and only when a guided, hands-on walkthrough of the campaign's
   * first moves actually makes sense right now (a fresh, undispatched campaign) — Lobby has no
   * live game state to walk through, and mid-campaign the scripted first-hop steps wouldn't apply. */
  onStartGuidedTour?: () => void;
}

export default function TutorialOverlay({ onClose, variant = 'main', onStartGuidedTour }: TutorialOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const steps = variant === 'chapter0' ? CHAPTER0_STEPS : STEPS;
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  const close = () => {
    localStorage.setItem(variant === 'chapter0' ? CHAPTER0_TUTORIAL_SEEN_KEY : TUTORIAL_SEEN_KEY, '1');
    onClose();
  };

  const startGuidedTour = () => {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
    onStartGuidedTour?.();
  };

  return (
    <div style={BACKDROP}>
      <div style={CARD}>
        <p style={STEP_LABEL}>
          How to play — {stepIndex + 1} of {steps.length}
        </p>
        <h2 style={TITLE}>{step.title}</h2>
        <p style={BODY}>{step.body}</p>
        <div style={FOOTER}>
          <div style={DOTS}>
            {steps.map((_, i) => (
              <span
                key={i}
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: i === stepIndex ? '#e8d5a3' : '#4a3d28',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {stepIndex > 0 && (
              <button style={BUTTON} onClick={() => setStepIndex(i => i - 1)}>
                Back
              </button>
            )}
            {isLast && onStartGuidedTour ? (
              <>
                <button style={GHOST_BUTTON} onClick={close}>
                  Explore on my own
                </button>
                <button style={PRIMARY_BUTTON} onClick={startGuidedTour}>
                  Walk me through the first move
                </button>
              </>
            ) : (
              <>
                <button style={GHOST_BUTTON} onClick={close}>
                  Skip
                </button>
                <button style={PRIMARY_BUTTON} onClick={() => (isLast ? close() : setStepIndex(i => i + 1))}>
                  {isLast ? 'Begin' : 'Next'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
