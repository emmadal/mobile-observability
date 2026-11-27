import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { type Health, HealthBadge } from '@/components/ui';
import { formatDuration } from '@/features/overview/format';
import { formatDateTime, timeAgo } from './format';
import {
  formatBytes,
  formatResponseBody,
  type NetworkRequest,
  type RequestOutcomeKind,
  type RequestTrace,
  requestOutcome,
  statusLabel,
} from './request-trace';

const OUTCOME_HEALTH: Record<RequestOutcomeKind, Health> = {
  ok: 'good',
  redirect: 'good',
  client: 'warning',
  server: 'critical',
  network: 'critical',
};

export function RequestOutcomeBadge({
  trace,
}: {
  trace: Pick<RequestTrace, 'statusCode' | 'error'>;
}) {
  const outcome = requestOutcome(trace);
  return <HealthBadge health={OUTCOME_HEALTH[outcome.kind]} label={outcome.label} />;
}

/**
 * One request as an expandable row: the summary line names the endpoint, its
 * outcome and duration; opening it shows the full trace (no JavaScript needed).
 */
export function RequestTraceRow({
  trace,
  now,
  context,
}: {
  trace: RequestTrace | NetworkRequest;
  now: number;
  /** Extra line under the endpoint: project, release, user... */
  context?: ReactNode;
}) {
  return (
    <li className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-2.5 text-xs hover:bg-raised/40 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-90"
          />
          <div className="min-w-0 flex-1">
            <p
              className="wrap-anywhere font-mono text-2xs"
              title={`${trace.method} ${trace.host}${trace.path}`}
            >
              <span className="font-semibold text-ink">{trace.method}</span>{' '}
              <span className="text-ink-2">
                {trace.host}
                {trace.path}
              </span>
            </p>
            {context && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-ink-3">
                {context}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <RequestOutcomeBadge trace={trace} />
            <span className="text-2xs text-ink-3 tabular">
              {formatDuration(trace.durationMs)} ·{' '}
              <time
                dateTime={trace.timestamp.toISOString()}
                title={formatDateTime(trace.timestamp)}
              >
                {timeAgo(trace.timestamp, now)}
              </time>
            </span>
          </div>
        </summary>
        <div className="px-5 pb-3">
          <RequestTraceDetails trace={trace} />
        </div>
      </details>
    </li>
  );
}

/** What happened to a request: network failure or API answer, timings, trace id and body. */
export function RequestTraceDetails({ trace }: { trace: RequestTrace | NetworkRequest }) {
  const outcome = requestOutcome(trace);
  const body = trace.responseBody ? formatResponseBody(trace.responseBody) : null;
  const network = 'projectName' in trace ? trace : null;
  return (
    <div className="rounded-md border border-line bg-night/60 text-2xs">
      <div className="flex flex-wrap items-start gap-2 border-b border-line px-3 py-2.5">
        <RequestOutcomeBadge trace={trace} />
        <p className="min-w-0 flex-1 text-ink-2">{outcome.explanation}</p>
      </div>

      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-3 py-2.5">
        <Field label="Endpoint" mono>
          {trace.method} {trace.host}
          {trace.path}
        </Field>
        <Field label="Status">
          <span className={statusClass(trace.statusCode, trace.error)}>
            {statusLabel(trace.statusCode)}
          </span>
        </Field>
        {trace.error && <Field label="Failure">{trace.error}</Field>}
        {trace.errorMessage && (
          <Field label="Error message">
            <span className="text-critical">{trace.errorMessage}</span>
          </Field>
        )}
        <Field label="Duration">
          {formatDuration(trace.durationMs)}
          {trace.ttfbMs !== null && (
            <span className="text-ink-3"> · first byte after {formatDuration(trace.ttfbMs)}</span>
          )}
        </Field>
        {(trace.bytesSent !== null || trace.bytesReceived !== null) && (
          <Field label="Size">
            {trace.bytesSent !== null && <>sent {formatBytes(trace.bytesSent)}</>}
            {trace.bytesSent !== null && trace.bytesReceived !== null && ' · '}
            {trace.bytesReceived !== null && <>received {formatBytes(trace.bytesReceived)}</>}
          </Field>
        )}
        {trace.networkType && <Field label="Connection">{trace.networkType}</Field>}
        {trace.routeName && (
          <Field label="Screen" mono>
            {trace.routeName}
          </Field>
        )}
        <Field label="Time">{formatDateTime(trace.timestamp)} UTC</Field>
        {trace.traceId && (
          <Field label="Trace id" mono>
            <span className="select-all">{trace.traceId}</span>
          </Field>
        )}
        {network && (
          <>
            <Field label="App">
              {network.projectName} · {network.appVersion} · {network.platform}
            </Field>
            {(network.userId || network.userPhone) && (
              <Field label="User">
                {network.userId ?? 'Anonymous'}
                {network.userPhone && <span className="text-ink-3"> · {network.userPhone}</span>}
              </Field>
            )}
            {network.sessionRowId && (
              <Field label="Session" mono>
                <Link
                  href={`/sessions/${network.sessionRowId}`}
                  className="text-ink-2 underline-offset-2 hover:text-ink hover:underline"
                >
                  {network.sessionId}
                </Link>
              </Field>
            )}
          </>
        )}
      </dl>

      <div className="border-t border-line px-3 py-2.5">
        <p className="font-medium text-ink-3">Response body</p>
        {body ? (
          <pre className="mt-1.5 max-h-64 overflow-auto rounded border border-line bg-night p-2.5 font-mono text-2xs whitespace-pre-wrap break-words text-ink-2">
            {body.text}
          </pre>
        ) : !outcome.answered ? (
          <p className="mt-1 text-ink-3">None: the API never answered this request.</p>
        ) : trace.statusCode >= 400 ? (
          <p className="mt-1 text-ink-3">
            Not captured. Set{' '}
            <code className="font-mono text-ink-2">networkErrorBodiesEnabled: true</code> in{' '}
            <code className="font-mono text-ink-2">Observe.configure</code> (SDK 0.3+) to keep what
            the API answered on errors.
          </p>
        ) : (
          <p className="mt-1 text-ink-3">Only error responses keep their body.</p>
        )}
      </div>
    </div>
  );
}

function statusClass(statusCode: number, error: string | null): string {
  if (error || statusCode === 0 || statusCode >= 500) return 'text-critical';
  if (statusCode >= 400) return 'text-warning';
  return 'text-ink-2';
}

function Field({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className={`min-w-0 wrap-anywhere text-ink-2 ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </>
  );
}
