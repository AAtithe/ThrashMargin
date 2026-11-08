// GENERATED from shared/portal/client/colorScheme.ts by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
/**
 * Light or dark, chosen once and shared by every game in the portal.
 *
 * The choice lives in localStorage under `tm_theme`, beside `tm_token` and `tm_user`, so flipping it
 * in one game flips all five and the landing page (one origin). With nothing stored, the operating
 * system's preference decides. The palettes themselves are CSS variables in this package's
 * stylesheet; theme.ts hands out `var(--…)` references, so nothing has to re-render to recolour.
 *
 * Copied into each game by scripts/sync-shared.mjs, like the rest of shared/portal/client.
 * theme-init.js (beside this file) applies the same rule before first paint.
 */
export type Scheme = 'light' | 'dark';

const KEY = 'tm_theme';
const EVENT = 'tm-theme-change';

export function storedScheme(): Scheme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function initialScheme(): Scheme {
  const stored = storedScheme();
  if (stored) return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentScheme(): Scheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyScheme(scheme: Scheme): void {
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
}

export function setScheme(scheme: Scheme): void {
  try {
    localStorage.setItem(KEY, scheme);
  } catch {
    // Private mode or blocked storage: still switch for this page.
  }
  applyScheme(scheme);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: scheme }));
}

/** Follow changes made by another toggle on this page, or by another tab. */
export function onSchemeChange(fn: (scheme: Scheme) => void): () => void {
  const local = (e: Event) => fn((e as CustomEvent<Scheme>).detail);
  const other = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    const s = initialScheme();
    applyScheme(s);
    fn(s);
  };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener('storage', other);
  };
}
