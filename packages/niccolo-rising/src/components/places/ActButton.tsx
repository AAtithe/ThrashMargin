import type { ReactNode } from 'react';
import { Button } from '../ui';
import type { PlaceProps, Verb } from '../types';

/** A button bound to one verb: disabled, with the reason as its tooltip, whenever the sim would refuse it. */
export default function ActButton({ p, verb, children, tone }: { p: PlaceProps; verb: Verb; children: ReactNode; tone?: 'default' | 'primary' | 'quiet' | 'danger' }) {
  const reason = p.why(verb);
  return (
    <Button tone={tone} disabled={reason !== null} title={reason ?? undefined} onClick={() => p.act(verb)}>
      {children}
    </Button>
  );
}
