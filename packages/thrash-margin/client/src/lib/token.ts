const KEY = 'tm_token';
const USER_KEY = 'tm_user';

export interface StoredUser {
  userId: string;
  username: string;
  /** Shows or hides the Admin link. Presentational only; the server re-checks every request. */
  isAdmin?: boolean;
}

/**
 * Session timeouts. Two limits, whichever comes first:
 *   - 12 hours from sign-in. Enforced by the server too (`api/_lib/auth.ts`, jwt maxAge), so it
 *     holds even if this file is bypassed. The token's own `exp` is read here only to sign the
 *     browser out at the same moment the server would start refusing it.
 *   - 60 minutes with no clicks or key presses, across every game on the portal.
 * A session from before these limits existed has no activity stamp and is treated as expired, so
 * everyone signs in once more and picks up the current fields (isAdmin among them).
 *
 * With no token stored there is nothing to expire, so the CLAUDE.md local-UI check (set `tm_user`
 * only, in the console) keeps working.
 */
const ACTIVE_KEY = 'tm_last_active';
const IDLE_LIMIT_MS = 60 * 60 * 1000;

function tokenExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function sessionExpired(): boolean {
  const token = localStorage.getItem(KEY);
  if (!token) return false;
  const exp = tokenExpiryMs(token);
  if (exp === null || exp <= Date.now()) return true;
  const last = Number(localStorage.getItem(ACTIVE_KEY));
  if (!last || Date.now() - last > IDLE_LIMIT_MS) return true;
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
    return !u || typeof u.isAdmin !== 'boolean';
  } catch {
    return true;
  }
}

export const clearToken = () => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ACTIVE_KEY);
};

function checkSession(): void {
  if (sessionExpired()) clearToken();
}

// Activity keeps the session alive; returning to an expired one signs out and reloads, so the
// page re-renders as signed out (the lobbies then show their sign-in panel).
if (typeof window !== 'undefined') {
  let lastWrite = 0;
  const expireNow = () => {
    clearToken();
    window.location.reload();
  };
  const touch = () => {
    if (!localStorage.getItem(KEY)) return;
    if (sessionExpired()) return expireNow();
    const now = Date.now();
    if (now - lastWrite < 30_000) return;
    lastWrite = now;
    localStorage.setItem(ACTIVE_KEY, String(now));
  };
  for (const ev of ['pointerdown', 'keydown', 'visibilitychange']) {
    window.addEventListener(ev, touch, { passive: true });
  }
  window.setInterval(() => {
    if (localStorage.getItem(KEY) && sessionExpired()) expireNow();
  }, 60_000);
}

export const getToken = (): string | null => {
  checkSession();
  return localStorage.getItem(KEY);
};

export const getStoredUser = (): StoredUser | null => {
  checkSession();
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};

/** Called on sign-in. Starts the idle clock with the token, so a fresh session is never stale. */
export const setToken = (t: string) => {
  localStorage.setItem(KEY, t);
  localStorage.setItem(ACTIVE_KEY, String(Date.now()));
};
export const setStoredUser = (u: StoredUser) => localStorage.setItem(USER_KEY, JSON.stringify(u));
