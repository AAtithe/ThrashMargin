// GENERATED from shared/portal/client/motion.ts by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
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
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

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
 * Skip the current playback on any click or key press (registered once; the latest `skip` wins).
 * Only listens while `active` is true.
 */
export function useSkipOnInput(active: boolean, skip: () => void): void {
  const fn = useRef(skip);
  fn.current = skip;
  useEffect(() => {
    if (!active) return;
    const h = () => fn.current();
    // Capture phase, so the press that skips also reaches whatever it was aimed at. On `click`, not
    // `pointerdown`: skipping redraws the screen (settled dice are a different width from tumbling
    // ones), and a skip on pointerdown moved the button out from under the press before it was
    // released, so the click landed beside it and was lost. On click, the press has already
    // reached its target when the skip redraws.
    window.addEventListener('keydown', h, true);
    window.addEventListener('click', h, true);
    return () => {
      window.removeEventListener('keydown', h, true);
      window.removeEventListener('click', h, true);
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

/** Ease-in-out, for things that travel (a ship leaving port and arriving), where ease-out alone
 * makes the start look like a jolt. */
export function easeInOut(t: number): number {
  return t < 0.5 ? (1 - easeOut(1 - 2 * t)) / 2 : 0.5 + easeOut(2 * t - 1) / 2;
}

/*
 * Playback clocks.
 *
 * Every clock here remembers which `key` (or value) its reading belongs to, and on the very render
 * that the key changes it already reports the *start* of the new run. A clock that reset in an
 * effect would still carry the previous run's finished value for one painted frame: a lorry drawn
 * at her destination, then jumping back to set off. Three games found that flicker independently;
 * these are the fixed versions, and the only ones.
 */

/**
 * 0 → 1 over `baseMs` (paced), restarting whenever `key` changes. A `null` key means "nothing to
 * play" and reads 1. With motion off it reads 1 at once. `skip` jumps to 1.
 */
export function useTween(key: string | number | null, baseMs: number): { t: number; playing: boolean; skip: () => void } {
  const pace = usePace();
  const dur = key === null ? 0 : paced(baseMs, pace);
  // Starts at 0 when there is something to play, so even the first render after mount is the
  // start of the run, not one painted frame of its end.
  const [st, setSt] = useState<{ key: typeof key; t: number }>({ key, t: dur > 0 ? 0 : 1 });
  const raf = useRef<number | null>(null);
  // Read when a run starts. Switching between full and quick mid-run keeps the run going; only a
  // switch to off (or a new key) ends or restarts it.
  const durRef = useRef(dur);
  durRef.current = dur;
  const live = dur > 0;
  useEffect(() => {
    const dur = durRef.current;
    if (dur <= 0) {
      setSt({ key, t: 1 });
      return;
    }
    const start = performance.now();
    setSt({ key, t: 0 });
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setSt({ key, t });
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [key, live]);
  const skip = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setSt({ key, t: 1 });
  }, [key]);
  const t = dur <= 0 ? 1 : st.key === key ? st.t : 0;
  return { t, playing: t < 1, skip };
}

/**
 * Tween from the previous `value` to the new one whenever it changes. `from` is what was on screen
 * before the change; the caller draws the live value as the target and interpolates with `t`.
 * Nothing plays on first mount or with motion off. `same` decides what counts as a change (a list
 * rebuilt on every action, where only a change of position should animate). The restart happens
 * during render, so there is no frame of the end state before it begins.
 */
export function useTweenOnChange<T>(
  value: T,
  baseMs: number,
  same: (a: T, b: T) => boolean = Object.is,
): { from: T; t: number; playing: boolean; skip: () => void } {
  const pace = usePace();
  const [seg, setSeg] = useState({ from: value, to: value, id: 0, dur: 0 });
  const [t, setT] = useState(1);
  if (!same(seg.to, value)) {
    const dur = paced(baseMs, pace);
    setSeg({ from: seg.to, to: value, id: seg.id + 1, dur });
    setT(dur > 0 ? 0 : 1);
  }
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (seg.id === 0 || seg.dur <= 0) return;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / seg.dur);
      setT(p);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [seg.id, seg.dur]);
  const skip = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setT(1);
  }, []);
  // Motion switched off mid-play: finish now rather than let the frame loop run on.
  const playing = t < 1 && pace !== 'off';
  return { from: seg.from, t: playing ? t : 1, playing, skip };
}

/**
 * Step through frames, each held for its own duration (`baseMs[i]`, paced): an AI turn replayed
 * action by action, a faction's captures one at a time. `index` is the frame on screen, 0 … count-1
 * while playing and `count` once finished (show the real state). Restarts when `key` changes; the
 * durations are read at that moment. With motion off, or a `null` key, it is finished at once.
 */
export function useSteps(key: string | number | null, baseMs: number[]): { index: number; playing: boolean; skip: () => void } {
  const pace = usePace();
  const count = baseMs.length;
  const factor = key === null ? 0 : paced(1000, pace) / 1000;
  const live = factor > 0 && count > 0;
  // Starts on frame 0 when there is something to play, so the first render after mount is not one
  // painted frame of the finished state.
  const [st, setSt] = useState<{ key: typeof key; index: number }>({ key, index: live ? 0 : count });
  const timer = useRef<number | null>(null);
  const durations = useRef(baseMs);
  durations.current = baseMs;
  // Read at each step, so switching between full and quick changes the remaining holds without
  // restarting the replay. Only a switch to off (or a new key) ends or restarts it.
  const factorRef = useRef(factor);
  factorRef.current = factor;
  useEffect(() => {
    if (!live) {
      setSt({ key, index: count });
      return;
    }
    let i = 0;
    setSt({ key, index: 0 });
    const hold = (n: number) => Math.max(16, Math.round((durations.current[n] ?? 0) * factorRef.current));
    const tick = () => {
      i += 1;
      setSt({ key, index: i });
      if (i < count) timer.current = window.setTimeout(tick, hold(i));
    };
    timer.current = window.setTimeout(tick, hold(0));
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [key, count, live]);
  const skip = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setSt({ key, index: count });
  }, [key, count]);
  const index = !live ? count : st.key === key ? st.index : 0;
  return { index, playing: index < count, skip };
}

/**
 * Reveal `count` freshly arrived items one after another when `key` changes, rather than all at
 * once. Returns props for item `i`: hidden items keep their space (so the panel does not jump as
 * they land) and each rises in as it is revealed. Outside a playback it returns nothing, so a list
 * that is not animating, and every list with motion off, renders exactly as before.
 */
export function useStagger(key: string | number | null, count: number, stepMs = 240): (i: number) => { className?: string; style?: CSSProperties } {
  const { t, playing } = useTween(key, Math.max(1, count) * stepMs);
  return (i: number) => {
    if (!playing || count <= 0) return {};
    return t * count > i ? { className: 'tm-anim-rise' } : { style: { visibility: 'hidden' } };
  };
}

/** Restart a one-shot animation class (`tm-anim-pulse`, `tm-anim-shake`) on an element without
 * remounting it, which would drop keyboard focus and reset its state. */
export function replayClass(el: HTMLElement | null, cls: string): void {
  if (!el || currentPace() === 'off') return;
  el.classList.remove(cls);
  void el.offsetWidth; // force a reflow so the browser sees the class as new
  el.classList.add(cls);
}

/*
 * Floating amounts: the small "+£120" or "−5" that rises off a figure when it changes.
 */

export interface FloatItem {
  id: number;
  text: string;
  /** A theme token, e.g. `UI.good`. Never a hex literal. */
  colour: string;
}

/**
 * A short-lived list of floating amounts. `push` adds one; each removes itself after its animation.
 * Removal is on a timer, not `animationend`, which never fires if motion is switched off mid-flight.
 * Nothing is pushed with motion off.
 */
export function useFloats(lifeMs = 1100, max = 6): { items: FloatItem[]; push: (text: string, colour: string) => void } {
  const [items, setItems] = useState<FloatItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
  const push = useCallback(
    (text: string, colour: string) => {
      const ms = paced(lifeMs);
      if (ms <= 0) return;
      const id = ++seq.current;
      setItems(prev => [...prev, { id, text, colour }].slice(-max));
      timers.current.push(window.setTimeout(() => setItems(prev => prev.filter(f => f.id !== id)), ms + 60));
    },
    [lifeMs, max],
  );
  return { items, push };
}

/**
 * One floating amount. Absolutely positioned: put it inside a `position: relative` box and place it
 * with `style`. Styling beyond position and colour is the caller's; `className` adds a game's own
 * hook for CSS and tests alongside `tm-anim-float`.
 */
export function FloatText({ text, colour, style, className }: { text: string; colour: string; style?: CSSProperties; className?: string }): ReactElement {
  return createElement(
    'span',
    {
      className: className ? `tm-anim-float ${className}` : 'tm-anim-float',
      'aria-hidden': true,
      style: { position: 'absolute', whiteSpace: 'nowrap', fontSize: '0.75rem', fontWeight: 600, color: colour, pointerEvents: 'none', ...style },
    },
    text,
  );
}

/** A signed amount for a float: "+120" / "−52" (a true minus sign), with an optional unit either side. */
export function signed(amount: number, format: (n: number) => string = String): string {
  return (amount >= 0 ? '+' : '−') + format(Math.abs(amount));
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
