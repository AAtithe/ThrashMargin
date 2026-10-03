// The browser save queue (shared/portal/client/saveQueue.ts) against a fake, slow server. Run by
// scripts/check.sh: rapid saves must never trip a false conflict, and a real one must stop saving.
import { createSaver, type SaveOutcome } from '../shared/portal/client/saveQueue';
let fails = 0; const ok = (c: unknown, m: string) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
// A fake server holding one game's version, with a slow response.
let serverVersion = 0; let concurrent = 0; let maxConcurrent = 0; const sent: number[] = [];
(globalThis as any).fetch = async (_url: string, init: any) => {
  concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
  const body = JSON.parse(init.body); sent.push(body.state.n);
  await new Promise(r => setTimeout(r, 20));
  concurrent--;
  if (body.version !== undefined && body.version !== serverVersion) return { ok: false, status: 409, json: async () => ({}) };
  serverVersion++;
  return { ok: true, status: 200, json: async () => ({ version: serverVersion }) };
};
(async () => {
  const outcomes: SaveOutcome[] = [];
  const s = createSaver('/api/x', () => ({}), o => outcomes.push(o));
  s.reset('g1', 0);
  for (let n = 1; n <= 50; n++) { s.save('g1', { n }); await new Promise(r => setTimeout(r, 2)); }
  await new Promise(r => setTimeout(r, 400));
  ok(maxConcurrent === 1, 'never more than one save in flight');
  ok(!outcomes.includes('conflict'), 'fifty rapid saves: no false conflict');
  ok(sent[sent.length - 1] === 50, 'the last state sent is the latest one');
  ok(sent.length < 50, `intermediate states coalesced (${sent.length} requests for 50 moves)`);
  // Another tab saves behind our back.
  serverVersion += 1;
  s.save('g1', { n: 51 }); await new Promise(r => setTimeout(r, 60));
  ok(outcomes[outcomes.length - 1] === 'conflict', 'a newer save elsewhere is reported as a conflict');
  const before = sent.length; s.save('g1', { n: 52 }); await new Promise(r => setTimeout(r, 60));
  ok(sent.length === before, 'after a conflict this tab stops saving');
  s.reset('g1', serverVersion); s.save('g1', { n: 53 }); await new Promise(r => setTimeout(r, 60));
  ok(outcomes[outcomes.length - 1] === 'saved', 'after reloading (reset) it saves again');
  console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
