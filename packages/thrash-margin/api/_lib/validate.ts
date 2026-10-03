// Deliberately loose: one @, something either side, a dot in the domain, no spaces. Enough to catch
// a typo or a username in the email box; the only real proof of an address is mail arriving there.
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
