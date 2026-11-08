/** Types for engine.js, the plain-DOM coaching engine shared with coaching/founders-ledger.html. */
export interface LedgerOptions {
  /** The saved state, or null for a new ledger. Older shapes are migrated on load. */
  initial?: unknown;
  /** Every change, as a plain JSON copy of the whole state. The host saves it. */
  onChange?: (state: Record<string, unknown>) => void;
  /** True only where Claude can be asked (claude.ai). The portal passes false. */
  ai?: boolean;
}

/** Renders the game into `root` and wires its controls. Returns the function that removes both. */
export function mountLedger(root: HTMLElement, opts?: LedgerOptions): () => void;

/** The engine without a page (scripts/drive.ts). */
export function createLedger(initial: unknown, opts?: Omit<LedgerOptions, 'initial'>): any;
