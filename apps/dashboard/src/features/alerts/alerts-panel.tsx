import { TrashIcon } from 'lucide-react';
import { createAlertRuleAction, deleteAlertRuleAction } from '@/app/actions/alerts';
import { Panel } from '@/components/ui';
import {
  ALERT_METRIC_LABELS,
  ALERT_WINDOW_LABELS,
  type AlertMetric,
  type AlertWindow,
} from '@/server/alerts/evaluate';
import type { listAlertRules } from './service';

/** Fires when the value goes below (crash-free) or above (rate, latency). */
function direction(metric: AlertMetric): string {
  return metric === 'crash_free_rate' ? 'below' : 'above';
}

function thresholdLabel(metric: AlertMetric, threshold: number): string {
  if (metric === 'startup_p75') return `${(threshold / 1000).toFixed(1)} s`;
  return `${Math.floor(threshold * 10_000) / 100}%`;
}

/** Per-project threshold alerts, with the owner-only create and delete forms. */
export function AlertsPanel({
  rules,
  projects,
  canManage,
}: {
  rules: Awaited<ReturnType<typeof listAlertRules>>;
  projects: { id: string; name: string }[];
  canManage: boolean;
}) {
  return (
    <Panel
      title="Alerts"
      description="Thresholds evaluated as telemetry arrives; firing rules appear on the Overview."
    >
      {rules.length === 0 ? (
        <p className="px-5 pt-3 pb-4 text-sm text-ink-2">
          No alert rules yet. Create one to be warned when a project degrades.
        </p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 text-xs last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate">
                  <span className="font-medium text-ink">{rule.projectName}</span>{' '}
                  <span className="text-ink-2">
                    {ALERT_METRIC_LABELS[rule.metric]} {direction(rule.metric)}{' '}
                    {thresholdLabel(rule.metric, rule.threshold)} ·{' '}
                    {ALERT_WINDOW_LABELS[rule.window]}
                  </span>
                </p>
                <p className="mt-0.5 text-2xs text-ink-3">
                  {rule.lastStatus === 'firing' ? (
                    <span className="font-medium text-critical">
                      Firing
                      {rule.lastFiredAt
                        ? ` since ${rule.lastFiredAt.toISOString().slice(0, 16)}Z`
                        : ''}
                    </span>
                  ) : rule.lastStatus === 'ok' ? (
                    'Healthy on last check'
                  ) : (
                    'Not evaluated yet'
                  )}
                </p>
              </div>
              {canManage && (
                <form action={deleteAlertRuleAction}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <button
                    type="submit"
                    aria-label={`Delete the ${rule.projectName} ${ALERT_METRIC_LABELS[rule.metric]} alert`}
                    className="rounded p-1.5 text-ink-3 transition-colors hover:bg-raised hover:text-critical"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && projects.length > 0 && (
        <form
          action={createAlertRuleAction}
          className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4 text-xs"
        >
          <label htmlFor="alert-project" className="sr-only">
            Project
          </label>
          <select
            id="alert-project"
            name="projectId"
            className="h-8 rounded-md border border-line-strong bg-night px-2 text-xs text-ink"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <label htmlFor="alert-metric" className="sr-only">
            Metric
          </label>
          <select
            id="alert-metric"
            name="metric"
            className="h-8 rounded-md border border-line-strong bg-night px-2 text-xs text-ink"
          >
            {(Object.keys(ALERT_METRIC_LABELS) as AlertMetric[]).map((metric) => (
              <option key={metric} value={metric}>
                {ALERT_METRIC_LABELS[metric]}
              </option>
            ))}
          </select>
          <label htmlFor="alert-window" className="sr-only">
            Window
          </label>
          <select
            id="alert-window"
            name="window"
            defaultValue="1h"
            className="h-8 rounded-md border border-line-strong bg-night px-2 text-xs text-ink"
          >
            {(Object.keys(ALERT_WINDOW_LABELS) as AlertWindow[]).map((window) => (
              <option key={window} value={window}>
                {ALERT_WINDOW_LABELS[window]}
              </option>
            ))}
          </select>
          <label htmlFor="alert-threshold" className="sr-only">
            Threshold
          </label>
          <input
            id="alert-threshold"
            name="threshold"
            type="number"
            step="any"
            required
            placeholder="Threshold"
            className="h-8 w-32 rounded-md border border-line-strong bg-night px-2 text-xs text-ink placeholder:text-ink-3"
          />
          <button
            type="submit"
            className="h-8 rounded-md border border-line-strong px-3 font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            Add alert
          </button>
          <p className="w-full text-2xs text-ink-3">
            Crash-free fires below (0.99 = 99%); error rate fires above (0.05 = 5%); P75 is in
            milliseconds.
          </p>
        </form>
      )}
    </Panel>
  );
}
