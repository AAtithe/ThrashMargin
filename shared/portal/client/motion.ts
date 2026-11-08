/**
 * Motion: the pace at which the games play their animations, chosen once and shared by every game.
 *
 * Every animation in the portal is presentation only. The simulations stay pure and resolve an
 * action at once; the screen then takes a moment to show what happened (a die tumbling, a ship
 * gliding along its route, an AI turn replayed step by step, money counting up). Nothing here ever
 * delays a save or holds the game state back, and any playback can be skipped with a click or a key.
 *
 * Three paces, stored in localStorage under `tm_motion` beside `tm_theme`:
 *   full   the designed timings
 *   quick  the same animations at roughly 40% of the time
 *   off    no animation: everything snaps straight to the result
 * With nothing stored, the operating system's reduced-motion preference chooses `off`, otherwise
 * `full`. The current pace is mirrored on <html data-motion="…"> so CSS can switch animations off.
 *
 * Copied into each game by scripts/sync-shared.mjs, like the rest of shared/portal/client.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Pace = 'full' | 'quick' | 'off';

const KEY = 'tm_motion';
const EVENT = 'tm-motion-change';
const FACTOR: Record<Pace, number> = { full: 1, quick: 0.4, off: 0 };
export const PACES: Pace[] = ['full', 'quick', 'off'];
export const PACE_LABEL: Record<Pace, string> = { full: 'Motion: full', quick: 'Motion: quick', off: 'Motion: off' };

export function storedPace(): Pace | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'full' || v === 'quick' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

function systemPrefersReduced(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function currentPace(): Pace {
  return storedPace() ?? (systemPrefersReduced() ? 'off' : 'full');
}

function mirror(pace: Pace): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = pace;
}

export function setPace(pace: Pace): void {
  try {
    localStorage.setItem(KEY, pace);
  } catch {
    // Private mode or blocked storage: still switch for this page.
  }
  mirror(pace);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pace }));
}

export function nextPace(pace: Pace): Pace {
  return PACES[(PACES.indexOf(pace) + 1) % PACES.length];
}

/** Follow changes made by another toggle on this page, or by another tab. */
export function onPaceChange(fn: (pace: Pace) => void): () => void {
  const local = (e: Event) => fn((e as CustomEvent<Pace>).detail);
  const other = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    const p = currentPace();
    mirror(p);
    fn(p);
  };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener('storage', other);
  };
}

/** A designed duration scaled to the current pace. 0 means "do not animate, show the result". */
export function paced(baseMs: number, pace: Pace = currentPace()): number {
  return Math.round(baseMs * FACTOR[pace]);
}

/** The current pace, re-rendering when it changes. */
export function usePace(): Pace {
  const [pace, setLocal] = useState<Pace>(currentPace);
  useEffect(() => onPaceChange(setLocal), []);
  return pace;
}

/** Ease-out cubic, the default curve for things settling into place. */
export function easeOut(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/**
 * Drive a 0 → 1 progress value over `durationMs` (already paced by the caller, or use `paced`).
 * Restarts whenever `key` changes. Returns 1 at once when the duration is 0. The returned `skip`
 * jumps straight to 1.
 */
export function useProgress(key: unknown, durationMs: number): { t: number; done: boolean; skip: () => void } {
  const [t, setT] = useState(durationMs > 0 ? 0 : 1);
  const raf = useRef<number | null>(null);
  const skipped = useRef(false);
  useEffect(() => {
    skipped.current = false;
    if (durationMs <= 0) {
      setT(1);
      return;
    }
    setT(0);
    const start = performance.now();
    const step = (now: number) => {
      if (skipped.current) return;
      const p = Math.min(1, (now - start) / durationMs);
      setT(p);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, durationMs]);
  const skip = useCallback(() => {
    skipped.current = true;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setT(1);
  }, []);
  return { t, done: t >= 1, skip };
}

/**
 * A number that counts from its previous value to `target` instead of jumping. Rounds to integers
 * unless `decimals` is given. Snaps at once when motion is off.
 */
export function useCountUp(target: number, baseMs = 600, decimals = 0): number {
  const pace = usePace();
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const dur = paced(baseMs, pace);
    const start = from.current;
    if (dur <= 0 || start === target || !Number.isFinite(start) || !Number.isFinite(target)) {
      from.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    const k = 10 ** decimals;
    const step = (now: number) => {
      const p = easeOut((now - t0) / dur);
      const v = start + (target - start) * p;
      from.current = v;
      setShown(Math.round(v * k) / k);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [target, baseMs, decimals, pace]);
  return shown;
}

/**
 * Step through `count` items one after another, `baseMs` apart (paced). Used to replay a batch of
 * things that happened at once in the simulation (an AI turn, a week's news) as a short sequence.
 * Restarts when `key` changes. `index` is how many items are revealed so far (0 … count); `skip`
 * reveals them all. With motion off, everything is revealed at once.
 *
 * While `playing` is true the caller should keep its normal controls usable, or show a clear
 * "skip" affordance: playback must never trap the player.
 */
export function useSequence(key: unknown, count: number, baseMs = 450): { index: number; playing: boolean; skip: () => void } {
  const pace = usePace();
  const dur = paced(baseMs, pace);
  const [index, setIndex] = useState(dur > 0 ? 0 : count);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (dur <= 0 || count <= 0) {
      setIndex(count);
      return;
    }
    setIndex(0);
    let i = 0;
    const tick = () => {
      i += 1;
      setIndex(i);
      if (i < count) timer.current = window.setTimeout(tick, dur);
    };
    timer.current = window.setTimeout(tick, Math.min(dur, 120));
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, count, dur]);
  const skip = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setIndex(count);
  }, [count]);
  return { index, playing: index < count, skip };
}

/**
 * Skip the current playback on any click or key press (registered once; the latest `skip` wins).
 * Only listens while `active` is true.
 */
export function useSkipOnInput(active: boolean, skip: () => void): void {
  const fn = useRef(skip);
  fn.current = skip;
  useEffect(() => {
    if (!active) return;
    const h = () => fn.current();
    // Capture phase, so the press that skips also reaches whatever it was aimed at.
    window.addEventListener('keydown', h, true);
    window.addEventListener('pointerdown', h, true);
    return () => {
      window.removeEventListener('keydown', h, true);
      window.removeEventListener('pointerdown', h, true);
    };
  }, [active]);
}

/** A promise that resolves after a paced delay, or at once if the signal aborts or motion is off. */
export function pause(baseMs: number, signal?: AbortSignal): Promise<void> {
  const ms = paced(baseMs);
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Shared keyframes and utility classes, injected once as a <style> tag (the CSP allows inline
 * styles, not inline scripts). Keyframe names carry a `tm-motion-` prefix so they can never replace a
 * game's own keyframes (an unprefixed `tm-pulse` once overrode Thrash Margin's). Animation durations read `--tm-motion` (1, 0.4 or 0), so pace
 * changes apply to CSS animations too. Colours are never set here: callers style with tokens.
 *
 *   tm-anim-pop      scale in from 0.85 with a small overshoot
 *   tm-anim-fade     fade in
 *   tm-anim-rise     fade in while rising 6px (toasts, new log lines)
 *   tm-anim-float    rise 18px and fade out (floating "+£120" markers)
 *   tm-anim-pulse    one soft pulse of scale (a value that just changed)
 *   tm-anim-shake    a short horizontal shake (a loss, a rejected action)
 *   tm-anim-tumble   a die tumbling (rotate and bounce), loops while applied
 *   tm-anim-glow     a ring that swells and fades (uses currentColor for the ring)
 */
const STYLE_ID = 'tm-motion-styles';
const CSS = `
:root{--tm-motion:1}
:root[data-motion="quick"]{--tm-motion:.4}
:root[data-motion="off"]{--tm-motion:0}
@keyframes tm-motion-pop{0%{transform:scale(.85);opacity:0}70%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@keyframes tm-motion-fade{from{opacity:0}to{opacity:1}}
@keyframes tm-motion-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes tm-motion-float{0%{opacity:0;transform:translateY(0)}15%{opacity:1}100%{opacity:0;transform:translateY(-18px)}}
@keyframes tm-motion-pulse{0%{transform:scale(1)}40%{transform:scale(1.08)}100%{transform:scale(1)}}
@keyframes tm-motion-shake{0%,100%{transform:none}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@keyframes tm-motion-tumble{0%{transform:rotate(0) translateY(0)}25%{transform:rotate(90deg) translateY(-4px)}50%{transform:rotate(180deg) translateY(0)}75%{transform:rotate(270deg) translateY(-3px)}100%{transform:rotate(360deg) translateY(0)}}
@keyframes tm-motion-glow{0%{box-shadow:0 0 0 0 currentColor;opacity:1}100%{box-shadow:0 0 0 10px transparent;opacity:1}}
.tm-anim-pop{animation:tm-motion-pop calc(320ms * var(--tm-motion)) ease-out both}
.tm-anim-fade{animation:tm-motion-fade calc(300ms * var(--tm-motion)) ease-out both}
.tm-anim-rise{animation:tm-motion-rise calc(320ms * var(--tm-motion)) ease-out both}
.tm-anim-float{animation:tm-motion-float calc(1100ms * var(--tm-motion)) ease-out both;pointer-events:none}
.tm-anim-pulse{animation:tm-motion-pulse calc(420ms * var(--tm-motion)) ease-out}
.tm-anim-shake{animation:tm-motion-shake calc(380ms * var(--tm-motion)) ease-in-out}
.tm-anim-tumble{animation:tm-motion-tumble calc(420ms * var(--tm-motion)) linear infinite}
.tm-anim-glow{animation:tm-motion-glow calc(900ms * var(--tm-motion)) ease-out}
:root[data-motion="off"] [class*="tm-anim-"]{animation:none !important}
:root[data-motion="off"] .tm-anim-float{display:none}
@media (prefers-reduced-motion: reduce){.tm-anim-float{display:none}}
`;

/** Apply the stored pace and inject the shared keyframes. Call once from main.tsx. */
export function initMotion(): void {
  if (typeof document === 'undefined') return;
  mirror(currentPace());
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
