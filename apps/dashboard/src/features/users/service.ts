import 'server-only';

import { and, eq, gte, ilike, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { errorEvents, logEvents, projects, sessions } from '@/db/schema';
import type { OverviewFilters, PlatformKey, ResolvedWindow } from '@/features/overview/filters';
import type { FilterOptions } from '@/features/overview/service';
import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from '@/server/db/keyset';

export const USERS_PAGE_SIZE = 25;

export interface UserRow {
  /** The app's own user identifier. */
  userId: string;
  sessions: number;
  crashedSessions: number;
  errors: number;
  /** Observe.logEvent calls attributed to the user. */
  events: number;
  projects: number;
  /** Most recent device the user was seen on. */
  device: string | null;
  platform: 'ios' | 'android' | null;
  appVersion: string | null;
  firstSeen: Date;
  lastSeen: Date;
}

export interface UsersPage {
  users: UserRow[];
  cursor: string | null;
  hasMore: boolean;
  totals: {
    users: number;
    sessions: number;
    crashedSessions: number;
    errors: number;
    /** Distinct users with a session in the last 24 h. */
    dau: number;
    /** Distinct users with a session in the last 7 days. */
    wau: number;
    /** Distinct users with a session in the last 30 days. */
    mau: number;
    /** Users whose first-ever session started inside the window. */
    newUsers: number;
  };
}

function dimensions(
  table: typeof sessions | typeof errorEvents | typeof logEvents,
  projectIds: string[],
  filters: Pick<OverviewFilters, 'platform' | 'environment' | 'version'>,
): SQL[] {
  const conditions: SQL[] = [inArray(table.projectId, projectIds)];
  if (filters.platform) conditions.push(eq(table.platform, filters.platform as PlatformKey));
  if (filters.environment) conditions.push(eq(table.environment, filters.environment));
  if (filters.version) conditions.push(eq(table.appVersion, filters.version));
  return conditions;
}

function userSearch(query: string | null): SQL | undefined {
  if (!query) return undefined;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return ilike(sessions.userId, pattern);
}

const latestDevice = sql<
  string | null
>`(array_agg(concat_ws(' ', ${sessions.deviceBrand}, ${sessions.deviceModel}) order by ${sessions.lastSeenAt} desc) filter (where ${sessions.deviceModel} is not null))[1]`;

/** Active users with their session, crash and error footprint, most recent first. */
export async function listUsers(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
  params: { query: string | null; cursor: string | null },
): Promise<UsersPage> {
  const empty: UsersPage = {
    users: [],
    cursor: null,
    hasMore: false,
    totals: {
      users: 0,
      sessions: 0,
      crashedSessions: 0,
      errors: 0,
      dau: 0,
      wau: 0,
      mau: 0,
      newUsers: 0,
    },
  };
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const projectIds = selected.map((project) => project.id);
  if (projectIds.length === 0) return empty;

  const db = getDb();
  const nowMs = window.to.getTime();
  const sessionScope = and(
    ...dimensions(sessions, projectIds, filters),
    gte(sessions.startedAt, window.from),
    lt(sessions.startedAt, window.to),
    // Anonymous traffic (no user id) is not a "user" we can follow over time.
    sql`${sessions.userId} is not null`,
    userSearch(params.query),
  );
  const lastSeen = sql<Date>`max(${sessions.lastSeenAt})`;

  const pageQuery = db
    .select({
      userId: sql<string>`${sessions.userId}`,
      sessions: sql<number>`count(*)::int`,
      crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
      projects: sql<number>`(count(distinct ${sessions.projectId}))::int`,
      device: latestDevice,
      platform: sql<
        string | null
      >`(array_agg(${sessions.platform} order by ${sessions.lastSeenAt} desc))[1]`,
      appVersion: sql<
        string | null
      >`(array_agg(${sessions.appVersion} order by ${sessions.lastSeenAt} desc))[1]`,
      firstSeen: sql<Date>`min(${sessions.startedAt})`,
      lastSeen,
      cursorSort: lastSeen,
      cursorId: sql<string>`${sessions.userId}`,
    })
    .from(sessions)
    .where(sessionScope)
    .groupBy(sessions.userId);
  const cursor = decodeCursor(params.cursor);
  const grouped = cursor
    ? pageQuery.having(keysetCondition(lastSeen, sessions.userId, cursor, 'timestamptz'))
    : pageQuery;

  const [errorRows, eventRows, summaryRows, dauRows, wauRows, mauRows, newUserRows, rows] =
    await Promise.all([
      db
        .select({ userId: errorEvents.userId, errors: sql<number>`count(*)::int` })
        .from(errorEvents)
        .where(
          and(
            ...dimensions(errorEvents, projectIds, filters),
            gte(errorEvents.timestamp, window.from),
            lt(errorEvents.timestamp, window.to),
            sql`${errorEvents.userId} is not null`,
          ),
        )
        .groupBy(errorEvents.userId),
      db
        .select({ userId: logEvents.userId, events: sql<number>`count(*)::int` })
        .from(logEvents)
        .where(
          and(
            ...dimensions(logEvents, projectIds, filters),
            gte(logEvents.timestamp, window.from),
            lt(logEvents.timestamp, window.to),
            sql`${logEvents.userId} is not null`,
          ),
        )
        .groupBy(logEvents.userId),
      db
        .select({
          users: sql<number>`(count(distinct ${sessions.userId}))::int`,
          sessions: sql<number>`count(*)::int`,
          crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
        })
        .from(sessions)
        .where(sessionScope),
      getDb()
        .select({
          dau: sql<number>`(count(distinct ${sessions.userId}))::int`,
        })
        .from(sessions)
        .where(
          and(
            ...dimensions(sessions, projectIds, filters),
            gte(sessions.startedAt, new Date(nowMs - 24 * 3_600_000)),
            sql`${sessions.userId} is not null`,
          ),
        ),
      getDb()
        .select({
          wau: sql<number>`(count(distinct ${sessions.userId}))::int`,
        })
        .from(sessions)
        .where(
          and(
            ...dimensions(sessions, projectIds, filters),
            gte(sessions.startedAt, new Date(nowMs - 7 * 86_400_000)),
            sql`${sessions.userId} is not null`,
          ),
        ),
      getDb()
        .select({
          mau: sql<number>`(count(distinct ${sessions.userId}))::int`,
        })
        .from(sessions)
        .where(
          and(
            ...dimensions(sessions, projectIds, filters),
            gte(sessions.startedAt, new Date(nowMs - 30 * 86_400_000)),
            sql`${sessions.userId} is not null`,
          ),
        ),
      getDb()
        .select({ newUsers: sql<number>`count(*)::int` })
        .from(
          db
            .select({ userId: sessions.userId })
            .from(sessions)
            .where(
              and(inArray(sessions.projectId, projectIds), sql`${sessions.userId} is not null`),
            )
            .groupBy(sessions.userId)
            .having(sql`min(${sessions.startedAt}) >= ${window.from}`)
            .as('new_users'),
        ),
      grouped
        .orderBy(sql`max(${sessions.lastSeenAt}) desc`, sql`${sessions.userId} desc`)
        .limit(USERS_PAGE_SIZE + 1),
    ]);

  const errorsBy = new Map(errorRows.map((row) => [row.userId, Number(row.errors)]));
  const eventsBy = new Map(eventRows.map((row) => [row.userId, Number(row.events)]));
  const summary = summaryRows[0];

  const { cursor: next, hasMore } = nextCursor(rows, USERS_PAGE_SIZE);
  return {
    users: rows.slice(0, USERS_PAGE_SIZE).map(({ cursorSort: _sort, cursorId: _id, ...row }) => ({
      userId: row.userId,
      sessions: Number(row.sessions),
      crashedSessions: Number(row.crashed),
      errors: errorsBy.get(row.userId) ?? 0,
      events: eventsBy.get(row.userId) ?? 0,
      projects: Number(row.projects),
      device: row.device,
      platform: (row.platform as 'ios' | 'android' | null) ?? null,
      appVersion: row.appVersion,
      firstSeen: new Date(row.firstSeen),
      lastSeen: new Date(row.lastSeen),
    })),
    cursor: next ? encodeCursor(next) : null,
    hasMore,
    totals: {
      users: Number(summary?.users ?? 0),
      sessions: Number(summary?.sessions ?? 0),
      crashedSessions: Number(summary?.crashed ?? 0),
      errors: errorRows.reduce((total, row) => total + Number(row.errors), 0),
      dau: Number(dauRows[0]?.dau ?? 0),
      wau: Number(wauRows[0]?.wau ?? 0),
      mau: Number(mauRows[0]?.mau ?? 0),
      newUsers: Number(newUserRows[0]?.newUsers ?? 0),
    },
  };
}

/** The full footprint of one user across the workspace, or null cross-org. */
export async function getUserDetail(
  organizationId: string,
  userId: string,
): Promise<{
  userId: string;
  projects: { id: string; name: string; sessions: number }[];
  sessions: number;
  crashedSessions: number;
  errors: number;
  events: number;
  devices: string[];
  firstSeen: Date | null;
  lastSeen: Date | null;
} | null> {
  const db = getDb();
  const [profile] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .innerJoin(projects, eq(projects.id, sessions.projectId))
    .where(and(eq(projects.organizationId, organizationId), eq(sessions.userId, userId)))
    .limit(1);
  if (!profile) return null;

  const [projectRows, totals, errorRow, eventRow] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        sessions: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .where(and(eq(projects.organizationId, organizationId), eq(sessions.userId, userId)))
      .groupBy(projects.id, projects.name),
    db
      .select({
        sessions: sql<number>`count(*)::int`,
        crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
        firstSeen: sql<Date | null>`min(${sessions.startedAt})`,
        lastSeen: sql<Date | null>`max(${sessions.lastSeenAt})`,
        devices: sql<
          string[]
        >`array_agg(distinct concat_ws(' ', ${sessions.deviceBrand}, ${sessions.deviceModel})) filter (where ${sessions.deviceModel} is not null)`,
      })
      .from(sessions)
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .where(and(eq(projects.organizationId, organizationId), eq(sessions.userId, userId))),
    db
      .select({ errors: sql<number>`count(*)::int` })
      .from(errorEvents)
      .innerJoin(projects, eq(projects.id, errorEvents.projectId))
      .where(and(eq(projects.organizationId, organizationId), eq(errorEvents.userId, userId))),
    db
      .select({ events: sql<number>`count(*)::int` })
      .from(logEvents)
      .innerJoin(projects, eq(projects.id, logEvents.projectId))
      .where(and(eq(projects.organizationId, organizationId), eq(logEvents.userId, userId))),
  ]);

  const row = totals[0];
  return {
    userId,
    projects: projectRows.map((project) => ({
      ...project,
      sessions: Number(project.sessions),
    })),
    sessions: Number(row?.sessions ?? 0),
    crashedSessions: Number(row?.crashed ?? 0),
    errors: Number(errorRow[0]?.errors ?? 0),
    events: Number(eventRow[0]?.events ?? 0),
    devices: row?.devices ?? [],
    firstSeen: row?.firstSeen ? new Date(row.firstSeen) : null,
    lastSeen: row?.lastSeen ? new Date(row.lastSeen) : null,
  };
}
