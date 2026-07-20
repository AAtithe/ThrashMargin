import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Temporary diagnostic endpoint: imports each dependency of the real Niccolo API routes
 * individually via dynamic import (which rejects on a module-evaluation-time throw, unlike a
 * top-level import that would crash the whole function before the handler even runs) so a
 * FUNCTION_INVOCATION_FAILED can be isolated to a specific module. Delete once the real routes
 * are confirmed working.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const results: Record<string, string> = {};

  async function probe(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      results[name] = 'ok';
    } catch (e) {
      results[name] = e instanceof Error ? (e.stack ?? e.message) : String(e);
    }
  }

  await probe('uuid', () => import('uuid'));
  await probe('vercel_node_types_only', async () => {});
  await probe('lib_cors', () => import('../../thrash-margin/api/_lib/cors'));
  await probe('lib_auth', () => import('../../thrash-margin/api/_lib/auth'));
  await probe('lib_db', () => import('../../thrash-margin/api/_lib/db'));
  await probe('repo_engine', () => import('@repo/engine'));
  await probe('sim_content', () => import('../src/sim/content'));
  await probe('sim_state_and_create', async () => {
    const mod = await import('../src/sim/state');
    const s = mod.createInitialState('diag-test');
    if (s.week !== 0) throw new Error(`unexpected week ${s.week}`);
  });

  return res.status(200).json(results);
}
