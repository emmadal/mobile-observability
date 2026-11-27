/**
 * Overview filters: the time range, the auto-refresh interval and the
 * dimension filters, all carried in the URL so a view can be shared and
 * survives a reload. Pure module, used by the server page and the toolbar.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const QUICK_RANGES = [
  { key: '5m', label: 'Last 5 minutes', ms: 5 * MINUTE },
  { key: '15m', label: 'Last 15 minutes', ms: 15 * MINUTE },
  { key: '30m', label: 'Last 30 minutes', ms: 30 * MINUTE },
  { key: '1h', label: 'Last 1 hour', ms: HOUR },
  { key: '3h', label: 'Last 3 hours', ms: 3 * HOUR },
  { key: '6h', label: 'Last 6 hours', ms: 6 * HOUR },
  { key: '12h', label: 'Last 12 hours', ms: 12 * HOUR },
  { key: '24h', label: 'Last 24 hours', ms: DAY },
  { key: '7d', label: 'Last 7 days', ms: 7 * DAY },
  { key: '30d', label: 'Last 30 days', ms: 30 * DAY },
] as const;

export type QuickRangeKey = (typeof QUICK_RANGES)[number]['key'];
export const DEFAULT_RANGE: QuickRangeKey = '24h';

export const REFRESH_INTERVALS = [
  { key: 'off', label: 'Off', ms: 0 },
  { key: '5m', label: '5 minutes', ms: 5 * MINUTE },
  { key: '15m', label: '15 minutes', ms: 15 * MINUTE },
  { key: '30m', label: '30 minutes', ms: 30 * MINUTE },
  { key: '1h', label: '1 hour', ms: HOUR },
  { key: '3h', label: '3 hours', ms: 3 * HOUR },
  { key: '6h', label: '6 hours', ms: 6 * HOUR },
  { key: '12h', label: '12 hours', ms: 12 * HOUR },
  { key: '24h', label: '24 hours', ms: DAY },
] as const;

export type RefreshKey = (typeof REFRESH_INTERVALS)[number]['key'];
/** Pages refresh every 5 minutes unless the URL says otherwise (`refresh=off`). */
export const DEFAULT_REFRESH: RefreshKey = '5m';

/** A custom range may reach this far back (beyond the longest retention). */
export const MAX_CUSTOM_RANGE_DAYS = 90;

export const PLATFORMS = [
  { key: 'ios', label: 'iOS' },
  { key: 'android', label: 'Android' },
] as const;
export type PlatformKey = (typeof PLATFORMS)[number]['key'];

/** Bucket sizes (seconds). Each divides a day, so buckets align to UTC midnight. */
const BUCKET_LADDER = [
  10,
  30,
  60,
  120,
  300,
  600,
  900,
  1800,
  3600,
  3 * 3600,
  6 * 3600,
  12 * 3600,
  86_400,
] as const;
const MAX_BUCKETS = 60;

/** Smallest bucket that keeps the chart at or under 60 columns. */
export function pickBucketSeconds(spanMs: number): number {
  for (const seconds of BUCKET_LADDER) {
    if (spanMs / (seconds * SECOND) <= MAX_BUCKETS) return seconds;
  }
  return 86_400;
}

export type RangeSelection =
  | { kind: 'quick'; key: QuickRangeKey }
  /** Inclusive UTC calendar days, `YYYY-MM-DD`. */
  | { kind: 'custom'; fromDay: string; toDay: string };

export interface OverviewFilters {
  range: RangeSelection;
  refresh: RefreshKey;
  project: string | null;
  platform: PlatformKey | null;
  environment: string | null;
  version: string | null;
}

export interface ResolvedWindow {
  from: Date;
  to: Date;
  bucketSeconds: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VALUE_LENGTH = 128;

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed && trimmed.length <= MAX_VALUE_LENGTH ? trimmed : undefined;
}

/** `YYYY-MM-DD` to the UTC midnight that starts it, or null when invalid. */
export function parseDay(value: string | undefined): Date | null {
  if (!value || !DAY_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rejects impossible dates such as 2026-02-31 (Date rolls them over).
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isQuickRange(value: string | undefined): value is QuickRangeKey {
  return QUICK_RANGES.some((range) => range.key === value);
}

function isRefresh(value: string | undefined): value is RefreshKey {
  return REFRESH_INTERVALS.some((interval) => interval.key === value);
}

function isPlatform(value: string | undefined): value is PlatformKey {
  return PLATFORMS.some((platform) => platform.key === value);
}

/**
 * Reads the filters from the URL. Anything invalid falls back to its
 * default rather than failing the page: a hand-edited URL still renders.
 */
export function parseOverviewFilters(params: SearchParams, now: Date): OverviewFilters {
  const rangeKey = single(params.range);
  const fromDay = parseDay(single(params.from));
  const toDay = parseDay(single(params.to));
  const today = parseDay(formatDay(now)) as Date;
  const earliest = new Date(today.getTime() - MAX_CUSTOM_RANGE_DAYS * DAY);

  let range: RangeSelection = { kind: 'quick', key: DEFAULT_RANGE };
  if (isQuickRange(rangeKey)) {
    range = { kind: 'quick', key: rangeKey };
  } else if (fromDay && toDay && fromDay <= toDay && toDay <= today) {
    const start = fromDay < earliest ? earliest : fromDay;
    range = { kind: 'custom', fromDay: formatDay(start), toDay: formatDay(toDay) };
  }

  const refresh = single(params.refresh);
  const platform = single(params.platform);
  return {
    range,
    refresh: isRefresh(refresh) ? refresh : DEFAULT_REFRESH,
    project: single(params.project) ?? null,
    platform: isPlatform(platform) ? platform : null,
    environment: single(params.env) ?? null,
    version: single(params.version) ?? null,
  };
}

/** The concrete [from, to) window and bucket size for a range at `now`. */
export function resolveWindow(range: RangeSelection, now: Date): ResolvedWindow {
  if (range.kind === 'quick') {
    const span = QUICK_RANGES.find((quick) => quick.key === range.key)?.ms ?? DAY;
    return {
      from: new Date(now.getTime() - span),
      to: now,
      bucketSeconds: pickBucketSeconds(span),
    };
  }
  const from = parseDay(range.fromDay) as Date;
  const endOfDay = new Date((parseDay(range.toDay) as Date).getTime() + DAY);
  const to = endOfDay > now ? now : endOfDay;
  return { from, to, bucketSeconds: pickBucketSeconds(to.getTime() - from.getTime()) };
}

/** Start of every bucket in [from, to), aligned to the Unix epoch (so to UTC midnight). */
export function bucketStarts(window: ResolvedWindow): Date[] {
  const size = window.bucketSeconds * SECOND;
  const first = Math.floor(window.from.getTime() / size) * size;
  const starts: Date[] = [];
  for (let time = first; time < window.to.getTime(); time += size) starts.push(new Date(time));
  return starts;
}

/** The URL query for a set of filters; defaults are left out to keep links short. */
export function toSearchParams(filters: OverviewFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.range.kind === 'quick') {
    if (filters.range.key !== DEFAULT_RANGE) query.set('range', filters.range.key);
  } else {
    query.set('from', filters.range.fromDay);
    query.set('to', filters.range.toDay);
  }
  if (filters.project) query.set('project', filters.project);
  if (filters.platform) query.set('platform', filters.platform);
  if (filters.environment) query.set('env', filters.environment);
  if (filters.version) query.set('version', filters.version);
  if (filters.refresh !== DEFAULT_REFRESH) query.set('refresh', filters.refresh);
  return query;
}

export function quickRangeLabel(key: QuickRangeKey): string {
  return QUICK_RANGES.find((range) => range.key === key)?.label ?? 'Last 24 hours';
}

const dayLabel = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Last 3 hours", "Nov 24, 2026" or "Nov 1 – 7, 2026". */
export function rangeLabel(range: RangeSelection): string {
  if (range.kind === 'quick') return quickRangeLabel(range.key);
  const from = parseDay(range.fromDay) as Date;
  const to = parseDay(range.toDay) as Date;
  return range.fromDay === range.toDay ? dayLabel.format(from) : dayLabel.formatRange(from, to);
}

export function refreshMs(key: RefreshKey): number {
  return REFRESH_INTERVALS.find((interval) => interval.key === key)?.ms ?? 0;
}

export function hasDimensionFilters(filters: OverviewFilters): boolean {
  return Boolean(filters.project || filters.platform || filters.environment || filters.version);
}
