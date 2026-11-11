/**
 * War for the Planet: the war, from the planet map to a fought battle and back
 * (fireline-planet-design.md, section 17). W4.
 *
 * One PlanetSave holds the whole war and the battle in progress. Every order goes through the pure
 * reducer (applyPlanetAction): a refused order returns the very same state, which shows its
 * problem as a toast and saves nothing; any other result is saved at once, whole, through the
 * existing save queue. A fought battle is the skirmish <Battle> on the generated GameState, saved
 * every 15 seconds of play as campaign battles are; its outcome comes back as a BattleReport.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import ArmyTab from '../components/planet/ArmyTab';
import { DebriefCard, EndCard, PendingCard, type Debrief } from '../components/planet/BattleCards';
import CommanderTab from '../components/planet/CommanderTab';
import DiplomacyTab from '../components/planet/DiplomacyTab';
import JournalTab from '../components/planet/JournalTab';
import PlanetTour, { PLANET_TOUR_STEPS, firstUnfinished, readPlanetTour, writePlanetTour, type PlanetTabKey } from '../components/planet/PlanetTour';
import PlanetMapCanvas from '../components/planet/PlanetMapCanvas';
import RegionPanel from '../components/planet/RegionPanel';
import ResearchTab from '../components/planet/ResearchTab';
import TradeTab from '../components/planet/TradeTab';
import { RES_NAME, type PlanetProps } from '../components/planet/common';
import { buildPlanetBattle, planetBattleReport } from '../planet/battle';
import { attackTargets } from '../planet/battleSetup';
import { factionIncome } from '../planet/economy';
import { planetMapOf } from '../planet/map';
import { quickResolve } from '../planet/resolve';
import type { PlanetSave } from '../planet/save';
import { simulateInWorker } from '../planet/simulateClient';
import { armyPath } from '../planet/supply';
import { applyPlanetAction, planetActionProblem, type PlanetAction } from '../planet/turn';
import { RESOURCES, type BattleReport, type FactionId, type RegionId } from '../planet/types';
import { DIFFICULTIES } from '../sim/rules';
import { wonBy } from '../sim/sides';
import type { GameState } from '../sim/types';
import { Battle } from './GameScreen';

type Tab = PlanetTabKey;
const TABS: { key: Tab; label: string }[] = [
  { key: 'map', label: 'Map' },
  { key: 'army', label: 'Army' },
  { key: 'research', label: 'Research' },
  { key: 'commander', label: 'Commander' },
  { key: 'diplomacy', label: 'Diplomacy' },
  { key: 'trade', label: 'Trade' },
  { key: 'journal', label: 'Journal' },
];

export default function PlanetFlow({
  initial,
  save,
  saveError,
  lastSaved,
  cloud,
}: {
  initial: PlanetSave;
  save: (x: PlanetSave) => void;
  saveError: string | null;
  lastSaved: number | null;
  cloud: boolean;
}) {
  const navigate = useNavigate();
  const [ps, setPs] = useState(initial);
  const psRef = useRef(initial);
  // A battle being fought opens straight into it; otherwise the planet.
  const [view, setView] = useState<'planet' | 'battle'>(initial.battle && initial.planet.pending[0]?.fighting ? 'battle' : 'planet');
  // Each opened battle gets its own number; saves from a battle that has since been left are dropped.
  const [session, setSession] = useState(0);
  const sessionRef = useRef(0);
  const [tab, setTab] = useState<Tab>('map');
  const [selected, setSelected] = useState<RegionId | null>(() => initial.planet.factions[0]?.army?.region ?? null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [busy, setBusy] = useState<'simulate' | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const toastTimer = useRef(0);
  const [proposing, setProposing] = useState<FactionId | null>(null);
  // The guided first turn: its progress is this browser's, per save, outside the war itself. Where
  // it resumes is decided here, by walking its steps in order to the first one not finished.
  const [tour, setTour] = useState<{ startAt: number; n: number } | null>(() => {
    const p = readPlanetTour(initial.id);
    return p?.open ? { startAt: firstUnfinished(p, PLANET_TOUR_STEPS), n: 0 } : null;
  });
  const tourStepDone = useCallback(
    (i: number) => {
      const p = readPlanetTour(initial.id) ?? { open: true, done: [] };
      const next = { open: true, done: p.done.includes(i) ? p.done : [...p.done, i] };
      writePlanetTour(initial.id, next);
      // A fought battle unmounts the run; it comes back at the first step still to do.
      setTour(t => (t ? { ...t, startAt: firstUnfinished(next, PLANET_TOUR_STEPS) } : t));
    },
    [initial.id],
  );
  const closeTour = useCallback(() => {
    const p = readPlanetTour(initial.id);
    writePlanetTour(initial.id, { open: false, done: p?.done ?? [] });
    setTour(null);
  }, [initial.id]);
  const openTour = () => {
    writePlanetTour(initial.id, { open: true, done: [] });
    setTour(t => ({ startAt: 0, n: (t?.n ?? 0) + 1 }));
  };

  const s = ps.planet;
  const map = planetMapOf(s);

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(t => ({ text, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  // The lobby may have been scrolled far down: the war opens at the top.
  useEffect(() => {
    if (view === 'planet') window.scrollTo(0, 0);
  }, [view]);

  const commit = useCallback(
    (next: PlanetSave) => {
      psRef.current = next;
      setPs(next);
      save(next);
    },
    [save],
  );

  /** Every order: refused ones toast their problem and save nothing. */
  const act = useCallback(
    (a: PlanetAction): boolean => {
      const cur = psRef.current;
      const before = cur.planet;
      const pb = before.pending[0];
      const next = applyPlanetAction(before, a);
      if (next === before) {
        showToast(planetActionProblem(before, a) ?? 'That order cannot be given now.');
        return false;
      }
      const fighting = !!next.pending[0]?.fighting;
      commit({ ...cur, planet: next, battle: fighting ? cur.battle : null });
      if (pb && (a.type === 'autoResolve' || a.type === 'battleResult')) {
        const report: BattleReport = a.type === 'battleResult' ? a.report : quickResolve(pb.setup);
        setDebrief({ before, after: next, pb, report });
      }
      return true;
    },
    [commit, showToast],
  );

  const saveBattle = useMemo(() => {
    const mine = session;
    return (b: GameState) => {
      if (sessionRef.current !== mine || !psRef.current.battle) return;
      const next = { ...psRef.current, battle: b };
      psRef.current = next;
      save(next);
    };
  }, [session, save]);

  const openBattle = () => {
    sessionRef.current += 1;
    setSession(sessionRef.current);
    setView('battle');
  };

  const fight = () => {
    const cur = psRef.current;
    const next = applyPlanetAction(cur.planet, { type: 'fight' });
    if (next === cur.planet) {
      showToast(planetActionProblem(cur.planet, { type: 'fight' }) ?? 'That battle cannot be fought now.');
      return;
    }
    // The clock is read here, in the screen, and handed to the pure generator.
    const battle = buildPlanetBattle(next.pending[0].setup, { id: cur.id, name: cur.name, createdAt: Date.now() });
    commit({ ...cur, planet: next, battle });
    openBattle();
  };

  const leaveBattle = () => {
    // The battle stays in the save; the pending card offers to return to it.
    sessionRef.current += 1;
    setSession(sessionRef.current);
    setPs(psRef.current);
    setView('planet');
  };

  /** Folds a fought (or retreated) battle back into the war. */
  const finishBattle = (g: GameState, retreat = false) => {
    const cur = psRef.current;
    const pb = cur.planet.pending[0];
    if (!pb) return;
    const report = planetBattleReport(pb.setup, g, { retreat });
    if (!report) return;
    sessionRef.current += 1;
    setSession(sessionRef.current);
    act({ type: 'battleResult', report });
    setView('planet');
  };

  const simulate = () => {
    const pb = psRef.current.planet.pending[0];
    if (!pb || busy) return;
    setBusy('simulate');
    simulateInWorker(pb.setup, Date.now())
      .then(report => {
        if (psRef.current.planet.pending[0]?.id === pb.id) act({ type: 'battleResult', report });
      })
      .catch(() => showToast('The simulation failed. Try Auto-resolve instead.'))
      .finally(() => setBusy(null));
  };

  const targets = useMemo(() => (s.result || s.pending.length ? [] : attackTargets(s, 0)), [s]);
  const moves = useMemo(() => {
    const army = s.factions[0].army;
    if (!army || s.result || s.pending.length || army.moved >= s.options.armyMove) return [];
    return map.regions.map(g => g.id).filter(r => r !== army.region && armyPath(s, 0, r) !== null);
  }, [s, map]);

  // ---- The battle --------------------------------------------------------------------------------
  if (view === 'battle' && ps.battle && s.pending[0]?.fighting) {
    return (
      <Battle
        key={session}
        initial={ps.battle}
        save={saveBattle}
        saveError={saveError}
        lastSaved={lastSaved}
        cloud={cloud}
        campaign={{
          leaveLabel: 'Planet',
          onLeave: leaveBattle,
          endWhen: 'winner',
          renderEnd: g => <BattleOver g={g} onDone={() => finishBattle(g)} />,
        }}
      />
    );
  }

  // ---- The planet --------------------------------------------------------------------------------
  const props: PlanetProps = { s, map, act };
  const inc = factionIncome(s, 0);
  const endProblem = planetActionProblem(s, { type: 'endTurn' });
  const pb = s.pending[0];

  return (
    <div className="fl-pl-shell" data-testid="planet-screen" data-turn={s.turn}>
      <header className="fl-pl-head">
        <button type="button" className="fl-pl-btn" onClick={() => navigate('/')} data-testid="planet-lobby">
          ← Lobby
        </button>
        <div className="fl-pl-title">
          <strong>
            {map.name}: {ps.name}
          </strong>
          <span className="fl-small" data-testid="planet-turn">
            Turn {s.turn} of {s.options.turnLimit} · {DIFFICULTIES[s.difficulty].label}
          </span>
        </div>
        <div className="fl-pl-stocks" data-testid="planet-stocks">
          {RESOURCES.map(r => (
            <span key={r} className="fl-pl-stock" title={`${RES_NAME[r]}: ${inc.income[r]} in, ${inc.upkeep[r]} upkeep a turn`}>
              <span>{RES_NAME[r]}</span>
              <strong data-testid={`stock-${r}`}>{s.factions[0].stock[r]}</strong>
              <span className="fl-pl-net" data-sign={inc.net[r] > 0 ? 'up' : inc.net[r] < 0 ? 'down' : 'flat'}>
                {inc.net[r] > 0 ? `+${inc.net[r]}` : inc.net[r]}
              </span>
            </span>
          ))}
          <span className="fl-pl-stock" title="Science a turn, for research">
            <span>Science</span>
            <strong>+{inc.income.science}</strong>
          </span>
        </div>
        <div className="fl-pl-endturn">
          <span className="fl-small" style={{ color: saveError ? 'var(--ui-bad)' : undefined }} title={saveError ?? undefined} data-testid="planet-save-status">
            {saveError ? `Not saving: ${saveError}` : lastSaved ? `Saved ${cloud ? 'to your account' : 'in this browser'}` : ''}
          </span>
          <ThemeToggle />
          <button type="button" className="fl-pl-btn" onClick={openTour} title="A guided first turn, from the start" data-testid="planet-tour-button">
            Tour
          </button>
          <button
            type="button"
            className="fl-pl-btn primary"
            disabled={!!endProblem}
            title={endProblem ?? 'Every other faction moves, then production, then the next turn.'}
            onClick={() => act({ type: 'endTurn' })}
            id="pl-end-turn"
            data-testid="end-turn"
          >
            End turn
          </button>
          {endProblem && !s.result && <span className="fl-small">{endProblem}</span>}
        </div>
      </header>
      <nav className="fl-pl-tabs" role="tablist" aria-label="War screens">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" className="fl-pl-tab" aria-selected={tab === t.key} onClick={() => {
              setTab(t.key);
              setProposing(null);
            }} id={`pl-tab-${t.key}`} data-testid={`tab-${t.key}`}>
            {t.label}
            {t.key === 'diplomacy' && s.offers.length > 0 && <span className="fl-dot-count">{s.offers.length}</span>}
          </button>
        ))}
      </nav>
      <main className="fl-pl-main">
        {s.result && <EndCard s={s} onLobby={() => navigate('/')} />}
        {pb && (
          <PendingCard
            s={s}
            map={map}
            busy={busy}
            onFight={fight}
            onAuto={() => act({ type: 'autoResolve' })}
            onSimulate={simulate}
            onResume={() => (ps.battle ? openBattle() : showToast('The battle could not be found. Retreat or try again.'))}
            onRetreat={() => ps.battle && finishBattle(ps.battle, true)}
          />
        )}
        {tab === 'map' && (
          <div className="fl-pl-mapview">
            <div>
              <PlanetMapCanvas s={s} map={map} selected={selected} targets={targets} moves={moves} onSelect={setSelected} />
              <div className="fl-pl-legend" aria-label="Legend">
                {s.factions.map(f => (
                  <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', opacity: f.alive ? 1 : 0.5 }}>
                    <span className="fl-pl-swatch" style={{ borderColor: `var(--pl-f${f.id})` }}>
                      {f.name.charAt(0)}
                    </span>
                    {f.name}
                    {f.alive ? '' : ' (out)'}
                  </span>
                ))}
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span className="fl-pl-swatch">N</span>Independents
                </span>
                <span>Ringed in red: attack now. Dashed: sea crossings. Hatched: cut off.</span>
              </div>
            </div>
            <RegionPanel {...props} region={selected} onSelect={setSelected} />
          </div>
        )}
        {tab === 'army' && (
          <ArmyTab
            {...props}
            onShowRegion={r => {
              setSelected(r);
              setTab('map');
            }}
          />
        )}
        {tab === 'research' && <ResearchTab {...props} />}
        {tab === 'commander' && <CommanderTab {...props} />}
        {tab === 'diplomacy' && <DiplomacyTab {...props} proposing={proposing} onProposing={setProposing} />}
        {tab === 'trade' && <TradeTab {...props} selected={selected} />}
        {tab === 'journal' && <JournalTab {...props} />}
      </main>
      {toast && (
        <div key={toast.n} className="fl-pl-toast" role="status" data-testid="planet-toast">
          {toast.text}
        </div>
      )}
      {debrief && <DebriefCard d={debrief} map={planetMapOf(debrief.after)} onClose={() => setDebrief(null)} />}
      {tour && (
        <PlanetTour
          key={tour.n}
          view={{ s, map, tab, selected, proposing: tab === 'diplomacy' ? proposing : null, moves, targets }}
          startAt={tour.startAt}
          onStepDone={tourStepDone}
          onClose={closeTour}
          hidden={!!debrief || !!s.result}
        />
      )}
    </div>
  );
}

/** Drawn over the battlefield once it has a winner: the result, then back to the planet. */
function BattleOver({ g, onDone }: { g: GameState; onDone: () => void }) {
  const won = wonBy(g, 0);
  return (
    <div className="fl-scrim fixed">
      <div className="fl-debrief" role="dialog" aria-label="Battle over" data-testid="planet-battle-over" data-result={won ? 'won' : 'lost'}>
        <p className="fl-eyebrow">War for the Planet</p>
        <h2 className="fl-debrief-title" data-won={won ? '1' : '0'}>
          {won ? 'VICTORY' : 'DEFEAT'}
        </h2>
        <p className="fl-small" style={{ margin: 0 }}>
          {g.log[g.log.length - 1]?.text ?? ''} The survivors return to the planet, with their kills.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="fl-camp-btn primary" onClick={onDone} data-testid="back-to-planet">
            Back to the planet
          </button>
        </div>
      </div>
    </div>
  );
}
