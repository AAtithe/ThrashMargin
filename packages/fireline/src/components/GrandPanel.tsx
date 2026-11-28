/**
 * Grand War (fireline-grand-war-design.md, G4b): the war's own panel, beside the battle. Three tabs:
 *
 *  - Cities: each of your cities (population, level, housing, districts against the cap) and the towns
 *    you hold; the dominion race.
 *  - Diplomacy: each other power (temperament, stance and the minutes left on it, trust both ways),
 *    with a button for each step the rules allow (a disabled one says why), and the offers waiting.
 *  - Trade: your routes (trips, credits paid, the convoy's state), and opening a new one between two
 *    cities, with what a trip would pay.
 *
 * It reads the live state handed in on each refresh, and every button sends an ordinary action through
 * `dispatch`, so a refused one changes nothing (the same rules as the reducer: grandDiplomacy.ts and
 * grandTrade.ts give the reasons).
 */
import { useState } from 'react';
import { Button, SelectField } from '../lib/Kit';
import { cityCounts, cityLevel, citiesOf, districtCap, districtsOf, townsHeld, townsOf } from '../sim/cities';
import { cityHousing, dominantTeam } from '../sim/grand';
import { diplomacyOn, diplomacyProblem, endsOf, temperOf, trustOf } from '../sim/grandDiplomacy';
import { endOf, routeCap, routeProblem, routesOf, tradeOn, tripValue } from '../sim/grandTrade';
import { BUILDINGS, ROUTE_COST, SIDE_NAMES, TREATY_NAME, type Owner } from '../sim/rules';
import { isAlly, sidesOf, stanceOf } from '../sim/sides';
import type { GameAction, GameState } from '../sim/types';

type TabId = 'cities' | 'diplomacy' | 'trade';

/** A power's name as a heading: "Ashen Combine". */
const powerName = (o: Owner): string => SIDE_NAMES[o];

const STANCE_WORDS: Record<string, string> = { w: 'At war', c: 'Ceasefire', p: 'Trade pact', a: 'Alliance' };

/** "Command Yard city 214" style name for a route end or a city. */
function endName(s: GameState, id: number): string {
  const b = s.buildings.find(x => x.id === id);
  if (b) return `${b.owner === 0 ? '' : `${powerName(b.owner)}: `}${b.kind === 'hq' ? 'Capital' : 'City'} ${id}`;
  const t = townsOf(s).find(x => x.id === id);
  return t ? `Town ${id}` : `Gone (${id})`;
}

/** "1 city", "3 cities". */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const minutesLeft = (s: GameState, ticks: number): string => `${Math.max(0, Math.ceil((ticks - s.tick) / 600))} min`;

export default function GrandPanel({ state: s, dispatch, onClose }: { state: GameState; dispatch: (a: GameAction) => boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>(() => (s.grand?.offers?.length ? 'diplomacy' : 'cities'));
  const tabs: { id: TabId; label: string; on: boolean }[] = [
    { id: 'cities', label: 'Cities', on: true },
    { id: 'diplomacy', label: `Diplomacy${s.grand?.offers?.length ? ` (${s.grand.offers.length})` : ''}`, on: diplomacyOn(s) },
    { id: 'trade', label: 'Trade', on: tradeOn(s) },
  ];
  return (
    <div className="fl-d-card fl-d-help-card fl-scroll" role="dialog" aria-label="Grand War" data-testid="grand-panel" onClick={e => e.stopPropagation()}>
      <header className="fl-d-card-head">
        <h2 className="fl-d-card-title">Grand War</h2>
        <button type="button" className="fl-d-btn" data-testid="grand-close" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="fl-grand-tabs" role="tablist" aria-label="Grand War">
        {tabs
          .filter(t => t.on)
          .map(t => (
            <button key={t.id} type="button" role="tab" className="fl-d-btn" aria-selected={tab === t.id} data-testid={`grand-tab-${t.id}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
      </div>
      {tab === 'cities' && <CitiesTab s={s} />}
      {tab === 'diplomacy' && diplomacyOn(s) && <DiplomacyTab s={s} dispatch={dispatch} />}
      {tab === 'trade' && tradeOn(s) && <TradeTab s={s} dispatch={dispatch} />}
    </div>
  );
}

function CitiesTab({ s }: { s: GameState }) {
  const g = s.setup!.grand!;
  const { total, byTeam } = cityCounts(s);
  const ours = byTeam.get(0) ?? 0;
  const lead = dominantTeam(s);
  const dom = s.grand?.dominion;
  return (
    <div className="fl-grand-body">
      <p className="fl-grand-line" data-testid="grand-dominion">
        You hold <strong>{ours}</strong> of {total} cities and towns; dominion needs {g.dominionShare}% held for {g.dominionMinutes} minutes.
        {dom && lead !== null
          ? isAlly(s, 0, dom.team)
            ? ` Held for ${Math.floor((s.tick - dom.since) / 600)} min: ${minutesLeft(s, dom.since + g.dominionMinutes * 600)} to victory.`
            : ` The ${powerName(dom.team)} holds the share: ${minutesLeft(s, dom.since + g.dominionMinutes * 600)} until it wins.`
          : ''}
        {g.timeLimit ? ` The war is decided on cities held in ${minutesLeft(s, g.timeLimit * 600)}.` : ''}
      </p>
      <table className="fl-grand-table">
        <thead>
          <tr>
            <th scope="col">City</th>
            <th scope="col">People</th>
            <th scope="col">Level</th>
            <th scope="col">Housing</th>
            <th scope="col">Districts</th>
          </tr>
        </thead>
        <tbody>
          {citiesOf(s, 0).map(c => {
            const level = cityLevel(c.pop!);
            return (
              <tr key={c.id} data-testid="grand-city">
                <th scope="row">{c.kind === 'hq' ? 'Capital' : `${BUILDINGS[c.kind].name} city`}</th>
                <td>{c.pop}</td>
                <td>{level}</td>
                <td>{cityHousing(s, c)}</td>
                <td>
                  {districtsOf(s, c).length} of {districtCap(level)}
                </td>
              </tr>
            );
          })}
          {townsHeld(s, 0).map(t => (
            <tr key={t.id}>
              <th scope="row">Town {t.id}</th>
              <td colSpan={4}>Militia {t.garrison ?? 0}; pays, houses 8 and claims the ground round it</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fl-grand-note">
        A city grows a person every 30 seconds toward the housing round it; fed Quarters raise it. Each level widens its borders and lets it hold two more
        districts. A Forward Base Truck deployed well away from every city and town founds a new one, taking six people from your largest city.
      </p>
    </div>
  );
}

function DiplomacyTab({ s, dispatch }: { s: GameState; dispatch: (a: GameAction) => boolean }) {
  const others = sidesOf(s).filter(o => o !== 0);
  const offers = s.grand?.offers ?? [];
  return (
    <div className="fl-grand-body">
      {offers.length > 0 && (
        <section aria-label="Offers" className="fl-grand-offers">
          {offers.map(o => (
            <div key={o.id} className="fl-grand-offer" data-testid="grand-offer">
              <span>
                The {powerName(o.from)} offers {o.kind === 'a' ? 'an' : 'a'} {TREATY_NAME[o.kind]} ({minutesLeft(s, o.expires)} to answer).
              </span>
              <Button tone="primary" size="small" data-testid="grand-accept" onClick={() => dispatch({ type: 'answer', offer: o.id, accept: true })}>
                Accept
              </Button>
              <Button tone="quiet" size="small" data-testid="grand-decline" onClick={() => dispatch({ type: 'answer', offer: o.id, accept: false })}>
                Decline
              </Button>
            </div>
          ))}
        </section>
      )}
      {others.map(o => {
        const out = !s.buildings.some(b => b.owner === o && b.hp > 0);
        const st = stanceOf(s, 0, o) ?? 'w';
        const T = temperOf(s, o);
        const step = (act: 'ceasefire' | 'pact' | 'alliance' | 'war', label: string, tone: 'default' | 'danger' = 'default') => {
          const why = diplomacyProblem(s, 0, o, act);
          return (
            <Button size="small" tone={tone} disabled={why !== null} disabledReason={why ?? ''} data-testid={`grand-${act}-${o}`} onClick={() => dispatch({ type: 'diplomacy', to: o as Owner, act })}>
              {label}
            </Button>
          );
        };
        return (
          <section key={o} className="fl-grand-power" aria-label={powerName(o)} data-testid={`grand-power-${o}`} data-stance={st}>
            <header>
              <strong>{powerName(o)}</strong>
              <span>{T ? T.name : ''}</span>
              <span data-testid={`grand-stance-${o}`}>
                {out ? 'Out of the war' : STANCE_WORDS[st]}
                {!out && st !== 'w' ? `, ${minutesLeft(s, endsOf(s, 0, o as Owner))} left` : ''}
              </span>
            </header>
            {!out && (
              <>
                <p className="fl-grand-line">
                  Their trust in you {trustOf(s, o as Owner, 0)}; yours in them {trustOf(s, 0, o as Owner)}. {count(citiesOf(s, o as Owner).length, 'city', 'cities')},{' '}
                  {count(townsHeld(s, o as Owner).length, 'town', 'towns')}.
                </p>
                <div className="fl-grand-actions">
                  {step('ceasefire', st === 'c' ? 'Renew ceasefire' : 'Propose ceasefire')}
                  {step('pact', st === 'p' ? 'Renew trade pact' : 'Propose trade pact')}
                  {step('alliance', st === 'a' ? 'Renew alliance' : 'Propose alliance')}
                  {step('war', 'Declare war', 'danger')}
                </div>
              </>
            )}
          </section>
        );
      })}
      <p className="fl-grand-note">
        Treaties last 10, 15 and 20 minutes and must be renewed: one that runs out steps down a level, and a ceasefire that runs out is war again. Breaking a
        treaty before its time costs you the trust of every power.
      </p>
    </div>
  );
}

function TradeTab({ s, dispatch }: { s: GameState; dispatch: (a: GameAction) => boolean }) {
  const mine = [...citiesOf(s, 0).map(b => b.id), ...townsHeld(s, 0).map(t => t.id)];
  const partners = sidesOf(s).filter(o => o !== 0 && (stanceOf(s, 0, o) === 'p' || stanceOf(s, 0, o) === 'a'));
  const ends = [...mine, ...partners.flatMap(o => citiesOf(s, o).map(b => b.id))];
  const [from, setFrom] = useState<number>(mine[0] ?? 0);
  const [to, setTo] = useState<number>(ends.find(e => e !== mine[0]) ?? 0);
  const why = routeProblem(s, 0, from, to);
  const value = why === null ? tripValue(s, { owner: 0, from, to }) : null;
  const routes = routesOf(s, 0);
  return (
    <div className="fl-grand-body">
      <p className="fl-grand-line">
        {routes.length} of {count(routeCap(s, 0), 'route', 'routes')} running. A convoy is paid each time it reaches the far city; raiders hunt convoys as they hunt
        haulers.
      </p>
      {routes.length > 0 && (
        <table className="fl-grand-table">
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">A trip</th>
              <th scope="col">Trips</th>
              <th scope="col">Paid</th>
              <th scope="col">Convoy</th>
              <th scope="col">
                <span className="fl-sr">Close</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {routes.map(r => (
              <tr key={r.id} data-testid="grand-route">
                <th scope="row">
                  {endName(s, r.from)} to {endName(s, r.to)}
                </th>
                <td>{endOf(s, r.from) && endOf(s, r.to) ? tripValue(s, r).credits : 0}</td>
                <td>{r.trips}</td>
                <td>{r.paid}</td>
                <td>{r.convoy ? 'On the road' : `Replaced in ${minutesLeft(s, r.wait)}`}</td>
                <td>
                  <Button size="small" tone="quiet" onClick={() => dispatch({ type: 'unroute', id: r.id })}>
                    Close
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ends.length < 2 ? (
        <p className="fl-grand-note" data-testid="grand-trade-none">
          A route needs two cities: found one with a Forward Base Truck, take a town, or sign a trade pact to trade with another power's cities.
        </p>
      ) : (
      <div className="fl-grand-new">
        <SelectField label="From" value={from} onChange={e => setFrom(Number(e.target.value))} data-testid="grand-from">
          {mine.map(id => (
            <option key={id} value={id}>
              {endName(s, id)}
            </option>
          ))}
        </SelectField>
        <SelectField label="To" value={to} onChange={e => setTo(Number(e.target.value))} data-testid="grand-to">
          {ends.map(id => (
            <option key={id} value={id}>
              {endName(s, id)}
            </option>
          ))}
        </SelectField>
        <Button tone="primary" disabled={why !== null} disabledReason={why ?? ''} data-testid="grand-route-open" onClick={() => dispatch({ type: 'route', from, to })}>
          Open route ({ROUTE_COST})
        </Button>
      </div>
      )}
      {value && (
        <p className="fl-grand-line">
          A trip pays {value.credits} credits{value.food ? ` and ${value.food} food` : ''}
          {value.partner ? `, and ${value.partner} to the partner` : ''}.
        </p>
      )}
      {!partners.length && <p className="fl-grand-note">Foreign routes, which pay more, need a trade pact or an alliance.</p>}
    </div>
  );
}
