import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { WarningIcon } from '@/components/icons';
import { type Health, HealthBadge } from '@/components/ui';
import { formatDuration } from '@/features/overview/format';
import { CopyButton } from './copy-button';
import { formatDateTime, timeAgo } from './format';
import {
  bodyMessage,
  bodyReportsFailure,
  calledUrl,
  displayUrl,
  formatBytes,
  formatResponseBody,
  type NetworkRequest,
  type RequestOutcomeKind,
  type RequestTrace,
  requestOutcome,
  statusLabel,
  userLabel,
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

/** The API answered 2xx/3xx but its JSON says the operation failed. */
function answeredWithFailure(trace: RequestTrace): boolean {
  return requestOutcome(trace).kind === 'ok' && bodyReportsFailure(trace.responseBody);
}

function BodyFailureBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-2xs font-medium text-warning ring-1 ring-warning/30 ring-inset"
      title="The HTTP status says success, but the JSON the API answered reports a failure."
    >
      <WarningIcon className="size-3" />
      Body reports failure
    </span>
  );
}

/** "msisdn:segment" chip naming who sent a request. */
export function UserChip({ label }: { label: string | null }) {
  if (!label) return <span className="text-ink-3">Anonymous</span>;
  return (
    <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-2xs font-medium text-ink">
      {label}
    </span>
  );
}

/**
 * One request as an expandable row: the summary line names the URL called,
 * its outcome, duration and what the API said; opening it shows the full
 * trace (no JavaScript needed).
 */
export function RequestTraceRow({
  trace,
  now,
  context,
}: {
  trace: RequestTrace | NetworkRequest;
  now: number;
  /** Extra line under the URL: user, project, release, screen... */
  context?: ReactNode;
}) {
  const message = bodyMessage(trace.responseBody);
  const bodyFailure = answeredWithFailure(trace);
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
              title={`${trace.method} ${calledUrl(trace)}`}
            >
              <span className="font-semibold text-ink">{trace.method}</span>{' '}
              <span className="text-ink-2">{displayUrl(trace)}</span>
            </p>
            {context && (
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-ink-3">
                {context}
              </p>
            )}
            {(message || trace.errorMessage) && (
              <p
                className={`mt-1 line-clamp-2 text-2xs ${
                  requestOutcome(trace).kind === 'ok' && !bodyFailure
                    ? 'text-ink-2'
                    : 'text-warning'
                }`}
              >
                {message ? `“${message}”` : trace.errorMessage}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-1">
              <RequestOutcomeBadge trace={trace} />
              {bodyFailure && <BodyFailureBadge />}
            </div>
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

/**
 * Everything about one request, in the order it is read: what happened, the
 * request (URL called), the response (status, timing, size), who sent it, and
 * the body the API answered.
 */
export function RequestTraceDetails({ trace }: { trace: RequestTrace | NetworkRequest }) {
  const outcome = requestOutcome(trace);
  const body = trace.responseBody ? formatResponseBody(trace.responseBody) : null;
  const message = bodyMessage(trace.responseBody);
  const bodyFailure = answeredWithFailure(trace);
  const network = 'projectName' in trace ? trace : null;
  const url = calledUrl(trace);
  const templated = `${trace.host}${trace.path}`;
  return (
    <div className="rounded-md border border-line bg-night/60 text-2xs">
      <div className="flex flex-wrap items-start gap-2 border-b border-line px-3 py-2.5">
        <RequestOutcomeBadge trace={trace} />
        {bodyFailure && <BodyFailureBadge />}
        <p className="min-w-0 flex-1 text-ink-2">
          {bodyFailure
            ? 'The API answered with a success status, but its response says the operation failed. Read the response body below.'
            : outcome.explanation}
          {message && (
            <>
              {' '}
              It said: <span className="font-medium text-ink">“{message}”</span>
            </>
          )}
        </p>
      </div>

      <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
        <Section title="Request">
          <Field label="URL called" mono>
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 select-all">
                <span className="font-semibold text-ink">{trace.method}</span> {url}
              </span>
              <CopyButton value={url} />
            </span>
          </Field>
          {trace.url &&
            trace.url.replace(/^https?:\/\//i, '').split(/[?#]/, 1)[0] !== templated && (
              <Field label="Endpoint" mono>
                {templated}
              </Field>
            )}
          {!trace.url && (
            <Field label="Query">
              <span className="text-ink-3">
                Not captured: set{' '}
                <code className="font-mono text-ink-2">networkFullUrls: true</code> to keep the real
                path and query string.
              </span>
            </Field>
          )}
          {trace.routeName && (
            <Field label="Screen" mono>
              {trace.routeName}
            </Field>
          )}
          <Field label="Sent at">{formatDateTime(trace.timestamp)} UTC</Field>
          {trace.traceId && (
            <Field label="Trace id" mono>
              <span className="select-all">{trace.traceId}</span>
            </Field>
          )}
        </Section>

        <Section title="Response">
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
          {trace.contentType && (
            <Field label="Content type" mono>
              {trace.contentType}
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
        </Section>
      </div>

      {network && (
        <div className="border-t border-line">
          <Section title="Sent by">
            <Field label="User">
              <UserChip label={userLabel(network)} />
              {network.userId && network.userId !== userLabel(network) && (
                <span className="ml-1.5 font-mono text-ink-3">{network.userId}</span>
              )}
            </Field>
            <Field label="App">
              {network.projectName} · {network.appVersion} · {network.platform}
            </Field>
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
          </Section>
        </div>
      )}

      <div className="border-t border-line px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-ink-3">
            Response body
            {body && (
              <span className="font-normal">
                {' '}
                · first 4 KB, credential-like keys redacted on device
              </span>
            )}
          </p>
          {body && <CopyButton value={body.text} />}
        </div>
        {body ? (
          <pre className="mt-1.5 max-h-80 overflow-auto rounded border border-line bg-night p-2.5 font-mono text-2xs whitespace-pre-wrap break-words text-ink-2">
            {body.text}
          </pre>
        ) : !outcome.answered ? (
          <p className="mt-1 text-ink-3">None: the API never answered this request.</p>
        ) : (
          <p className="mt-1 text-ink-3">
            Not captured. Set{' '}
            <code className="font-mono text-ink-2">networkResponseBodies: 'all'</code> in{' '}
            <code className="font-mono text-ink-2">Observe.configure</code> (SDK 0.4+) to keep what
            the API answered on every request
            {trace.statusCode >= 400 ? ', or ' : '. '}
            {trace.statusCode >= 400 && (
              <>
                <code className="font-mono text-ink-2">'errors'</code> for error responses only.
              </>
            )}
          </p>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 px-3 py-2.5">
      <h4 className="mb-1.5 text-2xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h4>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">{children}</dl>
    </section>
  );
}

function Field({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className={`min-w-0 wrap-anywhere text-ink-2 ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </>
  );
}
