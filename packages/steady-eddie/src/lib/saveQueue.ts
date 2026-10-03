// GENERATED from shared/portal/client/saveQueue.ts by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
/**
 * Sends a game's saves to the server one at a time, always the latest state.
 *
 * Games save after every move (Niccolò Rising on every real-time tick), far faster than a request
 * completes. Saves now carry a version (see api/_lib/saves.ts), so two saves in flight from the same
 * tab would look like a conflict to the server. This keeps exactly one in flight: anything that
 * arrives meanwhile replaces whatever was waiting, and goes as soon as the current one returns,
 * with the version that one came back with.
 *
 * After a conflict (409: saved from another tab or device) or a missing game (404) it stops saving
 * altogether and reports it. Carrying on would only overwrite newer progress, or write nowhere.
 */
export type SaveOutcome = 'saved' | 'conflict' | 'missing' | 'expired' | 'failed';

export const SAVE_MESSAGES: Record<Exclude<SaveOutcome, 'saved'>, string> = {
  conflict:
    'This game has been saved from another tab or device since you opened it, so this tab has stopped saving. Reload the page to continue from the latest save.',
  missing: 'This game no longer exists on the server, so progress here is not being saved.',
  expired: 'Your sign-in has expired. Sign in again to keep saving.',
  failed: 'Could not reach the server; your latest progress will be saved on the next move.',
};

/** The messages above, so a later successful save can clear one without touching other errors. */
export const SAVE_ERRORS: ReadonlySet<string> = new Set(Object.values(SAVE_MESSAGES));

export interface Saver {
  /** Call after loading or creating a game, with the version the server returned. */
  reset(gameId: string, version: number | undefined): void;
  /** Queue the latest state of a game for saving. */
  save(gameId: string, state: unknown): void;
}

export function createSaver(
  endpoint: string,
  headers: () => HeadersInit,
  onResult: (outcome: SaveOutcome, gameId: string) => void,
): Saver {
  let currentId: string | null = null;
  let version: number | undefined;
  let halted = false;
  let inFlight = false;
  let pending: { id: string; state: unknown } | null = null;

  async function pump(): Promise<void> {
    if (inFlight || !pending || halted) return;
    const job = pending;
    pending = null;
    inFlight = true;
    let outcome: SaveOutcome = 'failed';
    try {
      const res = await fetch(`${endpoint}?id=${encodeURIComponent(job.id)}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ state: job.state, version }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (job.id === currentId && typeof data.version === 'number') version = data.version;
        outcome = 'saved';
      } else if (res.status === 409) outcome = 'conflict';
      else if (res.status === 404) outcome = 'missing';
      else if (res.status === 401) outcome = 'expired';
    } catch {
      outcome = 'failed';
    } finally {
      inFlight = false;
    }
    if (outcome === 'conflict' || outcome === 'missing') {
      halted = true;
      pending = null;
    }
    onResult(outcome, job.id);
    void pump();
  }

  return {
    reset(gameId, v) {
      currentId = gameId;
      version = v;
      halted = false;
      pending = null;
    },
    save(gameId, state) {
      if (gameId !== currentId) {
        // A game that was never loaded through reset(): save it without a version check.
        currentId = gameId;
        version = undefined;
        halted = false;
      }
      if (halted) return;
      pending = { id: gameId, state };
      void pump();
    },
  };
}
