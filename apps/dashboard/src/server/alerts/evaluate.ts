import 'server-only';

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { type Database, getDb } from '@/db/client';
import { alertRules, metrics, requests, sessions } from '@/db/schema';
import { COLD_LAUNCH_METRIC } from '@/features/overview/service';

/** Evaluations run at most this often per project: ingest stays cheap. */
export const EVALUATION_THROTTLE_MS = 60_000;

export type AlertMetric = 'crash_free_rate' | 'api_error_rate' | 'startup_p75';
export type AlertWindow = '1h' | '6h' | '24h';

const WINDOW_SECONDS: Record<AlertWindow, number> = {
  '1h': 3_600,
  '6h': 21_600,
  '24h': 86_400,
};

export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  crash_free_rate: 'Crash-free sessions',
  api_error_rate: 'API error rate',
  startup_p75: 'Cold launch P75',
};

export const ALERT_WINDOW_LABELS: Record<AlertWindow, string> = {
  '1h': 'last hour',
  '6h': 'last 6 hours',
  '24h': 'last 24 hours',
};

/** crash_free_rate fires below its threshold; rate and latency fire above. */
function isFiring(metric: AlertMetric, threshold: number, value: number): boolean {
  return metric === 'crash_free_rate' ? value < threshold : value > threshold;
}

/**
 * Evaluates every rule of a project against fresh telemetry and moves the
 * rule's status between 'ok' and 'firing'. Returns the rules that newly
 * fired, so the ingest path could notify later integrations.
 */
export async function evaluateAlerts(
  db: Database,
  projectId: string,
  now = new Date(),
): Promise<{ metric: AlertMetric; threshold: number; value: number }[]> {
  const rules = await db.select().from(alertRules).where(eq(alertRules.projectId, projectId));
  if (rules.length === 0) return [];

  // Throttle: telemetry arrives in bursts, so skip checks evaluated recently.
  const due = rules.filter(
    (rule) =>
      !rule.lastCheckedAt ||
      now.getTime() - new Date(rule.lastCheckedAt).getTime() >= EVALUATION_THROTTLE_MS,
  );
  if (due.length === 0) return [];

  const windows = [...new Set(due.map((rule) => rule.window))];

  // One aggregate query per window, shared by all rules with that window.
  const results = new Map<AlertWindow, Partial<Record<AlertMetric, number>>>();
  await Promise.all(
    windows.map(async (window) => {
      const from = new Date(now.getTime() - WINDOW_SECONDS[window] * 1000);
      const scope = and(
        eq(sessions.projectId, projectId),
        gte(sessions.startedAt, from),
        lt(sessions.startedAt, now),
      );
      const requestScope = and(
        eq(requests.projectId, projectId),
        gte(requests.timestamp, from),
        lt(requests.timestamp, now),
      );
      const launchScope = and(
        eq(metrics.projectId, projectId),
        eq(metrics.name, COLD_LAUNCH_METRIC),
        gte(metrics.timestamp, from),
        lt(metrics.timestamp, now),
      );
      const [sessionTotals, requestTotals, launchTotal] = await Promise.all([
        db
          .select({
            total: sql<number>`count(*)::int`,
            crashed: sql<number>`(count(*) filter (where ${sessions.status} = 'crashed'))::int`,
          })
          .from(sessions)
          .where(scope),
        db
          .select({
            total: sql<number>`count(*)::int`,
            errors: sql<number>`(count(*) filter (where ${requests.statusCode} >= 400 or ${requests.error} is not null))::int`,
          })
          .from(requests)
          .where(requestScope),
        db
          .select({
            p75: sql<
              number | null
            >`percentile_cont(0.75) within group (order by ${metrics.valueMs})`,
          })
          .from(metrics)
          .where(launchScope),
      ]);
      const sessionsTotal = Number(sessionTotals[0]?.total ?? 0);
      const requestsTotal = Number(requestTotals[0]?.total ?? 0);
      const p75 = launchTotal[0]?.p75;
      results.set(window, {
        crash_free_rate:
          sessionsTotal > 0
            ? 1 - Number(sessionTotals[0]?.crashed ?? 0) / sessionsTotal
            : undefined,
        api_error_rate:
          requestsTotal > 0 ? Number(requestTotals[0]?.errors ?? 0) / requestsTotal : undefined,
        startup_p75: p75 === null || p75 === undefined ? undefined : Number(p75),
      });
    }),
  );

  const newlyFired: { metric: AlertMetric; threshold: number; value: number }[] = [];
  for (const rule of due) {
    const value = results.get(rule.window)?.[rule.metric];
    const firing = value !== undefined && isFiring(rule.metric, rule.threshold, value);
    if (firing && rule.lastStatus !== 'firing') {
      newlyFired.push({
        metric: rule.metric as AlertMetric,
        threshold: rule.threshold,
        value: value as number,
      });
    }
    await db
      .update(alertRules)
      .set({
        lastStatus: firing ? 'firing' : 'ok',
        lastCheckedAt: now,
        ...(firing && rule.lastStatus !== 'firing' ? { lastFiredAt: now } : {}),
      })
      .where(eq(alertRules.id, rule.id));
  }
  return newlyFired;
}

/** Firing rules across an organization, for the Overview banner. */
export async function getFiringAlerts(
  organizationId: string,
): Promise<
  { projectName: string; metric: AlertMetric; threshold: number; lastFiredAt: Date | null }[]
> {
  const rows = await getDb().execute<{
    project_name: string;
    metric: AlertMetric;
    threshold: number;
    last_fired_at: string | null;
  }>(sql`
    select p.name as project_name, r.metric::text as metric, r.threshold, r.last_fired_at
    from alert_rules r
    join projects p on p.id = r.project_id
    where p.organization_id = ${organizationId} and r.last_status = 'firing'
    order by r.last_fired_at desc nulls last
  `);
  return rows.rows.map((row) => ({
    projectName: row.project_name,
    metric: row.metric,
    threshold: Number(row.threshold),
    lastFiredAt: row.last_fired_at ? new Date(row.last_fired_at) : null,
  }));
}
