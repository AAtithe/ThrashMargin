// Admin access is granted purely by username, via an env var — not a DB column or client-side
// toggle. There is no UI entry point that reveals who is or isn't an admin; every admin route
// re-checks this server-side on every request against the username embedded in the caller's
// signed JWT, so the check cannot be bypassed by hiding/showing a nav link.
//
// The match is exact, case included. `users.username` is UNIQUE but case-sensitive, so a
// case-insensitive comparison here let anyone register 'Tom' and inherit the admin rights of
// 'tom'. ADMIN_USERNAMES must therefore spell each name exactly as it is stored.
export function isAdminUsername(username: string): boolean {
  const list = (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return list.includes(username);
}
