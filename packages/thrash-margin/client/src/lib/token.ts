const KEY = 'tm_token';
const USER_KEY = 'tm_user';

export interface StoredUser {
  userId: string;
  username: string;
}

export const getToken = (): string | null => localStorage.getItem(KEY);
export const setToken = (t: string) => localStorage.setItem(KEY, t);
export const clearToken = () => { localStorage.removeItem(KEY); localStorage.removeItem(USER_KEY); };

export const getStoredUser = (): StoredUser | null => {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};
export const setStoredUser = (u: StoredUser) => localStorage.setItem(USER_KEY, JSON.stringify(u));
