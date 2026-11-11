import { useEffect, useRef, useState } from 'react';
import { API, authHeaders } from '../lib/api';
import { readJson, serverFailure } from '../lib/apiReply';
import { LoadingScreen, SIGN_IN_AGAIN } from '../lib/Loading';
import { createSaver, SAVE_MESSAGES } from '../lib/saveQueue';
import { mountLedger } from '../ledger/engine.js';
import PortalNav from '../components/PortalNav';

const ENDPOINT = `${API}/api/play/founders-ledger`;
/** Typing in the letter or a review saves on every key; this waits for a pause before sending. */
const SAVE_PAUSE_MS = 700;

interface Opened {
  id: string;
  state: unknown;
  version?: number;
  /** Whether the server's coach (Claude) is switched on. */
  ai: boolean;
}

/** Whether the coach is on. Never blocks opening the ledger: any failure means off. */
async function coachStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}?coach=status`, { headers: authHeaders() });
    if (!res.ok) return false;
    return (await readJson(res))?.ai === true;
  } catch {
    return false;
  }
}

/** One coach task. The engine treats null as "use the built-in fallback". */
async function askCoach(task: string, payload: unknown): Promise<unknown> {
  try {
    const res = await fetch(`${ENDPOINT}?coach=${encodeURIComponent(task)}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) return null;
    return (await readJson(res))?.result ?? null;
  } catch {
    return null;
  }
}

class SignInExpired extends Error {}

/**
 * One ledger per account. Opens it, or creates it the first time (the server returns the existing
 * one if a create races another tab), then loads it with its version for the save queue.
 */
async function openLedger(): Promise<Opened> {
  const fail = async (res: Response, action: string): Promise<never> => {
    if (res.status === 401) throw new SignInExpired(SIGN_IN_AGAIN);
    const body = await readJson(res);
    throw new Error(body?.message ?? serverFailure(action, res));
  };

  const ai = coachStatus();
  const list = await fetch(ENDPOINT, { headers: authHeaders() });
  if (!list.ok) return fail(list, 'opening your ledger');
  const saves = ((await readJson(list))?.saves ?? []) as { id: string }[];

  let id = saves[0]?.id;
  if (!id) {
    const made = await fetch(ENDPOINT, { method: 'POST', headers: authHeaders(), body: '{}' });
    if (!made.ok) return fail(made, 'starting your ledger');
    id = (await readJson(made))?.gameId as string;
  }

  const one = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!one.ok) return fail(one, 'opening your ledger');
  const data = await readJson(one);
  return { id, state: data?.state ?? null, version: data?.version, ai: await ai };
}

export default function LedgerScreen() {
  const host = useRef<HTMLDivElement>(null);
  const opened = useRef<Opened | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    openLedger()
      .then(o => {
        if (cancelled) return;
        opened.current = o;
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error && err.message ? err.message : 'Could not reach the server. Check the connection and try again.');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const el = host.current;
    const o = opened.current;
    if (phase !== 'ready' || !el || !o) return;

    const saver = createSaver(ENDPOINT, authHeaders, outcome => setSaveNote(outcome === 'saved' ? null : SAVE_MESSAGES[outcome]));
    saver.reset(o.id, o.version);
    let latest: unknown = null;
    let timer: number | undefined;
    const flush = () => {
      window.clearTimeout(timer);
      if (latest === null) return;
      saver.save(o.id, latest);
      latest = null;
    };
    const unmount = mountLedger(el, {
      initial: o.state,
      ai: o.ai,
      coach: askCoach,
      onChange: state => {
        latest = state;
        window.clearTimeout(timer);
        timer = window.setTimeout(flush, SAVE_PAUSE_MS);
      },
    });
    // Leaving mid-pause still sends the last change.
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      unmount();
    };
  }, [phase]);

  const expired = error === SIGN_IN_AGAIN;
  return (
    <div className="fl-page">
      <PortalNav />
      {phase !== 'ready' && (
        <LoadingScreen
          motif="ledger"
          caption="Opening your ledger"
          fullPage={false}
          error={error}
          actions={
            expired ? (
              <a className="btn" href="/thrash-margin/login?next=/founders-ledger/">Sign in again</a>
            ) : (
              <button type="button" className="btn" onClick={() => setAttempt(a => a + 1)}>Try again</button>
            )
          }
        />
      )}
      {saveNote && (
        <div className="fl-save-note" role="alert" data-testid="save-note">
          {saveNote}
        </div>
      )}
      <div ref={host} className="fl-host" hidden={phase !== 'ready'} />
      <PortalNav variant="footer" />
    </div>
  );
}
