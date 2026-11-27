import { LIMITS, sanitizeUrl } from '@mobile-observability/protocol';
import { traceId, traceparent } from '../core/ids';
import { sanitizeResponseBody } from '../core/redact';

export interface CompletedRequest {
  method: string;
  host: string;
  path: string;
  statusCode: number;
  startedAt: number;
  durationMs: number;
  bytesReceived?: number;
  bytesSent?: number;
  timeToFirstByteMs?: number;
  /** Failure kind when no response arrived: network error, timeout, aborted. */
  error?: string;
  /** The platform's or the JS error's own message for that failure. */
  errorMessage?: string;
  /** Redacted start of an error response body (opt-in). */
  responseBody?: string;
  /** W3C trace id propagated to the backend in the `traceparent` header. */
  traceId?: string;
}

export interface RequestSummary {
  count: number;
  failed: number;
  bytesReceived: number;
  bytesSent: number;
  totalDuration: number;
  slowest?: {
    duration: number;
    host: string;
    statusCode: number;
    timeToFirstByte?: number;
    bytesReceived?: number;
  };
}

type XhrConstructor = typeof XMLHttpRequest;

interface TrackedXhr extends XMLHttpRequest {
  __mobs?: {
    method: string;
    url: string;
    startedAt?: number;
    firstByteAt?: number;
    bytesSent?: number;
    error?: string;
    traceId?: string;
  };
}

const RING_SIZE = 200;
const MAX_ERROR_MESSAGE = 512;
/** An error body still streaming after this long is recorded without it. */
const BODY_READ_TIMEOUT_MS = 2_000;
const TEXT_CONTENT_TYPE = /json|text|xml|html|x-www-form-urlencoded/i;

export interface NetworkTrackerOptions {
  now: () => number;
  shouldIgnore: (url: string) => boolean;
  onRequest: (request: CompletedRequest) => void;
  /** Keep the redacted start of error response bodies (status >= 400). */
  captureErrorBodies?: boolean;
}

/**
 * Patches XMLHttpRequest (React Native's fetch is built on it) to record
 * method, sanitized URL, status, duration and sizes (AC-5). Request bodies and
 * headers are never read; a failed request keeps its failure message, and an
 * error response its redacted body only when `captureErrorBodies` is on.
 */
export class NetworkTracker {
  private readonly recent: CompletedRequest[] = [];
  private restore: (() => void) | null = null;
  private restoreFetch: (() => void) | null = null;

  constructor(private readonly options: NetworkTrackerOptions) {}

  install(Xhr: XhrConstructor | undefined): void {
    if (!Xhr || this.restore) return;
    const proto = Xhr.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const tracker = this;

    proto.open = function open(
      this: TrackedXhr,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      const href = String(url);
      if (!tracker.options.shouldIgnore(href)) {
        this.__mobs = { method: String(method || 'GET'), url: href };
      } else {
        this.__mobs = undefined;
      }
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as XMLHttpRequest['open'];

    proto.send = function send(this: TrackedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
      const state = this.__mobs;
      if (state) {
        state.startedAt = tracker.options.now();
        state.traceId = traceId();
        try {
          this.setRequestHeader('traceparent', traceparent(state.traceId));
        } catch {
          // Request already sent or headers frozen; the id still records locally.
        }
        state.bytesSent = typeof body === 'string' ? body.length : undefined;
        const onFailure = (kind: string) => () => {
          state.error = kind;
        };
        this.addEventListener('error', onFailure('network error'));
        this.addEventListener('timeout', onFailure('timeout'));
        this.addEventListener('abort', onFailure('aborted'));
        this.addEventListener('readystatechange', () => {
          if (this.readyState >= 2 && state.firstByteAt === undefined) {
            state.firstByteAt = tracker.options.now();
          }
        });
        this.addEventListener('loadend', () => tracker.complete(this, state));
      }
      return originalSend.call(this, body);
    };

    this.restore = () => {
      proto.open = originalOpen;
      proto.send = originalSend;
    };
  }

  /**
   * Expo replaces global fetch with a native implementation (expo/fetch) that
   * bypasses XMLHttpRequest, so fetch is wrapped too. React Native's own
   * polyfill (`fetch.polyfill === true`) runs on XHR and is left alone to
   * avoid counting requests twice.
   */
  installFetch(target: { fetch?: typeof fetch }): void {
    const original = target.fetch;
    if (!original || (original as { polyfill?: boolean }).polyfill || this.restoreFetch) return;
    const tracker = this;
    const wrapped = async function trackedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (tracker.options.shouldIgnore(url)) return original(input, init);
      const method = (
        init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
      ).toUpperCase();
      const startedAt = tracker.options.now();
      const bytesSent = typeof init?.body === 'string' ? init.body.length : undefined;
      const id = traceId();
      const headers = new Headers(init?.headers);
      headers.set('traceparent', traceparent(id));
      const trackedInit = { ...init, headers };
      let response: Response;
      try {
        response = await original(input, trackedInit);
      } catch (error) {
        const message = errorMessageOf(error);
        tracker.record({
          ...sanitizeUrl(url),
          method,
          statusCode: 0,
          startedAt,
          durationMs: Math.max(0, tracker.options.now() - startedAt),
          error: fetchFailureKind(error),
          ...(message ? { errorMessage: message } : {}),
          ...(bytesSent !== undefined ? { bytesSent } : {}),
          traceId: id,
        });
        throw error;
      }
      const length = Number(response.headers?.get?.('content-length') ?? Number.NaN);
      const now = tracker.options.now();
      const request: CompletedRequest = {
        ...sanitizeUrl(url),
        method,
        statusCode: response.status,
        startedAt,
        // fetch resolves when headers arrive: this is time to first byte.
        durationMs: Math.max(0, now - startedAt),
        timeToFirstByteMs: Math.max(0, now - startedAt),
        ...(Number.isFinite(length) ? { bytesReceived: length } : {}),
        ...(bytesSent !== undefined ? { bytesSent } : {}),
        traceId: id,
      };
      if (tracker.options.captureErrorBodies && response.status >= 400) {
        // The clone is taken before the app sees the response; the app is not
        // kept waiting while the error body is read.
        void readFetchBody(response).then((body) =>
          tracker.record(body ? { ...request, responseBody: body } : request),
        );
      } else {
        tracker.record(request);
      }
      return response;
    };
    target.fetch = wrapped as typeof fetch;
    this.restoreFetch = () => {
      target.fetch = original;
    };
  }

  uninstall(): void {
    this.restore?.();
    this.restore = null;
    this.restoreFetch?.();
    this.restoreFetch = null;
  }

  /** Summary of requests that finished in [from, to], for time-to-interactive params. */
  summarize(from: number, to: number): RequestSummary | null {
    const inWindow = this.recent.filter(
      (request) => request.startedAt >= from && request.startedAt + request.durationMs <= to,
    );
    if (inWindow.length === 0) return null;
    const failed = inWindow.filter((request) => isFailure(request.statusCode)).length;
    const completed = inWindow.filter((request) => request.statusCode > 0);
    const slowest = completed.reduce<CompletedRequest | undefined>(
      (max, request) => (!max || request.durationMs > max.durationMs ? request : max),
      undefined,
    );
    return {
      count: inWindow.length,
      failed,
      bytesReceived: sum(inWindow.map((request) => request.bytesReceived ?? 0)),
      bytesSent: sum(inWindow.map((request) => request.bytesSent ?? 0)),
      totalDuration: sum(inWindow.map((request) => request.durationMs)),
      ...(slowest
        ? {
            slowest: {
              duration: slowest.durationMs,
              host: slowest.host,
              statusCode: slowest.statusCode,
              ...(slowest.timeToFirstByteMs !== undefined
                ? { timeToFirstByte: slowest.timeToFirstByteMs }
                : {}),
              ...(slowest.bytesReceived !== undefined
                ? { bytesReceived: slowest.bytesReceived }
                : {}),
            },
          }
        : {}),
    };
  }

  private complete(xhr: TrackedXhr, state: NonNullable<TrackedXhr['__mobs']>): void {
    if (state.startedAt === undefined) return;
    const now = this.options.now();
    const { host, path } = sanitizeUrl(state.url);
    const statusCode = state.error ? 0 : xhr.status;
    const errorMessage = state.error ? readXhrFailure(xhr) : undefined;
    const responseBody =
      this.options.captureErrorBodies && statusCode >= 400 ? readXhrBody(xhr) : undefined;
    const request: CompletedRequest = {
      method: state.method.toUpperCase(),
      host,
      path,
      statusCode,
      startedAt: state.startedAt,
      durationMs: Math.max(0, now - state.startedAt),
      ...(state.bytesSent !== undefined ? { bytesSent: state.bytesSent } : {}),
      ...(responseSize(xhr) !== undefined ? { bytesReceived: responseSize(xhr) } : {}),
      ...(state.firstByteAt !== undefined && statusCode > 0
        ? { timeToFirstByteMs: state.firstByteAt - state.startedAt }
        : {}),
      ...(state.error ? { error: state.error } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(responseBody ? { responseBody } : {}),
      ...(state.traceId ? { traceId: state.traceId } : {}),
    };
    this.record(request);
  }

  private record(request: CompletedRequest): void {
    this.recent.push(request);
    if (this.recent.length > RING_SIZE) this.recent.shift();
    this.options.onRequest(request);
  }
}

function responseSize(xhr: XMLHttpRequest): number | undefined {
  try {
    const header = xhr.getResponseHeader('content-length');
    if (header) {
      const parsed = Number(header);
      if (Number.isFinite(parsed)) return parsed;
    }
    const response: unknown = xhr.response;
    if (typeof response === 'string') return response.length;
    if (response && typeof response === 'object' && 'size' in response) {
      const size = (response as { size: unknown }).size;
      if (typeof size === 'number') return size;
    }
  } catch {
    // Some response types throw on access; size is optional.
  }
  return undefined;
}

/** Timeout, abort or plain network failure of a rejected fetch. */
function fetchFailureKind(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'aborted';
  return 'network error';
}

/** "TypeError: Network request failed", cut to the protocol limit. */
function errorMessageOf(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  const { name, message } = error as { name?: unknown; message?: unknown };
  const text =
    typeof message === 'string' && message
      ? typeof name === 'string' && name && name !== 'Error'
        ? `${name}: ${message}`
        : message
      : typeof error === 'string'
        ? error
        : undefined;
  return text?.trim().slice(0, MAX_ERROR_MESSAGE) || undefined;
}

/**
 * React Native puts the native failure message ("The request timed out.",
 * "Unable to resolve host ...") in `responseText` of a failed text request.
 */
function readXhrFailure(xhr: XMLHttpRequest): string | undefined {
  try {
    if (xhr.responseType !== '' && xhr.responseType !== 'text') return undefined;
    const text = xhr.responseText;
    return typeof text === 'string'
      ? text.trim().slice(0, MAX_ERROR_MESSAGE) || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

function isTextContent(contentType: string | null | undefined): boolean {
  return !contentType || TEXT_CONTENT_TYPE.test(contentType);
}

/** Error body of a finished XHR when it is text or parsed JSON; blobs are skipped. */
function readXhrBody(xhr: XMLHttpRequest): string | undefined {
  try {
    if (!isTextContent(xhr.getResponseHeader('content-type'))) return undefined;
    if (xhr.responseType === '' || xhr.responseType === 'text') {
      const text = xhr.responseText;
      return typeof text === 'string'
        ? sanitizeResponseBody(text, LIMITS.maxResponseBodyLength)
        : undefined;
    }
    if (xhr.responseType === 'json' && xhr.response !== null && xhr.response !== undefined) {
      return sanitizeResponseBody(JSON.stringify(xhr.response), LIMITS.maxResponseBodyLength);
    }
  } catch {
    // Some response types throw on access; the body is optional.
  }
  return undefined;
}

/** Reads a clone of an error response; undefined when not text, unreadable or too slow. */
function readFetchBody(response: Response): Promise<string | undefined> {
  let clone: Response;
  try {
    if (!isTextContent(response.headers?.get?.('content-type'))) {
      return Promise.resolve(undefined);
    }
    clone = response.clone();
  } catch {
    return Promise.resolve(undefined);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), BODY_READ_TIMEOUT_MS);
  });
  const read = clone
    .text()
    .then((text) => sanitizeResponseBody(text, LIMITS.maxResponseBodyLength))
    .catch(() => undefined);
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

export function isFailure(statusCode: number): boolean {
  return statusCode === 0 || statusCode >= 400;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
