import { useContext, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { replayClass, usePace } from '../../lib/motion';
import { UI } from '../../theme';
import { Button } from '../ui';
import { Anchor, Floats, OutcomeContext, useGameFloats } from '../motion';
import type { PlaceProps, Verb } from '../types';

/**
 * A button bound to one verb: disabled, with the reason as its tooltip, whenever the sim would refuse it.
 * When motion is on it also answers its own press: what the action gained floats up from it, and it
 * shakes if the action was refused or went badly. The answer is drawn after the state has changed and
 * been saved; nothing here waits on it or holds the button.
 */
export default function ActButton({ p, verb, children, tone, id }: { p: PlaceProps; verb: Verb; children: ReactNode; tone?: 'default' | 'primary' | 'quiet' | 'danger'; id?: string }) {
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
  const button = (
    <Button id={id} tone={tone} disabled={reason !== null} title={reason ?? undefined} onClick={() => p.act(verb, origin)}>
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
