import 'server-only';

import { and, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { errorEvents, logEvents, metrics, sessions } from '@/db/schema';
import type { OverviewFilters, PlatformKey, ResolvedWindow } from '@/features/overview/filters';
import type { FilterOptions } from '@/features/overview/service';

const COLD_LAUNCH_METRIC = 'app_startup.cold_launch_time';

export interface ReleaseRow {
  key: string;
  appVersion: string;
  appBuild: string;
  updateId: string | null;
  platform: 'ios' | 'android';
  environment: string;
  sessions: number;
  crashedSessions: number;
  /** Share of sessions without a crash, 0..1; null without sessions. */
  crashFreeRate: number | null;
  installations: number;
  users: number;
  /** Users of this release who saw at least one crash. */
  crashedUsers: number;
  /** Share of users without a crash, 0..1; null without users. */
  crashFreeUsers: number | null;
  /** Share of all sessions in the window running this release, 0..1. */
  adoptionRate: number;
  errors: number;
  crashes: number;
  /** Observe.logEvent calls in this release. */
  logEvents: number;
  coldLaunchP75: number | null;
  startupSamples: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface ReleasesView {
  releases: ReleaseRow[];
  totals: {
    releases: number;
    sessions: number;
    crashedSessions: number;
    crashFreeRate: number | null;
    errors: number;
    crashes: number;
    logEvents: number;
  };
}

const toNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** The release key used to merge sessions, errors and startup metrics. */
function releaseKey(row: {
  appVersion: string;
  appBuild: string;
  updateId: string | null;
  platform: string;
  environment: string;
}): string {
  return [row.appVersion, row.appBuild, row.updateId ?? '', row.platform, row.environment].join(
    '|',
  );
}

/**
 * Per release (version + build + OTA update), across the selected window and
 * dimension filters: sessions, crash-free share, errors and cold launch.
 */
export async function getReleases(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
): Promise<ReleasesView> {
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const projectIds = selected.map((project) => project.id);
  const empty: ReleasesView = {
    releases: [],
    totals: {
      releases: 0,
      sessions: 0,
      crashedSessions: 0,
      crashFreeRate: null,
      errors: 0,
      crashes: 0,
      logEvents: 0,
    },
  };
  if (projectIds.length === 0) return empty;

  const sessionScope = and(
    inArray(sessions.projectId, projectIds),
    gte(sessions.startedAt, window.from),
    lt(sessions.startedAt, window.to),
    filters.platform ? eq(sessions.platform, filters.platform as PlatformKey) : undefined,
    filters.environment ? eq(sessions.environment, filters.environment) : undefined,
    filters.version ? eq(sessions.appVersion, filters.version) : undefined,
  );
  const telemetryScope = (
    table: typeof errorEvents | typeof metrics | typeof logEvents,
  ): SQL | undefined =>
    and(
      inArray(table.projectId, projectIds),
      gte(table.timestamp, window.from),
      lt(table.timestamp, window.to),
      filters.platform ? eq(table.platform, filters.platform as PlatformKey) : undefined,
      filters.environment ? eq(table.environment, filters.environment) : undefined,
      filters.version ? eq(table.appVersion, filters.version) : undefined,
    );

  const [sessionRows, errorRows, launchRows, logRows] = await Promise.all([
    getDb()
      .select({
        appVersion: sessions.appVersion,
        appBuild: sessions.appBuild,
        updateId: sessions.updateId,
        platform: sessions.platform,
        environment: sessions.environment,
        total: sql<number>`count(*)::int`,
        crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
        installations: sql<number>`count(distinct ${sessions.installationId})::int`,
        users: sql<number>`count(distinct ${sessions.userId})::int`,
        crashedUsers: sql<number>`(count(distinct ${sessions.userId}) filter (where ${sessions.status} = 'crashed'))::int`,
        firstSeen: sql<Date>`min(${sessions.startedAt})`,
        lastSeen: sql<Date>`max(${sessions.lastSeenAt})`,
      })
      .from(sessions)
      .where(sessionScope)
      .groupBy(
        sessions.appVersion,
        sessions.appBuild,
        sessions.updateId,
        sessions.platform,
        sessions.environment,
      ),
    getDb()
      .select({
        appVersion: errorEvents.appVersion,
        appBuild: errorEvents.appBuild,
        updateId: errorEvents.updateId,
        platform: errorEvents.platform,
        environment: errorEvents.environment,
        errors: sql<number>`count(*)::int`,
        crashes: sql<number>`(count(*) filter (where ${errorEvents.fatal}))::int`,
        lastSeen: sql<Date>`max(${errorEvents.timestamp})`,
      })
      .from(errorEvents)
      .where(telemetryScope(errorEvents))
      .groupBy(
        errorEvents.appVersion,
        errorEvents.appBuild,
        errorEvents.updateId,
        errorEvents.platform,
        errorEvents.environment,
      ),
    getDb()
      .select({
        appVersion: metrics.appVersion,
        appBuild: metrics.appBuild,
        updateId: metrics.updateId,
        platform: metrics.platform,
        environment: metrics.environment,
        samples: sql<number>`count(*)::int`,
        p75: sql<number | null>`percentile_cont(0.75) within group (order by ${metrics.valueMs})`,
        lastSeen: sql<Date>`max(${metrics.timestamp})`,
      })
      .from(metrics)
      .where(and(telemetryScope(metrics), eq(metrics.name, COLD_LAUNCH_METRIC)))
      .groupBy(
        metrics.appVersion,
        metrics.appBuild,
        metrics.updateId,
        metrics.platform,
        metrics.environment,
      ),
    getDb()
      .select({
        appVersion: logEvents.appVersion,
        appBuild: logEvents.appBuild,
        updateId: logEvents.updateId,
        platform: logEvents.platform,
        environment: logEvents.environment,
        logEvents: sql<number>`count(*)::int`,
        lastSeen: sql<Date>`max(${logEvents.timestamp})`,
      })
      .from(logEvents)
      .where(telemetryScope(logEvents))
      .groupBy(
        logEvents.appVersion,
        logEvents.appBuild,
        logEvents.updateId,
        logEvents.platform,
        logEvents.environment,
      ),
  ]);

  const byKey = new Map<string, ReleaseRow>();
  for (const row of sessionRows) {
    const key = releaseKey(row);
    byKey.set(key, {
      key,
      appVersion: row.appVersion,
      appBuild: row.appBuild,
      updateId: row.updateId,
      platform: row.platform,
      environment: row.environment,
      sessions: Number(row.total),
      crashedSessions: Number(row.crashed),
      crashFreeRate: null,
      installations: Number(row.installations),
      users: Number(row.users),
      crashedUsers: Number(row.crashedUsers),
      crashFreeUsers: null,
      adoptionRate: 0,
      errors: 0,
      crashes: 0,
      logEvents: 0,
      coldLaunchP75: null,
      startupSamples: 0,
      firstSeen: new Date(row.firstSeen),
      lastSeen: new Date(row.lastSeen),
    });
  }

  for (const row of errorRows) {
    const key = releaseKey(row);
    const current = byKey.get(key);
    if (!current) continue;
    current.errors = Number(row.errors);
    current.crashes = Number(row.crashes);
    const lastSeen = new Date(row.lastSeen);
    if (lastSeen > current.lastSeen) current.lastSeen = lastSeen;
  }

  for (const row of launchRows) {
    const key = releaseKey(row);
    const current = byKey.get(key);
    if (!current) continue;
    current.coldLaunchP75 = toNumber(row.p75);
    current.startupSamples = Number(row.samples);
  }

  for (const row of logRows) {
    const key = releaseKey(row);
    const current = byKey.get(key);
    if (!current) continue;
    current.logEvents = Number(row.logEvents);
    const lastSeen = new Date(row.lastSeen);
    if (lastSeen > current.lastSeen) current.lastSeen = lastSeen;
  }

  const releases = [...byKey.values()]
    .map((release) => ({
      ...release,
      crashFreeRate: release.sessions > 0 ? 1 - release.crashedSessions / release.sessions : null,
      crashFreeUsers: release.users > 0 ? 1 - release.crashedUsers / release.users : null,
    }))
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime() || b.sessions - a.sessions)
    .slice(0, 100);

  const totalSessions = releases.reduce((total, release) => total + release.sessions, 0);
  const crashedSessions = releases.reduce((total, release) => total + release.crashedSessions, 0);
  // Adoption is the share of the window's sessions running each release.
  for (const release of releases) {
    release.adoptionRate = totalSessions > 0 ? release.sessions / totalSessions : 0;
  }
  return {
    releases,
    totals: {
      releases: releases.length,
      sessions: totalSessions,
      crashedSessions,
      crashFreeRate: totalSessions > 0 ? 1 - crashedSessions / totalSessions : null,
      errors: releases.reduce((total, release) => total + release.errors, 0),
      crashes: releases.reduce((total, release) => total + release.crashes, 0),
      logEvents: releases.reduce((total, release) => total + release.logEvents, 0),
    },
  };
}
