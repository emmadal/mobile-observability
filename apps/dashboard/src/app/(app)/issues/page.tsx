import { SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { HealthBadge, PageHeader, Panel } from '@/components/ui';
import {
  DEFAULT_ISSUE_STATUS,
  ISSUE_STATUS_FILTERS,
  ISSUES_PAGE_SIZE,
  type IssueListItem,
  type IssueListParams,
  type IssueStatusFilter,
  listIssues,
  MAX_SEARCH_LENGTH,
} from '@/features/issues/service';
import {
  parseOverviewFilters,
  rangeLabel,
  resolveWindow,
  toSearchParams,
} from '@/features/overview/filters';
import { OverviewFrame } from '@/features/overview/overview-frame';
import { getFilterOptions } from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { getOrgContext } from '@/features/projects/access';
import { formatCount, timeAgo } from '@/features/telemetry/format';

export const metadata = { title: 'Issues' };

const STATUS_LABELS: Record<IssueStatusFilter, string> = {
  open: 'Open',
  resolved: 'Resolved',
  ignored: 'Ignored',
  all: 'All',
};

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed.slice(0, MAX_SEARCH_LENGTH) : undefined;
}

function parseIssueParams(params: SearchParams): Pick<IssueListParams, 'status' | 'query'> {
  const status = single(params.status);
  return {
    status: ISSUE_STATUS_FILTERS.includes(status as IssueStatusFilter)
      ? (status as IssueStatusFilter)
      : DEFAULT_ISSUE_STATUS,
    query: single(params.q) ?? null,
  };
}

/** The current filters plus an override, as a shareable query string. */
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

export default function IssuesPage({ searchParams }: PageProps<'/issues'>) {
  return (
    <>
      <PageHeader
        title="Issues"
        description="Grouped crashes and errors, most recent activity first."
        aside="Times in UTC"
      />
      <Suspense fallback={<IssuesSkeleton />}>
        <IssuesContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function IssuesContent({ searchParams }: Pick<PageProps<'/issues'>, 'searchParams'>) {
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
            Create a project in Settings, then errors from your app appear here automatically.
          </p>
        </Panel>
      </div>
    );
  }

  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const issueParams = parseIssueParams(params);
  const window = resolveWindow(filters.range, now);
  const page = await listIssues(options, filters, window, {
    ...issueParams,
    cursor: single(params.cursor) ?? null,
  });

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Issue status" className="flex flex-wrap items-center gap-1">
            {ISSUE_STATUS_FILTERS.map((status) => {
              const selected = issueParams.status === status;
              return (
                <Link
                  key={status}
                  href={`/issues?${queryFor(filters, {
                    status: status === DEFAULT_ISSUE_STATUS ? null : status,
                    q: issueParams.query,
                  })}`}
                  aria-current={selected ? 'page' : undefined}
                  className={
                    selected
                      ? 'flex items-center gap-2 rounded-md bg-raised px-3 py-1.5 text-xs font-semibold text-ink'
                      : 'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-ink-2 hover:bg-raised/60 hover:text-ink'
                  }
                >
                  {STATUS_LABELS[status]}
                  <span className="text-2xs text-ink-3 tabular">
                    {formatCount(page.counts[status])}
                  </span>
                </Link>
              );
            })}
          </nav>

          <form action="/issues" method="get" className="flex items-center gap-2">
            {[...toSearchParams(filters)].map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            {issueParams.status !== DEFAULT_ISSUE_STATUS && (
              <input type="hidden" name="status" value={issueParams.status} />
            )}
            <label htmlFor="issue-search" className="sr-only">
              Search issues
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                id="issue-search"
                name="q"
                type="search"
                defaultValue={issueParams.query ?? ''}
                maxLength={MAX_SEARCH_LENGTH}
                placeholder="Search type, message, culprit"
                className="h-8 w-64 rounded-md border border-line-strong bg-night pr-3 pl-8 text-xs text-ink placeholder:text-ink-3 outline-none transition-colors hover:border-ink-3 focus:border-focus focus:ring-2 focus:ring-focus/30"
              />
            </div>
            <button
              type="submit"
              className="h-8 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              Search
            </button>
            {issueParams.query && (
              <Link
                href={`/issues?${queryFor(filters, { status: issueParams.status, q: null })}`}
                className="text-xs text-ink-3 hover:text-ink"
              >
                Clear
              </Link>
            )}
          </form>
        </div>

        <Panel
          title="Issues"
          description={`${rangeLabel(filters.range)} · ${formatCount(page.counts.all)} matching issues`}
        >
          {page.issues.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
              No issues match these filters. New errors from your apps are grouped here as they
              arrive.
            </p>
          ) : (
            <IssueTable issues={page.issues} now={now.getTime()} />
          )}
          {(page.cursor || params.cursor) && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-2xs text-ink-3">
                Newest first · {ISSUES_PAGE_SIZE} issues per page
              </p>
              <div className="flex items-center gap-3 text-xs">
                {params.cursor && (
                  <Link
                    href={`/issues?${queryFor(filters, { status: issueParams.status, q: issueParams.query })}`}
                    className="text-ink-3 hover:text-ink"
                  >
                    Back to newest
                  </Link>
                )}
                {page.cursor && (
                  <Link
                    href={`/issues?${queryFor(filters, {
                      status: issueParams.status,
                      q: issueParams.query,
                      cursor: page.cursor,
                    })}`}
                    className="font-medium text-ink hover:underline"
                  >
                    Older issues
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

function FixBadge({ origin }: { origin: 'js' | 'native' }) {
  return (
    <span
      className={
        origin === 'js'
          ? 'rounded-full bg-good/10 px-2 py-0.5 text-2xs font-medium text-good ring-1 ring-good/30 ring-inset'
          : 'rounded-full bg-raised px-2 py-0.5 text-2xs font-medium text-ink-3 ring-1 ring-line-strong ring-inset'
      }
    >
      {origin === 'js' ? 'Fix via OTA update' : 'Needs new build'}
    </span>
  );
}

function IssueTable({ issues, now }: { issues: IssueListItem[]; now: number }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-xs">
        <thead className="border-y border-line text-ink-3">
          <tr>
            <th scope="col" className="w-[56%] px-5 py-2 font-medium">
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
          {issues.map((issue) => (
            <tr
              key={issue.id}
              className="relative cursor-pointer border-b border-line last:border-b-0 hover:bg-raised/40"
            >
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  {issue.fatal && <HealthBadge health="critical" label="Crash" />}
                  {issue.kind === 'hang' && <HealthBadge health="warning" label="Hang" />}
                  {issue.kind === 'anr' && <HealthBadge health="critical" label="ANR" />}
                  {issue.kind === 'oom' && <HealthBadge health="critical" label="OOM" />}
                  {issue.regressed && <HealthBadge health="warning" label="Regressed" />}
                  {issue.status === 'resolved' && <HealthBadge health="good" label="Resolved" />}
                  {issue.status === 'ignored' && (
                    <span className="rounded-full bg-raised px-2 py-0.5 text-2xs font-medium text-ink-3 ring-1 ring-line-strong ring-inset">
                      Ignored
                    </span>
                  )}
                  <FixBadge origin={issue.origin} />
                  <Link
                    href={`/issues/${issue.id}`}
                    className="wrap-anywhere font-semibold text-ink after:absolute after:inset-0 hover:underline"
                  >
                    {issue.type}
                  </Link>
                </div>
                <p className="font-narrow mt-0.5 wrap-anywhere text-ink-2" title={issue.message}>
                  {issue.message}
                </p>
                {issue.culprit && (
                  <p className="mt-0.5 wrap-anywhere font-mono text-2xs text-ink-3">
                    {issue.culprit}
                  </p>
                )}
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-ink-2">{issue.projectName}</td>
              <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular">
                {formatCount(issue.eventCount)}
              </td>
              <td className="px-5 py-3 text-right whitespace-nowrap text-ink-3 tabular">
                <time dateTime={issue.lastSeen.toISOString()} title={issue.lastSeen.toISOString()}>
                  {timeAgo(issue.lastSeen, now)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssuesSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-8 w-80 motion-safe:animate-pulse rounded-md bg-raised" />
      <div className="h-80 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
