/**
 * War for the Planet: the Trade screen (fireline-planet-design.md, sections 7 and 17). W4.
 * Your routes with their yields and blockades, the picker to open one (every check is
 * routeProblem, live), and the exchange terms in force with whether they flow this turn.
 */
import { useState } from 'react';
import { describeTerms } from '../../planet/diplomacy';
import { VALUE } from '../../planet/rules';
import { exchangeFlows, routeCap, routeCost, routePartner, routePath, routeProblem, routeYield } from '../../planet/trade';
import { RESOURCES, type RegionId } from '../../planet/types';
import { FactionName, OrderButton, RES_NAME, stockText, type PlanetProps } from './common';

export default function TradeTab({ s, map, act, selected }: PlanetProps & { selected: RegionId | null }) {
  const mine = s.routes.filter(r => r.owner === 0);
  const cap = routeCap(s, 0);
  const own = map.regions.filter(g => s.regions[g.id].owner === 0);
  // Opens on the selected region when it is yours and has a city in reach, else on the first of
  // your cities that has one.
  const [from, setFrom] = useState<RegionId>(() => {
    const mineSel = selected !== null && s.regions[selected]?.owner === 0 ? [selected] : [];
    const reach = [...mineSel, ...own.map(g => g.id)].find(r => map.regions.some(h => h.id !== r && routeProblem(s, 0, r, h.id) === null));
    return reach ?? mineSel[0] ?? own[0]?.id ?? 0;
  });
  const [to, setTo] = useState<RegionId | null>(null);
  const reachable = map.regions.filter(g => g.id !== from && routeProblem(s, 0, from, g.id) === null);
  const target = to !== null && to !== from ? to : reachable[0]?.id ?? null;
  const exchanges = s.treaties.filter(t => (t.a === 0 || t.b === 0) && t.terms.some(x => x.k === 'exchange'));
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
      <section className="fl-pl-card" data-testid="trade-routes">
        <h3>
          Routes: {mine.length} of {cap}
        </h3>
        <span className="fl-small">
          More routes come with bigger cities and ports. A route pays nothing in a turn when its path is cut: it is blockaded.
        </span>
        <ul className="fl-pl-list">
          {mine.map(r => {
            const path = routePath(s, r);
            const partner = routePartner(s, r);
            return (
              <li key={r.id} className="fl-pl-item" data-testid={`route-${r.id}`} data-blockaded={path ? '0' : '1'}>
                <span>
                  <strong>
                    {map.regions[r.from].city} to {map.regions[r.to].city}
                  </strong>{' '}
                  <span className="fl-small">{partner === null ? 'domestic' : `with ${s.factions[partner].name}`}</span>
                  <br />
                  <span className="fl-small" style={{ color: path ? undefined : 'var(--pl-route-blocked)' }}>
                    {path ? `${stockText(routeYield(s, r))} a turn${partner !== null ? ' to each side' : ''}, ${path.length - 1} hops` : 'Blockaded: no safe path this turn'}
                  </span>
                </span>
                <OrderButton s={s} act={act} a={{ type: 'closeRoute', id: r.id }} tone="danger">
                  Close
                </OrderButton>
              </li>
            );
          })}
          {mine.length === 0 && <li className="fl-small">No routes yet.</li>}
        </ul>
      </section>

      <section className="fl-pl-card" id="pl-trade-open" data-testid="trade-open">
        <h3>Open a route</h3>
        <span className="fl-small">
          Between two of your cities at least 2 hops apart (ore and food to you), or to a city of a faction you have a trade pact or alliance with (fuel and alloys
          to both). At most 6 hops; sea legs need a port. Costs {stockText(routeCost())}.
        </span>
        <label className="fl-pl-field">
          From
          <select className="fl-pl-input" value={from} onChange={e => setFrom(Number(e.target.value))} data-testid="route-from">
            {own.map(g => (
              <option key={g.id} value={g.id}>
                {g.city}
              </option>
            ))}
          </select>
        </label>
        <label className="fl-pl-field">
          To
          <select className="fl-pl-input" value={target ?? ''} onChange={e => setTo(Number(e.target.value))} data-testid="route-to">
            {reachable.length === 0 && <option value="">No city in reach</option>}
            {reachable.map(g => (
              <option key={g.id} value={g.id}>
                {g.city} ({s.regions[g.id].owner === 0 ? 'yours' : s.factions[s.regions[g.id].owner].name})
              </option>
            ))}
          </select>
        </label>
        {target !== null && (
          <span className="fl-small">
            It would pay {stockText(routeYield(s, { id: 0, owner: 0, from, to: target }))} a turn.
          </span>
        )}
        <div>
          <OrderButton
            s={s}
            act={act}
            a={{ type: 'openRoute', from, to: target ?? -1 }}
            tone="primary"
            testId="open-route"
            id="pl-open-route"
            extraProblem={target === null ? routeProblem(s, 0, from, from) ?? 'No city in reach of this one.' : null}
          >
            Open the route
          </OrderButton>
        </div>
      </section>

      <section className="fl-pl-card" data-testid="trade-exchanges">
        <h3>Exchange terms</h3>
        <span className="fl-small">
          An exchange in a treaty flows only in turns when at least one foreign route between the two of you is open. Fair rates by value:{' '}
          {RESOURCES.map(r => `${RES_NAME[r].toLowerCase()} ${VALUE[r]}`).join(', ')}.
        </span>
        <ul className="fl-pl-list">
          {exchanges.map(t => {
            const other = t.a === 0 ? t.b : t.a;
            const flows = exchangeFlows(s, t.a, t.b);
            return (
              <li key={`${t.a}-${t.b}`} className="fl-pl-item">
                <span>
                  <FactionName s={s} f={other} />: {describeTerms(s, t.terms.filter(x => x.k === 'exchange'))}.{' '}
                  <span className="fl-small" style={{ color: flows ? 'var(--ui-good)' : 'var(--pl-route-blocked)' }}>
                    {flows ? 'Flowing this turn.' : 'Paused: no open route between you.'}
                  </span>
                </span>
              </li>
            );
          })}
          {exchanges.length === 0 && <li className="fl-small">No exchange terms in force. Add one to a trade pact or alliance on the Diplomacy screen.</li>}
        </ul>
      </section>
    </div>
  );
}
