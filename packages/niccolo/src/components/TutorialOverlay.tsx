import { useState } from 'react';

const TUTORIAL_SEEN_KEY = 'niccolo_tutorial_seen';

/** Whether the tutorial has been dismissed before, in this browser — a local UI preference, not
 * campaign state, so it lives in localStorage rather than GameState/saves. */
export function hasSeenTutorial(): boolean {
  return !!localStorage.getItem(TUTORIAL_SEEN_KEY);
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

const PRIMARY_BUTTON: React.CSSProperties = {
  ...BUTTON,
  borderColor: '#e8d5a3',
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

interface TutorialOverlayProps {
  onClose: () => void;
  /** Only passed by GameScreen, and only when a guided, hands-on walkthrough of the campaign's
   * first moves actually makes sense right now (a fresh, undispatched campaign) — Lobby has no
   * live game state to walk through, and mid-campaign the scripted first-hop steps wouldn't apply. */
  onStartGuidedTour?: () => void;
}

export default function TutorialOverlay({ onClose, onStartGuidedTour }: TutorialOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const close = () => {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
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
          How to play — {stepIndex + 1} of {STEPS.length}
        </p>
        <h2 style={TITLE}>{step.title}</h2>
        <p style={BODY}>{step.body}</p>
        <div style={FOOTER}>
          <div style={DOTS}>
            {STEPS.map((_, i) => (
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
