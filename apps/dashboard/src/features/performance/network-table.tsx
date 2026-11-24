'use client';

import { XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDuration } from '@/features/overview/format';
import { formatCount, formatDateTime, formatPercent, timeAgo } from '@/features/telemetry/format';
import type { NetworkView, RecentRequest } from './service';

interface Props {
  network: NetworkView;
  now: number;
}

/** Row key of the endpoints table: method + host + path. */
const rowKey = (row: { method: string; host: string; path: string }) =>
  `${row.method}:${row.host}:${row.path}`;

/**
 * Endpoints grouped by method, host and path, slowest P90 first. Summaries
 * stay on one line; "View" opens a sheet with the full endpoint details and
 * the recent requests captured for it.
 */
export function NetworkTable({ network, now }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const row = network.rows.find((candidate) => rowKey(candidate) === selected) ?? null;

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-xs">
          <thead className="border-y border-line text-ink-3">
            <tr>
              <th scope="col" className="w-[38%] px-5 py-2 font-medium">
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
              <th scope="col" className="px-3 py-2 text-right font-medium">
                P95
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {network.rows.map((endpoint) => (
              <tr
                key={rowKey(endpoint)}
                className="border-b border-line last:border-b-0 hover:bg-raised/40"
              >
                <td className="px-5 py-2.5">
                  <p
                    className="wrap-anywhere font-mono text-2xs text-ink-2"
                    title={`${endpoint.method} ${endpoint.host}${endpoint.path}`}
                  >
                    <span className="font-semibold text-ink">{endpoint.method}</span>{' '}
                    {endpoint.host}
                    {endpoint.path}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                  {formatCount(endpoint.requests)}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                  {formatCount(endpoint.errorCount)}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2 tabular">
                  {formatPercent(endpoint.errorRate)}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tabular">
                  {endpoint.p50Ms === null ? '—' : formatDuration(endpoint.p50Ms)}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-2 tabular">
                  {endpoint.p90Ms === null ? '—' : formatDuration(endpoint.p90Ms)}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink tabular">
                  {endpoint.p95Ms === null ? '—' : formatDuration(endpoint.p95Ms)}
                </td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setSelected(rowKey(endpoint))}
                    className="rounded border border-line-strong px-2 py-1 text-2xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {row && (
        <EndpointSheet
          row={row}
          requests={network.recent.filter((request) => sameEndpoint(request, row))}
          now={now}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function sameEndpoint(
  request: RecentRequest,
  row: { method: string; host: string; path: string },
): boolean {
  return request.method === row.method && request.host === row.host && request.path === row.path;
}

/** Right-side sheet with the full endpoint details, above a dimmed backdrop. */
function EndpointSheet({
  row,
  requests,
  now,
  onClose,
}: {
  row: {
    method: string;
    host: string;
    path: string;
    requests: number;
    errorCount: number;
    errorRate: number;
    p50Ms: number | null;
    p90Ms: number | null;
    p95Ms: number | null;
  };
  requests: RecentRequest[];
  now: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close endpoint details"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-night/60"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${row.method} ${row.host}${row.path} details`}
        className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-line bg-panel shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">
              <span className="font-mono">{row.method}</span> Endpoint details
            </h3>
            <p className="font-mono mt-1 text-xs break-all text-ink-2">
              {row.host}
              {row.path}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1.5 text-ink-3 transition-colors hover:bg-raised hover:text-ink"
          >
            <XIcon className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <dl className="grid grid-cols-3 divide-x divide-line border-b border-line">
            <SheetStat label="Requests" value={formatCount(row.requests)} />
            <SheetStat
              label="Errors"
              value={formatCount(row.errorCount)}
              detail={formatPercent(row.errorRate)}
            />
            <SheetStat
              label="P50 / P90 / P95"
              value={[row.p50Ms, row.p90Ms, row.p95Ms]
                .map((ms) => (ms === null ? '—' : formatDuration(ms)))
                .join(' / ')}
            />
          </dl>

          <p className="px-5 pt-4 pb-2 text-2xs font-medium tracking-wide text-ink-3 uppercase">
            Recent requests ({formatCount(requests.length)})
          </p>
          {requests.length === 0 ? (
            <p className="px-5 pb-4 text-xs text-ink-2">
              No individual request for this endpoint in the latest captures.
            </p>
          ) : (
            <ul className="border-t border-line">
              {requests.map((request) => (
                <li
                  key={request.id}
                  className="border-b border-line px-5 py-2.5 text-xs last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <time
                      dateTime={request.timestamp.toISOString()}
                      title={formatDateTime(request.timestamp)}
                      className="text-ink-3 tabular"
                    >
                      {timeAgo(request.timestamp, now)}
                    </time>
                    <span
                      className={
                        request.error
                          ? 'text-2xs text-critical'
                          : request.statusCode >= 500
                            ? 'text-critical tabular'
                            : request.statusCode >= 400
                              ? 'text-warning tabular'
                              : 'text-ink-2 tabular'
                      }
                    >
                      {request.error ? 'failed' : request.statusCode}
                    </span>
                    <span className="text-ink tabular">{formatDuration(request.durationMs)}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-ink-3">
                    <span>
                      {request.projectName} · {request.appVersion} · {request.platform}
                    </span>
                    {request.networkType && <span>· {request.networkType}</span>}
                    {request.ttfbMs !== null && (
                      <span className="tabular">· TTFB {formatDuration(request.ttfbMs)}</span>
                    )}
                    {request.traceId && (
                      <span className="font-mono wrap-anywhere">· trace {request.traceId}</span>
                    )}
                    {request.sessionRowId && (
                      <a
                        href={`/sessions/${request.sessionRowId}`}
                        className="font-mono text-ink-2 hover:text-ink hover:underline"
                      >
                        · session {shortIdOf(request.sessionId)}
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function shortIdOf(id: string | null): string {
  return id && id.length > 8 ? id.slice(0, 8) : (id ?? '');
}

function SheetStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-2xs text-ink-3">{label}</dt>
      <dd className="font-wide mt-1 text-sm font-semibold text-ink">{value}</dd>
      {detail && <dd className="text-2xs text-ink-3 tabular">{detail}</dd>}
    </div>
  );
}
