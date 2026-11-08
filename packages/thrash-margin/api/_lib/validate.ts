// Deliberately loose: one @, something either side, a dot in the domain, no spaces. Enough to catch
// a typo or a username in the email box; the only real proof of an address is mail arriving there.
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * The shortest password accepted when one is set, at registration or on the Profile page. Raised from
 * 6 after the November 2026 security review. Existing shorter passwords still sign in.
 */
export const MIN_PASSWORD = 8;
