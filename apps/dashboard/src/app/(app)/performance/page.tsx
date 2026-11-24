import type { StartupMetricName } from '@mobile-observability/protocol';
import Link from 'next/link';
import { Suspense } from 'react';
import { HealthBadge, PageHeader, Panel } from '@/components/ui';
import {
  parseOverviewFilters,
  rangeLabel,
  resolveWindow,
  toSearchParams,
} from '@/features/overview/filters';
import { formatDuration } from '@/features/overview/format';
import { OverviewFrame } from '@/features/overview/overview-frame';
import { getFilterOptions } from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { StartupHistogram, StartupSeriesChart } from '@/features/performance/charts';
import {
  getNetwork,
  getScreens,
  getStartupView,
  isStartupMetric,
  METRIC_LABELS,
  type MetricStats,
  type NetworkView,
  type RecentRequest,
  type StatusCodeClass,
} from '@/features/performance/service';
import { getOrgContext } from '@/features/projects/access';
import { formatCount, formatDateTime, formatPercent, timeAgo } from '@/features/telemetry/format';

export const metadata = { title: 'Performance' };

const TABS = [
  { key: 'startup', label: 'Startup' },
  { key: 'screens', label: 'Screens' },
  { key: 'network', label: 'Network' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
const DEFAULT_TAB: TabKey = 'startup';

const DEFAULT_METRIC: StartupMetricName = 'app_startup.cold_launch_time';

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed || undefined;
}

function parseTab(params: SearchParams): TabKey {
  const tab = single(params.tab);
  return TABS.some((item) => item.key === tab) ? (tab as TabKey) : DEFAULT_TAB;
}

function queryFor(
  filters: ReturnType<typeof parseOverviewFilters>,
  extra: Record<string, string | null | undefined>,
): string {
  const query = toSearchParams(filters);
  for (const [key, value] of Object.entries(extra)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  return query.toString();
}

export default function PerformancePage({ searchParams }: PageProps<'/performance'>) {
  return (
    <>
      <PageHeader
        title="Performance"
        description="Launch, screen transition and network performance across this workspace."
        aside="Times in UTC"
      />
      <Suspense fallback={<PerformanceSkeleton />}>
        <PerformanceContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PerformanceContent({
  searchParams,
}: Pick<PageProps<'/performance'>, 'searchParams'>) {
  const context = await getOrgContext();
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const params = await searchParams;
  const now = new Date();
  const parsed = parseOverviewFilters(params, now);
  const options = await getFilterOptions(context.organizationId);
  if (options.projects.length === 0) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <Panel title="No projects yet" className="max-w-2xl">
          <p className="px-5 pt-2 pb-5 text-sm text-ink-2">
            Create a project in Settings, then performance samples from your app appear here
            automatically.
          </p>
        </Panel>
      </div>
    );
  }

  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const tab = parseTab(params);
  const metricParam = single(params.metric);
  const metric = isStartupMetric(metricParam) ? metricParam : DEFAULT_METRIC;
  const window = resolveWindow(filters.range, now);

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <nav aria-label="Performance sections" className="flex flex-wrap items-center gap-1">
          {TABS.map((item) => {
            const selected = tab === item.key;
            return (
              <Link
                key={item.key}
                href={`/performance?${queryFor(filters, {
                  tab: item.key === DEFAULT_TAB ? null : item.key,
                  metric: item.key === 'startup' && metric !== DEFAULT_METRIC ? metric : null,
                })}`}
                aria-current={selected ? 'page' : undefined}
                className={
                  selected
                    ? 'rounded-md bg-raised px-3 py-1.5 text-xs font-semibold text-ink'
                    : 'rounded-md px-3 py-1.5 text-xs text-ink-2 hover:bg-raised/60 hover:text-ink'
                }
              >
                {item.label}
              </Link>
            );
          })}
          <p className="ml-auto text-2xs text-ink-3">{rangeLabel(filters.range)}</p>
        </nav>

        {tab === 'startup' && (
          <StartupTab options={options} filters={filters} window={window} metric={metric} />
        )}
        {tab === 'screens' && <ScreensTab options={options} filters={filters} window={window} />}
        {tab === 'network' && (
          <NetworkTab options={options} filters={filters} window={window} now={now.getTime()} />
        )}
      </div>
    </OverviewFrame>
  );
}

async function StartupTab({
  options,
  filters,
  window,
  metric,
}: {
  options: Awaited<ReturnType<typeof getFilterOptions>>;
  filters: ReturnType<typeof parseOverviewFilters>;
  window: ReturnType<typeof resolveWindow>;
  metric: StartupMetricName;
}) {
  const view = await getStartupView(options, filters, window, metric);
  const selected = view.stats.find((stat) => stat.name === metric) ?? view.stats[0];
  const axis = {
    bucketSeconds: window.bucketSeconds,
    spanMs: window.to.getTime() - window.from.getTime(),
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {view.stats.map((stat) => (
          <MetricCard
            key={stat.name}
            stat={stat}
            selected={stat.name === metric}
            href={`/performance?${queryFor(filters, {
              metric: stat.name === DEFAULT_METRIC ? null : stat.name,
            })}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={`${selected?.label ?? METRIC_LABELS[metric]} over time`}
          description={`P50, P90 and P99 per ${window.bucketSeconds < 3600 ? `${Math.round(window.bucketSeconds / 60)}-minute` : `${Math.round(window.bucketSeconds / 3600)}-hour`} bucket.`}
        >
          <div className="px-5 pt-3 pb-4">
            <StartupSeriesChart
              series={view.series}
              metricLabel={selected?.label ?? METRIC_LABELS[metric]}
              axis={axis}
            />
          </div>
        </Panel>
        <Panel
          title="Distribution"
          description={`Samples split into ten equal ranges up to the slowest ${METRIC_LABELS[metric].toLowerCase()} sample.`}
        >
          <div className="px-5 pt-3 pb-4">
            <StartupHistogram
              histogram={view.histogram}
              metricLabel={selected?.label ?? METRIC_LABELS[metric]}
            />
          </div>
        </Panel>
      </div>

      <Panel
        title="Every startup metric"
        description={`${rangeLabel(filters.range)} · percentiles computed from reported samples.`}
      >
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead className="border-y border-line text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Metric
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Target
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Samples
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  P50
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  P90
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  P99
                </th>
              </tr>
            </thead>
            <tbody>
              {view.stats.map((stat) => (
                <tr key={stat.name} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2.5 text-ink-2">{stat.label}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-3 tabular">
                    {formatDuration(stat.targetMs)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                    {formatCount(stat.samples)}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                    {stat.p50 === null ? 'No data' : formatDuration(stat.p50)}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                    {stat.p90 === null ? 'No data' : formatDuration(stat.p90)}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap text-ink tabular">
                    {stat.p99 === null ? 'No data' : formatDuration(stat.p99)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-2.5 text-2xs text-ink-3">
          Showing {rangeLabel(filters.range).toLowerCase()} · times in UTC.
        </p>
      </Panel>
    </>
  );
}

function MetricCard({
  stat,
  selected,
  href,
}: {
  stat: MetricStats;
  selected: boolean;
  href: string;
}) {
  const health =
    stat.p90 === null
      ? null
      : stat.p90 <= stat.targetMs
        ? { health: 'good' as const, label: 'On target' }
        : { health: 'warning' as const, label: 'Slow' };
  return (
    <Link
      href={href}
      aria-current={selected ? 'true' : undefined}
      className={
        selected
          ? 'flex flex-col gap-2 rounded-[10px] border border-ink-3 bg-panel p-4 ring-1 ring-ink-3/20'
          : 'flex flex-col gap-2 rounded-[10px] border border-line bg-panel p-4 transition-colors hover:border-line-strong'
      }
    >
      <p className="text-xs font-medium text-ink-2">{stat.label}</p>
      <p className="font-wide text-lg font-semibold tracking-tight text-ink">
        {stat.p50 === null ? 'No data' : formatDuration(stat.p50)}
      </p>
      <p className="text-2xs text-ink-3 tabular">
        P50 · P90 {stat.p90 === null ? '—' : formatDuration(stat.p90)} · P99{' '}
        {stat.p99 === null ? '—' : formatDuration(stat.p99)}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {health ? (
          <HealthBadge health={health.health} label={health.label} />
        ) : (
          <span className="text-2xs text-ink-3">No samples</span>
        )}
        <span className="text-2xs text-ink-3 tabular">
          {formatCount(stat.samples)} samples · target {formatDuration(stat.targetMs)}
        </span>
      </div>
    </Link>
  );
}

async function ScreensTab({
  options,
  filters,
  window,
}: {
  options: Awaited<ReturnType<typeof getFilterOptions>>;
  filters: ReturnType<typeof parseOverviewFilters>;
  window: ReturnType<typeof resolveWindow>;
}) {
  const rows = await getScreens(options, filters, window);
  return (
    <Panel
      title="Screens"
      description={`Routes ordered by P90 cold time-to-render, slowest first. ${rangeLabel(filters.range)}.`}
    >
      {rows.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
          No navigation samples in this range. Screen timings appear once your app reports
          `navigation.*` metrics for screen changes.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead className="border-y border-line text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Route
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Samples
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Cold TTR P90
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Warm TTR P90
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  TTI P90
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.routeName} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2.5 font-mono text-xs text-ink">{row.routeName}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                    {formatCount(row.samples)}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                    {row.coldTtrP90 === null ? '—' : formatDuration(row.coldTtrP90)}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                    {row.warmTtrP90 === null ? '—' : formatDuration(row.warmTtrP90)}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap text-ink tabular">
                    {row.ttiP90 === null ? '—' : formatDuration(row.ttiP90)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-5 py-2.5 text-2xs text-ink-3">
        Showing {rangeLabel(filters.range).toLowerCase()} · times in UTC.
      </p>
    </Panel>
  );
}

async function NetworkTab({
  options,
  filters,
  window,
  now,
}: {
  options: Awaited<ReturnType<typeof getFilterOptions>>;
  filters: ReturnType<typeof parseOverviewFilters>;
  window: ReturnType<typeof resolveWindow>;
  now: number;
}) {
  const network = await getNetwork(options, filters, window);
  return (
    <>
      <Panel>
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 sm:divide-x lg:grid-cols-5">
          <NetworkStat
            label="Requests"
            value={formatCount(network.totalRequests)}
            detail="In this range"
          />
          <NetworkStat
            label="Errors"
            value={formatCount(network.errorCount)}
            detail="Status ≥ 400 or failed"
          />
          <NetworkStat
            label="Error rate"
            value={formatPercent(network.errorRate)}
            detail="Share of requests"
          />
          <NetworkStat
            label="P50 duration"
            value={network.p50Ms === null ? 'No data' : formatDuration(network.p50Ms)}
            detail="Median response time"
          />
          <NetworkStat
            label="P95 duration"
            value={network.p95Ms === null ? 'No data' : formatDuration(network.p95Ms)}
            detail="Across all requests"
          />
        </dl>
      </Panel>

      {network.totalRequests > 0 && (
        <Panel title="Status codes" description="Response classes across all captured requests.">
          <StatusBars statuses={network.statuses} total={network.totalRequests} />
        </Panel>
      )}

      <Panel
        title="Endpoints"
        description={`Grouped by method, host and path, slowest P90 first. ${rangeLabel(filters.range)}.`}
      >
        {network.rows.length === 0 ? (
          <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
            No network requests in this range. Requests appear once your app reports captured HTTP
            traffic.
          </p>
        ) : (
          <NetworkTable network={network} />
        )}
        <p className="border-t border-line px-5 py-2.5 text-2xs text-ink-3">
          Query strings and headers are never stored.
        </p>
      </Panel>

      <RecentRequests requests={network.recent} now={now} />
    </>
  );
}

const STATUS_CLASSES: { key: StatusCodeClass; label: string; bar: string }[] = [
  { key: '2xx', label: '2xx Success', bar: 'bg-good' },
  { key: '3xx', label: '3xx Redirect', bar: 'bg-series' },
  { key: '4xx', label: '4xx Client error', bar: 'bg-warning' },
  { key: '5xx', label: '5xx Server error', bar: 'bg-critical' },
];

function StatusBars({
  statuses,
  total,
}: {
  statuses: Partial<Record<StatusCodeClass, number>>;
  total: number;
}) {
  return (
    <div className="mt-3 px-5 pb-4">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-raised ring-1 ring-line ring-inset">
        {STATUS_CLASSES.map(({ key, bar }) => {
          const count = statuses[key] ?? 0;
          if (count === 0) return null;
          return (
            <div
              key={key}
              className={bar}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${key}: ${formatCount(count)}`}
            />
          );
        })}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-3">
        {STATUS_CLASSES.map(({ key, label }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span
              className={`size-2 rounded-sm ${STATUS_CLASSES.find((c) => c.key === key)?.bar}`}
            />
            <span>{label}</span>
            <span className="text-ink-2 tabular">{formatCount(statuses[key] ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentRequests({ requests, now }: { requests: RecentRequest[]; now: number }) {
  return (
    <Panel
      title="Recent requests"
      description="The 20 latest captured HTTP requests, newest first."
    >
      {requests.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No requests captured in this range.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-xs">
            <thead className="border-y border-line text-ink-3">
              <tr>
                <th scope="col" className="w-[40%] px-5 py-2 font-medium">
                  Request
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Project
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Duration
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} className="border-b border-line last:border-b-0">
                  <td className="max-w-0 px-5 py-2.5">
                    <p
                      className="truncate font-mono text-2xs"
                      title={`${request.method} ${request.host}${request.path}`}
                    >
                      <span className="font-semibold text-ink">{request.method}</span>{' '}
                      <span className="text-ink-2">
                        {request.host}
                        {request.path}
                      </span>
                    </p>
                    {request.error && (
                      <p className="truncate text-2xs text-critical" title={request.error}>
                        {request.error}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">
                    {request.projectName}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                    {request.error ? (
                      <span className="text-2xs text-critical">failed</span>
                    ) : (
                      <span
                        className={
                          request.statusCode >= 500
                            ? 'text-critical'
                            : request.statusCode >= 400
                              ? 'text-warning'
                              : 'text-ink-2'
                        }
                      >
                        {request.statusCode}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                    {formatDuration(request.durationMs)}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap text-ink-3 tabular">
                    <time
                      dateTime={request.timestamp.toISOString()}
                      title={formatDateTime(request.timestamp)}
                    >
                      {timeAgo(request.timestamp, now)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function NetworkStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-lg font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="text-2xs text-ink-3">{detail}</dd>
    </div>
  );
}

function NetworkTable({ network }: { network: NetworkView }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-xs">
        <thead className="border-y border-line text-ink-3">
          <tr>
            <th scope="col" className="w-[42%] px-5 py-2 font-medium">
              Endpoint
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Requests
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Errors
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Error rate
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              P50
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              P90
            </th>
            <th scope="col" className="px-5 py-2 text-right font-medium">
              P95
            </th>
          </tr>
        </thead>
        <tbody>
          {network.rows.map((row) => (
            <tr
              key={`${row.method}:${row.host}:${row.path}`}
              className="border-b border-line last:border-b-0"
            >
              <td className="max-w-0 px-5 py-2.5">
                <p className="truncate font-mono text-2xs text-ink-2">
                  <span className="font-semibold text-ink">{row.method}</span> {row.host}
                  {row.path}
                </p>
              </td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                {formatCount(row.requests)}
              </td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                {formatCount(row.errorCount)}
              </td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                {formatPercent(row.errorRate)}
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tabular">
                {row.p50Ms === null ? '—' : formatDuration(row.p50Ms)}
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tabular">
                {row.p90Ms === null ? '—' : formatDuration(row.p90Ms)}
              </td>
              <td className="px-5 py-2.5 text-right whitespace-nowrap text-ink tabular">
                {row.p95Ms === null ? '—' : formatDuration(row.p95Ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerformanceSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-8 w-72 motion-safe:animate-pulse rounded-md bg-raised" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed skeleton count
            key={index}
            className="h-32 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel"
          />
        ))}
      </div>
      <div className="h-72 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
