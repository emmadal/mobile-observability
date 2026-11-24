import { SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { type Health, HealthBadge, PageHeader, Panel } from '@/components/ui';
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
import {
  DEFAULT_SESSION_STATUS,
  listSessions,
  MAX_SESSION_SEARCH_LENGTH,
  SESSION_STATUS_FILTERS,
  SESSIONS_PAGE_SIZE,
  type SessionListItem,
  type SessionListParams,
  type SessionStatusFilter,
} from '@/features/sessions/service';
import {
  deviceLabel,
  formatCompact,
  formatCount,
  formatElapsed,
  osLabel,
  timeAgo,
} from '@/features/telemetry/format';

export const metadata = { title: 'Sessions' };

const STATUS_LABELS: Record<SessionStatusFilter, string> = {
  all: 'All',
  ok: 'OK',
  errored: 'Errored',
  crashed: 'Crashed',
  abnormal: 'Abnormal',
};

const STATUS_HEALTH: Record<'ok' | 'errored' | 'crashed' | 'abnormal', Health> = {
  ok: 'good',
  errored: 'warning',
  crashed: 'critical',
  abnormal: 'warning',
};

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed.slice(0, MAX_SESSION_SEARCH_LENGTH) : undefined;
}

function parseSessionParams(params: SearchParams): Pick<SessionListParams, 'status' | 'query'> {
  const status = single(params.status);
  return {
    status: SESSION_STATUS_FILTERS.includes(status as SessionStatusFilter)
      ? (status as SessionStatusFilter)
      : DEFAULT_SESSION_STATUS,
    query: single(params.q) ?? null,
  };
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

export default function SessionsPage({ searchParams }: PageProps<'/sessions'>) {
  return (
    <>
      <PageHeader
        title="Sessions"
        description="Every app session in the selected range, newest first."
        aside="Times in UTC"
      />
      <Suspense fallback={<SessionsSkeleton />}>
        <SessionsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SessionsContent({ searchParams }: Pick<PageProps<'/sessions'>, 'searchParams'>) {
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
            Create a project in Settings, then sessions from your app appear here automatically.
          </p>
        </Panel>
      </div>
    );
  }

  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const sessionParams = parseSessionParams(params);
  const window = resolveWindow(filters.range, now);
  const page = await listSessions(options, filters, window, {
    ...sessionParams,
    cursor: single(params.cursor) ?? null,
  });

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Session status" className="flex flex-wrap items-center gap-1">
            {SESSION_STATUS_FILTERS.map((status) => {
              const selected = sessionParams.status === status;
              return (
                <Link
                  key={status}
                  href={`/sessions?${queryFor(filters, {
                    status: status === DEFAULT_SESSION_STATUS ? null : status,
                    q: sessionParams.query,
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

          <form action="/sessions" method="get" className="flex items-center gap-2">
            {[...toSearchParams(filters)].map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            {sessionParams.status !== DEFAULT_SESSION_STATUS && (
              <input type="hidden" name="status" value={sessionParams.status} />
            )}
            <label htmlFor="session-search" className="sr-only">
              Search sessions
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                id="session-search"
                name="q"
                type="search"
                defaultValue={sessionParams.query ?? ''}
                maxLength={MAX_SESSION_SEARCH_LENGTH}
                placeholder="Search session, install or user id"
                className="h-8 w-64 rounded-md border border-line-strong bg-night pr-3 pl-8 text-xs text-ink placeholder:text-ink-3 outline-none transition-colors hover:border-ink-3 focus:border-focus focus:ring-2 focus:ring-focus/30"
              />
            </div>
            <button
              type="submit"
              className="h-8 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              Search
            </button>
            {sessionParams.query && (
              <Link
                href={`/sessions?${queryFor(filters, { status: sessionParams.status, q: null })}`}
                className="text-xs text-ink-3 hover:text-ink"
              >
                Clear
              </Link>
            )}
          </form>
        </div>

        <Panel
          title="Sessions"
          description={`${rangeLabel(filters.range)} · ${formatCompact(page.counts.all)} sessions`}
        >
          {page.sessions.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
              No sessions match these filters. Sessions from your apps appear here as they start.
            </p>
          ) : (
            <SessionTable sessions={page.sessions} now={now.getTime()} />
          )}
          {(page.cursor || params.cursor) && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-2xs text-ink-3">
                Newest first · {SESSIONS_PAGE_SIZE} sessions per page
              </p>
              <div className="flex items-center gap-3 text-xs">
                {params.cursor && (
                  <Link
                    href={`/sessions?${queryFor(filters, { status: sessionParams.status, q: sessionParams.query })}`}
                    className="text-ink-3 hover:text-ink"
                  >
                    Back to newest
                  </Link>
                )}
                {page.cursor && (
                  <Link
                    href={`/sessions?${queryFor(filters, {
                      status: sessionParams.status,
                      q: sessionParams.query,
                      cursor: page.cursor,
                    })}`}
                    className="font-medium text-ink hover:underline"
                  >
                    Older sessions
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

function SessionTable({ sessions, now }: { sessions: SessionListItem[]; now: number }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-xs">
        <thead className="border-y border-line text-ink-3">
          <tr>
            <th scope="col" className="px-5 py-2 font-medium">
              Session
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Project
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Release
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Duration
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Errors
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Logs
            </th>
            <th scope="col" className="px-5 py-2 text-right font-medium">
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.id}
              className="relative cursor-pointer border-b border-line last:border-b-0 hover:bg-raised/40"
            >
              <td className="px-5 py-2.5">
                <Link
                  href={`/sessions/${session.id}`}
                  className="font-mono text-xs font-medium wrap-anywhere text-ink after:absolute after:inset-0 hover:underline focus-visible:after:absolute"
                >
                  {session.sessionId}
                </Link>
                <p className="text-2xs text-ink-3">
                  {deviceLabel(session.deviceBrand, session.deviceModel) ?? 'Unknown device'} ·{' '}
                  {osLabel(session.platform, session.osVersion)}
                </p>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <HealthBadge
                  health={STATUS_HEALTH[session.status]}
                  label={STATUS_LABELS[session.status]}
                />
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">{session.projectName}</td>
              <td className="px-3 py-2.5 text-ink-2">
                <span className="whitespace-nowrap">
                  {session.appVersion} ({session.appBuild})
                </span>
                {session.updateId && (
                  <span className="block font-mono text-2xs wrap-anywhere text-ink-3">
                    update {session.updateId}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tabular">
                {session.endedAt
                  ? formatElapsed(session.startedAt, session.endedAt)
                  : `open · ${timeAgo(session.lastSeenAt, now)}`}
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                {formatCount(session.errorCount)}
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tabular">
                {formatCount(session.eventCount)}
              </td>
              <td className="px-5 py-2.5 text-right whitespace-nowrap text-ink-3 tabular">
                <time
                  dateTime={session.startedAt.toISOString()}
                  title={session.startedAt.toISOString()}
                >
                  {timeAgo(session.startedAt, now)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-8 w-96 motion-safe:animate-pulse rounded-md bg-raised" />
      <div className="h-80 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
