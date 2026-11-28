import { SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import { singleParam } from '@/features/events/filters';
import {
  MAX_NETWORK_SEARCH_LENGTH,
  NETWORK_STATUSES,
  type NetworkStatus,
  parseNetworkStatus,
  segmentName,
} from '@/features/network/filters';
import {
  listNetworkRequests,
  NETWORK_PAGE_SIZE,
  type NetworkSegment,
  type NetworkStats,
} from '@/features/network/service';
import {
  type OverviewFilters,
  parseOverviewFilters,
  rangeLabel,
  resolveWindow,
  toSearchParams,
} from '@/features/overview/filters';
import { formatDuration } from '@/features/overview/format';
import { OverviewFrame } from '@/features/overview/overview-frame';
import { getFilterOptions } from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { getOrgContext } from '@/features/projects/access';
import { formatCompact, formatCount, formatPercent } from '@/features/telemetry/format';
import { type NetworkRequest, userLabel } from '@/features/telemetry/request-trace';
import { RequestTraceRow, UserChip } from '@/features/telemetry/request-trace-details';
import { MAX_SEGMENT_LENGTH, NO_SEGMENT } from '@/features/users/service';

export const metadata = { title: 'Network' };

export default function NetworkPage({ searchParams }: PageProps<'/network'>) {
  return (
    <>
      <PageHeader
        title="Network"
        description="Every request between your apps and their APIs: the URL called, the status and what the backend answered, with who sent it as msisdn:segment."
        aside="Times in UTC"
      />
      <Suspense fallback={<NetworkSkeleton />}>
        <NetworkContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

interface NetworkQuery {
  segment: string | null;
  status: NetworkStatus;
  q: string | null;
  cursor?: string | null;
}

function buildQuery(filters: OverviewFilters, query: NetworkQuery): string {
  const params = toSearchParams(filters);
  if (query.segment) params.set('segment', query.segment);
  if (query.status !== 'all') params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

async function NetworkContent({ searchParams }: Pick<PageProps<'/network'>, 'searchParams'>) {
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
            Create a project in Settings, then the requests your apps send appear here.
          </p>
        </Panel>
      </div>
    );
  }

  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const query: NetworkQuery = {
    segment: singleParam(params.segment, MAX_SEGMENT_LENGTH) ?? null,
    status: parseNetworkStatus(params.status),
    q: singleParam(params.q, MAX_NETWORK_SEARCH_LENGTH) ?? null,
  };
  const cursor = singleParam(params.cursor, 512) ?? null;
  const page = await listNetworkRequests(options, filters, resolveWindow(filters.range, now), {
    segment: query.segment,
    status: query.status,
    query: query.q,
    cursor,
  });
  const hrefFor = (change: Partial<NetworkQuery>) =>
    `/network?${buildQuery(filters, { ...query, ...change, cursor: change.cursor ?? null })}`;
  const selectedName = query.segment
    ? segmentName(query.segment === NO_SEGMENT ? null : query.segment)
    : 'All segments';

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <SegmentPanel
          segments={page.segments}
          selected={query.segment}
          hrefFor={(segment) => hrefFor({ segment })}
        />

        <Panel>
          <StatsRow stats={page.stats} scope={selectedName} />
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusFilter
            stats={page.stats}
            selected={query.status}
            hrefFor={(status) => hrefFor({ status })}
          />
          <form action="/network" method="get" className="flex items-center gap-2">
            {[...toSearchParams(filters)].map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            {query.segment && <input type="hidden" name="segment" value={query.segment} />}
            {query.status !== 'all' && <input type="hidden" name="status" value={query.status} />}
            <label htmlFor="network-search" className="sr-only">
              Search requests by phone number or URL
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                id="network-search"
                name="q"
                type="search"
                defaultValue={query.q ?? ''}
                maxLength={MAX_NETWORK_SEARCH_LENGTH}
                placeholder="MSISDN or URL"
                className="h-8 w-64 rounded-md border border-line-strong bg-night pr-3 pl-8 text-xs text-ink placeholder:text-ink-3 outline-none transition-colors hover:border-ink-3 focus:border-focus focus:ring-2 focus:ring-focus/30"
              />
            </div>
            <button
              type="submit"
              className="h-8 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              Search
            </button>
            {query.q && (
              <Link href={hrefFor({ q: null })} className="text-xs text-ink-3 hover:text-ink">
                Clear
              </Link>
            )}
          </form>
        </div>

        <Panel
          title={`Requests · ${selectedName}`}
          description={`${rangeLabel(filters.range)} · newest first. Open a request for the URL called, the status and the response body.`}
        >
          {page.requests.length === 0 ? (
            <EmptyState hasFilters={Boolean(query.q || query.status !== 'all' || query.segment)} />
          ) : (
            <ul className="mt-3 border-t border-line">
              {page.requests.map((request) => (
                <RequestTraceRow
                  key={request.id}
                  trace={request}
                  now={now.getTime()}
                  context={<RequestContext request={request} />}
                />
              ))}
            </ul>
          )}
          {(page.cursor || cursor) && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-2xs text-ink-3">
                Newest first · {NETWORK_PAGE_SIZE} requests per page
              </p>
              <div className="flex items-center gap-3 text-xs">
                {cursor && (
                  <Link href={hrefFor({})} className="text-ink-3 hover:text-ink">
                    Back to newest
                  </Link>
                )}
                {page.cursor && (
                  <Link
                    href={hrefFor({ cursor: page.cursor })}
                    className="font-medium text-ink hover:underline"
                  >
                    Older requests
                  </Link>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </OverviewFrame>
  );
}

/** Who sent the request and from where: msisdn:segment, app, release, screen. */
function RequestContext({ request }: { request: NetworkRequest }) {
  return (
    <>
      <UserChip label={userLabel(request)} />
      <span>
        · {request.projectName} {request.appVersion} · {request.platform}
      </span>
      {request.routeName && <span className="font-mono">· {request.routeName}</span>}
    </>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="px-5 pt-3 pb-5 text-sm text-ink-2">
      {hasFilters ? (
        <p>No request matches these filters in this range.</p>
      ) : (
        <p>
          No requests in this range. The SDK records every <code className="font-mono">fetch</code>{' '}
          and <code className="font-mono">XMLHttpRequest</code> call; set{' '}
          <code className="font-mono text-xs text-ink">networkFullUrls: true</code> and{' '}
          <code className="font-mono text-xs text-ink">networkResponseBodies: 'all'</code> in{' '}
          <code className="font-mono text-xs text-ink">Observe.configure</code> to keep the URL
          called and what the API answered.
        </p>
      )}
    </div>
  );
}

/** Requests per segment (merchant, kyc, kya, ftth...): each card filters the list. */
function SegmentPanel({
  segments,
  selected,
  hrefFor,
}: {
  segments: NetworkSegment[];
  selected: string | null;
  hrefFor: (segment: string | null) => string;
}) {
  if (segments.length === 0) return null;
  const total = segments.reduce(
    (sum, entry) => ({
      requests: sum.requests + entry.requests,
      failed: sum.failed + entry.failed,
    }),
    { requests: 0, failed: 0 },
  );
  return (
    <Panel
      title="Requests by segment"
      description="The segment of the user who sent each request (Observe.setUser). Select one to list only its requests."
    >
      <ul
        className={`mt-3 grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 ${
          LARGE_COLUMNS[Math.min(segments.length + 1, 6)] ?? 'lg:grid-cols-6'
        }`}
      >
        <SegmentCard
          label="All segments"
          entry={total}
          who={`${formatCount(segments.length)} ${segments.length === 1 ? 'segment' : 'segments'}`}
          href={hrefFor(null)}
          selected={!selected}
        />
        {segments.map((entry) => {
          const value = entry.segment ?? NO_SEGMENT;
          return (
            <SegmentCard
              key={value}
              label={segmentName(entry.segment)}
              entry={entry}
              who={`${formatCount(entry.users)} ${entry.users === 1 ? 'user' : 'users'}`}
              href={hrefFor(value)}
              selected={selected === value}
            />
          );
        })}
      </ul>
    </Panel>
  );
}

/** One row of cards on large screens when they fit: no empty filler cell. */
const LARGE_COLUMNS: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

function SegmentCard({
  label,
  entry,
  who,
  href,
  selected,
}: {
  label: string;
  entry: { requests: number; failed: number };
  /** "12 users", "4 segments". */
  who: string;
  href: string;
  selected: boolean;
}) {
  return (
    <li className="bg-panel">
      <Link
        href={href}
        aria-current={selected ? 'true' : undefined}
        className={`flex h-full flex-col gap-1 px-5 py-3.5 transition-colors hover:bg-raised/60 ${
          selected ? 'bg-raised shadow-[inset_0_-2px_0_0_var(--color-ink)]' : ''
        }`}
      >
        <span className="text-2xs font-medium tracking-wide text-ink-3 uppercase">{label}</span>
        <span className="font-wide text-lg font-semibold tracking-tight text-ink tabular">
          {formatCompact(entry.requests)}{' '}
          <span className="text-xs font-normal text-ink-3">
            {entry.requests === 1 ? 'request' : 'requests'}
          </span>
        </span>
        <span className="text-2xs text-ink-3">
          {who} ·{' '}
          <span className={entry.failed > 0 ? 'text-warning' : ''}>
            {formatCount(entry.failed)} not OK
          </span>
        </span>
      </Link>
    </li>
  );
}

function StatsRow({ stats, scope }: { stats: NetworkStats; scope: string }) {
  const rate = (value: number) =>
    stats.requests === 0 ? 'No data' : formatPercent(value / stats.requests);
  return (
    <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x lg:grid-cols-7">
      <Stat label="Requests" value={formatCount(stats.requests)} detail={scope} />
      <Stat
        label="Not OK"
        value={rate(stats.failed)}
        detail={`${formatCount(stats.failed)} requests`}
        tone={stats.failed > 0 ? 'warning' : undefined}
      />
      <Stat
        label="API errors"
        value={formatCount(stats.apiErrors)}
        detail="Answered 4xx / 5xx"
        tone={stats.apiErrors > 0 ? 'warning' : undefined}
      />
      <Stat
        label="Network failures"
        value={formatCount(stats.networkFailures)}
        detail="No answer: offline, timeout"
        tone={stats.networkFailures > 0 ? 'critical' : undefined}
      />
      <Stat
        label="Median"
        value={stats.p50Ms === null ? '—' : formatDuration(stats.p50Ms)}
        detail="Answered requests"
      />
      <Stat
        label="P95"
        value={stats.p95Ms === null ? '—' : formatDuration(stats.p95Ms)}
        detail="Answered requests"
      />
      <Stat label="Users" value={formatCount(stats.users)} detail="Identified senders" />
    </dl>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'warning' | 'critical';
}) {
  const color =
    tone === 'critical' ? 'text-critical' : tone === 'warning' ? 'text-warning' : 'text-ink';
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={`font-wide text-lg font-semibold tracking-tight tabular ${color}`}>{value}</dd>
      <dd className="wrap-anywhere text-2xs text-ink-3" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

/** All / Not OK / API errors / Network failures / OK, with their counts. */
function StatusFilter({
  stats,
  selected,
  hrefFor,
}: {
  stats: NetworkStats;
  selected: NetworkStatus;
  hrefFor: (status: NetworkStatus) => string;
}) {
  const counts: Record<NetworkStatus, number> = {
    all: stats.requests,
    failed: stats.failed,
    api: stats.apiErrors,
    network: stats.networkFailures,
    ok: stats.ok,
  };
  return (
    <nav
      aria-label="Filter by outcome"
      className="flex flex-wrap gap-1 rounded-md border border-line bg-panel p-0.5"
    >
      {NETWORK_STATUSES.map((status) => {
        const current = status.key === selected;
        return (
          <Link
            key={status.key}
            href={hrefFor(status.key)}
            aria-current={current ? 'true' : undefined}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
              current ? 'bg-raised font-medium text-ink' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {status.label}
            <span className="text-2xs text-ink-3 tabular">{formatCompact(counts[status.key])}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NetworkSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-28 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-24 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-8 w-96 motion-safe:animate-pulse rounded-md bg-raised" />
      <div className="h-96 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
