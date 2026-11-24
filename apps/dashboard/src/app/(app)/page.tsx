import { METRIC_TARGETS_MS } from '@mobile-observability/protocol';
import Link from 'next/link';
import { type ReactNode, Suspense } from 'react';
import { type Health, HealthBadge, PageHeader, Panel, primaryButtonClass } from '@/components/ui';
import { ErrorsChart, LaunchChart, SessionsChart } from '@/features/overview/charts';
import {
  type OverviewFilters,
  parseOverviewFilters,
  rangeLabel,
  resolveWindow,
  toSearchParams,
} from '@/features/overview/filters';
import { formatDuration, plural } from '@/features/overview/format';
import { OverviewFrame } from '@/features/overview/overview-frame';
import {
  COLD_LAUNCH_METRIC,
  getFilterOptions,
  getOverview,
  type Overview,
} from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { getOrgContext } from '@/features/projects/access';
import { ALERT_METRIC_LABELS, type AlertMetric, getFiringAlerts } from '@/server/alerts/evaluate';

export const metadata = { title: 'Overview' };

const integer = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const COLD_LAUNCH_TARGET = METRIC_TARGETS_MS[COLD_LAUNCH_METRIC];

/**
 * Overview: app health across the workspace for a time range and filters
 * carried in the URL (see features/overview/filters.ts). All reads are
 * request-time (session, then database), inside Suspense; auto-refresh
 * re-runs this render on an interval.
 */
export default function OverviewPage({ searchParams }: PageProps<'/'>) {
  return (
    <>
      <PageHeader
        title="Overview"
        description="App health across every project in this workspace."
        aside="Times in UTC"
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OverviewContent({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const context = await getOrgContext();
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const now = new Date();
  const parsed = parseOverviewFilters(await searchParams, now);
  const options = await getFilterOptions(context.organizationId);
  if (options.projects.length === 0) return <Onboarding isOwner={context.role === 'owner'} />;

  // A project id from another workspace (or a deleted one) falls back to all.
  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const timeWindow = resolveWindow(filters.range, now);
  const overview = await getOverview(options, filters, timeWindow);

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <Dashboard
        overview={overview}
        rangeName={rangeLabel(filters.range)}
        filters={filters}
        alerts={await getFiringAlerts(context.organizationId)}
      />
    </OverviewFrame>
  );
}

function crashFreeHealth(rate: number): { health: Health; label: string } {
  if (rate >= 0.995) return { health: 'good', label: 'Healthy' };
  if (rate >= 0.98) return { health: 'warning', label: 'Degraded' };
  return { health: 'critical', label: 'Critical' };
}

function formatRate(rate: number): string {
  // Keep precision where it matters: 99.95% must not round up to 100%.
  const percent = Math.floor(rate * 10_000) / 100;
  return `${percent.toFixed(percent === 100 ? 0 : 2)}%`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function timeAgo(date: Date, now: number): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

function Dashboard({
  overview,
  rangeName,
  filters,
  alerts,
}: {
  overview: Overview;
  rangeName: string;
  filters: OverviewFilters;
  alerts: {
    projectName: string;
    metric: AlertMetric;
    threshold: number;
    lastFiredAt: Date | null;
  }[];
}) {
  const now = overview.to.getTime();
  const rate = overview.crashFreeRate;
  const status = rate === null ? null : crashFreeHealth(rate);
  const launch = overview.coldLaunchP75;
  const axis = {
    bucketSeconds: overview.bucketSeconds,
    spanMs: overview.to.getTime() - overview.from.getTime(),
  };

  return (
    <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      {alerts.length > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-[10px] border border-critical/40 bg-critical/5 px-5 py-3"
        >
          <p className="text-xs font-semibold text-critical">
            {alerts.length === 1 ? '1 alert firing' : `${alerts.length} alerts firing`}
          </p>
          <ul className="flex flex-col gap-0.5 text-xs text-ink-2">
            {alerts.map((alert) => (
              <li key={`${alert.projectName}:${alert.metric}`}>
                {alert.projectName} — {ALERT_METRIC_LABELS[alert.metric]} crossed its threshold
                {alert.lastFiredAt ? ` (${timeAgo(alert.lastFiredAt, now)})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* The one loud element: crash-free share beside the sessions it comes from. */}
      <Panel className="grid grid-cols-1 gap-x-8 gap-y-4 p-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="flex flex-col justify-between gap-4 lg:border-r lg:border-line lg:pr-8">
          <div>
            <h2 className="text-sm font-semibold text-ink">Crash-free sessions</h2>
            <p className="mt-0.5 text-xs text-ink-3">{rangeName}.</p>
          </div>
          <div>
            <p className="font-wide text-hero font-semibold tracking-tight text-ink">
              {rate === null ? 'No data' : formatRate(rate)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {status && <HealthBadge health={status.health} label={status.label} />}
              <span className="text-xs text-ink-3">
                {overview.sessions === 0
                  ? 'No sessions started in this range.'
                  : `${integer.format(overview.crashedSessions)} of ${plural(overview.sessions, 'session', 'sessions')} crashed`}
              </span>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Sessions</h2>
            <p className="text-xs text-ink-3">{integer.format(overview.sessions)} started</p>
          </div>
          <SessionsChart timeline={overview.timeline} axis={axis} />
        </div>
      </Panel>

      <Panel>
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
          <Stat
            label="Error events"
            value={compact.format(overview.errors)}
            detail={plural(overview.crashes, 'crash', 'crashes')}
          />
          <Stat
            label="Log events"
            value={compact.format(overview.logEvents)}
            detail="Observe.logEvent calls"
          />
          <Stat
            label="Sessions"
            value={compact.format(overview.sessions)}
            detail="Started in this range"
          />
          <Stat
            label="Cold launch, p75"
            value={launch === null ? 'No data' : formatDuration(launch)}
            detail={`Target ${formatDuration(COLD_LAUNCH_TARGET)}`}
            badge={
              launch === null ? undefined : launch <= COLD_LAUNCH_TARGET ? (
                <HealthBadge health="good" label="On target" />
              ) : (
                <HealthBadge health="warning" label="Slow" />
              )
            }
          />
          <Stat
            label="Open issues"
            value={compact.format(overview.openIssues)}
            detail="Selected projects, any time"
          />
        </dl>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Error events"
          description={`${plural(overview.errors, 'event', 'events')}, ${plural(overview.crashes, 'crash', 'crashes')}`}
        >
          <div className="px-5 pt-3 pb-4">
            <ErrorsChart timeline={overview.timeline} axis={axis} />
          </div>
        </Panel>
        <Panel
          title="Cold launch, p75"
          description="Time from process start to the first rendered screen."
        >
          <div className="px-5 pt-3 pb-4">
            <LaunchChart timeline={overview.timeline} axis={axis} targetMs={COLD_LAUNCH_TARGET} />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Top issues" description="Most events in this range first.">
          {overview.topIssues.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
              No errors in this range. New errors from your apps are grouped here as they arrive.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <thead className="border-y border-line text-ink-3">
                  <tr>
                    <th scope="col" className="w-[62%] px-5 py-2 font-medium">
                      Issue
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Project
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Events
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.topIssues.map((issue) => (
                    <tr
                      key={issue.id}
                      className="border-b border-line last:border-b-0 hover:bg-raised/40"
                    >
                      <td className="max-w-0 px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          {issue.fatal && <HealthBadge health="critical" label="Crash" />}
                          {issue.regressed && <HealthBadge health="warning" label="Regressed" />}
                          {issue.status === 'resolved' && (
                            <HealthBadge health="good" label="Resolved" />
                          )}
                          <span className="truncate font-semibold text-ink">{issue.type}</span>
                        </div>
                        <p className="font-narrow mt-0.5 truncate text-ink-2" title={issue.message}>
                          {issue.message}
                        </p>
                        {issue.culprit && (
                          <p className="mt-0.5 truncate font-mono text-2xs text-ink-3">
                            {issue.culprit}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">
                        {issue.projectName}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                        {integer.format(issue.events)}
                      </td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap text-ink-3 tabular">
                        <time dateTime={issue.lastSeen.toISOString()}>
                          {timeAgo(issue.lastSeen, now)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Projects"
          description={`${rangeName}, per project.`}
          className="xl:self-start"
        >
          <ul className="mt-3 border-t border-line">
            {overview.projects.map((project) => {
              const projectRate =
                project.sessions > 0 ? 1 - project.crashedSessions / project.sessions : null;
              const projectStatus = projectRate === null ? null : crashFreeHealth(projectRate);
              return (
                <li key={project.id} className="border-b border-line px-5 py-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-semibold text-ink">{project.name}</span>
                    {!project.sdkEnabled ? (
                      <HealthBadge health="warning" label="SDK paused" />
                    ) : projectStatus ? (
                      <HealthBadge health={projectStatus.health} label={projectStatus.label} />
                    ) : (
                      <span className="text-2xs text-ink-3">Waiting for data</span>
                    )}
                  </div>
                  <p className="mt-1 text-2xs text-ink-3 tabular">
                    {integer.format(project.errors)} errors, {integer.format(project.sessions)}{' '}
                    sessions, {integer.format(project.openIssues)} open issues
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Top events"
        description="Observe.logEvent calls grouped by name, most frequent first."
      >
        {overview.topEvents.length === 0 ? (
          <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
            No log events in this range. Call Observe.logEvent from your app and the busiest names
            appear here.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="border-y border-line text-ink-3">
                <tr>
                  <th scope="col" className="w-[52%] px-5 py-2 font-medium">
                    Event
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Events
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Sessions
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Flagged
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.topEvents.map((event) => {
                  const query = toSearchParams(filters);
                  query.set('name', event.name);
                  return (
                    <tr
                      key={event.name}
                      className="border-b border-line last:border-b-0 hover:bg-raised/40"
                    >
                      <td className="max-w-0 px-5 py-2.5">
                        <Link
                          href={`/events/detail?${query.toString()}`}
                          className="block truncate font-mono font-semibold text-ink hover:underline"
                          title={event.name}
                        >
                          {event.name}
                        </Link>
                        {event.displayName && (
                          <p className="font-narrow mt-0.5 truncate text-2xs text-ink-2">
                            {event.displayName}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                        {integer.format(event.events)}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tabular">
                        {integer.format(event.sessions)}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                        {event.flagged > 0 ? (
                          <HealthBadge health="warning" label={integer.format(event.flagged)} />
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap text-ink-3 tabular">
                        <time dateTime={event.lastSeen.toISOString()}>
                          {timeAgo(event.lastSeen, now)}
                        </time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  badge,
}: {
  label: string;
  value: string;
  detail: string;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r max-sm:[&:nth-last-child(-n+2)]:border-b-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-xl font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
        {badge}
        {detail}
      </dd>
    </div>
  );
}

function Onboarding({ isOwner }: { isOwner: boolean }) {
  if (!isOwner) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <Panel title="No projects yet" className="max-w-2xl">
          <p className="px-5 pt-2 pb-5 text-sm text-ink-2">
            The workspace owner creates projects. Once an app sends data, its health shows up here.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="px-5 py-6 sm:px-8">
      <Panel
        title="Connect your first app"
        description="Three steps, then crashes, errors and launch times appear on this page."
        className="max-w-3xl"
      >
        <ol className="mt-4 border-t border-line">
          <Step number={1} title="Create a project">
            <p>
              Each app gets its own project, with a public ingest key and a secret upload token.
            </p>
            <Link href="/settings#projects" className={`${primaryButtonClass} mt-3`}>
              Create a project
            </Link>
          </Step>
          <Step number={2} title="Install the SDK">
            <p>
              Add the SDK to your Expo or React Native app, then configure it with the ingest key.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-night px-3 py-2 font-mono text-2xs text-ink-2">
              npx expo install @mobile-observability/react-native
            </pre>
          </Step>
          <Step number={3} title="Upload source maps in CI">
            <p>Readable stack traces need source maps. Run the CLI after each build or update.</p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-night px-3 py-2 font-mono text-2xs text-ink-2">
              npx mobs sourcemaps upload-eas --dist dist --eas-json update.json
            </pre>
          </Step>
        </ol>
      </Panel>
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-line px-5 py-4 last:border-b-0">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full border border-line-strong text-xs font-semibold text-ink-2 tabular"
      >
        {number}
      </span>
      <div className="text-xs text-ink-2">
        <h3 className="mb-1 text-sm font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-[15.5rem] motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-[6.5rem] motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-64 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
