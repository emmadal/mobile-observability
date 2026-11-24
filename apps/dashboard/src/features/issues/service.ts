import 'server-only';

import type { Breadcrumb, Frame } from '@mobile-observability/protocol';
import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { getDb } from '@/db/client';
import { errorEvents, issues, projects } from '@/db/schema';
import type { OverviewFilters, PlatformKey, ResolvedWindow } from '@/features/overview/filters';
import type { FilterOptions } from '@/features/overview/service';
import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from '@/server/db/keyset';

export const ISSUES_PAGE_SIZE = 25;
export const ISSUE_STATUS_FILTERS = ['open', 'resolved', 'ignored', 'all'] as const;
export type IssueStatusFilter = (typeof ISSUE_STATUS_FILTERS)[number];
export const DEFAULT_ISSUE_STATUS: IssueStatusFilter = 'open';
export const MAX_SEARCH_LENGTH = 64;

export interface IssueListParams {
  status: IssueStatusFilter;
  /** Substring matched against type, message and culprit. */
  query: string | null;
  cursor: string | null;
}

export interface IssueListItem {
  id: string;
  projectId: string;
  projectName: string;
  type: string;
  message: string;
  culprit: string | null;
  origin: 'js' | 'native';
  kind: string;
  status: 'open' | 'resolved' | 'ignored';
  fatal: boolean;
  regressed: boolean;
  eventCount: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface IssueListPage {
  issues: IssueListItem[];
  cursor: string | null;
  hasMore: boolean;
  counts: Record<IssueStatusFilter, number>;
}

/** Only issues with at least one event inside the window and dimension filters. */
function issueScope(
  projectIds: string[],
  filters: Pick<OverviewFilters, 'platform' | 'environment' | 'version'>,
  window: ResolvedWindow,
): SQL | undefined {
  if (projectIds.length === 0) return undefined;
  const eventConditions: (SQL | undefined)[] = [
    eq(errorEvents.issueId, issues.id),
    inArray(errorEvents.projectId, projectIds),
    gte(errorEvents.timestamp, window.from),
    lt(errorEvents.timestamp, window.to),
  ];
  if (filters.platform)
    eventConditions.push(eq(errorEvents.platform, filters.platform as PlatformKey));
  if (filters.environment) eventConditions.push(eq(errorEvents.environment, filters.environment));
  if (filters.version) eventConditions.push(eq(errorEvents.appVersion, filters.version));

  return and(
    inArray(issues.projectId, projectIds),
    exists(
      getDb()
        .select({ one: sql`1` })
        .from(errorEvents)
        .where(and(...eventConditions)),
    ),
  );
}

/** Escapes the LIKE wildcards so a search for "50%" is literal. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

function searchCondition(query: string | null): SQL | undefined {
  if (!query) return undefined;
  const pattern = likePattern(query);
  return or(
    ilike(issues.type, pattern),
    ilike(issues.message, pattern),
    ilike(issues.culprit, pattern),
  );
}

/** One page of issues, newest activity first, with per-status totals for the tabs. */
export async function listIssues(
  options: FilterOptions,
  filters: OverviewFilters,
  window: ResolvedWindow,
  params: IssueListParams,
): Promise<IssueListPage> {
  const empty: IssueListPage = {
    issues: [],
    cursor: null,
    hasMore: false,
    counts: { open: 0, resolved: 0, ignored: 0, all: 0 },
  };
  const selected = filters.project
    ? options.projects.filter((project) => project.id === filters.project)
    : options.projects;
  const projectIds = selected.map((project) => project.id);
  if (projectIds.length === 0) return empty;

  const db = getDb();
  const scope = issueScope(projectIds, filters, window);
  const search = searchCondition(params.query);
  const statusCondition = params.status === 'all' ? undefined : eq(issues.status, params.status);
  const cursor = decodeCursor(params.cursor);

  const countRows = await db
    .select({ status: issues.status, total: count() })
    .from(issues)
    .where(and(scope, search))
    .groupBy(issues.status);
  const counts: Record<IssueStatusFilter, number> = {
    open: 0,
    resolved: 0,
    ignored: 0,
    all: 0,
  };
  for (const row of countRows) {
    counts[row.status] = Number(row.total);
    counts.all += Number(row.total);
  }

  const rows = await db
    .select({
      id: issues.id,
      projectId: issues.projectId,
      projectName: projects.name,
      type: issues.type,
      message: issues.message,
      culprit: issues.culprit,
      origin: issues.origin,
      kind: issues.kind,
      status: issues.status,
      fatal: issues.fatal,
      regressed: issues.regressed,
      eventCount: issues.eventCount,
      firstSeen: issues.firstSeen,
      lastSeen: issues.lastSeen,
      cursorSort: issues.lastSeen,
      cursorId: issues.id,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(
      and(
        scope,
        search,
        statusCondition,
        cursor ? keysetCondition(issues.lastSeen, issues.id, cursor, 'timestamptz') : undefined,
      ),
    )
    .orderBy(desc(issues.lastSeen), desc(issues.id))
    .limit(ISSUES_PAGE_SIZE + 1);

  const { cursor: next, hasMore } = nextCursor(rows, ISSUES_PAGE_SIZE);
  return {
    issues: rows.slice(0, ISSUES_PAGE_SIZE).map(({ cursorSort, cursorId, ...issue }) => issue),
    cursor: next ? encodeCursor(next) : null,
    hasMore,
    counts,
  };
}

export interface IssueDetail {
  id: string;
  projectId: string;
  projectName: string;
  fingerprint: string;
  origin: 'js' | 'native';
  kind: string;
  type: string;
  message: string;
  culprit: string | null;
  status: 'open' | 'resolved' | 'ignored';
  regressed: boolean;
  fatal: boolean;
  eventCount: number;
  firstSeen: Date;
  lastSeen: Date;
  resolvedAt: Date | null;
}

export interface IssueStats {
  events: number;
  users: number;
  sessions: number;
}

export interface IssueRelease {
  appVersion: string;
  appBuild: string;
  events: number;
  lastSeen: Date;
}

export interface IssueEvent {
  id: number;
  timestamp: Date;
  fatal: boolean;
  handled: boolean;
  appVersion: string;
  appBuild: string;
  updateId: string | null;
  platform: 'ios' | 'android';
  environment: string;
  osVersion: string | null;
  deviceBrand: string | null;
  deviceModel: string | null;
  userId: string | null;
  sessionId: string | null;
  routeName: string | null;
  tags: Record<string, string> | null;
  frames: Frame[];
  symbolicatedFrames: Frame[] | null;
  breadcrumbs: Breadcrumb[];
  rawStack: string | null;
}

export interface IssueDetailView {
  issue: IssueDetail;
  stats: IssueStats;
  releases: IssueRelease[];
  events: IssueEvent[];
}

/** One issue belonging to the visitor's organization, or null (also cross-org). */
export async function getIssueDetail(
  organizationId: string,
  issueId: string,
): Promise<IssueDetailView | null> {
  const db = getDb();
  const [issue] = await db
    .select({
      id: issues.id,
      projectId: issues.projectId,
      projectName: projects.name,
      fingerprint: issues.fingerprint,
      origin: issues.origin,
      kind: issues.kind,
      type: issues.type,
      message: issues.message,
      culprit: issues.culprit,
      status: issues.status,
      regressed: issues.regressed,
      fatal: issues.fatal,
      eventCount: issues.eventCount,
      firstSeen: issues.firstSeen,
      lastSeen: issues.lastSeen,
      resolvedAt: issues.resolvedAt,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(issues.id, issueId), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!issue) return null;

  const [statsRows, releases, events] = await Promise.all([
    db
      .select({
        events: sql<number>`count(*)::int`,
        users: sql<number>`count(distinct ${errorEvents.userId})::int`,
        sessions: sql<number>`count(distinct ${errorEvents.sessionId})::int`,
      })
      .from(errorEvents)
      .where(eq(errorEvents.issueId, issue.id)),
    db
      .select({
        appVersion: errorEvents.appVersion,
        appBuild: errorEvents.appBuild,
        events: sql<number>`count(*)::int`,
        lastSeen: sql<Date>`max(${errorEvents.timestamp})`,
      })
      .from(errorEvents)
      .where(eq(errorEvents.issueId, issue.id))
      .groupBy(errorEvents.appVersion, errorEvents.appBuild)
      .orderBy(desc(sql`max(${errorEvents.timestamp})`))
      .limit(10),
    db
      .select({
        id: errorEvents.id,
        timestamp: errorEvents.timestamp,
        fatal: errorEvents.fatal,
        handled: errorEvents.handled,
        appVersion: errorEvents.appVersion,
        appBuild: errorEvents.appBuild,
        updateId: errorEvents.updateId,
        platform: errorEvents.platform,
        environment: errorEvents.environment,
        osVersion: errorEvents.osVersion,
        deviceBrand: errorEvents.deviceBrand,
        deviceModel: errorEvents.deviceModel,
        userId: errorEvents.userId,
        sessionId: errorEvents.sessionId,
        routeName: errorEvents.routeName,
        tags: errorEvents.tags,
        frames: errorEvents.frames,
        symbolicatedFrames: errorEvents.symbolicatedFrames,
        breadcrumbs: errorEvents.breadcrumbs,
        rawStack: errorEvents.rawStack,
      })
      .from(errorEvents)
      .where(eq(errorEvents.issueId, issue.id))
      .orderBy(desc(errorEvents.timestamp), desc(errorEvents.id))
      .limit(25),
  ]);

  const [stats] = statsRows;
  return {
    issue,
    stats: {
      events: Number(stats?.events ?? 0),
      users: Number(stats?.users ?? 0),
      sessions: Number(stats?.sessions ?? 0),
    },
    releases: releases.map((release) => ({
      ...release,
      events: Number(release.events),
      lastSeen: new Date(release.lastSeen),
    })),
    events,
  };
}

/**
 * Resolves, ignores or reopens an issue. Returns false when the issue is not
 * part of the organization, so a crafted id cannot touch another workspace.
 */
export async function setIssueStatus(
  organizationId: string,
  issueId: string,
  status: 'open' | 'resolved' | 'ignored',
): Promise<boolean> {
  const db = getDb();
  const [owned] = await db
    .select({ id: issues.id })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(issues.id, issueId), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!owned) return false;

  await db
    .update(issues)
    .set({
      status,
      resolvedAt: status === 'resolved' ? new Date() : null,
      regressed: false,
    })
    .where(eq(issues.id, owned.id));
  return true;
}
