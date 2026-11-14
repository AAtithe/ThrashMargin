import { nextPace, PACE_LABEL, setPace, usePace } from '../lib/motion';

/**
 * One button that cycles the portal's animation pace: full, quick, off (lib/motion.ts). Shared by
 * every game through localStorage, like the light/dark toggle beside it, and styled the same way.
 */
export default function MotionToggle({ style, className }: { style?: React.CSSProperties; className?: string }) {
  const pace = usePace();
  const next = nextPace(pace);
  return (
    <button
      type="button"
      onClick={() => setPace(next)}
      title={`Animation pace. Click for ${next}`}
      aria-label={`${PACE_LABEL[pace]}. Switch to ${next}`}
      className={className}
      // Given a className (the game header passes the kit's quiet button), the class styles it.
      style={className ? style : {
        background: 'transparent',
        border: '1px solid var(--portal-btn-rule)',
        color: 'var(--portal-link)',
        borderRadius: 4,
        padding: '0.15rem 0.5rem',
        fontSize: '0.72rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {PACE_LABEL[pace]}
    </button>
  );
}
