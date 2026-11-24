import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { alertRules, projects } from '@/db/schema';
import type { AlertMetric, AlertWindow } from '@/server/alerts/evaluate';

export interface AlertRuleRow {
  id: string;
  projectId: string;
  projectName: string;
  metric: AlertMetric;
  window: AlertWindow;
  threshold: number;
  lastStatus: 'firing' | 'ok' | null;
  lastFiredAt: Date | null;
}

/** Every rule of the workspace, for the Settings management panel. */
export async function listAlertRules(organizationId: string): Promise<AlertRuleRow[]> {
  const rows = await getDb()
    .select({
      id: alertRules.id,
      projectId: alertRules.projectId,
      projectName: projects.name,
      metric: alertRules.metric,
      window: alertRules.window,
      threshold: alertRules.threshold,
      lastStatus: alertRules.lastStatus,
      lastFiredAt: alertRules.lastFiredAt,
    })
    .from(alertRules)
    .innerJoin(projects, eq(projects.id, alertRules.projectId))
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.name), asc(alertRules.createdAt));
  return rows.map((row) => ({
    ...row,
    metric: row.metric as AlertMetric,
    window: row.window as AlertWindow,
    lastStatus: (row.lastStatus as 'firing' | 'ok' | null) ?? null,
    lastFiredAt: row.lastFiredAt ? new Date(row.lastFiredAt) : null,
  }));
}
