import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorEvents, issues, metrics, projects, sessions } from '@/db/schema';
import { createTestProject, db, resetDatabase, type TestProject } from '../../../test/fixtures';
import { type OverviewFilters, parseOverviewFilters, resolveWindow } from './filters';
import { COLD_LAUNCH_METRIC, getFilterOptions, getOverview } from './service';

const NOW = new Date();
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

let shop: TestProject;
let otherProjectId: string;

interface Context {
  platform?: 'ios' | 'android';
  environment?: string;
  appVersion?: string;
}

function context(projectId: string, at: Date, overrides: Context = {}) {
  return {
    projectId,
    eventId: randomUUID(),
    timestamp: at,
    installationId: 'install-1',
    platform: overrides.platform ?? 'ios',
    appVersion: overrides.appVersion ?? '1.0.0',
    appBuild: '1',
    environment: overrides.environment ?? 'production',
  } as const;
}

async function addIssue(projectId: string, fatal = false): Promise<string> {
  const [issue] = await db
    .insert(issues)
    .values({
      projectId,
      fingerprint: randomUUID(),
      origin: 'js',
      kind: 'exception',
      type: fatal ? 'FatalError' : 'TypeError',
      message: 'boom',
      fatal,
      eventCount: 1,
      firstSeen: ago(60),
      lastSeen: ago(1),
    })
    .returning({ id: issues.id });
  if (!issue) throw new Error('issue not created');
  return issue.id;
}

async function addError(
  projectId: string,
  issueId: string,
  at: Date,
  fatal = false,
  overrides: Context = {},
) {
  await db.insert(errorEvents).values({
    ...context(projectId, at, overrides),
    issueId,
    origin: 'js',
    kind: 'exception',
    fatal,
    handled: !fatal,
    type: 'TypeError',
    message: 'boom',
    frames: [],
    breadcrumbs: [],
  });
}

async function addSession(projectId: string, at: Date, crashed = false, overrides: Context = {}) {
  const { eventId, timestamp, ...rest } = context(projectId, at, overrides);
  await db.insert(sessions).values({
    ...rest,
    sessionId: eventId,
    status: crashed ? 'crashed' : 'ok',
    startedAt: timestamp,
    lastSeenAt: timestamp,
  });
}

async function addLaunch(projectId: string, at: Date, valueMs: number, overrides: Context = {}) {
  await db
    .insert(metrics)
    .values({ ...context(projectId, at, overrides), name: COLD_LAUNCH_METRIC, valueMs });
}

async function overviewFor(organizationId: string, params: Record<string, string> = {}) {
  const filters: OverviewFilters = parseOverviewFilters(params, NOW);
  const options = await getFilterOptions(organizationId);
  return {
    options,
    overview: await getOverview(options, filters, resolveWindow(filters.range, NOW)),
  };
}

beforeEach(async () => {
  await resetDatabase();
  shop = await createTestProject('Shop');
  const [other] = await db
    .insert(projects)
    .values({ organizationId: shop.organizationId, name: 'Courier', slug: 'courier' })
    .returning({ id: projects.id });
  otherProjectId = other?.id ?? '';

  const typeError = await addIssue(shop.projectId);
  const crash = await addIssue(shop.projectId, true);
  await addError(shop.projectId, typeError, ago(10));
  await addError(shop.projectId, typeError, ago(20), false, { platform: 'android' });
  await addError(shop.projectId, crash, ago(30), true, { appVersion: '1.1.0' });
  // Outside the last hour, inside the last 24 hours.
  await addError(shop.projectId, typeError, ago(300), false, { environment: 'staging' });

  await addSession(shop.projectId, ago(5));
  await addSession(shop.projectId, ago(15), false, { platform: 'android' });
  await addSession(shop.projectId, ago(25), true, { appVersion: '1.1.0' });
  await addSession(otherProjectId, ago(35));

  await addLaunch(shop.projectId, ago(5), 800);
  await addLaunch(shop.projectId, ago(6), 1200);
  await addLaunch(shop.projectId, ago(7), 2000, { platform: 'android' });
});

describe('getOverview', () => {
  it('totals the selected window across every project', async () => {
    const { overview } = await overviewFor(shop.organizationId, { range: '1h' });
    expect(overview.errors).toBe(3);
    expect(overview.crashes).toBe(1);
    expect(overview.sessions).toBe(4);
    expect(overview.crashedSessions).toBe(1);
    expect(overview.crashFreeRate).toBeCloseTo(0.75);
    expect(overview.coldLaunchP75).toBe(1600);
    expect(overview.openIssues).toBe(2);
    expect(overview.projects.map((project) => project.name)).toEqual(['Shop', 'Courier']);
    expect(overview.topIssues[0]).toMatchObject({ type: 'TypeError', events: 2 });

    const wider = await overviewFor(shop.organizationId, { range: '24h' });
    expect(wider.overview.errors).toBe(4);
  });

  it('buckets the timeline and zero-fills empty buckets', async () => {
    const { overview } = await overviewFor(shop.organizationId, { range: '1h' });
    expect(overview.bucketSeconds).toBe(60);
    expect(overview.timeline.length).toBe(61);
    const totals = overview.timeline.reduce(
      (sum, bucket) => ({
        errors: sum.errors + bucket.errors,
        crashes: sum.crashes + bucket.crashes,
        sessions: sum.sessions + bucket.sessions,
        launches: sum.launches + bucket.coldLaunchSamples,
      }),
      { errors: 0, crashes: 0, sessions: 0, launches: 0 },
    );
    expect(totals).toEqual({ errors: 3, crashes: 1, sessions: 4, launches: 3 });
    expect(overview.timeline.filter((bucket) => bucket.coldLaunchP75 !== null)).toHaveLength(3);
  });

  it('applies the platform, environment and version filters', async () => {
    const android = await overviewFor(shop.organizationId, { range: '24h', platform: 'android' });
    expect(android.overview.errors).toBe(1);
    expect(android.overview.sessions).toBe(1);
    expect(android.overview.coldLaunchP75).toBe(2000);

    const staging = await overviewFor(shop.organizationId, { range: '24h', env: 'staging' });
    expect(staging.overview.errors).toBe(1);
    expect(staging.overview.sessions).toBe(0);
    expect(staging.overview.crashFreeRate).toBeNull();

    const version = await overviewFor(shop.organizationId, { range: '24h', version: '1.1.0' });
    expect(version.overview.crashes).toBe(1);
    expect(version.overview.crashedSessions).toBe(1);
  });

  it('scopes to one project, and ignores a project from another workspace', async () => {
    const courier = await overviewFor(shop.organizationId, { project: otherProjectId });
    expect(courier.overview.projects.map((project) => project.name)).toEqual(['Courier']);
    expect(courier.overview.sessions).toBe(1);
    expect(courier.overview.errors).toBe(0);

    const outsider = await createTestProject('Outsider');
    const foreign = await overviewFor(outsider.organizationId, { project: shop.projectId });
    expect(foreign.overview.projects).toEqual([]);
    expect(foreign.overview.errors).toBe(0);
  });
});

describe('getFilterOptions', () => {
  it('lists projects, environments and recent versions of the workspace', async () => {
    const options = await getFilterOptions(shop.organizationId);
    expect(options.projects.map((project) => project.name)).toEqual(['Shop', 'Courier']);
    expect(options.environments).toEqual(['production', 'staging']);
    expect(options.versions.sort()).toEqual(['1.0.0', '1.1.0']);
  });
});
