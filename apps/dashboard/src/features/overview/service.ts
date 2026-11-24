import 'server-only';

import {
  type AnyColumn,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  type SQL,
  sql,
} from 'drizzle-orm';
import { getDb } from '@/db/client';
import { errorEvents, issues, metrics, projects, sessions } from '@/db/schema';
import {
  bucketStarts,
  type OverviewFilters,
  type PlatformKey,
  type ResolvedWindow,
} from './filters';

/** Cold launch is the headline startup metric (target from the protocol). */
export const COLD_LAUNCH_METRIC = 'app_startup.cold_launch_time';

/** How far back the filter menus look for environments and versions. */
const OPTIONS_LOOKBACK = sql`now() - interval '30 days'`;
const MAX_VERSION_OPTIONS = 30;

export interface ProjectOption {
  id: string;
  name: string;
  sdkEnabled: boolean;
}

export interface FilterOptions {
  projects: ProjectOption[];
  environments: string[];
  versions: string[];
}

export interface TimelineBucket {
  /** ISO start of the bucket (UTC). */
  start: string;
  errors: number;
  crashes: number;
  sessions: number;
  crashedSessions: number;
  /** p75 cold launch in the bucket, ms; null without samples. */
  coldLaunchP75: number | null;
  coldLaunchSamples: number;
}

export interface ProjectHealth {
  id: string;
  name: string;
  sdkEnabled: boolean;
  errors: number;
  sessions: number;
  crashedSessions: number;
  openIssues: number;
}

export interface TopIssue {
  id: string;
  projectName: string;
  type: string;
  message: string;
  culprit: string | null;
  fatal: boolean;
  regressed: boolean;
  status: 'open' | 'resolved' | 'ignored';
  /** Events inside the selected window and filters. */
  events: number;
  lastSeen: Date;
}

export interface Overview {
  from: Date;
  to: Date;
  bucketSeconds: number;
  timeline: TimelineBucket[];
  errors: number;
  crashes: number;
  sessions: number;
  crashedSessions: number;
  /** Open issues of the selected projects; not bound to the window. */
  openIssues: number;
  /** Share of sessions without a crash, 0..1; null without sessions. */
  crashFreeRate: number | null;
  /** p75 cold launch over the window, ms; null without samples. */
  coldLaunchP75: number | null;
  projects: ProjectHealth[];
  topIssues: TopIssue[];
}

/** Projects, environments and versions the filter menus offer. */
export async function getFilterOptions(organizationId: string): Promise<FilterOptions> {
  const db = getDb();
  const projectRows = await db
    .select({ id: projects.id, name: projects.name, sdkEnabled: projects.sdkEnabled })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.createdAt));
  if (projectRows.length === 0) return { projects: [], environments: [], versions: [] };
  const ids = projectRows.map((project) => project.id);

  const [environmentRows, versionRows] = await Promise.all([
    db.execute<{ value: string }>(sql`
      select distinct ${sessions.environment} as value from ${sessions}
      where ${inArray(sessions.projectId, ids)} and ${sessions.startedAt} >= ${OPTIONS_LOOKBACK}
      union
      select distinct ${errorEvents.environment} from ${errorEvents}
      where ${inArray(errorEvents.projectId, ids)} and ${errorEvents.timestamp} >= ${OPTIONS_LOOKBACK}
      order by 1
    `),
    db.execute<{ value: string }>(sql`
      select value from (
        select ${sessions.appVersion} as value, max(${sessions.startedAt}) as seen from ${sessions}
        where ${inArray(sessions.projectId, ids)} and ${sessions.startedAt} >= ${OPTIONS_LOOKBACK}
        group by 1
        union all
        select ${errorEvents.appVersion}, max(${errorEvents.timestamp}) from ${errorEvents}
        where ${inArray(errorEvents.projectId, ids)} and ${errorEvents.timestamp} >= ${OPTIONS_LOOKBACK}
        group by 1
      ) as seen_versions
      group by value
      order by max(seen) desc
      limit ${MAX_VERSION_OPTIONS}
    `),
  ]);

  return {
    projects: projectRows,
    environments: environmentRows.rows.map((row) => row.value),
    versions: versionRows.rows.map((row) => row.value),
  };
}

type ScopedTable = typeof errorEvents | typeof sessions | typeof metrics;

/** Dimension filters shared by every telemetry table. */
function dimensions(
  table: ScopedTable,
  projectIds: string[],
  filters: Pick<OverviewFilters, 'platform' | 'environment' | 'version'>,
): SQL[] {
  const conditions: SQL[] = [inArray(table.projectId, projectIds)];
  if (filters.platform) conditions.push(eq(table.platform, filters.platform as PlatformKey));
  if (filters.environment) conditions.push(eq(table.environment, filters.environment));
  if (filters.version) conditions.push(eq(table.appVersion, filters.version));
  return conditions;
}

/**
 * Bucket start for a timestamp column. The size comes from a fixed ladder of
 * integers (filters.ts), so inlining it is safe; it keeps the expression
 * identical wherever it is repeated.
 */
function bucketOf(column: AnyColumn, seconds: number): SQL<Date> {
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error('invalid bucket size');
  return sql<Date>`date_bin(${sql.raw(`'${seconds} seconds'`)}::interval, ${column}, timestamptz '1970-01-01 00:00:00+00')`;
}

const toNumber = (value: unknown): number => Number(value ?? 0);

/** Everything the Overview shows for the selected window and filters. */
export async function getOverview(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
): Promise<Overview> {
  const db = getDb();
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const ids = selected.map((project) => project.id);
  const { from, to, bucketSeconds } = window;

  const empty: Overview = {
    from,
    to,
    bucketSeconds,
    timeline: bucketStarts(window).map((start) => ({
      start: start.toISOString(),
      errors: 0,
      crashes: 0,
      sessions: 0,
      crashedSessions: 0,
      coldLaunchP75: null,
      coldLaunchSamples: 0,
    })),
    errors: 0,
    crashes: 0,
    sessions: 0,
    crashedSessions: 0,
    openIssues: 0,
    crashFreeRate: null,
    coldLaunchP75: null,
    projects: [],
    topIssues: [],
  };
  if (ids.length === 0) return empty;

  const errorScope = and(
    ...dimensions(errorEvents, ids, filters),
    gte(errorEvents.timestamp, from),
    lt(errorEvents.timestamp, to),
  );
  const sessionScope = and(
    ...dimensions(sessions, ids, filters),
    gte(sessions.startedAt, from),
    lt(sessions.startedAt, to),
  );
  const launchScope = and(
    ...dimensions(metrics, ids, filters),
    eq(metrics.name, COLD_LAUNCH_METRIC),
    gte(metrics.timestamp, from),
    lt(metrics.timestamp, to),
  );

  const errorBucket = bucketOf(errorEvents.timestamp, bucketSeconds);
  const sessionBucket = bucketOf(sessions.startedAt, bucketSeconds);
  const launchBucket = bucketOf(metrics.timestamp, bucketSeconds);
  const p75 = sql<number | null>`percentile_cont(0.75) within group (order by ${metrics.valueMs})`;

  const [
    errorSeries,
    sessionSeries,
    launchSeries,
    errorTotals,
    sessionTotals,
    openIssueRows,
    [launchTotal],
    topIssueRows,
  ] = await Promise.all([
    db
      .select({
        bucket: errorBucket,
        errors: sql<number>`count(*)::int`,
        crashes: sql<number>`(count(*) filter (where ${errorEvents.fatal}))::int`,
      })
      .from(errorEvents)
      .where(errorScope)
      .groupBy(sql`1`),
    db
      .select({
        bucket: sessionBucket,
        sessions: sql<number>`count(*)::int`,
        crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
      })
      .from(sessions)
      .where(sessionScope)
      .groupBy(sql`1`),
    db
      .select({ bucket: launchBucket, p75, samples: sql<number>`count(*)::int` })
      .from(metrics)
      .where(launchScope)
      .groupBy(sql`1`),
    db
      .select({
        projectId: errorEvents.projectId,
        errors: count(),
        crashes: sql<number>`(count(*) filter (where ${errorEvents.fatal}))::int`,
      })
      .from(errorEvents)
      .where(errorScope)
      .groupBy(errorEvents.projectId),
    db
      .select({
        projectId: sessions.projectId,
        sessions: count(),
        crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
      })
      .from(sessions)
      .where(sessionScope)
      .groupBy(sessions.projectId),
    db
      .select({ projectId: issues.projectId, open: count() })
      .from(issues)
      .where(and(inArray(issues.projectId, ids), eq(issues.status, 'open')))
      .groupBy(issues.projectId),
    db.select({ p75 }).from(metrics).where(launchScope),
    db
      .select({
        issueId: errorEvents.issueId,
        events: sql<number>`count(*)::int`,
        lastSeen: sql<Date>`max(${errorEvents.timestamp})`,
      })
      .from(errorEvents)
      .where(errorScope)
      .groupBy(errorEvents.issueId)
      .orderBy(desc(sql`2`), desc(sql`3`))
      .limit(8),
  ]);

  const issueIds = topIssueRows.map((row) => row.issueId);
  const issueDetails =
    issueIds.length === 0
      ? []
      : await db
          .select({
            id: issues.id,
            projectName: projects.name,
            type: issues.type,
            message: issues.message,
            culprit: issues.culprit,
            fatal: issues.fatal,
            regressed: issues.regressed,
            status: issues.status,
          })
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .where(inArray(issues.id, issueIds));
  const detailsById = new Map(issueDetails.map((issue) => [issue.id, issue]));
  const topIssues: TopIssue[] = topIssueRows.flatMap((row) => {
    const issue = detailsById.get(row.issueId);
    return issue
      ? [{ ...issue, events: toNumber(row.events), lastSeen: new Date(row.lastSeen) }]
      : [];
  });

  const byBucket = <T extends { bucket: Date }>(rows: T[]) =>
    new Map(rows.map((row) => [new Date(row.bucket).getTime(), row]));
  const errorsAt = byBucket(errorSeries);
  const sessionsAt = byBucket(sessionSeries);
  const launchAt = byBucket(launchSeries);
  const timeline = empty.timeline.map((bucket) => {
    const time = new Date(bucket.start).getTime();
    const error = errorsAt.get(time);
    const session = sessionsAt.get(time);
    const launch = launchAt.get(time);
    return {
      start: bucket.start,
      errors: toNumber(error?.errors),
      crashes: toNumber(error?.crashes),
      sessions: toNumber(session?.sessions),
      crashedSessions: toNumber(session?.crashed),
      coldLaunchP75: launch?.p75 === null || launch?.p75 === undefined ? null : Number(launch.p75),
      coldLaunchSamples: toNumber(launch?.samples),
    };
  });

  const byProject = <T extends { projectId: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.projectId, row]));
  const errorsBy = byProject(errorTotals);
  const sessionsBy = byProject(sessionTotals);
  const openBy = byProject(openIssueRows);
  const health: ProjectHealth[] = selected.map((project) => ({
    ...project,
    errors: toNumber(errorsBy.get(project.id)?.errors),
    sessions: toNumber(sessionsBy.get(project.id)?.sessions),
    crashedSessions: toNumber(sessionsBy.get(project.id)?.crashed),
    openIssues: toNumber(openBy.get(project.id)?.open),
  }));

  const sum = (pick: (row: ProjectHealth) => number) =>
    health.reduce((total, row) => total + pick(row), 0);
  const totalSessions = sum((row) => row.sessions);
  const crashedSessions = sum((row) => row.crashedSessions);
  const launchP75 = launchTotal?.p75;

  return {
    from,
    to,
    bucketSeconds,
    timeline,
    errors: sum((row) => row.errors),
    crashes: errorTotals.reduce((total, row) => total + toNumber(row.crashes), 0),
    sessions: totalSessions,
    crashedSessions,
    openIssues: sum((row) => row.openIssues),
    crashFreeRate: totalSessions > 0 ? 1 - crashedSessions / totalSessions : null,
    coldLaunchP75: launchP75 === null || launchP75 === undefined ? null : Number(launchP75),
    projects: health,
    topIssues,
  };
}
