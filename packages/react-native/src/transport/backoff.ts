const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60_000;

/** Exponential backoff with full jitter, bounded to [1 s, 5 min] (AC-9). */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** Math.max(0, attempt));
  return Math.max(MIN_DELAY_MS, Math.round(ceiling * (0.5 + random() * 0.5)));
}

/** Parses `Retry-After` (seconds or HTTP date) into a delay in ms, capped at 5 min. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(MAX_DELAY_MS, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(MAX_DELAY_MS, Math.max(0, date - now));
}
