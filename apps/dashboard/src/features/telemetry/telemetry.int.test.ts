import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorEvents, issues, logEvents, metrics, projects, requests, sessions } from '@/db/schema';
import { getDeviceBreakdown } from '@/features/devices/service';
import { EVENTS_PAGE_SIZE, getEventDetail, listEvents } from '@/features/events/service';
import {
  getIssueDetail,
  ISSUES_PAGE_SIZE,
  listIssues,
  setIssueStatus,
} from '@/features/issues/service';
import { listNetworkRequests, NETWORK_PAGE_SIZE } from '@/features/network/service';
import {
  type OverviewFilters,
  parseOverviewFilters,
  resolveWindow,
} from '@/features/overview/filters';
import { getFilterOptions, getOverview } from '@/features/overview/service';
import {
  getEndpointRequests,
  getNetwork,
  getScreens,
  getStartupView,
} from '@/features/performance/service';
import { getReleases } from '@/features/releases/service';
import { getSessionDetail, listSessions } from '@/features/sessions/service';
import { getUserDetail, listUsers, NO_SEGMENT, USERS_PAGE_SIZE } from '@/features/users/service';
import { createTestProject, db, resetDatabase, type TestProject } from '../../../test/fixtures';

const NOW = new Date();
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

let shop: TestProject;
let courierId: string;

interface TelemetryExtras {
  platform?: 'ios' | 'android';
  environment?: string;
  appVersion?: string;
  appBuild?: string;
  osVersion?: string;
  deviceModel?: string;
  deviceBrand?: string;
  deviceLocale?: string;
  isEmulator?: boolean;
  updateId?: string;
  userId?: string | null;
  sessionId?: string;
  routeName?: string;
}

function context(projectId: string, at: Date, overrides: TelemetryExtras = {}) {
  return {
    projectId,
    eventId: randomUUID(),
    timestamp: at,
    installationId: 'install-1',
    platform: overrides.platform ?? ('ios' as const),
    appVersion: overrides.appVersion ?? '1.0.0',
    appBuild: overrides.appBuild ?? '1',
    environment: overrides.environment ?? 'production',
    ...(overrides.sessionId === undefined ? {} : { sessionId: overrides.sessionId }),
    ...(overrides.userId === undefined ? {} : { userId: overrides.userId }),
    ...(overrides.updateId === undefined ? {} : { updateId: overrides.updateId }),
    ...(overrides.routeName === undefined ? {} : { routeName: overrides.routeName }),
    ...(overrides.osVersion === undefined ? {} : { osVersion: overrides.osVersion }),
    ...(overrides.deviceModel === undefined ? {} : { deviceModel: overrides.deviceModel }),
    ...(overrides.deviceBrand === undefined ? {} : { deviceBrand: overrides.deviceBrand }),
    ...(overrides.deviceLocale === undefined ? {} : { deviceLocale: overrides.deviceLocale }),
    ...(overrides.isEmulator === undefined ? {} : { isEmulator: overrides.isEmulator }),
  };
}

async function addIssue(
  projectId: string,
  overrides: Partial<typeof issues.$inferInsert> = {},
): Promise<string> {
  const [issue] = await db
    .insert(issues)
    .values({
      projectId,
      fingerprint: randomUUID(),
      origin: 'js',
      kind: 'exception',
      type: 'TypeError',
      message: 'boom',
      fatal: false,
      eventCount: 1,
      firstSeen: ago(60),
      lastSeen: ago(1),
      ...overrides,
    })
    .returning({ id: issues.id });
  if (!issue) throw new Error('issue not created');
  return issue.id;
}

interface ErrorExtras extends TelemetryExtras {
  fatal?: boolean;
  handled?: boolean;
  frames?: (typeof errorEvents.$inferInsert)['frames'];
  symbolicatedFrames?: (typeof errorEvents.$inferInsert)['symbolicatedFrames'];
  breadcrumbs?: (typeof errorEvents.$inferInsert)['breadcrumbs'];
  tags?: Record<string, string>;
  rawStack?: string;
}

async function addError(projectId: string, issueId: string, at: Date, overrides: ErrorExtras = {}) {
  await db.insert(errorEvents).values({
    ...context(projectId, at, overrides),
    issueId,
    origin: 'js',
    kind: 'exception',
    fatal: overrides.fatal ?? false,
    handled: overrides.handled ?? !overrides.fatal,
    type: 'TypeError',
    message: 'boom',
    frames: overrides.frames ?? [],
    symbolicatedFrames: overrides.symbolicatedFrames ?? null,
    breadcrumbs: overrides.breadcrumbs ?? [],
    rawStack: overrides.rawStack ?? null,
    tags: overrides.tags ?? null,
  });
}

async function addSession(
  projectId: string,
  at: Date,
  overrides: Omit<TelemetryExtras, 'sessionId' | 'routeName'> & {
    status?: 'ok' | 'errored' | 'crashed' | 'abnormal';
    userPhone?: string;
    userSegment?: string;
  } = {},
) {
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    ...context(projectId, at, overrides),
    sessionId,
    userPhone: overrides.userPhone ?? null,
    userSegment: overrides.userSegment ?? null,
    status: overrides.status ?? 'ok',
    startedAt: at,
    lastSeenAt: new Date(at.getTime() + 5 * MINUTE),
  });
  return sessionId;
}

async function addMetric(
  projectId: string,
  at: Date,
  name: string,
  valueMs: number,
  overrides: Record<string, unknown> = {},
) {
  await db.insert(metrics).values({
    ...context(projectId, at, overrides),
    name,
    valueMs,
  });
}

interface EventExtras extends Omit<TelemetryExtras, 'routeName'> {
  severity?: string;
  body?: string;
  displayName?: string;
  attributes?: Record<string, unknown>;
}

async function addEvent(projectId: string, at: Date, name: string, overrides: EventExtras = {}) {
  await db.insert(logEvents).values({
    ...context(projectId, at, overrides),
    name,
    severity: overrides.severity ?? 'info',
    body: overrides.body ?? null,
    displayName: overrides.displayName ?? null,
    attributes: overrides.attributes ?? null,
  });
}

async function optionsAndFilters(organizationId: string, params: Record<string, string> = {}) {
  const filters: OverviewFilters = parseOverviewFilters(params, NOW);
  const options = await getFilterOptions(organizationId);
  return { filters, options, window: resolveWindow(filters.range, NOW) };
}

beforeEach(async () => {
  await resetDatabase();
  shop = await createTestProject('Shop');
  const [courier] = await db
    .insert(projects)
    .values({ organizationId: shop.organizationId, name: 'Courier', slug: 'courier' })
    .returning({ id: projects.id });
  courierId = courier?.id ?? '';
});

describe('issues', () => {
  it('lists issues by last activity, filters by status, search and dimensions', async () => {
    const older = await addIssue(shop.projectId, {
      type: 'RangeError',
      message: 'index out of bounds',
      lastSeen: ago(30),
    });
    const newer = await addIssue(shop.projectId, {
      type: 'TypeError',
      message: 'cannot read items',
      fatal: true,
      lastSeen: ago(5),
    });
    const foreign = await addIssue(courierId, {
      type: 'NetworkError',
      message: 'timeout',
      lastSeen: ago(2),
    });
    await addError(shop.projectId, older, ago(30));
    await addError(shop.projectId, newer, ago(5), { platform: 'android' });
    await addError(courierId, foreign, ago(2));

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const page = await listIssues(options, filters, window, {
      status: 'open',
      query: null,
      cursor: null,
    });
    expect(page.issues.map((issue) => issue.id)).toEqual([foreign, newer, older]);
    expect(page.counts).toMatchObject({ open: 3, resolved: 0, ignored: 0, all: 3 });
    expect(page.issues[1]).toMatchObject({ type: 'TypeError', fatal: true, projectName: 'Shop' });

    const searched = await listIssues(options, filters, window, {
      status: 'all',
      query: 'timeout',
      cursor: null,
    });
    expect(searched.issues.map((issue) => issue.id)).toEqual([foreign]);

    const android = await optionsAndFilters(shop.organizationId, { platform: 'android' });
    const androidPage = await listIssues(android.options, android.filters, android.window, {
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(androidPage.issues.map((issue) => issue.id)).toEqual([newer]);

    const scoped = await optionsAndFilters(shop.organizationId, { project: courierId });
    const courierPage = await listIssues(scoped.options, scoped.filters, scoped.window, {
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(courierPage.issues.map((issue) => issue.id)).toEqual([foreign]);

    await setIssueStatus(shop.organizationId, older, 'resolved');
    const open = await listIssues(options, filters, window, {
      status: 'open',
      query: null,
      cursor: null,
    });
    expect(open.issues.map((issue) => issue.id)).toEqual([foreign, newer]);
    const resolved = await listIssues(options, filters, window, {
      status: 'resolved',
      query: null,
      cursor: null,
    });
    expect(resolved.issues.map((issue) => issue.id)).toEqual([older]);
  });

  it('paginates with a stable cursor', async () => {
    const rows = Array.from({ length: ISSUES_PAGE_SIZE + 5 }, (_, index) => ({
      projectId: shop.projectId,
      fingerprint: randomUUID(),
      origin: 'js' as const,
      kind: 'exception',
      type: `Error${index}`,
      message: `failure ${index}`,
      firstSeen: ago(120),
      lastSeen: ago(index + 1),
    }));
    const inserted = await db.insert(issues).values(rows).returning({ id: issues.id });
    await db.insert(errorEvents).values(
      inserted.map((issue, index) => ({
        ...context(shop.projectId, ago(index + 1)),
        issueId: issue.id,
        origin: 'js' as const,
        kind: 'exception',
        fatal: false,
        handled: true,
        type: `Error${index}`,
        message: `failure ${index}`,
        frames: [],
        breadcrumbs: [],
      })),
    );

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const first = await listIssues(options, filters, window, {
      status: 'open',
      query: null,
      cursor: null,
    });
    expect(first.issues).toHaveLength(ISSUES_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTruthy();

    const second = await listIssues(options, filters, window, {
      status: 'open',
      query: null,
      cursor: first.cursor,
    });
    expect(second.issues).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    const firstIds = new Set(first.issues.map((issue) => issue.id));
    expect(second.issues.every((issue) => !firstIds.has(issue.id))).toBe(true);
  });

  it('returns detail stats and rejects issues from another workspace', async () => {
    const issueId = await addIssue(shop.projectId, {
      firstSeen: ago(50),
      lastSeen: ago(2),
      eventCount: 3,
    });
    await addError(shop.projectId, issueId, ago(20), {
      sessionId: 'session-a',
      userId: 'user-1',
      tags: { plan: 'pro' },
      frames: [{ function: 'explode', file: 'src/a.ts', line: 4 }],
    });
    await addError(shop.projectId, issueId, ago(10), {
      sessionId: 'session-b',
      userId: 'user-1',
      appVersion: '1.1.0',
    });
    await addError(shop.projectId, issueId, ago(2), {
      sessionId: 'session-b',
      userId: 'user-2',
    });

    const detail = await getIssueDetail(shop.organizationId, issueId);
    expect(detail).not.toBeNull();
    expect(detail?.stats).toEqual({ events: 3, users: 2, sessions: 2 });
    expect(detail?.events[0]?.timestamp.getTime()).toBe(ago(2).getTime());
    expect(detail?.releases.map((release) => release.appVersion).sort()).toEqual([
      '1.0.0',
      '1.1.0',
    ]);
    expect(detail?.events[2]?.tags).toEqual({ plan: 'pro' });

    const outsider = await createTestProject('Outsider');
    expect(await getIssueDetail(outsider.organizationId, issueId)).toBeNull();
    expect(await setIssueStatus(outsider.organizationId, issueId, 'ignored')).toBe(false);
  });
});

describe('sessions', () => {
  it('lists sessions with status totals and filters', async () => {
    const ok = await addSession(shop.projectId, ago(30));
    const crashed = await addSession(shop.projectId, ago(20), { status: 'crashed' });
    const android = await addSession(shop.projectId, ago(10), {
      status: 'errored',
      platform: 'android',
      appVersion: '1.1.0',
    });
    await addSession(courierId, ago(5), { status: 'abnormal' });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId, {
      project: shop.projectId,
    });
    const all = await listSessions(options, filters, window, {
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(all.sessions.map((session) => session.sessionId)).toEqual([android, crashed, ok]);
    expect(all.counts).toMatchObject({ all: 3, ok: 1, errored: 1, crashed: 1, abnormal: 0 });

    const crashedOnly = await listSessions(options, filters, window, {
      status: 'crashed',
      query: null,
      cursor: null,
    });
    expect(crashedOnly.sessions.map((session) => session.sessionId)).toEqual([crashed]);

    const searched = await listSessions(options, filters, window, {
      status: 'all',
      query: android.slice(0, 8),
      cursor: null,
    });
    expect(searched.sessions.map((session) => session.sessionId)).toEqual([android]);

    const scoped = await optionsAndFilters(shop.organizationId, {
      platform: 'android',
      version: '1.1.0',
    });
    const androidOnly = await listSessions(scoped.options, scoped.filters, scoped.window, {
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(androidOnly.sessions.map((session) => session.sessionId)).toEqual([android]);
  });

  it('returns a session timeline scoped to its organization', async () => {
    const sessionId = await addSession(shop.projectId, ago(30), { status: 'errored' });
    const issueId = await addIssue(shop.projectId);
    await addError(shop.projectId, issueId, ago(20), { sessionId, fatal: true });
    await addMetric(shop.projectId, ago(18), 'app_startup.cold_launch_time', 1200, { sessionId });
    await db.insert(requests).values({
      ...context(shop.projectId, ago(15), { sessionId }),
      method: 'GET',
      host: 'api.example.com',
      path: '/cart',
      statusCode: 500,
      durationMs: 320,
      error: 'Server error',
    });
    await db.insert(logEvents).values({
      ...context(shop.projectId, ago(16), { sessionId }),
      name: 'checkout_started',
      severity: 'info',
      body: 'Cart has 3 items',
    });

    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId));
    expect(session).toBeDefined();
    const detail = await getSessionDetail(shop.organizationId, session?.id ?? 0);
    expect(detail?.session.sessionId).toBe(sessionId);
    expect(detail?.errors).toHaveLength(1);
    expect(detail?.errors[0]?.fatal).toBe(true);
    expect(detail?.metrics[0]).toMatchObject({
      name: 'app_startup.cold_launch_time',
      valueMs: 1200,
    });
    expect(detail?.requests[0]).toMatchObject({ path: '/cart', statusCode: 500, durationMs: 320 });
    expect(detail?.events[0]).toMatchObject({ name: 'checkout_started', severity: 'info' });

    const outsider = await createTestProject('Outsider');
    expect(await getSessionDetail(outsider.organizationId, session?.id ?? 0)).toBeNull();
    expect(await getSessionDetail(shop.organizationId, -1)).toBeNull();
  });
});

describe('events', () => {
  it('groups log events by name with counts, severity mix and filters', async () => {
    await addEvent(shop.projectId, ago(50), 'cart.checkout', {
      severity: 'info',
      sessionId: 's1',
      userId: 'u1',
    });
    await addEvent(shop.projectId, ago(30), 'cart.checkout', {
      severity: 'error',
      sessionId: 's2',
      userId: 'u1',
      body: 'payment failed',
    });
    await addEvent(shop.projectId, ago(20), 'screen.view', {
      severity: 'debug',
      sessionId: 's3',
      userId: 'u2',
      displayName: 'Screen viewed',
    });
    await addEvent(courierId, ago(10), 'cart.checkout', { severity: 'warn' });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const page = await listEvents(options, filters, window, {
      severity: 'all',
      query: null,
      cursor: null,
    });
    expect(page.events.map((event) => event.name)).toEqual(['cart.checkout', 'screen.view']);
    expect(page.events[0]).toMatchObject({
      events: 3,
      sessions: 2,
      users: 1,
      projects: 2,
      severities: { info: 1, error: 1, warn: 1, debug: 0, fatal: 0, trace: 0 },
    });
    expect(page.events[1]).toMatchObject({
      events: 1,
      sessions: 1,
      users: 1,
      projects: 1,
      displayName: 'Screen viewed',
    });
    expect(page.totals).toEqual({ events: 4, names: 2, sessions: 3, users: 2, projects: 2 });
    expect(page.counts).toMatchObject({ all: 4, info: 1, error: 1, warn: 1, debug: 1 });

    const searched = await listEvents(options, filters, window, {
      severity: 'all',
      query: 'payment',
      cursor: null,
    });
    expect(searched.events).toHaveLength(1);
    expect(searched.events[0]).toMatchObject({ name: 'cart.checkout', events: 1 });

    const errors = await listEvents(options, filters, window, {
      severity: 'error',
      query: null,
      cursor: null,
    });
    expect(errors.events.map((event) => event.name)).toEqual(['cart.checkout']);
    expect(errors.events[0]?.events).toBe(1);
    // Tab counts ignore the severity filter so users can switch back.
    expect(errors.counts.all).toBe(4);

    const scoped = await optionsAndFilters(shop.organizationId, { project: shop.projectId });
    const shopOnly = await listEvents(scoped.options, scoped.filters, scoped.window, {
      severity: 'all',
      query: null,
      cursor: null,
    });
    expect(shopOnly.events.map((event) => event.name)).toEqual(['screen.view', 'cart.checkout']);
    expect(shopOnly.events[1]).toMatchObject({ name: 'cart.checkout', events: 2, projects: 1 });

    const outsider = await createTestProject('Outsider');
    const outsiderOptions = await getFilterOptions(outsider.organizationId);
    const outsiderWindow = resolveWindow(parseOverviewFilters({}, NOW).range, NOW);
    const outsiderPage = await listEvents(
      outsiderOptions,
      parseOverviewFilters({}, NOW),
      outsiderWindow,
      { severity: 'all', query: null, cursor: null },
    );
    expect(outsiderPage.events).toEqual([]);
    expect(outsiderPage.totals.events).toBe(0);
  });

  it('paginates event groups by last activity with a stable cursor', async () => {
    const names = Array.from({ length: EVENTS_PAGE_SIZE + 3 }, (_, index) => `event.${index}`);
    for (const [index, name] of names.entries()) {
      await addEvent(shop.projectId, ago(index + 1), name, { severity: 'info' });
    }

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const first = await listEvents(options, filters, window, {
      severity: 'all',
      query: null,
      cursor: null,
    });
    expect(first.events).toHaveLength(EVENTS_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTruthy();
    expect(first.events[0]?.name).toBe('event.0');

    const second = await listEvents(options, filters, window, {
      severity: 'all',
      query: null,
      cursor: first.cursor,
    });
    expect(second.events).toHaveLength(3);
    expect(second.hasMore).toBe(false);
    const seen = new Set(first.events.map((event) => event.name));
    expect(second.events.every((event) => !seen.has(event.name))).toBe(true);
  });

  it('returns a detail view with severity counts, attributes and occurrences', async () => {
    await db.insert(sessions).values({
      ...context(shop.projectId, ago(60)),
      sessionId: 's1',
      status: 'ok',
      startedAt: ago(60),
      lastSeenAt: ago(35),
    });
    await addEvent(shop.projectId, ago(40), 'cart.checkout', {
      severity: 'info',
      sessionId: 's1',
      userId: 'u1',
      displayName: 'Checkout started',
      attributes: { plan: 'pro', items: 3 },
    });
    await addEvent(shop.projectId, ago(30), 'cart.checkout', {
      severity: 'error',
      sessionId: 's2',
      userId: 'u2',
      body: 'card declined',
      attributes: { plan: 'free' },
    });
    await addEvent(shop.projectId, ago(20), 'cart.checkout', {
      severity: 'error',
      sessionId: 's2',
      userId: 'u2',
      attributes: { plan: 'pro' },
    });
    await addEvent(courierId, ago(10), 'cart.checkout', { severity: 'fatal' });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId, {
      project: shop.projectId,
    });
    const detail = await getEventDetail(options, filters, window, 'cart.checkout', {
      severity: 'all',
      attrKey: null,
      attrValue: null,
      cursor: null,
    });
    expect(detail).not.toBeNull();
    expect(detail?.totals).toMatchObject({ events: 3, sessions: 2, users: 2, projects: 1 });
    expect(detail?.displayName).toBe('Checkout started');
    expect(detail?.severities).toMatchObject({ info: 1, error: 2, fatal: 0 });
    expect(detail?.attributes[0]).toEqual({ key: 'plan', value: 'pro', count: 2 });
    expect(detail?.attributes).toContainEqual({ key: 'plan', value: 'free', count: 1 });
    expect(detail?.attributes).toContainEqual({ key: 'items', value: '3', count: 1 });
    expect(detail?.occurrences.map((event) => event.severity)).toEqual(['error', 'error', 'info']);
    expect(detail?.occurrences[2]).toMatchObject({
      sessionId: 's1',
      projectName: 'Shop',
      displayName: 'Checkout started',
    });
    expect(detail?.occurrences[2]?.sessionRowId).toBeTypeOf('number');

    const filtered = await getEventDetail(options, filters, window, 'cart.checkout', {
      severity: 'error',
      attrKey: 'plan',
      attrValue: 'pro',
      cursor: null,
    });
    expect(filtered?.occurrences).toHaveLength(1);
    expect(filtered?.totals.events).toBe(1);
    expect(filtered?.severities).toMatchObject({ info: 1, error: 1 });
    // Attribute options stay visible for the selected severity.
    expect(filtered?.attributes).toEqual([
      { key: 'plan', value: 'free', count: 1 },
      { key: 'plan', value: 'pro', count: 1 },
    ]);

    const outsider = await createTestProject('Outsider');
    const outsiderOptions = await getFilterOptions(outsider.organizationId);
    expect(
      await getEventDetail(
        outsiderOptions,
        parseOverviewFilters({}, NOW),
        resolveWindow(parseOverviewFilters({}, NOW).range, NOW),
        'cart.checkout',
        { severity: 'all', attrKey: null, attrValue: null, cursor: null },
      ),
    ).toBeNull();
  });

  it('surfaces log event totals and top events on the overview', async () => {
    await addEvent(shop.projectId, ago(30), 'cart.checkout', {
      severity: 'error',
      sessionId: 's1',
    });
    await addEvent(shop.projectId, ago(20), 'cart.checkout', {
      severity: 'info',
      sessionId: 's2',
    });
    await addEvent(shop.projectId, ago(10), 'screen.view', { severity: 'debug' });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const overview = await getOverview(options, filters, window);
    expect(overview.logEvents).toBe(3);
    expect(overview.topEvents.map((event) => event.name)).toEqual(['cart.checkout', 'screen.view']);
    expect(overview.topEvents[0]).toMatchObject({
      events: 2,
      flagged: 1,
      sessions: 2,
    });
    expect(overview.projects[0]?.logEvents).toBe(3);
  });

  it('groups performance by device model and OS version', async () => {
    await addSession(shop.projectId, ago(50), {
      deviceModel: 'iPhone15,4',
      deviceBrand: 'Apple',
      osVersion: '18.1',
    });
    await addSession(shop.projectId, ago(40), {
      deviceModel: 'iPhone15,4',
      deviceBrand: 'Apple',
      osVersion: '18.1',
      status: 'crashed',
    });
    await addSession(shop.projectId, ago(30), {
      deviceModel: 'SM-A145F',
      deviceBrand: 'Samsung',
      osVersion: '14',
      platform: 'android',
      userId: 'u1',
    });
    await addMetric(shop.projectId, ago(20), 'app_startup.cold_launch_time', 900, {
      deviceModel: 'SM-A145F',
      deviceBrand: 'Samsung',
      osVersion: '14',
      platform: 'android',
    });
    const issueId = await addIssue(shop.projectId);
    await addError(shop.projectId, issueId, ago(10), {
      deviceModel: 'SM-A145F',
      deviceBrand: 'Samsung',
      osVersion: '14',
      platform: 'android',
    });
    // A device seen only through errors (no session row yet) is not listed.
    await addError(shop.projectId, issueId, ago(5), {
      deviceModel: 'Pixel 8',
      osVersion: '15',
      platform: 'android',
    });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const breakdown = await getDeviceBreakdown(options, filters, window);
    expect(breakdown.totalDevices).toBe(2);
    expect(breakdown.models).toBe(2);
    expect(breakdown.devices.map((device) => device.model)).toEqual(['iPhone15,4', 'SM-A145F']);
    expect(breakdown.devices[1]).toMatchObject({
      brand: 'Samsung',
      osVersion: '14',
      platform: 'android',
      sessions: 1,
      crashedSessions: 0,
      users: 1,
      errors: 1,
      coldLaunchP75: 900,
      startupSamples: 1,
    });
    expect(breakdown.devices[0]).toMatchObject({
      brand: 'Apple',
      sessions: 2,
      crashedSessions: 1,
      crashFreeRate: 0.5,
      errors: 0,
    });

    const ios = await optionsAndFilters(shop.organizationId, { platform: 'ios' });
    const iosView = await getDeviceBreakdown(ios.options, ios.filters, ios.window);
    expect(iosView.devices.map((device) => device.model)).toEqual(['iPhone15,4']);
  });
});

describe('users', () => {
  it('aggregates the session, crash and error footprint per user', async () => {
    await addSession(shop.projectId, ago(50), { userId: 'u-apple' });
    await addSession(shop.projectId, ago(30), { userId: 'u-apple', status: 'crashed' });
    await addSession(shop.projectId, ago(20), { userId: 'u-google', platform: 'android' });
    await addSession(shop.projectId, ago(40), { userId: null });
    await addSession(courierId, ago(15), { userId: 'u-apple' });
    const issueId = await addIssue(shop.projectId);
    await addError(shop.projectId, issueId, ago(10), { userId: 'u-apple' });
    await addError(shop.projectId, issueId, ago(5), { userId: 'u-apple' });
    await addEvent(shop.projectId, ago(8), 'cart.checkout', { userId: 'u-apple' });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const page = await listUsers(options, filters, window, { query: null, cursor: null });
    expect(page.totals).toEqual({
      users: 2,
      sessions: 4,
      crashedSessions: 1,
      errors: 2,
      dau: 2,
      wau: 2,
      mau: 2,
      newUsers: 2,
    });
    expect(page.users.map((user) => user.userId)).toEqual(['u-apple', 'u-google']);
    expect(page.users[0]).toMatchObject({
      sessions: 3,
      crashedSessions: 1,
      errors: 2,
      events: 1,
      projects: 2,
    });
    expect(page.users[1]).toMatchObject({ sessions: 1, crashedSessions: 0, errors: 0 });

    const searched = await listUsers(options, filters, window, {
      query: 'google',
      cursor: null,
    });
    expect(searched.users.map((user) => user.userId)).toEqual(['u-google']);

    const android = await optionsAndFilters(shop.organizationId, { platform: 'android' });
    const androidOnly = await listUsers(android.options, android.filters, android.window, {
      query: null,
      cursor: null,
    });
    expect(androidOnly.users.map((user) => user.userId)).toEqual(['u-google']);
    expect(androidOnly.totals.users).toBe(1);
  });

  it('counts users per segment, filters by segment and searches phone numbers', async () => {
    await addSession(shop.projectId, ago(50), {
      userId: 'kyc:231770000001',
      userPhone: '231770000001',
      userSegment: 'kyc',
    });
    await addSession(shop.projectId, ago(40), {
      userId: 'kyc:231770000002',
      userSegment: 'kyc',
      status: 'crashed',
    });
    await addSession(shop.projectId, ago(30), {
      userId: 'merchant:231880000003',
      userPhone: '231880000003',
      userSegment: 'merchant',
    });
    await addSession(shop.projectId, ago(20), { userId: 'legacy-7' });
    const issueId = await addIssue(shop.projectId);
    await addError(shop.projectId, issueId, ago(10), { userId: 'merchant:231880000003' });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const page = await listUsers(options, filters, window, { query: null, cursor: null });
    expect(page.segments).toEqual([
      { segment: 'kyc', users: 2, sessions: 2, crashedSessions: 1, activeLast24h: 2 },
      { segment: 'merchant', users: 1, sessions: 1, crashedSessions: 0, activeLast24h: 1 },
      { segment: null, users: 1, sessions: 1, crashedSessions: 0, activeLast24h: 1 },
    ]);
    expect(page.users.find((user) => user.userId === 'merchant:231880000003')).toMatchObject({
      phone: '231880000003',
      segment: 'merchant',
      errors: 1,
    });

    const merchants = await listUsers(options, filters, window, {
      query: null,
      cursor: null,
      segment: 'merchant',
    });
    expect(merchants.users.map((user) => user.userId)).toEqual(['merchant:231880000003']);
    expect(merchants.totals).toMatchObject({ users: 1, errors: 1, dau: 1, mau: 1 });
    // The breakdown keeps every segment so the cards stay comparable.
    expect(merchants.segments).toHaveLength(3);

    const kyc = await listUsers(options, filters, window, {
      query: null,
      cursor: null,
      segment: 'kyc',
    });
    expect(kyc.totals).toMatchObject({ users: 2, errors: 0, crashedSessions: 1 });

    const unsegmented = await listUsers(options, filters, window, {
      query: null,
      cursor: null,
      segment: NO_SEGMENT,
    });
    expect(unsegmented.users.map((user) => user.userId)).toEqual(['legacy-7']);

    const byPhone = await listUsers(options, filters, window, {
      query: '770000001',
      cursor: null,
    });
    expect(byPhone.users.map((user) => user.userId)).toEqual(['kyc:231770000001']);

    const profile = await getUserDetail(shop.organizationId, 'kyc:231770000001');
    expect(profile).toMatchObject({ phone: '231770000001', segment: 'kyc' });
  });

  it('paginates users by last activity with a stable cursor', async () => {
    for (let index = 0; index < USERS_PAGE_SIZE + 4; index += 1) {
      await addSession(shop.projectId, ago(index + 1), {
        userId: `u-${String(index).padStart(3, '0')}`,
      });
    }

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const first = await listUsers(options, filters, window, { query: null, cursor: null });
    expect(first.users).toHaveLength(USERS_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTruthy();
    expect(first.users[0]?.userId).toBe('u-000');

    const second = await listUsers(options, filters, window, {
      query: null,
      cursor: first.cursor,
    });
    expect(second.users).toHaveLength(4);
    expect(second.hasMore).toBe(false);
    const seen = new Set(first.users.map((user) => user.userId));
    expect(second.users.every((user) => !seen.has(user.userId))).toBe(true);
  });

  it('returns a user profile scoped to the organization', async () => {
    await addSession(shop.projectId, ago(50), {
      userId: 'u-apple',
      deviceBrand: 'Apple',
      deviceModel: 'iPhone15,4',
    });
    await addSession(shop.projectId, ago(10), { userId: 'u-apple', status: 'crashed' });
    await addSession(courierId, ago(5), {
      userId: 'u-apple',
      deviceBrand: 'Apple',
      deviceModel: 'iPad13,1',
    });
    const detail = await getUserDetail(shop.organizationId, 'u-apple');
    expect(detail).not.toBeNull();
    expect(detail?.sessions).toBe(3);
    expect(detail?.crashedSessions).toBe(1);
    expect(detail?.projects.map((project) => project.name).sort()).toEqual(['Courier', 'Shop']);
    expect(detail?.devices.sort()).toEqual(['Apple iPad13,1', 'Apple iPhone15,4']);

    const outsider = await createTestProject('Outsider');
    expect(await getUserDetail(outsider.organizationId, 'u-apple')).toBeNull();
    expect(await getUserDetail(shop.organizationId, 'ghost')).toBeNull();
  });
});

describe('performance', () => {
  it('computes startup percentiles, a histogram and a zero-filled series', async () => {
    for (const value of [100, 200, 300, 400, 500]) {
      await addMetric(shop.projectId, ago(50), 'app_startup.cold_launch_time', value);
    }
    await addMetric(shop.projectId, ago(40), 'app_startup.cold_launch_time', 900, {
      platform: 'android',
    });
    await addMetric(shop.projectId, ago(30), 'app_startup.warm_launch_time', 150);

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const view = await getStartupView(options, filters, window, 'app_startup.cold_launch_time');
    const selected = view.stats.find((stat) => stat.name === 'app_startup.cold_launch_time');
    expect(selected).toMatchObject({ samples: 6, p50: 350, p90: 700, p99: 880 });
    expect(view.stats.find((stat) => stat.name === 'app_startup.warm_launch_time')).toMatchObject({
      samples: 1,
      p50: 150,
    });
    expect(view.series.reduce((sum, point) => sum + point.samples, 0)).toBe(6);
    expect(view.histogram.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(6);

    const android = await optionsAndFilters(shop.organizationId, { platform: 'android' });
    const androidView = await getStartupView(
      android.options,
      android.filters,
      android.window,
      'app_startup.cold_launch_time',
    );
    expect(
      androidView.stats.find((stat) => stat.name === 'app_startup.cold_launch_time'),
    ).toMatchObject({
      samples: 1,
      p50: 900,
    });
  });

  it('sorts screens by P90 cold TTR and aggregates network endpoints', async () => {
    await addMetric(shop.projectId, ago(40), 'navigation.cold_ttr', 300, { routeName: '/home' });
    await addMetric(shop.projectId, ago(35), 'navigation.cold_ttr', 500, { routeName: '/home' });
    await addMetric(shop.projectId, ago(30), 'navigation.cold_ttr', 1200, { routeName: '/cart' });
    await addMetric(shop.projectId, ago(25), 'navigation.warm_ttr', 100, { routeName: '/home' });
    await addMetric(shop.projectId, ago(20), 'navigation.tti', 800, { routeName: '/cart' });
    await addMetric(shop.projectId, ago(15), 'navigation.cold_ttr', 100, { routeName: '/ignored' });
    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const screens = await getScreens(options, filters, window);
    expect(screens.map((screen) => screen.routeName)).toEqual(['/cart', '/home', '/ignored']);
    expect(screens[0]).toMatchObject({ coldTtrP90: 1200, ttiP90: 800, samples: 2 });
    expect(screens[1]).toMatchObject({ coldTtrP90: 480, warmTtrP90: 100, samples: 3 });

    const request = (at: Date, path: string, statusCode: number, durationMs: number) =>
      db.insert(requests).values({
        ...context(shop.projectId, at),
        method: 'GET',
        host: 'api.example.com',
        path,
        statusCode,
        durationMs,
      });
    await request(ago(30), '/cart', 200, 100);
    await request(ago(25), '/cart', 500, 300);
    await request(ago(20), '/cart', 404, 200);
    await request(ago(15), '/feed', 200, 500);

    const network = await getNetwork(options, filters, window);
    expect(network.totalRequests).toBe(4);
    expect(network.errorCount).toBe(2);
    expect(network.errorRate).toBeCloseTo(0.5);
    expect(network.p50Ms).toBe(250);
    expect(network.statuses).toEqual({ '2xx': 2, '4xx': 1, '5xx': 1 });
    expect(network.rows.map((row) => `${row.method} ${row.path}`)).toEqual([
      'GET /feed',
      'GET /cart',
    ]);
    expect(network.rows[1]).toMatchObject({
      requests: 3,
      errorCount: 2,
      p50Ms: 200,
      p90Ms: 280,
      p95Ms: 290,
    });
    // Recent requests are the latest individual calls, newest first.
    expect(network.recent).toHaveLength(4);
    expect(network.recent[0]).toMatchObject({
      projectName: 'Shop',
      errorMessage: null,
      responseBody: null,
    });
    expect(network.recent[0]).toMatchObject({ path: '/feed', statusCode: 200, durationMs: 500 });
    expect(network.recent.map((row) => row.timestamp.getTime())).toEqual([
      ago(15).getTime(),
      ago(20).getTime(),
      ago(25).getTime(),
      ago(30).getTime(),
    ]);
  });

  it('lists the traces of one endpoint with their failure details and user', async () => {
    const sessionId = await addSession(shop.projectId, ago(60), {
      userId: 'kyc:231770000001',
      userPhone: '231770000001',
      userSegment: 'kyc',
    });
    const request = (at: Date, statusCode: number, extra: Record<string, unknown> = {}) =>
      db.insert(requests).values({
        ...context(shop.projectId, at, { sessionId }),
        method: 'POST',
        host: 'api.example.com',
        path: '/login',
        statusCode,
        durationMs: 120,
        ...extra,
      });
    await request(ago(30), 200);
    await request(ago(20), 401, { responseBody: '{"message":"Invalid PIN"}' });
    await request(ago(10), 0, { error: 'timeout', errorMessage: 'The request timed out.' });
    await db.insert(requests).values({
      ...context(shop.projectId, ago(5)),
      method: 'GET',
      host: 'api.example.com',
      path: '/other',
      statusCode: 500,
      durationMs: 10,
    });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const endpoint = { method: 'POST', host: 'api.example.com', path: '/login' };
    const all = await getEndpointRequests(options, filters, window, endpoint, false);
    expect(all.map((row) => row.statusCode)).toEqual([0, 401, 200]);
    expect(all[0]).toMatchObject({
      error: 'timeout',
      errorMessage: 'The request timed out.',
      userId: 'kyc:231770000001',
      userPhone: '231770000001',
      sessionId,
    });
    expect(all[0]?.sessionRowId).toEqual(expect.any(Number));

    const failed = await getEndpointRequests(options, filters, window, endpoint, true);
    expect(failed.map((row) => row.statusCode)).toEqual([0, 401]);
    expect(failed[1]?.responseBody).toBe('{"message":"Invalid PIN"}');

    // Another workspace's filter options never reach this workspace's requests.
    const other = await createTestProject('Elsewhere');
    const foreign = await optionsAndFilters(other.organizationId);
    expect(
      await getEndpointRequests(foreign.options, foreign.filters, foreign.window, endpoint, false),
    ).toEqual([]);
  });
});

describe('network', () => {
  it('lists requests per segment with msisdn, URL called and what the API answered', async () => {
    const kya = await addSession(shop.projectId, ago(120), {
      userId: 'kya:231770000001',
      userPhone: '231770000001',
      userSegment: 'kya',
    });
    const merchant = await addSession(courierId, ago(120), {
      userId: 'merchant:231880000002',
      userPhone: '231880000002',
      userSegment: 'merchant',
    });
    const anonymous = await addSession(shop.projectId, ago(120));
    const request = (
      projectId: string,
      sessionId: string,
      at: Date,
      statusCode: number,
      extra: Record<string, unknown> = {},
    ) =>
      db.insert(requests).values({
        ...context(projectId, at, { sessionId }),
        method: 'POST',
        host: 'api.example.com',
        path: '/agents/:id',
        statusCode,
        durationMs: 100 + statusCode / 10,
        ...extra,
      });
    await request(shop.projectId, kya, ago(50), 200, {
      url: 'https://api.example.com/agents/42?lang=en',
      contentType: 'application/json',
      responseBody: '{"status":false,"message":"Agent suspended"}',
    });
    await request(shop.projectId, kya, ago(40), 422, {
      responseBody: '{"message":"MSISDN already registered"}',
    });
    await request(courierId, merchant, ago(30), 0, { error: 'timeout' });
    await request(courierId, merchant, ago(20), 201);
    await request(shop.projectId, anonymous, ago(10), 200);

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const all = await listNetworkRequests(options, filters, window, {
      segment: null,
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(all.requests.map((row) => row.statusCode)).toEqual([200, 201, 0, 422, 200]);
    expect(all.segments).toEqual([
      { segment: 'kya', requests: 2, failed: 1, users: 1 },
      { segment: 'merchant', requests: 2, failed: 1, users: 1 },
      { segment: null, requests: 1, failed: 0, users: 0 },
    ]);
    expect(all.stats).toMatchObject({
      requests: 5,
      failed: 2,
      apiErrors: 1,
      networkFailures: 1,
      ok: 3,
      users: 2,
    });
    const oldest = all.requests.at(-1);
    expect(oldest).toMatchObject({
      url: 'https://api.example.com/agents/42?lang=en',
      contentType: 'application/json',
      responseBody: '{"status":false,"message":"Agent suspended"}',
      userPhone: '231770000001',
      userSegment: 'kya',
      projectName: 'Shop',
    });

    const kyaOnly = await listNetworkRequests(options, filters, window, {
      segment: 'kya',
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(kyaOnly.requests.map((row) => row.userSegment)).toEqual(['kya', 'kya']);
    expect(kyaOnly.stats.requests).toBe(2);

    const noSegment = await listNetworkRequests(options, filters, window, {
      segment: NO_SEGMENT,
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(noSegment.requests).toHaveLength(1);

    const failures = await listNetworkRequests(options, filters, window, {
      segment: 'merchant',
      status: 'network',
      query: null,
      cursor: null,
    });
    expect(failures.requests.map((row) => row.error)).toEqual(['timeout']);
    // The outcome filter narrows the list, not the totals its chips show.
    expect(failures.stats.requests).toBe(2);

    const byPhone = await listNetworkRequests(options, filters, window, {
      segment: null,
      status: 'all',
      query: '231880',
      cursor: null,
    });
    expect(byPhone.requests.map((row) => row.userSegment)).toEqual(['merchant', 'merchant']);
    const byUrl = await listNetworkRequests(options, filters, window, {
      segment: null,
      status: 'all',
      query: 'lang=en',
      cursor: null,
    });
    expect(byUrl.requests).toHaveLength(1);

    // Another workspace never sees these requests.
    const other = await createTestProject('Elsewhere');
    const foreign = await optionsAndFilters(other.organizationId);
    const empty = await listNetworkRequests(foreign.options, foreign.filters, foreign.window, {
      segment: null,
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(empty.requests).toEqual([]);
    expect(empty.segments).toEqual([]);
  });

  it('pages through requests newest first', async () => {
    const sessionId = await addSession(shop.projectId, ago(600), { userSegment: 'ftth' });
    await db.insert(requests).values(
      Array.from({ length: NETWORK_PAGE_SIZE + 5 }, (_, index) => ({
        ...context(shop.projectId, ago(index + 1), { sessionId }),
        method: 'GET',
        host: 'api.example.com',
        path: '/plans',
        statusCode: 200,
        durationMs: 50,
      })),
    );
    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const first = await listNetworkRequests(options, filters, window, {
      segment: 'ftth',
      status: 'all',
      query: null,
      cursor: null,
    });
    expect(first.requests).toHaveLength(NETWORK_PAGE_SIZE);
    expect(first.cursor).toEqual(expect.any(String));
    const second = await listNetworkRequests(options, filters, window, {
      segment: 'ftth',
      status: 'all',
      query: null,
      cursor: first.cursor,
    });
    expect(second.requests).toHaveLength(5);
    expect(second.cursor).toBeNull();
    const firstIds = new Set(first.requests.map((row) => row.id));
    expect(second.requests.some((row) => firstIds.has(row.id))).toBe(false);
  });
});

describe('releases', () => {
  it('merges sessions, errors and cold launch per release', async () => {
    await addSession(shop.projectId, ago(50), { appVersion: '1.0.0', userId: 'u1' });
    await addSession(shop.projectId, ago(40), { appVersion: '1.0.0' });
    await addSession(shop.projectId, ago(30), {
      appVersion: '1.1.0',
      status: 'crashed',
      userId: 'u2',
    });
    const issueOne = await addIssue(shop.projectId);
    await addError(shop.projectId, issueOne, ago(20), { appVersion: '1.0.0' });
    await addError(shop.projectId, issueOne, ago(15), { appVersion: '1.1.0', fatal: true });
    await addMetric(shop.projectId, ago(10), 'app_startup.cold_launch_time', 800, {
      appVersion: '1.0.0',
    });
    await addMetric(shop.projectId, ago(8), 'app_startup.cold_launch_time', 2000, {
      appVersion: '1.1.0',
    });

    const { options, filters, window } = await optionsAndFilters(shop.organizationId);
    const view = await getReleases(options, filters, window);
    expect(view.releases).toHaveLength(2);
    const next = view.releases.find((release) => release.appVersion === '1.1.0');
    const stable = view.releases.find((release) => release.appVersion === '1.0.0');
    expect(next).toMatchObject({
      sessions: 1,
      crashedSessions: 1,
      crashFreeRate: 0,
      errors: 1,
      crashes: 1,
      coldLaunchP75: 2000,
      startupSamples: 1,
      users: 1,
      crashedUsers: 1,
      crashFreeUsers: 0,
      adoptionRate: 1 / 3,
    });
    expect(stable).toMatchObject({
      sessions: 2,
      crashedSessions: 0,
      crashFreeRate: 1,
      errors: 1,
      coldLaunchP75: 800,
      users: 1,
      crashedUsers: 0,
      crashFreeUsers: 1,
      adoptionRate: 2 / 3,
    });
    expect(view.totals).toMatchObject({
      releases: 2,
      sessions: 3,
      crashedSessions: 1,
      errors: 2,
      crashes: 1,
    });
    expect(view.totals.crashFreeRate).toBeCloseTo(2 / 3);
  });
});
