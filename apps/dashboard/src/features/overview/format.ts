/** Formatting shared by the server page and the client charts. */

/** "850 ms" below a second, "1.25 s" above. */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

/** Axis ticks: "0", "750ms", "1.5s", "2.25s". */
export function formatAxisDuration(ms: number): string {
  if (ms === 0) return '0';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Number((ms / 1000).toFixed(2))}s`;
}

/** "1 crash", "3 crashes". */
export function plural(count: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('en').format(count)} ${count === 1 ? one : many}`;
}
