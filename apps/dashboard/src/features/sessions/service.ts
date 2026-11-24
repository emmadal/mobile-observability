import 'server-only';

import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { errorEvents, issues, logEvents, metrics, projects, requests, sessions } from '@/db/schema';
import type { OverviewFilters, PlatformKey, ResolvedWindow } from '@/features/overview/filters';
import type { FilterOptions } from '@/features/overview/service';
import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from '@/server/db/keyset';

export const SESSIONS_PAGE_SIZE = 25;
export const SESSION_STATUS_FILTERS = ['all', 'ok', 'errored', 'crashed', 'abnormal'] as const;
export type SessionStatusFilter = (typeof SESSION_STATUS_FILTERS)[number];
export const DEFAULT_SESSION_STATUS: SessionStatusFilter = 'all';
export const MAX_SESSION_SEARCH_LENGTH = 64;

export interface SessionListParams {
  status: SessionStatusFilter;
  /** Substring matched against session, installation and user ids. */
  query: string | null;
  cursor: string | null;
}

export interface SessionListItem {
  id: number;
  sessionId: string;
  projectId: string;
  projectName: string;
  installationId: string;
  userId: string | null;
  status: 'ok' | 'errored' | 'crashed' | 'abnormal';
  errorCount: number;
  /** Observe.logEvent calls captured in this session. */
  eventCount: number;
  startedAt: Date;
  endedAt: Date | null;
  lastSeenAt: Date;
  platform: 'ios' | 'android';
  osVersion: string | null;
  deviceModel: string | null;
  appVersion: string;
  appBuild: string;
  updateId: string | null;
  environment: string;
}

export interface SessionListPage {
  sessions: SessionListItem[];
  cursor: string | null;
  hasMore: boolean;
  counts: Record<SessionStatusFilter, number>;
}

/** Sessions that started inside the window and match the dimension filters. */
function sessionScope(
  projectIds: string[],
  filters: Pick<OverviewFilters, 'platform' | 'environment' | 'version'>,
  window: ResolvedWindow,
): SQL | undefined {
  if (projectIds.length === 0) return undefined;
  const conditions: (SQL | undefined)[] = [
    inArray(sessions.projectId, projectIds),
    gte(sessions.startedAt, window.from),
    lt(sessions.startedAt, window.to),
  ];
  if (filters.platform) conditions.push(eq(sessions.platform, filters.platform as PlatformKey));
  if (filters.environment) conditions.push(eq(sessions.environment, filters.environment));
  if (filters.version) conditions.push(eq(sessions.appVersion, filters.version));
  return and(...conditions);
}

function searchCondition(query: string | null): SQL | undefined {
  if (!query) return undefined;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    ilike(sessions.sessionId, pattern),
    ilike(sessions.installationId, pattern),
    ilike(sessions.userId, pattern),
  );
}

/** One page of sessions, newest first, with per-status totals for the tabs. */
export async function listSessions(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
  params: SessionListParams,
): Promise<SessionListPage> {
  const empty: SessionListPage = {
    sessions: [],
    cursor: null,
    hasMore: false,
    counts: { all: 0, ok: 0, errored: 0, crashed: 0, abnormal: 0 },
  };
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const projectIds = selected.map((project) => project.id);
  if (projectIds.length === 0) return empty;

  const db = getDb();
  const scope = sessionScope(projectIds, filters, window);
  const search = searchCondition(params.query);
  const statusCondition = params.status === 'all' ? undefined : eq(sessions.status, params.status);
  const cursor = decodeCursor(params.cursor);

  const countRows = await db
    .select({ status: sessions.status, total: count() })
    .from(sessions)
    .where(and(scope, search))
    .groupBy(sessions.status);
  const counts: Record<SessionStatusFilter, number> = {
    all: 0,
    ok: 0,
    errored: 0,
    crashed: 0,
    abnormal: 0,
  };
  for (const row of countRows) {
    counts[row.status] = Number(row.total);
    counts.all += Number(row.total);
  }

  const rows = await db
    .select({
      id: sessions.id,
      sessionId: sessions.sessionId,
      projectId: sessions.projectId,
      projectName: projects.name,
      installationId: sessions.installationId,
      userId: sessions.userId,
      status: sessions.status,
      errorCount: sessions.errorCount,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      lastSeenAt: sessions.lastSeenAt,
      platform: sessions.platform,
      osVersion: sessions.osVersion,
      deviceModel: sessions.deviceModel,
      appVersion: sessions.appVersion,
      appBuild: sessions.appBuild,
      updateId: sessions.updateId,
      environment: sessions.environment,
      cursorSort: sessions.startedAt,
      cursorId: sessions.id,
    })
    .from(sessions)
    .innerJoin(projects, eq(projects.id, sessions.projectId))
    .where(
      and(
        scope,
        search,
        statusCondition,
        cursor
          ? keysetCondition(sessions.startedAt, sessions.id, cursor, 'timestamptz')
          : undefined,
      ),
    )
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(SESSIONS_PAGE_SIZE + 1);

  const { cursor: next, hasMore } = nextCursor(rows, SESSIONS_PAGE_SIZE);
  const visible = rows.slice(0, SESSIONS_PAGE_SIZE);
  const eventCountRows =
    visible.length === 0
      ? []
      : await db
          .select({
            sessionId: logEvents.sessionId,
            total: sql<number>`count(*)::int`,
          })
          .from(logEvents)
          .where(
            and(
              inArray(logEvents.projectId, projectIds),
              inArray(
                logEvents.sessionId,
                visible.map((session) => session.sessionId),
              ),
            ),
          )
          .groupBy(logEvents.sessionId);
  const eventsBySession = new Map(eventCountRows.map((row) => [row.sessionId, Number(row.total)]));
  return {
    sessions: visible.map(({ cursorSort, cursorId, ...session }) => ({
      ...session,
      eventCount: eventsBySession.get(session.sessionId) ?? 0,
    })),
    cursor: next ? encodeCursor(next) : null,
    hasMore,
    counts,
  };
}

export interface SessionDetail {
  id: number;
  sessionId: string;
  projectId: string;
  projectName: string;
  installationId: string;
  userId: string | null;
  status: 'ok' | 'errored' | 'crashed' | 'abnormal';
  errorCount: number;
  startedAt: Date;
  endedAt: Date | null;
  lastSeenAt: Date;
  platform: 'ios' | 'android';
  osVersion: string | null;
  deviceModel: string | null;
  appVersion: string;
  appBuild: string;
  updateId: string | null;
  runtimeVersion: string | null;
  environment: string;
}

export interface SessionError {
  id: number;
  issueId: string;
  timestamp: Date;
  fatal: boolean;
  type: string;
  message: string;
  routeName: string | null;
}

export interface SessionMetric {
  id: number;
  timestamp: Date;
  name: string;
  valueMs: number;
  routeName: string | null;
}

export interface SessionLogEvent {
  id: number;
  timestamp: Date;
  name: string;
  severity: string;
  body: string | null;
  displayName: string | null;
  attributes: Record<string, unknown> | null;
}

export interface SessionRequest {
  id: number;
  timestamp: Date;
  method: string;
  host: string;
  path: string;
  statusCode: number;
  durationMs: number;
  error: string | null;
}

export interface SessionDetailView {
  session: SessionDetail;
  errors: SessionError[];
  metrics: SessionMetric[];
  events: SessionLogEvent[];
  requests: SessionRequest[];
}

/** One session belonging to the visitor's organization, or null (also cross-org). */
export async function getSessionDetail(
  organizationId: string,
  id: number,
): Promise<SessionDetailView | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const db = getDb();
  const [session] = await db
    .select({
      id: sessions.id,
      sessionId: sessions.sessionId,
      projectId: sessions.projectId,
      projectName: projects.name,
      installationId: sessions.installationId,
      userId: sessions.userId,
      status: sessions.status,
      errorCount: sessions.errorCount,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      lastSeenAt: sessions.lastSeenAt,
      platform: sessions.platform,
      osVersion: sessions.osVersion,
      deviceModel: sessions.deviceModel,
      appVersion: sessions.appVersion,
      appBuild: sessions.appBuild,
      updateId: sessions.updateId,
      runtimeVersion: sessions.runtimeVersion,
      environment: sessions.environment,
    })
    .from(sessions)
    .innerJoin(projects, eq(projects.id, sessions.projectId))
    .where(and(eq(sessions.id, id), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!session) return null;

  const [errors, metricRows, eventRows, requestRows] = await Promise.all([
    db
      .select({
        id: errorEvents.id,
        issueId: errorEvents.issueId,
        timestamp: errorEvents.timestamp,
        fatal: errorEvents.fatal,
        type: issues.type,
        message: issues.message,
        routeName: errorEvents.routeName,
      })
      .from(errorEvents)
      .innerJoin(issues, eq(issues.id, errorEvents.issueId))
      .where(
        and(
          eq(errorEvents.projectId, session.projectId),
          eq(errorEvents.sessionId, session.sessionId),
        ),
      )
      .orderBy(desc(errorEvents.timestamp), desc(errorEvents.id))
      .limit(100),
    db
      .select({
        id: metrics.id,
        timestamp: metrics.timestamp,
        name: metrics.name,
        valueMs: metrics.valueMs,
        routeName: metrics.routeName,
      })
      .from(metrics)
      .where(
        and(eq(metrics.projectId, session.projectId), eq(metrics.sessionId, session.sessionId)),
      )
      .orderBy(asc(metrics.timestamp), asc(metrics.id))
      .limit(100),
    db
      .select({
        id: logEvents.id,
        timestamp: logEvents.timestamp,
        name: logEvents.name,
        severity: logEvents.severity,
        body: logEvents.body,
        displayName: logEvents.displayName,
        attributes: logEvents.attributes,
      })
      .from(logEvents)
      .where(
        and(eq(logEvents.projectId, session.projectId), eq(logEvents.sessionId, session.sessionId)),
      )
      .orderBy(asc(logEvents.timestamp), asc(logEvents.id))
      .limit(100),
    db
      .select({
        id: requests.id,
        timestamp: requests.timestamp,
        method: requests.method,
        host: requests.host,
        path: requests.path,
        statusCode: requests.statusCode,
        durationMs: requests.durationMs,
        error: requests.error,
      })
      .from(requests)
      .where(
        and(eq(requests.projectId, session.projectId), eq(requests.sessionId, session.sessionId)),
      )
      .orderBy(asc(requests.timestamp), asc(requests.id))
      .limit(100),
  ]);

  return {
    session,
    errors,
    metrics: metricRows.map((metric) => ({ ...metric, valueMs: Number(metric.valueMs) })),
    events: eventRows,
    requests: requestRows.map((request) => ({
      ...request,
      durationMs: Number(request.durationMs),
    })),
  };
}
