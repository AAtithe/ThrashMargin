export function gr(n: number): string {
  return `${Math.round(n).toLocaleString('en-GB')} gr`;
}

/** "2h 05m", "4m 30s", "12s". Never negative. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function stat(n: number): string {
  return n >= 1000 ? Math.round(n).toLocaleString('en-GB') : n.toFixed(2).replace(/\.00$/, '');
}
