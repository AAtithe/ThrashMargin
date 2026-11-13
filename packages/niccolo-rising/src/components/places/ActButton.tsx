import { useContext, useEffect, useId, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { replayClass, usePace } from '../../lib/motion';
import { UI } from '../../theme';
import { Button } from '../ui';
import { Anchor, Floats, OutcomeContext, useGameFloats } from '../motion';
import type { PlaceProps, Verb } from '../types';

const END: CSSProperties = { alignItems: 'flex-end', textAlign: 'right' };

/**
 * A refusal that comes from where the character is ("You cannot train while on the road.") rather
 * than from this button. It would repeat under every button on the screen, so the game screen says it
 * once above the place instead (GameScreen's away notice and the Infirmary and Steen panels), and
 * the button keeps it only as a tooltip.
 */
const AWAY = /^You cannot .+ while .+\.$/;

/**
 * A button bound to one verb: disabled whenever the sim would refuse it, with the reason written
 * under it (a tooltip never shows on a touch screen).
 * When motion is on it also answers its own press: what the action gained floats up from it, and it
 * shakes if the action was refused or went badly. The answer is drawn after the state has changed and
 * been saved; nothing here waits on it or holds the button.
 */
export default function ActButton({
  p,
  verb,
  children,
  tone,
  id,
  reasonShownBy,
  align = 'end',
}: {
  p: PlaceProps;
  verb: Verb;
  children: ReactNode;
  tone?: 'default' | 'primary' | 'quiet' | 'danger';
  id?: string;
  /**
   * Where the reason is already on screen, so this button does not repeat it: `'page'` when the panel
   * writes it out itself (Missions), or a sibling verb (Train beside Train ×20) whose button shows the
   * same reason. A different reason from the sibling's is still shown.
   */
  reasonShownBy?: 'page' | Verb;
  /** Which edge the reason lines up with: the end, for a button that closes its row, or the start. */
  align?: 'start' | 'end';
}) {
  const origin = useId();
  const pace = usePace();
  const outcome = useContext(OutcomeContext);
  const box = useRef<HTMLSpanElement>(null);
  const { items, push } = useGameFloats();
  useEffect(() => {
    if (!outcome || outcome.origin !== origin || pace === 'off') return;
    if (outcome.result !== 'ok') replayClass(box.current, 'tm-anim-shake');
    for (const g of outcome.gains) push(g.text, g.good ? UI.good : UI.bad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);
  const reason = p.why(verb);
  const shownElsewhere =
    reason !== null &&
    (AWAY.test(reason) || (reasonShownBy !== undefined && (reasonShownBy === 'page' || p.why(reasonShownBy) === reason)));
  const button = (
    <Button
      id={id}
      tone={tone}
      disabled={reason !== null}
      disabledReason={reasonShownBy === 'page' ? undefined : shownElsewhere ? '' : reason ?? ''}
      wrapStyle={align === 'end' ? END : undefined}
      title={shownElsewhere ? reason ?? undefined : undefined}
      onClick={() => p.act(verb, origin)}
    >
      {children}
    </Button>
  );
  if (pace === 'off') return button;
  return (
    <Anchor innerRef={box}>
      {button}
      <Floats items={items} side="above" />
    </Anchor>
  );
}
