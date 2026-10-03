import { useCallback, useEffect, useRef, useState } from 'react';
import { migrateState, processAction } from 'shared/sim';
import type { GameAction, GameConfig, GameState } from 'shared/sim';
import { API, SESSION_EXPIRED, authHeaders } from '../lib/api';
import { getToken } from '../lib/token';
import { newSeed, type GameHook, type SaveMeta, type SaveStatus } from './types';
import { SAVE_MESSAGES } from '../lib/saveQueue';

const SAVE_DELAY_MS = 700;

/**
 * Cloud persistence for signed-in players, on the same `games` table the other three games use
 * (discriminated by `game = 'thrash_margin'`, see api/game/index.ts), reached at
 * /api/play/thrash-margin through the shared api/play/[kind].ts. The client stays
 * authoritative, as in every game on the portal; this hook mirrors state to the server.
 *
 * The prototype only saved on End Turn, so a reload mid-turn silently threw away every action
 * taken that turn. Now every change is saved, debounced, and End Turn saves at once.
 */
export function useGameCloud(): GameHook {
  const [state, setState] = useState<GameState | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const ref = useRef<GameState | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<GameState | null>(null);
  // The version the server holds for the open game (api/_lib/saves.ts). Each save sends it, so a
  // save from a tab that has fallen behind another tab or device is refused (409) rather than
  // overwriting newer progress. After a refusal, or if the game has been deleted (404), this tab
  // stops saving and says why.
  const version = useRef<number | undefined>(undefined);
  const halted = useRef(false);

  const fetchSaves = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/play/thrash-margin`, { headers: authHeaders() });
      if (res.status === 401) { setError(SESSION_EXPIRED); return; }
      if (!res.ok) return;
      const data = await res.json();
      setSaves(data.saves ?? []);
    } catch {
      /* non-fatal: the lobby shows what it has */
    }
  }, []);

  // useGameHybrid mounts this hook for signed-out sessions too; an unauthenticated list only 401s.
  useEffect(() => { if (getToken()) void fetchSaves(); }, [fetchSaves]);

  // One PUT at a time, always carrying the newest state. Two in flight could land out of order and
  // leave the server holding the older one.
  const inFlight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async (closing = false): Promise<void> => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current && !closing) {
      await inFlight.current;
      // Another flush may have started while this one waited.
      if ((inFlight.current as Promise<void> | null) !== null) return flush(closing);
    }
    const s = pending.current;
    if (!s) return;
    pending.current = null;
    setSaveStatus('saving');
    const body = JSON.stringify({ state: s, version: version.current });
    const run = (async () => {
      try {
        const res = await fetch(`${API}/api/play/thrash-margin?id=${encodeURIComponent(s.id)}`, {
          method: 'PUT',
          headers: authHeaders(),
          body,
          // Browsers refuse keepalive bodies over 64 KB; a long game's state can pass that.
          keepalive: closing && body.length < 60_000,
        });
        if (res.status === 401) { setError(SESSION_EXPIRED); setSaveStatus('error'); }
        else if (res.status === 409 || res.status === 404) {
          halted.current = true;
          pending.current = null;
          setError(res.status === 409 ? SAVE_MESSAGES.conflict : SAVE_MESSAGES.missing);
          setSaveStatus('error');
        }
        else if (!res.ok) throw new Error(String(res.status));
        else {
          const data = await res.json().catch(() => ({}));
          if (typeof data.version === 'number' && ref.current?.id === s.id) version.current = data.version;
          setSaveStatus(pending.current ? 'saving' : 'saved');
        }
      } catch {
        setSaveStatus('error');
        // Keep it queued so the next change or End Turn retries, unless something newer is waiting.
        if (!pending.current && !halted.current) pending.current = s;
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (pending.current && !timer.current && !closing) void flush();
  }, []);

  const queueSave = useCallback((s: GameState, now: boolean) => {
    if (halted.current) return;
    pending.current = s;
    setSaveStatus('saving');
    if (timer.current) window.clearTimeout(timer.current);
    if (now) { void flush(); return; }
    timer.current = window.setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [flush]);

  // Do not lose the last few actions to a closed tab.
  useEffect(() => {
    const onHide = () => { if (pending.current) void flush(true); };
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); onHide(); };
  }, [flush]);

  const createGame = useCallback(async (config: Partial<GameConfig>, name?: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/play/thrash-margin`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ config, name, seed: newSeed() }),
      });
      if (res.status === 401) { setError(SESSION_EXPIRED); return null; }
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Could not start the campaign.'); return null; }
      const s = migrateState(data.state);
      ref.current = s;
      version.current = typeof data.version === 'number' ? data.version : undefined;
      halted.current = false;
      setState(s);
      setSaveStatus('saved');
      void fetchSaves();
      return data.gameId as string;
    } catch {
      setError('Network error: the campaign was not started.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchSaves]);

  const loadGame = useCallback(async (id: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/play/thrash-margin?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
      if (res.status === 401) { setError(SESSION_EXPIRED); return; }
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Could not load the campaign.'); return; }
      const s = migrateState(data.state);
      ref.current = s;
      version.current = typeof data.version === 'number' ? data.version : undefined;
      halted.current = false;
      setState(s);
      setSaveStatus('saved');
    } catch {
      setError('Network error: the campaign could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  const dispatch = useCallback((action: GameAction) => {
    const prev = ref.current;
    if (!prev) return null;
    const next = processAction(prev, action);
    if (next === prev) return null;
    ref.current = next;
    setState(next);
    queueSave(next, action.type === 'END_TURN' || next.status !== 'active');
    if (action.type === 'END_TURN') void fetchSaves();
    return next;
  }, [queueSave, fetchSaves]);

  const restore = useCallback((s: GameState) => {
    ref.current = s;
    setState(s);
    queueSave(s, false);
  }, [queueSave]);

  const deleteGame = useCallback(async (id: string) => {
    try {
      await fetch(`${API}/api/play/thrash-margin?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      setSaves(prev => prev.filter(s => s.id !== id));
    } catch {
      /* ignore */
    }
  }, []);

  return { state, error, loading, saveStatus, saves, createGame, loadGame, dispatch, restore, deleteGame };
}
