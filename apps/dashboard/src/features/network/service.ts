import 'server-only';

import { and, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { projects, requests, sessions } from '@/db/schema';
import type { OverviewFilters, ResolvedWindow } from '@/features/overview/filters';
import type { FilterOptions } from '@/features/overview/service';
import { requestScope, selectedProjectIds } from '@/features/performance/service';
import type { NetworkRequest } from '@/features/telemetry/request-trace';
import { requestTraceColumns, toRequestTrace } from '@/features/telemetry/request-trace-query';
import { NO_SEGMENT } from '@/features/users/service';
import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from '@/server/db/keyset';
import type { NetworkStatus } from './filters';

export const NETWORK_PAGE_SIZE = 50;

/** Requests of one user segment (null: no segment, or no identified user). */
export interface NetworkSegment {
  segment: string | null;
  requests: number;
  /** Network failures and API errors (status 0, >= 400). */
  failed: number;
  /** Distinct identified users who sent them. */
  users: number;
}

export interface NetworkStats {
  requests: number;
  failed: number;
  /** The API answered 4xx or 5xx. */
  apiErrors: number;
  /** No answer at all: offline, DNS, TLS, timeout, aborted. */
  networkFailures: number;
  ok: number;
  users: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface NetworkPage {
  requests: NetworkRequest[];
  cursor: string | null;
  /** Every segment seen in the window, busiest first; ignores segment, outcome and search. */
  segments: NetworkSegment[];
  /** Totals of the selected segment and search, before the outcome filter. */
  stats: NetworkStats;
}

const failed = sql`(${requests.statusCode} >= 400 or ${requests.statusCode} = 0 or ${requests.error} is not null)`;
const networkFailure = sql`(${requests.statusCode} = 0 or ${requests.error} is not null)`;
const apiError = sql`(${requests.statusCode} >= 400 and ${requests.error} is null)`;
const ok = sql`(${requests.statusCode} between 1 and 399 and ${requests.error} is null)`;
/** The session's user covers requests sent before the app identified it. */
const userKey = sql`coalesce(${sessions.userId}, ${requests.userId})`;

function statusCondition(status: NetworkStatus): SQL | undefined {
  switch (status) {
    case 'failed':
      return failed;
    case 'api':
      return apiError;
    case 'network':
      return networkFailure;
    case 'ok':
      return ok;
    default:
      return undefined;
  }
}

function segmentCondition(segment: string | null): SQL | undefined {
  if (!segment) return undefined;
  return segment === NO_SEGMENT
    ? sql`${sessions.userSegment} is null`
    : eq(sessions.userSegment, segment);
}

/** Phone, user id, URL or endpoint containing the text. */
function searchCondition(query: string | null): SQL | undefined {
  if (!query) return undefined;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    ilike(sessions.userPhone, pattern),
    ilike(sessions.userId, pattern),
    ilike(requests.userId, pattern),
    ilike(requests.url, pattern),
    sql`(${requests.host} || ${requests.path}) ilike ${pattern}`,
  );
}

const sessionJoin = and(
  eq(sessions.projectId, requests.projectId),
  eq(sessions.sessionId, requests.sessionId),
);

const EMPTY_STATS: NetworkStats = {
  requests: 0,
  failed: 0,
  apiErrors: 0,
  networkFailures: 0,
  ok: 0,
  users: 0,
  p50Ms: null,
  p95Ms: null,
};

/**
 * Requests between the apps and their APIs, newest first, with who sent them
 * (msisdn and segment from the session's user), filtered by segment, outcome
 * and search, plus the per-segment breakdown and totals of the selection.
 */
export async function listNetworkRequests(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
  params: {
    segment: string | null;
    status: NetworkStatus;
    query: string | null;
    cursor: string | null;
  },
): Promise<NetworkPage> {
  const projectIds = selectedProjectIds(options, filters);
  if (projectIds.length === 0) {
    return { requests: [], cursor: null, segments: [], stats: EMPTY_STATS };
  }
  const db = getDb();
  const scope = requestScope(projectIds, filters, window);
  const selection = and(scope, segmentCondition(params.segment), searchCondition(params.query));
  const cursor = decodeCursor(params.cursor);

  const [rows, segmentRows, statRows] = await Promise.all([
    db
      .select({
        ...requestTraceColumns,
        projectName: projects.name,
        appVersion: requests.appVersion,
        platform: requests.platform,
        sessionId: requests.sessionId,
        sessionRowId: sessions.id,
        userId: requests.userId,
        sessionUserId: sessions.userId,
        userPhone: sessions.userPhone,
        userSegment: sessions.userSegment,
        cursorSort: requests.timestamp,
        cursorId: requests.id,
      })
      .from(requests)
      .innerJoin(projects, eq(projects.id, requests.projectId))
      .leftJoin(sessions, sessionJoin)
      .where(
        and(
          selection,
          statusCondition(params.status),
          cursor
            ? keysetCondition(requests.timestamp, requests.id, cursor, 'timestamptz')
            : undefined,
        ),
      )
      .orderBy(desc(requests.timestamp), desc(requests.id))
      .limit(NETWORK_PAGE_SIZE + 1),
    db
      .select({
        segment: sessions.userSegment,
        requests: sql<number>`count(*)::int`,
        failed: sql<number>`(count(*) filter (where ${failed}))::int`,
        users: sql<number>`(count(distinct ${userKey}))::int`,
      })
      .from(requests)
      .leftJoin(sessions, sessionJoin)
      .where(scope)
      .groupBy(sessions.userSegment)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        requests: sql<number>`count(*)::int`,
        failed: sql<number>`(count(*) filter (where ${failed}))::int`,
        apiErrors: sql<number>`(count(*) filter (where ${apiError}))::int`,
        networkFailures: sql<number>`(count(*) filter (where ${networkFailure}))::int`,
        ok: sql<number>`(count(*) filter (where ${ok}))::int`,
        users: sql<number>`(count(distinct ${userKey}))::int`,
        p50Ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${requests.durationMs}) filter (where ${requests.statusCode} > 0)`,
        p95Ms: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${requests.durationMs}) filter (where ${requests.statusCode} > 0)`,
      })
      .from(requests)
      .leftJoin(sessions, sessionJoin)
      .where(selection),
  ]);

  const page = nextCursor(rows, NETWORK_PAGE_SIZE);
  const stat = statRows[0];
  return {
    requests: rows.slice(0, NETWORK_PAGE_SIZE).map((row) => ({
      ...toRequestTrace(row),
      projectName: row.projectName,
      appVersion: row.appVersion,
      platform: row.platform,
      sessionId: row.sessionId,
      sessionRowId: row.sessionRowId,
      userId: row.userId ?? row.sessionUserId,
      userPhone: row.userPhone,
      userSegment: row.userSegment,
    })),
    cursor: page.cursor ? encodeCursor(page.cursor) : null,
    segments: segmentRows.map((row) => ({
      segment: row.segment,
      requests: Number(row.requests),
      failed: Number(row.failed),
      users: Number(row.users),
    })),
    stats: stat
      ? {
          requests: Number(stat.requests),
          failed: Number(stat.failed),
          apiErrors: Number(stat.apiErrors),
          networkFailures: Number(stat.networkFailures),
          ok: Number(stat.ok),
          users: Number(stat.users),
          p50Ms: stat.p50Ms === null ? null : Number(stat.p50Ms),
          p95Ms: stat.p95Ms === null ? null : Number(stat.p95Ms),
        }
      : EMPTY_STATS,
  };
}
