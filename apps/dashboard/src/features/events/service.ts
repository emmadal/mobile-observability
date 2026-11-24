import 'server-only';

import { and, desc, eq, gte, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { logEvents, projects, sessions } from '@/db/schema';
import type { OverviewFilters, PlatformKey, ResolvedWindow } from '@/features/overview/filters';
import type { FilterOptions } from '@/features/overview/service';
import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from '@/server/db/keyset';
import type { EventSeverity, EventSeverityFilter } from './filters';

export const EVENTS_PAGE_SIZE = 25;
export const EVENT_OCCURRENCES_PAGE_SIZE = 50;
export const MAX_EVENT_ATTRIBUTE_ROWS = 60;

export type EventSeverityCounts = Record<EventSeverity, number>;

export interface EventListParams {
  severity: EventSeverityFilter;
  /** Substring matched against the event name, display name and body. */
  query: string | null;
  cursor: string | null;
}

export interface EventListItem {
  name: string;
  displayName: string | null;
  events: number;
  sessions: number;
  users: number;
  projects: number;
  severities: EventSeverityCounts;
  firstSeen: Date;
  lastSeen: Date;
}

export interface EventListTotals {
  events: number;
  names: number;
  sessions: number;
  users: number;
  projects: number;
}

export interface EventListPage {
  events: EventListItem[];
  cursor: string | null;
  hasMore: boolean;
  counts: Record<EventSeverityFilter, number>;
  totals: EventListTotals;
}

export interface EventDetailParams {
  severity: EventSeverityFilter;
  /** Attribute key/value pair narrowing the occurrences; both or neither. */
  attrKey: string | null;
  attrValue: string | null;
  cursor: string | null;
}

export interface EventOccurrence {
  id: number;
  timestamp: Date;
  severity: string;
  body: string | null;
  displayName: string | null;
  attributes: Record<string, unknown> | null;
  projectId: string;
  projectName: string;
  appVersion: string;
  appBuild: string;
  updateId: string | null;
  platform: 'ios' | 'android';
  environment: string;
  deviceBrand: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  userId: string | null;
  sessionId: string | null;
  /** Database id of the session, when the session row exists. */
  sessionRowId: number | null;
}

export type EventAttributeValue = {
  key: string;
  value: string;
  count: number;
};

export interface EventDetailView {
  name: string;
  displayName: string | null;
  totals: {
    events: number;
    sessions: number;
    users: number;
    projects: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
  };
  severities: EventSeverityCounts;
  attributes: EventAttributeValue[];
  occurrences: EventOccurrence[];
  cursor: string | null;
  hasMore: boolean;
}

function emptySeverities(): EventSeverityCounts {
  return { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
}

function emptyCounts(): Record<EventSeverityFilter, number> {
  return { all: 0, ...emptySeverities() };
}

function eventScope(
  projectIds: string[],
  filters: Pick<OverviewFilters, 'platform' | 'environment' | 'version'>,
  window: ResolvedWindow,
  name?: string,
): SQL {
  const conditions: SQL[] = [
    inArray(logEvents.projectId, projectIds),
    gte(logEvents.timestamp, window.from),
    lt(logEvents.timestamp, window.to),
  ];
  if (name) conditions.push(eq(logEvents.name, name));
  if (filters.platform) conditions.push(eq(logEvents.platform, filters.platform as PlatformKey));
  if (filters.environment) conditions.push(eq(logEvents.environment, filters.environment));
  if (filters.version) conditions.push(eq(logEvents.appVersion, filters.version));
  return and(...conditions) ?? sql`true`;
}

function eventSearch(query: string | null): SQL | undefined {
  if (!query) return undefined;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    ilike(logEvents.name, pattern),
    ilike(logEvents.displayName, pattern),
    ilike(logEvents.body, pattern),
  );
}

function severityCondition(severity: EventSeverityFilter): SQL | undefined {
  return severity === 'all' ? undefined : eq(logEvents.severity, severity);
}

function severityCount(severity: EventSeverity): SQL<number> {
  return sql<number>`(count(*) filter (where ${logEvents.severity} = ${severity}))::int`;
}

const latestDisplayName = sql<
  string | null
>`(array_agg(${logEvents.displayName} order by ${logEvents.timestamp} desc) filter (where ${logEvents.displayName} is not null))[1]`;

const toNumber = (value: unknown): number => Number(value ?? 0);
const toDate = (value: unknown): Date => new Date(value as string | number | Date);

/** One page of event-name groups, most recently active first. */
export async function listEvents(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
  params: EventListParams,
): Promise<EventListPage> {
  const empty: EventListPage = {
    events: [],
    cursor: null,
    hasMore: false,
    counts: emptyCounts(),
    totals: { events: 0, names: 0, sessions: 0, users: 0, projects: 0 },
  };
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const projectIds = selected.map((project) => project.id);
  if (projectIds.length === 0) return empty;

  const db = getDb();
  const scope = eventScope(projectIds, filters, window);
  const search = eventSearch(params.query);
  const severity = severityCondition(params.severity);
  const cursor = decodeCursor(params.cursor);
  const lastSeen = sql<Date>`max(${logEvents.timestamp})`;
  const firstSeen = sql<Date>`min(${logEvents.timestamp})`;

  const pageQuery = db
    .select({
      name: logEvents.name,
      displayName: latestDisplayName,
      events: sql<number>`count(*)::int`,
      sessions: sql<number>`(count(distinct ${logEvents.sessionId}))::int`,
      users: sql<number>`(count(distinct ${logEvents.userId}))::int`,
      projects: sql<number>`(count(distinct ${logEvents.projectId}))::int`,
      trace: severityCount('trace'),
      debug: severityCount('debug'),
      info: severityCount('info'),
      warn: severityCount('warn'),
      error: severityCount('error'),
      fatal: severityCount('fatal'),
      firstSeen,
      lastSeen,
      cursorSort: lastSeen,
      cursorId: logEvents.name,
    })
    .from(logEvents)
    .where(and(scope, search, severity))
    .groupBy(logEvents.name);
  const grouped = cursor
    ? pageQuery.having(keysetCondition(lastSeen, logEvents.name, cursor, 'timestamptz'))
    : pageQuery;

  const [severityRows, summaryRows, rows] = await Promise.all([
    db
      .select({ severity: logEvents.severity, total: sql<number>`count(*)::int` })
      .from(logEvents)
      .where(and(scope, search))
      .groupBy(logEvents.severity),
    db
      .select({
        events: sql<number>`count(*)::int`,
        names: sql<number>`(count(distinct ${logEvents.name}))::int`,
        sessions: sql<number>`(count(distinct ${logEvents.sessionId}))::int`,
        users: sql<number>`(count(distinct ${logEvents.userId}))::int`,
        projects: sql<number>`(count(distinct ${logEvents.projectId}))::int`,
      })
      .from(logEvents)
      .where(and(scope, search)),
    grouped.orderBy(desc(lastSeen), desc(logEvents.name)).limit(EVENTS_PAGE_SIZE + 1),
  ]);

  const counts = emptyCounts();
  for (const row of severityRows) {
    if (row.severity in counts) counts[row.severity as EventSeverity] = toNumber(row.total);
    counts.all += toNumber(row.total);
  }
  const summary = summaryRows[0];

  const { cursor: next, hasMore } = nextCursor(rows, EVENTS_PAGE_SIZE);
  return {
    events: rows.slice(0, EVENTS_PAGE_SIZE).map(({ cursorSort, cursorId, ...event }) => ({
      ...event,
      events: toNumber(event.events),
      sessions: toNumber(event.sessions),
      users: toNumber(event.users),
      projects: toNumber(event.projects),
      severities: {
        trace: toNumber(event.trace),
        debug: toNumber(event.debug),
        info: toNumber(event.info),
        warn: toNumber(event.warn),
        error: toNumber(event.error),
        fatal: toNumber(event.fatal),
      },
      firstSeen: toDate(event.firstSeen),
      lastSeen: toDate(event.lastSeen),
    })),
    cursor: next ? encodeCursor(next) : null,
    hasMore,
    counts,
    totals: {
      events: toNumber(summary?.events),
      names: toNumber(summary?.names),
      sessions: toNumber(summary?.sessions),
      users: toNumber(summary?.users),
      projects: toNumber(summary?.projects),
    },
  };
}

/** One event name with its severity/attribute breakdown and latest occurrences. */
export async function getEventDetail(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
  name: string,
  params: EventDetailParams,
): Promise<EventDetailView | null> {
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const projectIds = selected.map((project) => project.id);
  if (projectIds.length === 0) return null;

  const db = getDb();
  const [exists] = await db
    .select({ id: logEvents.id })
    .from(logEvents)
    .where(and(inArray(logEvents.projectId, projectIds), eq(logEvents.name, name)))
    .limit(1);
  if (!exists) return null;

  const scope = eventScope(projectIds, filters, window, name);
  const severity = severityCondition(params.severity);
  const attribute =
    params.attrKey && params.attrValue
      ? sql`${logEvents.attributes} ->> ${params.attrKey} = ${params.attrValue}`
      : undefined;
  const detailScope = and(scope, attribute) ?? scope;
  const cursor = decodeCursor(params.cursor);

  const [summaryRows, severityRows, attributeRows, occurrenceRows] = await Promise.all([
    db
      .select({
        events: sql<number>`count(*)::int`,
        sessions: sql<number>`(count(distinct ${logEvents.sessionId}))::int`,
        users: sql<number>`(count(distinct ${logEvents.userId}))::int`,
        projects: sql<number>`(count(distinct ${logEvents.projectId}))::int`,
        firstSeen: sql<Date | null>`min(${logEvents.timestamp})`,
        lastSeen: sql<Date | null>`max(${logEvents.timestamp})`,
        displayName: latestDisplayName,
      })
      .from(logEvents)
      .where(and(detailScope, severity) ?? detailScope),
    db
      .select({ severity: logEvents.severity, total: sql<number>`count(*)::int` })
      .from(logEvents)
      .where(detailScope)
      .groupBy(logEvents.severity),
    db.execute<EventAttributeValue>(sql`
      select attr.key as key, attr.value as value, count(*)::int as count
      from ${logEvents}
      cross join lateral jsonb_each_text(coalesce(${logEvents.attributes}, '{}'::jsonb)) as attr(key, value)
      where ${and(scope, severity) ?? scope}
      group by attr.key, attr.value
      order by count desc, attr.key asc, attr.value asc
      limit ${MAX_EVENT_ATTRIBUTE_ROWS}
    `),
    db
      .select({
        id: logEvents.id,
        timestamp: logEvents.timestamp,
        severity: logEvents.severity,
        body: logEvents.body,
        displayName: logEvents.displayName,
        attributes: logEvents.attributes,
        projectId: logEvents.projectId,
        projectName: projects.name,
        appVersion: logEvents.appVersion,
        appBuild: logEvents.appBuild,
        updateId: logEvents.updateId,
        platform: logEvents.platform,
        environment: logEvents.environment,
        deviceBrand: logEvents.deviceBrand,
        deviceModel: logEvents.deviceModel,
        osVersion: logEvents.osVersion,
        userId: logEvents.userId,
        sessionId: logEvents.sessionId,
        sessionRowId: sessions.id,
        cursorSort: logEvents.timestamp,
        cursorId: logEvents.id,
      })
      .from(logEvents)
      .innerJoin(projects, eq(projects.id, logEvents.projectId))
      .leftJoin(
        sessions,
        and(
          eq(sessions.projectId, logEvents.projectId),
          eq(sessions.sessionId, logEvents.sessionId),
        ),
      )
      .where(
        and(
          detailScope,
          severity,
          cursor
            ? keysetCondition(logEvents.timestamp, logEvents.id, cursor, 'timestamptz')
            : undefined,
        ),
      )
      .orderBy(desc(logEvents.timestamp), desc(logEvents.id))
      .limit(EVENT_OCCURRENCES_PAGE_SIZE + 1),
  ]);

  const summary = summaryRows[0];
  const severities = emptySeverities();
  for (const row of severityRows) {
    if (row.severity in severities) {
      severities[row.severity as EventSeverity] = toNumber(row.total);
    }
  }

  const { cursor: next, hasMore } = nextCursor(occurrenceRows, EVENT_OCCURRENCES_PAGE_SIZE);
  return {
    name,
    displayName: summary?.displayName ?? null,
    totals: {
      events: toNumber(summary?.events),
      sessions: toNumber(summary?.sessions),
      users: toNumber(summary?.users),
      projects: toNumber(summary?.projects),
      firstSeen: summary?.firstSeen ? toDate(summary.firstSeen) : null,
      lastSeen: summary?.lastSeen ? toDate(summary.lastSeen) : null,
    },
    severities,
    attributes: attributeRows.rows.map((row) => ({
      key: row.key,
      value: row.value,
      count: toNumber(row.count),
    })),
    occurrences: occurrenceRows
      .slice(0, EVENT_OCCURRENCES_PAGE_SIZE)
      .map(({ cursorSort, cursorId, ...occurrence }) => occurrence),
    cursor: next ? encodeCursor(next) : null,
    hasMore,
  };
}
