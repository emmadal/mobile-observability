import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { alertRules, metrics, projects, requests, sessions } from '@/db/schema';
import { createTestProject, db, resetDatabase, type TestProject } from '../../../test/fixtures';
import { evaluateAlerts, getFiringAlerts } from './evaluate';

let shop: TestProject;
const NOW = new Date();
const MINUTE = 60_000;

async function addSession(status: 'ok' | 'crashed', minutesAgo = 30): Promise<void> {
  await db.insert(sessions).values({
    projectId: shop.projectId,
    sessionId: randomUUID(),
    installationId: 'install-1',
    status,
    startedAt: new Date(NOW.getTime() - minutesAgo * MINUTE),
    lastSeenAt: new Date(NOW.getTime() - minutesAgo * MINUTE + MINUTE),
    platform: 'ios',
    appVersion: '1.0.0',
    appBuild: '1',
    environment: 'production',
  });
}

async function addRequest(statusCode: number, minutesAgo = 30): Promise<void> {
  await db.insert(requests).values({
    projectId: shop.projectId,
    eventId: randomUUID(),
    timestamp: new Date(NOW.getTime() - minutesAgo * MINUTE),
    installationId: 'install-1',
    method: 'GET',
    host: 'api.example.com',
    path: '/x',
    statusCode,
    durationMs: 100,
    platform: 'ios',
    appVersion: '1.0.0',
    appBuild: '1',
    environment: 'production',
  });
}

async function addRule(
  metric: 'crash_free_rate' | 'api_error_rate' | 'startup_p75',
  threshold: number,
) {
  const [rule] = await db
    .insert(alertRules)
    .values({ projectId: shop.projectId, metric, window: '24h', threshold })
    .returning({ id: alertRules.id });
  return rule?.id ?? '';
}

async function ruleById(id: string) {
  const [rule] = await db.select().from(alertRules).where(eq(alertRules.id, id));
  return rule;
}

beforeEach(async () => {
  await resetDatabase();
  shop = await createTestProject('Shop');
});

describe('alert evaluation', () => {
  it('fires a crash-free alert below the threshold and recovers', async () => {
    const ruleId = await db
      .insert(alertRules)
      .values({ projectId: shop.projectId, metric: 'crash_free_rate', window: '1h', threshold: 0.6 })
      .returning({ id: alertRules.id })
      .then((rows) => rows[0]?.id ?? '');
    await addSession('ok');
    await addSession('ok', 20);

    // 100% crash-free: above the 50% threshold.
    const first = await evaluateAlerts(db, shop.projectId, NOW);
    expect(first).toEqual([]);
    expect((await ruleById(ruleId))?.lastStatus).toBe('ok');

    // A wave of crashes drops the rate below the threshold.
    await addSession('crashed', 10);
    await addSession('crashed', 5);
    const fired = await evaluateAlerts(db, shop.projectId, new Date(NOW.getTime() + 2 * MINUTE));
    expect(fired).toEqual([{ metric: 'crash_free_rate', threshold: 0.6, value: 0.5 }]);
    const firing = await ruleById(ruleId);
    expect(firing?.lastStatus).toBe('firing');
    expect(firing?.lastFiredAt).toBeTruthy();

    // The 60 s throttle suppresses re-evaluation.
    const throttled = await evaluateAlerts(
      db,
      shop.projectId,
      new Date(NOW.getTime() + 3 * MINUTE),
    );
    expect(throttled).toEqual([]);

    // Recovery flips the status back to ok without a new fire event.
    const recovered = await evaluateAlerts(
      db,
      shop.projectId,
      new Date(NOW.getTime() + 62 * MINUTE),
    );
    expect(recovered).toEqual([]);
    expect((await ruleById(ruleId))?.lastStatus).toBe('ok');
  });

  it('evaluates api error rate and startup latency above their thresholds', async () => {
    const errorRule = await addRule('api_error_rate', 0.4);
    const launchRule = await addRule('startup_p75', 1_500);
    await addRequest(500);
    await addRequest(200);
    await db.insert(metrics).values({
      projectId: shop.projectId,
      eventId: randomUUID(),
      timestamp: new Date(NOW.getTime() - 10 * MINUTE),
      installationId: 'install-1',
      name: 'app_startup.cold_launch_time',
      valueMs: 2_000,
      platform: 'ios',
      appVersion: '1.0.0',
      appBuild: '1',
      environment: 'production',
    });

    const fired = await evaluateAlerts(db, shop.projectId, NOW);
    expect(fired).toHaveLength(2);
    expect((await ruleById(errorRule))?.lastStatus).toBe('firing');
    expect((await ruleById(launchRule))?.lastStatus).toBe('firing');
  });

  it('scopes firing alerts to the organization and skips projects without rules', async () => {
    await addRule('crash_free_rate', 0.99);
    await addSession('crashed');
    await addSession('ok', 20);
    await evaluateAlerts(db, shop.projectId, NOW);

    const firing = await getFiringAlerts(shop.organizationId);
    expect(firing).toHaveLength(1);
    expect(firing[0]).toMatchObject({ projectName: 'Shop', metric: 'crash_free_rate' });

    const outsider = await createTestProject('Outsider');
    expect(await getFiringAlerts(outsider.organizationId)).toEqual([]);

    // Projects without rules never reach the telemetry queries.
    await db.delete(projects).where(eq(projects.id, shop.projectId));
    expect(await evaluateAlerts(db, shop.projectId, NOW)).toEqual([]);
  });
});
