import 'server-only';

import {
  METRIC_LABELS,
  METRIC_TARGETS_MS,
  NAVIGATION_METRICS,
  type NavigationMetricName,
  STARTUP_METRICS,
  type StartupMetricName,
} from '@mobile-observability/protocol';
import { and, desc, eq, gte, inArray, isNotNull, lt, type SQL, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { metrics, projects, requests, sessions } from '@/db/schema';
import {
  bucketStarts,
  type OverviewFilters,
  type PlatformKey,
  type ResolvedWindow,
} from '@/features/overview/filters';
import type { FilterOptions } from '@/features/overview/service';

export { METRIC_LABELS, METRIC_TARGETS_MS };

export interface MetricStats {
  name: StartupMetricName;
  label: string;
  targetMs: number;
  samples: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

export interface StartupSeriesPoint {
  start: string;
  samples: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

export interface HistogramBucket {
  /** Lower bound, inclusive, in ms. */
  lowerMs: number;
  /** Upper bound, exclusive, in ms. */
  upperMs: number;
  count: number;
}

export interface StartupView {
  stats: MetricStats[];
  selected: StartupMetricName;
  series: StartupSeriesPoint[];
  histogram: HistogramBucket[];
}

export interface ScreenRow {
  routeName: string;
  samples: number;
  coldTtrP90: number | null;
  warmTtrP90: number | null;
  ttiP90: number | null;
}

export interface NetworkRow {
  method: string;
  host: string;
  path: string;
  requests: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
}

/** One individual HTTP request, newest first. */
export interface RecentRequest {
  id: number;
  timestamp: Date;
  method: string;
  host: string;
  path: string;
  statusCode: number;
  durationMs: number;
  /** Transport-level failure, e.g. a timeout; null when the server answered. */
  error: string | null;
  projectName: string;
  appVersion: string;
  platform: 'ios' | 'android';
  sessionId: string | null;
  /** Database id of the session, when the session row exists. */
  sessionRowId: number | null;
}

export type StatusCodeClass = '2xx' | '3xx' | '4xx' | '5xx';

export function statusCodeClass(code: number): StatusCodeClass | null {
  if (code >= 200 && code < 300) return '2xx';
  if (code >= 300 && code < 400) return '3xx';
  if (code >= 400 && code < 500) return '4xx';
  if (code >= 500 && code < 600) return '5xx';
  return null;
}

export interface NetworkView {
  rows: NetworkRow[];
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  p95Ms: number | null;
  p50Ms: number | null;
  /** Requests per status class; keys missing when zero. */
  statuses: Partial<Record<StatusCodeClass, number>>;
  /** Latest individual requests, newest first. */
  recent: RecentRequest[];
}

export const HISTOGRAM_BUCKETS = 10;

export function isStartupMetric(value: string | null | undefined): value is StartupMetricName {
  return STARTUP_METRICS.includes(value as StartupMetricName);
}

const toNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const selectedProjectIds = (options: FilterOptions, filters: OverviewFilters): string[] => {
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  return selected.map((project) => project.id);
};

function metricScope(
  projectIds: string[],
  filters: OverviewFilters,
  window: ResolvedWindow,
  names: readonly string[],
): SQL | undefined {
  if (projectIds.length === 0) return undefined;
  const conditions: (SQL | undefined)[] = [
    inArray(metrics.projectId, projectIds),
    inArray(metrics.name, [...names]),
    gte(metrics.timestamp, window.from),
    lt(metrics.timestamp, window.to),
  ];
  if (filters.platform) conditions.push(eq(metrics.platform, filters.platform as PlatformKey));
  if (filters.environment) conditions.push(eq(metrics.environment, filters.environment));
  if (filters.version) conditions.push(eq(metrics.appVersion, filters.version));
  return and(...conditions);
}

function bucketOf(seconds: number): SQL<Date> {
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error('invalid bucket size');
  return sql<Date>`date_bin(${sql.raw(`'${seconds} seconds'`)}::interval, ${metrics.timestamp}, timestamptz '1970-01-01 00:00:00+00')`;
}

const percentile = (fraction: number) =>
  sql<number | null>`percentile_cont(${fraction}) within group (order by ${metrics.valueMs})`;

/** P50/P90/P99 cards, a time series and a histogram for one startup metric. */
export async function getStartupView(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
  selected: StartupMetricName,
): Promise<StartupView> {
  const projectIds = selectedProjectIds(options, filters);
  const emptyStats: MetricStats[] = STARTUP_METRICS.map((name) => ({
    name,
    label: METRIC_LABELS[name],
    targetMs: METRIC_TARGETS_MS[name],
    samples: 0,
    p50: null,
    p90: null,
    p99: null,
  }));
  if (projectIds.length === 0) {
    return {
      stats: emptyStats,
      selected,
      series: bucketStarts(window).map((start) => ({
        start: start.toISOString(),
        samples: 0,
        p50: null,
        p90: null,
        p99: null,
      })),
      histogram: [],
    };
  }

  const db = getDb();
  const scope = metricScope(projectIds, filters, window, STARTUP_METRICS);
  const selectedScope = and(scope, eq(metrics.name, selected));

  const [statRows, seriesRows, maxRows] = await Promise.all([
    db
      .select({
        name: metrics.name,
        samples: sql<number>`count(*)::int`,
        p50: percentile(0.5),
        p90: percentile(0.9),
        p99: percentile(0.99),
      })
      .from(metrics)
      .where(scope)
      .groupBy(metrics.name),
    db
      .select({
        bucket: bucketOf(window.bucketSeconds),
        samples: sql<number>`count(*)::int`,
        p50: percentile(0.5),
        p90: percentile(0.9),
        p99: percentile(0.99),
      })
      .from(metrics)
      .where(selectedScope)
      .groupBy(sql`1`),
    db
      .select({ maxMs: sql<number | null>`max(${metrics.valueMs})` })
      .from(metrics)
      .where(selectedScope),
  ]);

  const byName = new Map(statRows.map((row) => [row.name, row]));
  const stats: MetricStats[] = STARTUP_METRICS.map((name) => {
    const base = emptyStats.find((metric) => metric.name === name) as MetricStats;
    const row = byName.get(name);
    return {
      ...base,
      samples: Number(row?.samples ?? 0),
      p50: toNumber(row?.p50),
      p90: toNumber(row?.p90),
      p99: toNumber(row?.p99),
    };
  });

  const byBucket = new Map(seriesRows.map((row) => [new Date(row.bucket).getTime(), row]));
  const series = bucketStarts(window).map((start) => {
    const row = byBucket.get(start.getTime());
    return {
      start: start.toISOString(),
      samples: Number(row?.samples ?? 0),
      p50: toNumber(row?.p50),
      p90: toNumber(row?.p90),
      p99: toNumber(row?.p99),
    };
  });

  const knownMax = toNumber(maxRows[0]?.maxMs);
  const target = METRIC_TARGETS_MS[selected];
  const high = Math.max(Math.ceil((knownMax ?? target) + 1), target + 1);
  const width = high / HISTOGRAM_BUCKETS;
  const histogramRows =
    knownMax === null
      ? []
      : await db
          .select({
            bucket: sql<number>`width_bucket(${metrics.valueMs}, 0, ${high}, ${HISTOGRAM_BUCKETS})::int`,
            total: sql<number>`count(*)::int`,
          })
          .from(metrics)
          .where(selectedScope)
          .groupBy(sql`1`)
          .orderBy(sql`1`);
  const countByBucket = new Map(
    histogramRows.map((row) => [Number(row.bucket), Number(row.total)]),
  );
  const histogram = Array.from({ length: HISTOGRAM_BUCKETS }, (_, index) => {
    const bucket = index + 1;
    return {
      lowerMs: Math.round((bucket - 1) * width),
      upperMs: Math.round(bucket * width),
      count: countByBucket.get(bucket) ?? 0,
    };
  });

  return { stats, selected, series, histogram };
}

/** Navigation routes, slowest P90 cold TTR first. */
export async function getScreens(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
): Promise<ScreenRow[]> {
  const projectIds = selectedProjectIds(options, filters);
  if (projectIds.length === 0) return [];
  const scope = metricScope(projectIds, filters, window, NAVIGATION_METRICS);

  const rows = await getDb()
    .select({
      routeName: metrics.routeName,
      name: metrics.name,
      samples: sql<number>`count(*)::int`,
      p90: percentile(0.9),
    })
    .from(metrics)
    .where(and(scope, isNotNull(metrics.routeName)))
    .groupBy(metrics.routeName, metrics.name);

  const byRoute = new Map<string, ScreenRow>();
  for (const row of rows) {
    const routeName = row.routeName;
    if (!routeName) continue;
    const current = byRoute.get(routeName) ?? {
      routeName,
      samples: 0,
      coldTtrP90: null,
      warmTtrP90: null,
      ttiP90: null,
    };
    current.samples += Number(row.samples);
    const p90 = toNumber(row.p90);
    switch (row.name as NavigationMetricName) {
      case 'navigation.cold_ttr':
        current.coldTtrP90 = p90;
        break;
      case 'navigation.warm_ttr':
        current.warmTtrP90 = p90;
        break;
      case 'navigation.tti':
        current.ttiP90 = p90;
        break;
    }
    byRoute.set(routeName, current);
  }

  return [...byRoute.values()].sort((a, b) => {
    const left = a.coldTtrP90 ?? a.warmTtrP90 ?? a.ttiP90 ?? 0;
    const right = b.coldTtrP90 ?? b.warmTtrP90 ?? b.ttiP90 ?? 0;
    return right - left || b.samples - a.samples;
  });
}

/** Network endpoints by P90 duration, slowest first. */
export async function getNetwork(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
): Promise<NetworkView> {
  const projectIds = selectedProjectIds(options, filters);
  const empty: NetworkView = {
    rows: [],
    totalRequests: 0,
    errorCount: 0,
    errorRate: 0,
    p95Ms: null,
    p50Ms: null,
    statuses: {},
    recent: [],
  };
  if (projectIds.length === 0) return empty;

  const conditions: (SQL | undefined)[] = [
    inArray(requests.projectId, projectIds),
    gte(requests.timestamp, window.from),
    lt(requests.timestamp, window.to),
  ];
  if (filters.platform) conditions.push(eq(requests.platform, filters.platform as PlatformKey));
  if (filters.environment) conditions.push(eq(requests.environment, filters.environment));
  if (filters.version) conditions.push(eq(requests.appVersion, filters.version));
  const scope = and(...conditions);

  const durationPercentile = (fraction: number) =>
    sql<number | null>`percentile_cont(${fraction}) within group (order by ${requests.durationMs})`;
  const isError = sql`(${requests.statusCode} >= 400 or ${requests.error} is not null)`;

  const [rows, totals, overall, statusRows, recentRows] = await Promise.all([
    getDb()
      .select({
        method: requests.method,
        host: requests.host,
        path: requests.path,
        requests: sql<number>`count(*)::int`,
        errorCount: sql<number>`(count(*) filter (where ${isError}))::int`,
        p50: durationPercentile(0.5),
        p90: durationPercentile(0.9),
        p95: durationPercentile(0.95),
      })
      .from(requests)
      .where(scope)
      .groupBy(requests.method, requests.host, requests.path)
      .orderBy(desc(sql`percentile_cont(0.9) within group (order by ${requests.durationMs})`))
      .limit(100),
    getDb()
      .select({
        total: sql<number>`count(*)::int`,
        errors: sql<number>`(count(*) filter (where ${isError}))::int`,
      })
      .from(requests)
      .where(scope),
    getDb()
      .select({
        p95: durationPercentile(0.95),
        p50: durationPercentile(0.5),
      })
      .from(requests)
      .where(scope),
    getDb()
      .select({ statusCode: requests.statusCode, total: sql<number>`count(*)::int` })
      .from(requests)
      .where(scope)
      .groupBy(requests.statusCode),
    getDb()
      .select({
        id: requests.id,
        timestamp: requests.timestamp,
        method: requests.method,
        host: requests.host,
        path: requests.path,
        statusCode: requests.statusCode,
        durationMs: requests.durationMs,
        error: requests.error,
        projectName: projects.name,
        appVersion: requests.appVersion,
        platform: requests.platform,
        sessionId: requests.sessionId,
        sessionRowId: sessions.id,
      })
      .from(requests)
      .innerJoin(projects, eq(projects.id, requests.projectId))
      .leftJoin(
        sessions,
        and(eq(sessions.projectId, requests.projectId), eq(sessions.sessionId, requests.sessionId)),
      )
      .where(scope)
      .orderBy(desc(requests.timestamp), desc(requests.id))
      .limit(20),
  ]);

  const totalRequests = Number(totals[0]?.total ?? 0);
  const errorCount = Number(totals[0]?.errors ?? 0);
  const statuses: Partial<Record<StatusCodeClass, number>> = {};
  for (const row of statusRows) {
    const key = statusCodeClass(Number(row.statusCode));
    if (key) statuses[key] = (statuses[key] ?? 0) + Number(row.total);
  }
  return {
    rows: rows.map((row) => ({
      method: row.method,
      host: row.host,
      path: row.path,
      requests: Number(row.requests),
      errorCount: Number(row.errorCount),
      errorRate: Number(row.requests) > 0 ? Number(row.errorCount) / Number(row.requests) : 0,
      p50Ms: toNumber(row.p50),
      p90Ms: toNumber(row.p90),
      p95Ms: toNumber(row.p95),
    })),
    totalRequests,
    errorCount,
    errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
    p95Ms: toNumber(overall[0]?.p95),
    p50Ms: toNumber(overall[0]?.p50),
    statuses,
    recent: recentRows.map((row) => ({ ...row, timestamp: new Date(row.timestamp) })),
  };
}
