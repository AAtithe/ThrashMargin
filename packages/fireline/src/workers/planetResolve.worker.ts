// Plays a planet battle out off the main thread (Simulate; fireline-planet-design.md, section 9.5).
// The work itself is the pure simulateBattle; this file only carries messages. W2.
import { simulateBattle } from '../planet/battle';
import type { BattleSetup } from '../planet/types';

interface Job {
  job: number;
  setup: BattleSetup;
  createdAt: number;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage: (m: unknown) => void };

ctx.onmessage = e => {
  const { job, setup, createdAt } = e.data;
  try {
    ctx.postMessage({ job, report: simulateBattle(setup, createdAt) });
  } catch (err) {
    ctx.postMessage({ job, error: err instanceof Error ? err.message : String(err) });
  }
};
