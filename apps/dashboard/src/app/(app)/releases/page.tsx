import { Suspense } from 'react';
import { HealthBadge, PageHeader, Panel } from '@/components/ui';
import { parseOverviewFilters, rangeLabel, resolveWindow } from '@/features/overview/filters';
import { formatDuration } from '@/features/overview/format';
import { OverviewFrame } from '@/features/overview/overview-frame';
import { getFilterOptions } from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { getOrgContext } from '@/features/projects/access';
import { getReleases, type ReleaseRow, type ReleasesView } from '@/features/releases/service';
import {
  formatCompact,
  formatCount,
  formatPercent,
  shortId,
  timeAgo,
} from '@/features/telemetry/format';

export const metadata = { title: 'Releases' };

export default function ReleasesPage({ searchParams }: PageProps<'/releases'>) {
  return (
    <>
      <PageHeader
        title="Releases"
        description="Health per app version, build and OTA update, newest activity first."
        aside="Times in UTC"
      />
      <Suspense fallback={<ReleasesSkeleton />}>
        <ReleasesContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ReleasesContent({ searchParams }: Pick<PageProps<'/releases'>, 'searchParams'>) {
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
            Create a project in Settings, then releases from your app appear here automatically.
          </p>
        </Panel>
      </div>
    );
  }

  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const window = resolveWindow(filters.range, now);
  const view = await getReleases(options, filters, window);

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <Panel>
          <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
            <Stat
              label="Releases"
              value={formatCount(view.totals.releases)}
              detail="Active in this range"
            />
            <Stat
              label="Sessions"
              value={formatCompact(view.totals.sessions)}
              detail="Started in this range"
            />
            <Stat
              label="Crash-free sessions"
              value={
                view.totals.crashFreeRate === null
                  ? 'No data'
                  : formatPercent(view.totals.crashFreeRate)
              }
              detail={
                view.totals.sessions === 0
                  ? 'No sessions'
                  : `${formatCount(view.totals.crashedSessions)} crashed`
              }
            />
            <Stat
              label="Errors"
              value={formatCompact(view.totals.errors)}
              detail={`${formatCount(view.totals.crashes)} crashes`}
            />
            <Stat
              label="Log events"
              value={formatCompact(view.totals.logEvents)}
              detail="Observe.logEvent calls"
            />
            <Stat
              label="Latest activity"
              value={
                view.releases[0] ? timeAgo(view.releases[0].lastSeen, now.getTime()) : 'No data'
              }
              detail={rangeLabel(filters.range)}
            />
          </dl>
        </Panel>

        <Panel
          title="Release health"
          description={`${rangeLabel(filters.range)} · grouped by version, build, OTA update, platform and environment.`}
        >
          {view.releases.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
              No releases in this range. Versions appear here as sessions and errors arrive from
              your apps.
            </p>
          ) : (
            <ReleaseTable view={view} now={now.getTime()} />
          )}
        </Panel>
      </div>
    </OverviewFrame>
  );
}

function releaseLabel(release: ReleaseRow): string {
  return `${release.appVersion} (${release.appBuild})`;
}

function ReleaseTable({ view, now }: { view: ReleasesView; now: number }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[62rem] text-left text-xs">
        <thead className="border-y border-line text-ink-3">
          <tr>
            <th scope="col" className="w-[24%] px-5 py-2 font-medium">
              Release
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Platform
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Environment
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Sessions
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Crash-free
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Crashes
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Errors
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Logs
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Cold launch P75
            </th>
            <th scope="col" className="px-5 py-2 text-right font-medium">
              Last seen
            </th>
          </tr>
        </thead>
        <tbody>
          {view.releases.map((release) => (
            <tr key={release.key} className="border-b border-line last:border-b-0">
              <td className="px-5 py-3">
                <p className="font-medium text-ink">{releaseLabel(release)}</p>
                <p className="mt-0.5 text-2xs text-ink-3">
                  {release.updateId ? (
                    <span className="font-mono">update {shortId(release.updateId)}</span>
                  ) : (
                    'Store build'
                  )}
                  {' · '}
                  {formatCount(release.installations)} installations · {formatCount(release.users)}{' '}
                  users
                </p>
              </td>
              <td className="px-3 py-3 capitalize text-ink-2">{release.platform}</td>
              <td className="px-3 py-3 text-ink-2">{release.environment}</td>
              <td className="px-3 py-3 text-right text-ink-2 tabular">
                {formatCount(release.sessions)}
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span className="text-ink tabular">
                    {release.crashFreeRate === null
                      ? 'No data'
                      : formatPercent(release.crashFreeRate)}
                  </span>
                  {release.crashFreeRate !== null && (
                    <HealthBadge
                      health={
                        release.crashFreeRate >= 0.995
                          ? 'good'
                          : release.crashFreeRate >= 0.98
                            ? 'warning'
                            : 'critical'
                      }
                      label={
                        release.crashFreeRate >= 0.995
                          ? 'Healthy'
                          : release.crashFreeRate >= 0.98
                            ? 'Degraded'
                            : 'Critical'
                      }
                    />
                  )}
                </span>
              </td>
              <td className="px-3 py-3 text-right text-ink-2 tabular">
                {formatCount(release.crashedSessions)}
              </td>
              <td className="px-3 py-3 text-right text-ink-2 tabular">
                {formatCount(release.errors)}
              </td>
              <td className="px-3 py-3 text-right text-ink-2 tabular">
                {formatCount(release.logEvents)}
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular">
                {release.coldLaunchP75 === null ? '—' : formatDuration(release.coldLaunchP75)}
              </td>
              <td className="px-5 py-3 text-right whitespace-nowrap text-ink-3 tabular">
                <time dateTime={release.lastSeen.toISOString()}>
                  {timeAgo(release.lastSeen, now)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-lg font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="truncate text-2xs text-ink-3" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

function ReleasesSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-24 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-80 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
