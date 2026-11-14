import { useEffect, useRef, useState } from 'react';
import { LiveRegion } from '../lib/Kit';
import { CAMPAIGN_START, findCity } from '../sim/content';
import { formatWeekDate } from '../sim/clock';
import type { GameState } from '../sim/types';

/**
 * Tells a screen reader what each new week brought, once per week: the date and purse, which
 * vessels made port, how many price reports came in, and a storm loss if there was one. Everything
 * it reads is already on screen somewhere (the header, the fleet list, Dispatches); this only says
 * that it changed. Presentation only: it reads two states and writes nothing.
 */
export default function WeekAnnouncer({ state }: { state: GameState }) {
  const prev = useRef(state);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (before.id !== state.id || before.week === state.week) return;
    setMessage(weekSummary(before, state));
  }, [state]);
  return <LiveRegion message={message} />;
}

function weekSummary(before: GameState, now: GameState): string {
  const parts = [`${formatWeekDate(now.week, CAMPAIGN_START)}.`, `${Math.round(now.cash)} florins in hand.`];
  const arrived = now.vessels.filter(v => {
    const was = before.vessels.find(b => b.id === v.id);
    return was?.destination && !v.destination;
  });
  for (const v of arrived) parts.push(`${v.name} made port at ${findCity(v.location)?.name ?? v.location}.`);
  const reports = Object.values(now.knownPrices).filter(n => n.receivedOnWeek === now.week).length;
  if (reports > 0) parts.push(`${reports} price report${reports === 1 ? '' : 's'} arrived.`);
  const storm = now.lastVoyageEvent;
  if (storm && storm.week === now.week) parts.push(`Storm struck ${storm.vesselName}.`);
  return parts.join(' ');
}
