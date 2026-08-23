import { formatWeekDate } from '../sim/clock';
import { CAMPAIGN_START, findCity } from '../sim/content';
import { readParentage } from '../sim/dossier';
import { cargoValue } from '../sim/insurance';
import { warehousesValue } from '../sim/warehouse';
import { resaleValue } from '../sim/shipyard';
import { toFlorins } from '../sim/currency';
import type { GameState } from '../sim/types';
import { UI, FONT } from '../theme';

/**
 * The epilogue (Chapter 8, Phase 25) — *"prices the whole campaign: net worth, people kept,
 * Conscience, secrets never sold"* (§9).
 *
 * **This is the one place in the game a net-worth figure belongs, and that is a deliberate,
 * previously-recorded decision rather than a reversal.** Phase 15 explicitly rejected an ambient
 * wealth readout on the grounds that a permanently visible number becomes a de facto score and
 * undermines the "no scripted victory" stance — and explicitly deferred the real number to this
 * screen. A single reckoning at the end is the opposite of a running score: it cannot be optimised
 * against week to week, because by the time you see it the campaign is over.
 *
 * It also deliberately reports things the ledger has no column for, next to the things it does. That
 * juxtaposition *is* the design pillar — "victories cost more than defeats" — and stating the
 * conscience, the household and the unsold secrets in the same breath as the florins is the only
 * point in eight chapters where the game gets to say so directly.
 */

const WRAP: React.CSSProperties = {
  height: '100vh',
  overflowY: 'auto',
  background: UI.ground,
  color: UI.text,
  fontFamily: FONT.body,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '2.5rem 1.5rem',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.9rem',
  letterSpacing: '0.12em',
  color: UI.brass,
  margin: '0 0 0.2rem',
  textAlign: 'center',
};

const SUB: React.CSSProperties = {
  fontSize: '0.85rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: UI.textSoft,
  margin: '0 0 1.8rem',
};

const PROSE: React.CSSProperties = {
  maxWidth: '34rem',
  textAlign: 'center',
  color: UI.brass,
  lineHeight: 1.65,
  margin: '0 0 1.1rem',
};

const LEDGER: React.CSSProperties = {
  maxWidth: '34rem',
  width: '100%',
  borderTop: `1px solid ${UI.rule}`,
  borderBottom: `1px solid ${UI.rule}`,
  padding: '1rem 0',
  margin: '0.8rem 0 1.4rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  fontSize: '0.86rem',
  padding: '0.28rem 0',
};

const NOTE: React.CSSProperties = {
  maxWidth: '34rem',
  fontSize: '0.78rem',
  color: UI.textFaint,
  textAlign: 'center',
  fontStyle: 'italic',
  margin: '0 0 1.4rem',
};

const BUTTON: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
  padding: '0.6rem 1.1rem',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  letterSpacing: '0.06em',
  cursor: 'pointer',
};

/** What the house is worth, counted the way the design doc's own §5 describes a balance sheet:
 * cash, cargo at last-known local value, loans out, less what is owed. Reuses `cargoValue` rather
 * than a second valuation, so the figure agrees with what insurance would have covered. */
function netWorth(state: GameState): { assets: number; liabilities: number; net: number } {
  let assets = Math.max(0, state.cash);
  for (const v of state.vessels) {
    assets += cargoValue(state.scarcity, v.cargo, v.location, state.marketEvents);
  }
  // Goods in a leased warehouse (Phase 26) count exactly like goods in a hold. Without this a
  // player who ended the campaign with four full sheds would be reported poorer than one who had
  // dumped the same stock at a crashed price, which is precisely backwards.
  assets += warehousesValue(state);
  // And the hulls themselves (Phase 28) — a house that ended with four carracks is not poorer than
  // one that never bought a ship, which is what omitting them would report.
  for (const v of state.vessels) assets += resaleValue(v);
  let liabilities = 0;
  for (const o of state.obligations) {
    if (o.settled) continue;
    const florins = toFlorins(o.amount, o.currency, state.exchangeRates);
    if (o.direction === 'payable') liabilities += florins;
    else assets += florins;
  }
  return { assets: Math.round(assets), liabilities: Math.round(liabilities), net: Math.round(assets - liabilities) };
}

const SHAPE_TITLE: Record<string, string> = {
  shape_scottish_house: 'A Scottish landed house',
  shape_venetian_bank: 'A Venetian bank',
  shape_dissolution: 'Dissolved into legacy',
};

const SHAPE_PROSE: Record<string, string> = {
  shape_scottish_house:
    'The company became ground. Tenancies near a Scottish burgh, a house that needed work, and an entry in a register that will outlast every ledger the house ever kept — the least intelligent use of capital Master Julius ever drafted, and the only one that cannot be repriced by a prince.',
  shape_venetian_bank:
    'The company became an institution. Deposits, branches, a constitution that survives its founder, and a name on a door in the Rialto honoured by clerks who will never meet anybody who built it. The most durable thing the house ever made, and the least like itself.',
  shape_dissolution:
    'The company was wound up while it was still worth something. The agencies closed in order, every officer was settled in person, the ships went to men who would sail them — and what remained was a name, a boy, and money that would never again be at risk from anybody’s war.',
};

export default function EpilogueScreen({ state, onReturn }: { state: GameState; onReturn: () => void }) {
  const worth = netWorth(state);
  const parentage = readParentage(state);
  const active = state.characters.filter(c => c.status === 'active');
  const departed = state.characters.filter(c => c.status === 'departed');
  const secretsSold = state.secrets.filter(s => s.used).length;
  const secretsKept = state.secrets.filter(s => !s.used && !s.expired).length;
  const secretsExpired = state.secrets.filter(s => s.expired).length;
  const shape = (['shape_scottish_house', 'shape_venetian_bank', 'shape_dissolution'] as const).find(
    f => state.flags[f],
  );
  const dossier = (state.evidence ?? []).filter(e => e.track === 'parentage').length;

  return (
    <div style={WRAP}>
      <h1 style={TITLE}>{shape ? SHAPE_TITLE[shape] : 'The house of Niccolò'}</h1>
      <p style={SUB}>Gemini · {formatWeekDate(state.week, CAMPAIGN_START)}</p>

      {shape && <p style={PROSE}>{SHAPE_PROSE[shape]}</p>}

      <p style={PROSE}>
        {parentage.provable
          ? 'The question the dyeworks yard opened was answered, in writing, in more than one city at once. Jordan de Ribérac was the boy’s grandfather and always had been, and there is now a file that says so which cannot be quietly lost.'
          : 'The question the dyeworks yard opened was never actually settled. The house knows the answer. It could not, in the end, make anybody else know it — and the man who could have confirmed it had no reason on earth to.'}
      </p>

      <div style={LEDGER}>
        <div style={ROW}>
          <span style={{ color: UI.textSoft }}>What the house is worth</span>
          <span style={{ color: UI.brass }}>{worth.net.toLocaleString()}f</span>
        </div>
        <div style={{ ...ROW, fontSize: '0.76rem', color: UI.textFaint }}>
          <span>assets {worth.assets.toLocaleString()}f, less {worth.liabilities.toLocaleString()}f owed</span>
          <span />
        </div>
        <div style={ROW}>
          <span style={{ color: UI.textSoft }}>Conscience</span>
          <span style={{ color: state.conscience >= 60 ? UI.good : state.conscience >= 30 ? UI.warn : UI.bad }}>
            {Math.round(state.conscience)} of 100
          </span>
        </div>
        <div style={ROW}>
          <span style={{ color: UI.textSoft }}>People kept</span>
          <span style={{ color: UI.brass }}>
            {active.length} of {active.length + departed.length}
          </span>
        </div>
        <div style={ROW}>
          <span style={{ color: UI.textSoft }}>Secrets sold</span>
          <span style={{ color: UI.brass }}>{secretsSold}</span>
        </div>
        <div style={ROW}>
          <span style={{ color: UI.textSoft }}>Secrets never sold</span>
          <span style={{ color: UI.brass }}>
            {secretsKept}
            {secretsExpired > 0 && <span style={{ color: UI.textFaint }}> ({secretsExpired} let lapse)</span>}
          </span>
        </div>
        <div style={ROW}>
          <span style={{ color: UI.textSoft }}>The parentage dossier</span>
          <span style={{ color: UI.brass }}>
            {dossier} piece{dossier === 1 ? '' : 's'} · {parentage.confidence}
          </span>
        </div>
        <div style={ROW}>
          <span style={{ color: UI.textSoft }}>Weeks played</span>
          <span style={{ color: UI.brass }}>{state.week}</span>
        </div>
      </div>

      {departed.length > 0 && (
        <p style={NOTE}>
          Lost along the way: {departed.map(c => c.name).join(', ')}. The ledger has never had a column
          for any of them.
        </p>
      )}
      {active.length > 0 && (
        <p style={NOTE}>
          Still with the house at the end: {active.map(c => c.name).join(', ')}
          {state.flags.family_restored ? ', and a boy who asks about ships.' : '.'}
        </p>
      )}

      <p style={{ ...NOTE, color: UI.textSoft, fontStyle: 'normal' }}>
        Begun at Bruges, {formatWeekDate(0, CAMPAIGN_START)}. Ended at{' '}
        {findCity(state.vessels.find(v => v.kind === 'ship')?.location ?? 'bruges')?.name ?? 'Bruges'}.
      </p>

      <button style={BUTTON} onClick={onReturn}>
        Return to campaigns
      </button>
    </div>
  );
}
