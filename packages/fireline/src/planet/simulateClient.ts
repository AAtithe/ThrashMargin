// Simulate in the browser (fireline-planet-design.md, section 13). W2.
//
// Browser only and not pure: it starts a Web Worker. Never imported by the pure files of
// src/planet/ or by the API. The worker runs the pure simulateBattle, so the report is the same
// as a direct call; where workers are unavailable the battle is simulated here instead, after
// yielding once so the busy label can paint.
import { simulateBattle } from './battle';
import type { BattleReport, BattleSetup } from './types';

let worker: Worker | null = null;
let nextJob = 1;
const waiting = new Map<number, { resolve: (r: BattleReport) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('../workers/planetResolve.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ job: number; report?: BattleReport; error?: string }>) => {
    const w = waiting.get(e.data.job);
    if (!w) return;
    waiting.delete(e.data.job);
    if (e.data.report) w.resolve(e.data.report);
    else w.reject(new Error(e.data.error || 'The simulation failed'));
  };
  worker.onerror = () => {
    // A broken worker fails every job it holds; the next call starts a fresh one.
    for (const w of waiting.values()) w.reject(new Error('The simulation failed'));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

const onMainThread = (setup: BattleSetup, createdAt: number): Promise<BattleReport> =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(simulateBattle(setup, createdAt));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 0);
  });

/** The battle played out by the computer on every side, off the main thread where possible. */
export function simulateInWorker(setup: BattleSetup, createdAt: number): Promise<BattleReport> {
  const w = getWorker();
  if (!w) return onMainThread(setup, createdAt);
  const job = nextJob++;
  return new Promise<BattleReport>((resolve, reject) => {
    waiting.set(job, { resolve, reject });
    w.postMessage({ job, setup, createdAt });
  });
}
