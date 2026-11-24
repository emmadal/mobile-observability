import { SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import { MAX_EVENT_SEARCH_LENGTH, singleParam } from '@/features/events/filters';
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
  formatCompact,
  formatCount,
  formatDateTime,
  formatPercent,
  timeAgo,
} from '@/features/telemetry/format';
import { listUsers, USERS_PAGE_SIZE } from '@/features/users/service';

export const metadata = { title: 'Users' };

export default function UsersPage({ searchParams }: PageProps<'/users'>) {
  return (
    <>
      <PageHeader
        title="Users"
        description="Identified users and their session, crash and error footprint."
        aside="Times in UTC"
      />
      <Suspense fallback={<UsersSkeleton />}>
        <UsersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function UsersContent({ searchParams }: Pick<PageProps<'/users'>, 'searchParams'>) {
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
            Create a project in Settings, then identified users appear here as they use your apps.
          </p>
        </Panel>
      </div>
    );
  }

  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const query = singleParam(params.q, MAX_EVENT_SEARCH_LENGTH) ?? null;
  const window = resolveWindow(filters.range, now);
  const page = await listUsers(options, filters, window, {
    query,
    cursor: singleParam(params.cursor, 512) ?? null,
  });

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <Panel>
          <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
            <Stat
              label="Users"
              value={formatCount(page.totals.users)}
              detail={`${rangeLabel(filters.range).toLowerCase()}`}
            />
            <Stat
              label="Sessions"
              value={formatCompact(page.totals.sessions)}
              detail={`${formatCount(page.totals.crashedSessions)} crashed`}
            />
            <Stat
              label="Errors"
              value={formatCompact(page.totals.errors)}
              detail="Across identified users"
            />
            <Stat
              label="Crash-free sessions"
              value={
                page.totals.sessions === 0
                  ? 'No data'
                  : formatPercent(1 - page.totals.crashedSessions / page.totals.sessions)
              }
              detail="Identified users only"
            />
          </dl>
        </Panel>

        <form action="/users" method="get" className="flex items-center gap-2">
          {[...toSearchParams(filters)].map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <label htmlFor="user-search" className="sr-only">
            Search users
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
            <input
              id="user-search"
              name="q"
              type="search"
              defaultValue={query ?? ''}
              maxLength={MAX_EVENT_SEARCH_LENGTH}
              placeholder="Search by user id"
              className="h-8 w-64 rounded-md border border-line-strong bg-night pr-3 pl-8 text-xs text-ink placeholder:text-ink-3 outline-none transition-colors hover:border-ink-3 focus:border-focus focus:ring-2 focus:ring-focus/30"
            />
          </div>
          <button
            type="submit"
            className="h-8 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            Search
          </button>
          {query && (
            <Link
              href={`/users?${toSearchParams(filters).toString()}`}
              className="text-xs text-ink-3 hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        <Panel
          title="Active users"
          description={`${rangeLabel(filters.range)} · most recently active first. Anonymous sessions are not listed.`}
        >
          {page.users.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
              No identified users in this range. Users appear once your app sends Observe.identify
              or sets a user id.
            </p>
          ) : (
            <UserTable users={page.users} filters={filters} now={now.getTime()} />
          )}
          {(page.cursor || params.cursor) && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-2xs text-ink-3">
                Newest activity first · {USERS_PAGE_SIZE} users per page
              </p>
              <div className="flex items-center gap-3 text-xs">
                {params.cursor && (
                  <Link
                    href={`/users?${toSearchParams(filters).toString()}`}
                    className="text-ink-3 hover:text-ink"
                  >
                    Back to newest
                  </Link>
                )}
                {page.cursor && (
                  <Link
                    href={`/users?${buildQuery(filters, { cursor: page.cursor, q: query })}`}
                    className="font-medium text-ink hover:underline"
                  >
                    Older users
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

function buildQuery(
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

function UserTable({
  users,
  filters,
  now,
}: {
  users: Awaited<ReturnType<typeof listUsers>>['users'];
  filters: ReturnType<typeof parseOverviewFilters>;
  now: number;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-xs">
        <thead className="border-y border-line text-ink-3">
          <tr>
            <th scope="col" className="w-[30%] px-5 py-2 font-medium">
              User
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Sessions
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Crashes
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Errors
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Events
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Last device
            </th>
            <th scope="col" className="px-5 py-2 text-right font-medium">
              Last seen
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const detail = `/users/detail?${buildQuery(filters, { id: user.userId })}`;
            return (
              <tr
                key={user.userId}
                className="border-b border-line last:border-b-0 hover:bg-raised/40"
              >
                <td className="max-w-0 px-5 py-3">
                  <Link
                    href={detail}
                    className="block truncate font-mono text-xs font-medium text-ink hover:underline"
                    title={user.userId}
                  >
                    {user.userId}
                  </Link>
                  <p className="mt-0.5 text-2xs text-ink-3">
                    {formatCount(user.projects)} {user.projects === 1 ? 'project' : 'projects'} ·{' '}
                    {user.appVersion ?? '—'}
                  </p>
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular">
                  {formatCount(user.sessions)}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                  {user.crashedSessions > 0 ? (
                    <span className="text-critical tabular">
                      {formatCount(user.crashedSessions)}
                    </span>
                  ) : (
                    <span className="text-ink-3 tabular">0</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular">
                  {formatCount(user.errors)}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular">
                  {formatCount(user.events)}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2">{user.device ?? '—'}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap text-ink-3 tabular">
                  <time
                    dateTime={user.lastSeen.toISOString()}
                    title={formatDateTime(user.lastSeen)}
                  >
                    {timeAgo(user.lastSeen, now)}
                  </time>
                </td>
              </tr>
            );
          })}
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

function UsersSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-24 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-8 w-96 motion-safe:animate-pulse rounded-md bg-raised" />
      <div className="h-80 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
