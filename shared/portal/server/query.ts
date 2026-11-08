/**
 * Reads one query-string value from a request, without touching `req.query`.
 *
 * Why not `req.query`: Vercel's Node helpers build it lazily, on first access, by calling Node's
 * `url.parse(req.url, true)`. Node deprecates `url.parse` (DEP0169), so every request that read
 * `req.query` logged a DeprecationWarning in production (first seen 2026-06-28, on the sign-in,
 * game and admin routes). Reading `req.url` with the WHATWG `URL` API gives the same values and
 * logs nothing.
 *
 * It covers the dynamic route segments too (`[kind]`, `[mode]`, `[resource]`): Vercel passes them
 * in the query string of `req.url`, which is the only thing its own `req.query` was ever built
 * from. A repeated key gives its first value, as the handlers' `Array.isArray(...) ? v[0] : v`
 * did before.
 *
 * The base URL only satisfies the parser; `req.url` is a path, and the host is never used.
 */
export function queryParam(req: { url?: string }, name: string): string | undefined {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}
