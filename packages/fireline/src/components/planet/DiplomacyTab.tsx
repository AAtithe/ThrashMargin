/**
 * War for the Planet: the Diplomacy screen (fireline-planet-design.md, sections 8 and 17). W4.
 * Each faction's stance, temperament, trust in you, and the treaty in force; offers waiting for an
 * answer; Propose (a TreatyDraft built here, with the faction's live verdict before you send it);
 * Declare war and Cancel with the cost of a breach stated; gifts.
 */
import { useEffect, useRef, useState } from 'react';
import { describeTerms, draftProblem, isBreach, proposalVerdict, TREATY_NAMES } from '../../planet/diplomacy';
import { GIFT_MAX, PAYMENT_MAX, TERM_AMOUNT_MAX, TREATY_TURNS } from '../../planet/rules';
import { stanceOf, treatyBetween } from '../../planet/state';
import { NEUTRAL, RESOURCES, type FactionId, type Resource, type Treaty, type TreatyDraft, type TreatyKind, type TreatyTerm } from '../../planet/types';
import { FactionName, OrderButton, RES_NAME, StancePill, turnsLeftText, why, type PlanetProps } from './common';

const TEMPERAMENT_TEXT = {
  expansionist: 'Expansionist: attacks readily and may break its word.',
  mercantile: 'Mercantile: values trade, never breaks a dated treaty.',
  defensive: 'Defensive: guards its own, wary of giving access, never breaks a dated treaty.',
} as const;

/**
 * The draft the propose dialog opens with: a ceasefire with a faction at war, a trade pact under a
 * ceasefire, else an alliance. The guided first turn reads it to know who would sign.
 */
export function defaultDraft(s: PlanetProps['s'], to: FactionId): TreatyDraft {
  const st = stanceOf(s, 0, to);
  const kind: TreatyKind = st === 'war' ? 'ceasefire' : st === 'ceasefire' ? 'trade' : 'alliance';
  const lim = TREATY_TURNS[kind];
  const turns = kind === 'ceasefire' ? 6 : null;
  return { kind, turns: !lim.open && turns === null ? lim.min : turns, terms: [] };
}

export default function DiplomacyTab({
  s,
  map,
  act,
  proposing: proposingProp,
  onProposing,
}: PlanetProps & { proposing?: FactionId | null; onProposing?: (f: FactionId | null) => void }) {
  // The open dialog may be held by the screen (so the guided first turn can see it), else here.
  const [proposingOwn, setProposingOwn] = useState<FactionId | null>(null);
  const proposing = onProposing ? proposingProp ?? null : proposingOwn;
  const setProposing = onProposing ?? setProposingOwn;
  const others = s.factions.filter(f => f.id !== 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {s.offers.length > 0 && (
        <section className="fl-pl-card" data-tone="good" data-testid="planet-offers">
          <h3>Offers to you</h3>
          <ul className="fl-pl-list">
            {s.offers.map(o => (
              <li key={o.id} className="fl-pl-item" data-testid={`offer-${o.id}`}>
                <span>
                  <FactionName s={s} f={o.from} /> offers a {TREATY_NAMES[o.draft.kind]}, {o.draft.turns === null ? 'open-ended' : `for ${o.draft.turns} turns`}
                  {o.draft.terms.length ? `: ${describeTerms(s, o.draft.terms)}` : ''}.{' '}
                  <span className="fl-small">{o.expires <= s.turn ? 'Expires at the end of this turn.' : `Open until turn ${o.expires}.`}</span>
                </span>
                <span className="fl-pl-row">
                  <OrderButton s={s} act={act} a={{ type: 'answerOffer', id: o.id, accept: true }} tone="primary" testId={`accept-${o.id}`}>
                    Accept
                  </OrderButton>
                  <OrderButton s={s} act={act} a={{ type: 'answerOffer', id: o.id, accept: false }} testId={`decline-${o.id}`}>
                    Decline
                  </OrderButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="fl-pl-factions">
        {others.map(f => {
          const st = stanceOf(s, 0, f.id);
          const t = treatyBetween(s, 0, f.id);
          const trust = s.trust[f.id]?.[0] ?? 50;
          return (
            <section key={f.id} className="fl-pl-card" data-testid={`faction-${f.id}`} data-stance={st}>
              <div className="fl-pl-row" style={{ justifyContent: 'space-between' }}>
                <h3>
                  <FactionName s={s} f={f.id} />
                </h3>
                {f.alive ? <StancePill st={st} /> : <span className="fl-tag">Out of the war</span>}
              </div>
              {f.temperament && <span className="fl-small">{TEMPERAMENT_TEXT[f.temperament]}</span>}
              <div className="fl-pl-trust" title="How far they trust you, 0 to 100">
                <span className="fl-small">Their trust in you</span>
                <span className="fl-pl-trust-bar">
                  <span style={{ width: `${trust}%` }} />
                </span>
                <strong>{trust}</strong>
              </div>
              {t ? <TreatyText s={s} t={t} /> : f.alive && <span className="fl-small">No treaty: you are at war.</span>}
              {f.alive && (
                <>
                  <div className="fl-pl-row">
                    <button type="button" className="fl-pl-btn primary" onClick={() => setProposing(f.id)} id={`pl-propose-${f.id}`} data-testid={`propose-${f.id}`}>
                      Propose a treaty
                    </button>
                    {t && (
                      <>
                        <OrderButton s={s} act={act} a={{ type: 'declareWar', on: f.id }} tone="danger" testId={`war-${f.id}`}>
                          Declare war
                        </OrderButton>
                        <OrderButton s={s} act={act} a={{ type: 'cancelTreaty', with: f.id }} testId={`cancel-${f.id}`}>
                          Cancel the {TREATY_NAMES[t.kind]}
                        </OrderButton>
                      </>
                    )}
                  </div>
                  {t && <span className="fl-small" style={{ color: isBreach(s, t) ? 'var(--ui-bad)' : undefined }}>{breachText(s, t, f.id)}</span>}
                  <Gift s={s} map={map} act={act} to={f.id} />
                </>
              )}
            </section>
          );
        })}
      </div>
      {proposing !== null && <ProposeDialog s={s} map={map} act={act} to={proposing} onClose={() => setProposing(null)} />}
    </div>
  );
}

function TreatyText({ s, t }: { s: PlanetProps['s']; t: Treaty }) {
  return (
    <span className="fl-small" data-testid="treaty-text">
      A {TREATY_NAMES[t.kind]} since turn {t.since}, {turnsLeftText(t.ends, s.turn)}
      {t.terms.length ? `. Terms: ${describeTerms(s, t.terms)}.` : ', no terms.'}
    </span>
  );
}

function breachText(s: PlanetProps['s'], t: Treaty, f: FactionId): string {
  const name = s.factions[f].name;
  if (isBreach(s, t)) return `Ending it now is a breach: ${name}'s trust in you falls by 30 and every other faction's by 10.`;
  if (t.turns === null) return `Ending an open-ended treaty is not a breach, but ${name}'s trust in you falls by 5.`;
  return 'This treaty may be ended without penalty.';
}

function Gift({ s, act, to }: PlanetProps & { to: FactionId }) {
  const [res, setRes] = useState<Resource>('food');
  const [amount, setAmount] = useState(5);
  return (
    <div className="fl-pl-row">
      <span className="fl-small">Gift</span>
      <input className="fl-pl-input" type="number" min={1} max={GIFT_MAX} value={amount} style={{ width: 64 }} aria-label="Gift amount" onChange={e => setAmount(Math.round(Number(e.target.value) || 0))} />
      <select className="fl-pl-input" value={res} aria-label="Gift resource" onChange={e => setRes(e.target.value as Resource)}>
        {RESOURCES.map(r => (
          <option key={r} value={r}>
            {RES_NAME[r]}
          </option>
        ))}
      </select>
      <OrderButton s={s} act={act} a={{ type: 'gift', to, res, amount }}>
        Send
      </OrderButton>
    </div>
  );
}

// ---- Propose ------------------------------------------------------------------------------------

type TermKind = TreatyTerm['k'];
const TERM_NAMES: Record<TermKind, string> = { tribute: 'Tribute each turn', exchange: 'Exchange each turn', access: 'Open regions (access)', split: 'Split of regions', payment: 'One-off payment' };

function ProposeDialog({ s, map, act, to, onClose }: PlanetProps & { to: FactionId; onClose: () => void }) {
  const [kind, setKind] = useState<TreatyKind>(() => defaultDraft(s, to).kind);
  const [turns, setTurns] = useState<number | null>(kind === 'ceasefire' ? 6 : null);
  const [terms, setTerms] = useState<TreatyTerm[]>([]);
  const [adding, setAdding] = useState<TermKind>('payment');
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', key);
    box.current?.focus();
    return () => window.removeEventListener('keydown', key);
  }, []);

  const lim = TREATY_TURNS[kind];
  const draft: TreatyDraft = { kind, turns: !lim.open && turns === null ? lim.min : turns, terms };
  const problem = draftProblem(s, 0, to, draft);
  const verdict = problem ? null : proposalVerdict(s, to, 0, draft);
  const sendProblem = why(s, { type: 'propose', to, draft });
  const thirdParty = map.regions.filter(g => s.regions[g.id].owner !== 0 && s.regions[g.id].owner !== to);

  const changeKind = (k: TreatyKind) => {
    setKind(k);
    const l = TREATY_TURNS[k];
    if (turns === null ? !l.open : turns < l.min || turns > l.max) setTurns(l.open ? null : 6);
    if (k === 'ceasefire') setTerms(terms.filter(t => t.k !== 'exchange'));
  };
  const addTerm = () => {
    const t: TreatyTerm =
      adding === 'tribute'
        ? { k: 'tribute', from: to, res: 'ore', amount: 2 }
        : adding === 'exchange'
          ? { k: 'exchange', from: 0, give: 'ore', giveAmount: 3, get: 'alloys', getAmount: 1 }
          : adding === 'access'
            ? { k: 'access', grantor: terms.some(x => x.k === 'access' && x.grantor === to) ? 0 : to }
            : adding === 'split'
              ? { k: 'split', regions: thirdParty.length ? [[thirdParty[0].id, 0]] : [] }
              : { k: 'payment', from: 0, res: 'food', amount: 5 };
    setTerms([...terms, t]);
  };
  const setTerm = (i: number, t: TreatyTerm) => setTerms(terms.map((x, j) => (j === i ? t : x)));
  const who = (f: FactionId) => (f === 0 ? 'You' : s.factions[f].name);
  const party = (value: FactionId, onChange: (f: FactionId) => void) => (
    <select className="fl-pl-input" value={value} onChange={e => onChange(Number(e.target.value))} aria-label="Which side">
      <option value={0}>You</option>
      <option value={to}>{s.factions[to].name}</option>
    </select>
  );
  const resource = (value: Resource, onChange: (r: Resource) => void, label: string) => (
    <select className="fl-pl-input" value={value} onChange={e => onChange(e.target.value as Resource)} aria-label={label}>
      {RESOURCES.map(r => (
        <option key={r} value={r}>
          {RES_NAME[r]}
        </option>
      ))}
    </select>
  );
  const amount = (value: number, max: number, onChange: (n: number) => void, label: string) => (
    <input className="fl-pl-input" type="number" min={1} max={max} value={value} style={{ width: 60 }} aria-label={label} onChange={e => onChange(Math.round(Number(e.target.value) || 0))} />
  );

  return (
    <div className="fl-scrim fixed" onClick={onClose}>
      <div ref={box} className="fl-modal" style={{ maxWidth: 620 }} role="dialog" aria-modal="true" aria-label="Propose a treaty" tabIndex={-1} onClick={e => e.stopPropagation()} data-testid="propose-dialog">
        <header>
          <h2>A treaty with {s.factions[to].name}</h2>
          <button type="button" className="fl-camp-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="fl-modal-body fl-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="fl-pl-row" role="group" aria-label="Kind of treaty">
            {(['ceasefire', 'trade', 'alliance'] as TreatyKind[]).map(k => (
              <button key={k} type="button" className="fl-pl-btn" aria-pressed={kind === k} onClick={() => changeKind(k)} data-testid={`treaty-${k}`}>
                {TREATY_NAMES[k]}
              </button>
            ))}
          </div>
          <span className="fl-small">
            {kind === 'ceasefire'
              ? 'No attacks either way for its length.'
              : kind === 'trade'
                ? 'No attacks; foreign trade routes and exchanges between you are allowed.'
                : 'Pass through each other\'s regions, fight together when you border a battle, and share an allied victory.'}
          </span>
          <div className="fl-pl-row">
            <label className="fl-pl-field">
              Length in turns
              <span className="fl-pl-row">
                <input
                  className="fl-pl-input"
                  type="number"
                  min={lim.min}
                  max={lim.max}
                  value={draft.turns ?? ''}
                  disabled={draft.turns === null}
                  style={{ width: 70 }}
                  onChange={e => setTurns(Math.round(Number(e.target.value) || lim.min))}
                  data-testid="treaty-turns"
                />
                {lim.open && (
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={draft.turns === null} onChange={e => setTurns(e.target.checked ? null : lim.min)} /> open-ended
                  </label>
                )}
              </span>
            </label>
            <span className="fl-small">
              {lim.min} to {lim.max} turns{lim.open ? ', or open-ended' : ''}.
            </span>
          </div>

          <h4 style={{ margin: 0, fontSize: '0.66rem', letterSpacing: '0.16em', textTransform: 'uppercase' }}>Terms</h4>
          {terms.length === 0 && <span className="fl-small">No terms.</span>}
          {terms.map((t, i) => (
            <div key={i} className="fl-pl-item">
              <span className="fl-pl-row">
                <strong className="fl-small">{TERM_NAMES[t.k]}</strong>
                {t.k === 'tribute' && (
                  <>
                    {party(t.from, f => setTerm(i, { ...t, from: f }))} pays {amount(t.amount, TERM_AMOUNT_MAX, n => setTerm(i, { ...t, amount: n }), 'Tribute amount')}
                    {resource(t.res, r => setTerm(i, { ...t, res: r }), 'Tribute resource')}
                  </>
                )}
                {t.k === 'payment' && (
                  <>
                    {party(t.from, f => setTerm(i, { ...t, from: f }))} pays {amount(t.amount, PAYMENT_MAX, n => setTerm(i, { ...t, amount: n }), 'Payment amount')}
                    {resource(t.res, r => setTerm(i, { ...t, res: r }), 'Payment resource')}
                  </>
                )}
                {t.k === 'exchange' && (
                  <>
                    {party(t.from, f => setTerm(i, { ...t, from: f }))} give {amount(t.giveAmount, TERM_AMOUNT_MAX, n => setTerm(i, { ...t, giveAmount: n }), 'Amount given')}
                    {resource(t.give, r => setTerm(i, { ...t, give: r }), 'Resource given')} for {amount(t.getAmount, TERM_AMOUNT_MAX, n => setTerm(i, { ...t, getAmount: n }), 'Amount received')}
                    {resource(t.get, r => setTerm(i, { ...t, get: r }), 'Resource received')}
                  </>
                )}
                {t.k === 'access' && <>{party(t.grantor, f => setTerm(i, { ...t, grantor: f }))} open their regions to the other</>}
                {t.k === 'split' && (
                  <>
                    {t.regions.map(([r, f], j) => (
                      <span key={j} className="fl-pl-row">
                        <select
                          className="fl-pl-input"
                          value={r}
                          aria-label="Region to split"
                          onChange={e => setTerm(i, { ...t, regions: t.regions.map((x, k) => (k === j ? [Number(e.target.value), x[1]] : x)) })}
                        >
                          {thirdParty.map(g => (
                            <option key={g.id} value={g.id}>
                              {g.city} ({s.regions[g.id].owner === NEUTRAL ? 'independent' : s.factions[s.regions[g.id].owner].name})
                            </option>
                          ))}
                        </select>
                        to {party(f, nf => setTerm(i, { ...t, regions: t.regions.map((x, k) => (k === j ? [x[0], nf] : x)) }))}
                      </span>
                    ))}
                    {t.regions.length < 4 && thirdParty.length > 0 && (
                      <button type="button" className="fl-pl-btn" onClick={() => setTerm(i, { ...t, regions: [...t.regions, [thirdParty[0].id, to]] })}>
                        Another region
                      </button>
                    )}
                  </>
                )}
              </span>
              <button type="button" className="fl-pl-btn danger" onClick={() => setTerms(terms.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          {terms.length < 4 && (
            <div className="fl-pl-row">
              <select className="fl-pl-input" value={adding} aria-label="Term to add" onChange={e => setAdding(e.target.value as TermKind)}>
                {(Object.keys(TERM_NAMES) as TermKind[])
                  .filter(k => k !== 'exchange' || kind !== 'ceasefire')
                  .map(k => (
                    <option key={k} value={k}>
                      {TERM_NAMES[k]}
                    </option>
                  ))}
              </select>
              <button type="button" className="fl-pl-btn" onClick={addTerm} data-testid="add-term">
                Add term
              </button>
            </div>
          )}

          <div className="fl-pl-verdict" data-accept={problem ? '0' : verdict?.accept ? '1' : '0'} id="pl-treaty-verdict" data-testid="treaty-verdict" aria-live="polite">
            {problem ? (
              problem
            ) : verdict ? (
              <>
                <strong>{verdict.accept ? `${s.factions[to].name} would accept.` : `${s.factions[to].name} would refuse.`}</strong> {verdict.reasons.join(' ')}
              </>
            ) : null}
          </div>
          <div className="fl-pl-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="fl-pl-btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="fl-pl-btn primary"
              disabled={!!sendProblem}
              title={sendProblem ?? undefined}
              onClick={() => {
                if (act({ type: 'propose', to, draft })) onClose();
              }}
              id="pl-send-proposal"
              data-testid="send-proposal"
            >
              Send to {who(to)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
