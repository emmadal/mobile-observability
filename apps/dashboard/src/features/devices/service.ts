import 'server-only';

import { and, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { errorEvents, metrics, sessions } from '@/db/schema';
import type { OverviewFilters, PlatformKey, ResolvedWindow } from '@/features/overview/filters';
import { COLD_LAUNCH_METRIC, type FilterOptions } from '@/features/overview/service';

export interface DeviceRow {
  platform: 'ios' | 'android';
  /** Manufacturer such as Apple or Samsung; null when the SDK did not send it. */
  brand: string | null;
  model: string | null;
  osVersion: string | null;
  sessions: number;
  crashedSessions: number;
  /** Share of sessions without a crash, 0..1; null without sessions. */
  crashFreeRate: number | null;
  users: number;
  errors: number;
  /** p75 cold launch on this device, ms; null without samples. */
  coldLaunchP75: number | null;
  startupSamples: number;
  lastSeen: Date;
}

export interface DeviceBreakdown {
  devices: DeviceRow[];
  /** Distinct device keys across the window. */
  totalDevices: number;
  models: number;
}

const UNKNOWN = '(unknown)';
/** Inline literal so SELECT and GROUP BY expressions match textually. */
const unknownExpr = sql`'(unknown)'`;

/** Sessions are windowed on startedAt; telemetry tables carry a timestamp. */
function scopeOf(
  table: typeof errorEvents | typeof metrics,
  projectIds: string[],
  filters: OverviewFilters,
  window: ResolvedWindow,
): SQL | undefined {
  return and(
    inArray(table.projectId, projectIds),
    gte(table.timestamp, window.from),
    lt(table.timestamp, window.to),
    filters.platform ? eq(table.platform, filters.platform as PlatformKey) : undefined,
    filters.environment ? eq(table.environment, filters.environment) : undefined,
    filters.version ? eq(table.appVersion, filters.version) : undefined,
  );
}

function sessionScope(
  projectIds: string[],
  filters: OverviewFilters,
  window: ResolvedWindow,
): SQL | undefined {
  return and(
    inArray(sessions.projectId, projectIds),
    gte(sessions.startedAt, window.from),
    lt(sessions.startedAt, window.to),
    filters.platform ? eq(sessions.platform, filters.platform as PlatformKey) : undefined,
    filters.environment ? eq(sessions.environment, filters.environment) : undefined,
    filters.version ? eq(sessions.appVersion, filters.version) : undefined,
  );
}

const deviceColumns = {
  platform: sessions.platform,
  brand: sql<string | null>`coalesce(${sessions.deviceBrand}, ${unknownExpr})`,
  model: sql<string | null>`coalesce(${sessions.deviceModel}, ${unknownExpr})`,
  osVersion: sql<string | null>`coalesce(${sessions.osVersion}, ${unknownExpr})`,
};

/**
 * Sessions, crashes, errors and cold-launch percentiles grouped per physical
 * device, so a problem limited to one model or OS version stands out.
 */
export async function getDeviceBreakdown(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
): Promise<DeviceBreakdown> {
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const projectIds = selected.map((project) => project.id);
  if (projectIds.length === 0) return { devices: [], totalDevices: 0, models: 0 };

  const sessionGroup = [
    sessions.platform,
    sql`coalesce(${sessions.deviceBrand}, ${unknownExpr})`,
    sql`coalesce(${sessions.deviceModel}, ${unknownExpr})`,
    sql`coalesce(${sessions.osVersion}, ${unknownExpr})`,
  ];
  const [sessionRows, errorRows, launchRows] = await Promise.all([
    getDb()
      .select({
        platform: deviceColumns.platform,
        brand: deviceColumns.brand,
        model: deviceColumns.model,
        osVersion: deviceColumns.osVersion,
        sessions: sql<number>`count(*)::int`,
        crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
        users: sql<number>`(count(distinct ${sessions.userId}))::int`,
        lastSeen: sql<Date>`max(${sessions.lastSeenAt})`,
      })
      .from(sessions)
      .where(sessionScope(projectIds, filters, window))
      .groupBy(...sessionGroup),
    getDb()
      .select({
        platform: errorEvents.platform,
        brand: sql<string | null>`coalesce(${errorEvents.deviceBrand}, ${unknownExpr})`,
        model: sql<string | null>`coalesce(${errorEvents.deviceModel}, ${unknownExpr})`,
        osVersion: sql<string | null>`coalesce(${errorEvents.osVersion}, ${unknownExpr})`,
        errors: sql<number>`count(*)::int`,
        lastSeen: sql<Date>`max(${errorEvents.timestamp})`,
      })
      .from(errorEvents)
      .where(scopeOf(errorEvents, projectIds, filters, window))
      .groupBy(
        errorEvents.platform,
        sql`coalesce(${errorEvents.deviceBrand}, ${unknownExpr})`,
        sql`coalesce(${errorEvents.deviceModel}, ${unknownExpr})`,
        sql`coalesce(${errorEvents.osVersion}, ${unknownExpr})`,
      ),
    getDb()
      .select({
        platform: metrics.platform,
        brand: sql<string | null>`coalesce(${metrics.deviceBrand}, ${unknownExpr})`,
        model: sql<string | null>`coalesce(${metrics.deviceModel}, ${unknownExpr})`,
        osVersion: sql<string | null>`coalesce(${metrics.osVersion}, ${unknownExpr})`,
        samples: sql<number>`count(*)::int`,
        p75: sql<number | null>`percentile_cont(0.75) within group (order by ${metrics.valueMs})`,
        lastSeen: sql<Date>`max(${metrics.timestamp})`,
      })
      .from(metrics)
      .where(
        and(scopeOf(metrics, projectIds, filters, window), eq(metrics.name, COLD_LAUNCH_METRIC)),
      )
      .groupBy(
        metrics.platform,
        sql`coalesce(${metrics.deviceBrand}, ${unknownExpr})`,
        sql`coalesce(${metrics.deviceModel}, ${unknownExpr})`,
        sql`coalesce(${metrics.osVersion}, ${unknownExpr})`,
      ),
  ]);

  interface Group {
    sessions: number;
    crashed: number;
    users: number;
    errors: number;
    coldLaunchP75: number | null;
    startupSamples: number;
    lastSeen: Date;
    platform: 'ios' | 'android';
  }
  const groups = new Map<string, Group>();
  const keyOf = (platform: string, brand: unknown, model: unknown, os: unknown) =>
    `${platform}|${String(brand)}|${String(model)}|${String(os)}`;

  for (const row of sessionRows) {
    groups.set(keyOf(row.platform, row.brand, row.model, row.osVersion), {
      platform: row.platform,
      sessions: Number(row.sessions),
      crashed: Number(row.crashed),
      users: Number(row.users),
      errors: 0,
      coldLaunchP75: null,
      startupSamples: 0,
      lastSeen: new Date(row.lastSeen),
    });
  }
  for (const row of errorRows) {
    const group = groups.get(keyOf(row.platform, row.brand, row.model, row.osVersion));
    if (!group) continue;
    group.errors = Number(row.errors);
    const lastSeen = new Date(row.lastSeen);
    if (lastSeen > group.lastSeen) group.lastSeen = lastSeen;
  }
  for (const row of launchRows) {
    const group = groups.get(keyOf(row.platform, row.brand, row.model, row.osVersion));
    if (!group) continue;
    group.coldLaunchP75 = row.p75 === null || row.p75 === undefined ? null : Number(row.p75);
    group.startupSamples = Number(row.samples);
    const lastSeen = new Date(row.lastSeen);
    if (lastSeen > group.lastSeen) group.lastSeen = lastSeen;
  }

  const devices: DeviceRow[] = [...groups.entries()]
    .map(([key, group]) => {
      const [platform = 'ios', brand = UNKNOWN, model = UNKNOWN, osVersion = UNKNOWN] =
        key.split('|');
      return {
        platform: platform as 'ios' | 'android',
        brand: brand === UNKNOWN ? null : brand,
        model: model === UNKNOWN ? null : model,
        osVersion: osVersion === UNKNOWN ? null : osVersion,
        sessions: group.sessions,
        crashedSessions: group.crashed,
        crashFreeRate: group.sessions > 0 ? 1 - group.crashed / group.sessions : null,
        users: group.users,
        errors: group.errors,
        coldLaunchP75: group.coldLaunchP75,
        startupSamples: group.startupSamples,
        lastSeen: group.lastSeen,
      };
    })
    .sort(
      (a, b) =>
        b.sessions - a.sessions ||
        b.errors - a.errors ||
        (b.lastSeen.getTime() || 0) - (a.lastSeen.getTime() || 0),
    );

  return {
    devices,
    totalDevices: devices.length,
    models: new Set(devices.map((device) => `${device.brand ?? ''}|${device.model ?? ''}`)).size,
  };
}
