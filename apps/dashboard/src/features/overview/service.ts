import 'server-only';

import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { errorEvents, issues, metrics, projects, sessions } from '@/db/schema';

/** Cold launch is the headline startup metric (target from the protocol). */
export const COLD_LAUNCH_METRIC = 'app_startup.cold_launch_time';

export interface HourBucket {
  hour: Date;
  errors: number;
  crashes: number;
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
  eventCount: number;
  lastSeen: Date;
}

export interface Overview {
  /** Database clock at query time, for relative times. */
  now: Date;
  hours: HourBucket[];
  errors: number;
  crashes: number;
  sessions: number;
  crashedSessions: number;
  openIssues: number;
  /** Share of sessions without a crash, 0..1; null without sessions. */
  crashFreeRate: number | null;
  /** p75 cold launch in ms; null without samples. */
  coldLaunchP75: number | null;
  projects: ProjectHealth[];
  topIssues: TopIssue[];
}

const since24h = sql`now() - interval '24 hours'`;

/** Hour buckets for the last 24 hours (current hour last), zero-filled. */
async function errorsPerHour(projectIds: string[]): Promise<{ now: Date; hours: HourBucket[] }> {
  const result = await getDb().execute<{
    now: Date;
    hour: Date;
    errors: number;
    crashes: number;
  }>(sql`
    with buckets as (
      select generate_series(
        date_trunc('hour', now()) - interval '23 hours',
        date_trunc('hour', now()),
        interval '1 hour'
      ) as hour
    )
    select
      now() as now,
      buckets.hour as hour,
      count(${errorEvents.id})::int as errors,
      (count(${errorEvents.id}) filter (where ${errorEvents.fatal}))::int as crashes
    from buckets
    left join ${errorEvents}
      on ${inArray(errorEvents.projectId, projectIds)}
      and ${errorEvents.timestamp} >= buckets.hour
      and ${errorEvents.timestamp} < buckets.hour + interval '1 hour'
    group by buckets.hour
    order by buckets.hour
  `);
  return {
    now: new Date(result.rows[0]?.now ?? 0),
    hours: result.rows.map((row) => ({
      hour: new Date(row.hour),
      errors: Number(row.errors),
      crashes: Number(row.crashes),
    })),
  };
}

/** Everything the Overview shows, for every project of the organization. */
export async function getOverview(organizationId: string): Promise<Overview | null> {
  const db = getDb();
  const projectRows = await db
    .select({ id: projects.id, name: projects.name, sdkEnabled: projects.sdkEnabled })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.createdAt));
  if (projectRows.length === 0) return null;
  const ids = projectRows.map((project) => project.id);

  const [pulse, errorRows, sessionRows, issueRows, [coldLaunch], topIssues] = await Promise.all([
    errorsPerHour(ids),
    db
      .select({
        projectId: errorEvents.projectId,
        errors: count(),
        crashes: sql<number>`(count(*) filter (where ${errorEvents.fatal}))::int`,
      })
      .from(errorEvents)
      .where(and(inArray(errorEvents.projectId, ids), gte(errorEvents.timestamp, since24h)))
      .groupBy(errorEvents.projectId),
    db
      .select({
        projectId: sessions.projectId,
        sessions: count(),
        crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
      })
      .from(sessions)
      .where(and(inArray(sessions.projectId, ids), gte(sessions.startedAt, since24h)))
      .groupBy(sessions.projectId),
    db
      .select({ projectId: issues.projectId, open: count() })
      .from(issues)
      .where(and(inArray(issues.projectId, ids), eq(issues.status, 'open')))
      .groupBy(issues.projectId),
    db
      .select({
        p75: sql<number | null>`percentile_cont(0.75) within group (order by ${metrics.valueMs})`,
      })
      .from(metrics)
      .where(
        and(
          inArray(metrics.projectId, ids),
          eq(metrics.name, COLD_LAUNCH_METRIC),
          gte(metrics.timestamp, since24h),
        ),
      ),
    db
      .select({
        id: issues.id,
        projectName: projects.name,
        type: issues.type,
        message: issues.message,
        culprit: issues.culprit,
        fatal: issues.fatal,
        regressed: issues.regressed,
        eventCount: issues.eventCount,
        lastSeen: issues.lastSeen,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(and(inArray(issues.projectId, ids), eq(issues.status, 'open')))
      .orderBy(desc(issues.lastSeen), desc(issues.id))
      .limit(8),
  ]);

  const byProject = <T extends { projectId: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.projectId, row]));
  const errorsBy = byProject(errorRows);
  const sessionsBy = byProject(sessionRows);
  const issuesBy = byProject(issueRows);

  const health: ProjectHealth[] = projectRows.map((project) => ({
    id: project.id,
    name: project.name,
    sdkEnabled: project.sdkEnabled,
    errors: Number(errorsBy.get(project.id)?.errors ?? 0),
    sessions: Number(sessionsBy.get(project.id)?.sessions ?? 0),
    crashedSessions: Number(sessionsBy.get(project.id)?.crashed ?? 0),
    openIssues: Number(issuesBy.get(project.id)?.open ?? 0),
  }));

  const sum = (pick: (row: ProjectHealth) => number) =>
    health.reduce((total, row) => total + pick(row), 0);
  const totalSessions = sum((row) => row.sessions);
  const crashedSessions = sum((row) => row.crashedSessions);
  const p75 = coldLaunch?.p75;

  return {
    now: pulse.now,
    hours: pulse.hours,
    errors: sum((row) => row.errors),
    crashes: errorRows.reduce((total, row) => total + Number(row.crashes), 0),
    sessions: totalSessions,
    crashedSessions,
    openIssues: sum((row) => row.openIssues),
    crashFreeRate: totalSessions > 0 ? 1 - crashedSessions / totalSessions : null,
    coldLaunchP75: p75 === null || p75 === undefined ? null : Number(p75),
    projects: health,
    topIssues,
  };
}
