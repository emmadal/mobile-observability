import { LIMITS, sanitizeUrl } from '@mobile-observability/protocol';
import { traceId, traceparent } from '../core/ids';
import { redactUrl, sanitizeResponseBody } from '../core/redact';

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
  /** Full URL as called, credential-like query values redacted (opt-in). */
  url?: string;
  /** `Content-Type` of the response. */
  contentType?: string;
  /** Redacted start of the response body (opt-in: errors only, or every response). */
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
/** Server-sent events never end: their body is not something to read. */
const STREAM_CONTENT_TYPE = /event-stream/i;
/** A fetch response announced larger than this is not cloned and read. */
const MAX_BODY_READ_BYTES = 1024 * 1024;

/** Which responses keep their redacted body. */
export type ResponseBodyCapture = 'off' | 'errors' | 'all';

export interface NetworkTrackerOptions {
  now: () => number;
  shouldIgnore: (url: string) => boolean;
  onRequest: (request: CompletedRequest) => void;
  /**
   * Keep the redacted start of response bodies: never, only for errors
   * (status >= 400), or for every response that arrived (default 'off').
   */
  responseBodies?: ResponseBodyCapture;
  /** Keep the full URL as called, credential-like query values redacted. */
  fullUrls?: boolean;
}

/**
 * Patches XMLHttpRequest (React Native's fetch is built on it) to record
 * method, sanitized URL, status, duration and sizes (AC-5). Request bodies and
 * headers are never read; a failed request keeps its failure message. With
 * `responseBodies` a response keeps its redacted body, and with `fullUrls` the
 * URL as called (credential-like query values redacted).
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
      const url = requestUrl(input);
      if (url === undefined || tracker.options.shouldIgnore(url)) return original(input, init);
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
          ...tracker.fullUrl(url),
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
      const contentType = readFetchHeader(response, 'content-type');
      const now = tracker.options.now();
      const request: CompletedRequest = {
        ...sanitizeUrl(url),
        ...tracker.fullUrl(url),
        method,
        statusCode: response.status,
        startedAt,
        // fetch resolves when headers arrive: this is time to first byte.
        durationMs: Math.max(0, now - startedAt),
        timeToFirstByteMs: Math.max(0, now - startedAt),
        ...(Number.isFinite(length) ? { bytesReceived: length } : {}),
        ...(bytesSent !== undefined ? { bytesSent } : {}),
        ...(contentType ? { contentType } : {}),
        traceId: id,
      };
      if (
        tracker.keepsBody(response.status) &&
        isReadableBody(contentType) &&
        !(Number.isFinite(length) && length > MAX_BODY_READ_BYTES)
      ) {
        // The clone is taken before the app sees the response; the app is not
        // kept waiting while the body is read.
        void readFetchBody(response).then(({ body, length: read }) =>
          tracker.record({
            ...request,
            ...(body ? { responseBody: body } : {}),
            ...(request.bytesReceived === undefined && read !== undefined
              ? { bytesReceived: read }
              : {}),
          }),
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

  /** Whether a response with this status keeps its body under the configured mode. */
  keepsBody(statusCode: number): boolean {
    const mode = this.options.responseBodies ?? 'off';
    if (mode === 'all') return statusCode > 0;
    if (mode === 'errors') return statusCode >= 400;
    return false;
  }

  /** `{ url }` with the redacted full URL when full URLs are on, `{}` otherwise. */
  fullUrl(url: string): { url?: string } {
    return this.options.fullUrls ? { url: redactUrl(url, LIMITS.maxUrlLength) } : {};
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
    const contentType = statusCode > 0 ? readXhrHeader(xhr, 'content-type') : undefined;
    const responseBody =
      this.keepsBody(statusCode) && isReadableBody(contentType) ? readXhrBody(xhr) : undefined;
    const request: CompletedRequest = {
      method: state.method.toUpperCase(),
      host,
      path,
      ...this.fullUrl(state.url),
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
      ...(contentType ? { contentType } : {}),
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

/** Text-like and not a never-ending event stream: worth reading. */
function isReadableBody(contentType: string | null | undefined): boolean {
  if (!contentType) return true;
  return TEXT_CONTENT_TYPE.test(contentType) && !STREAM_CONTENT_TYPE.test(contentType);
}

/** The request's URL whatever its form: string, URL (any polyfill) or Request. */
function requestUrl(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const { href, url } = input as { href?: unknown; url?: unknown };
    if (typeof href === 'string') return href;
    if (typeof url === 'string') return url;
    const text = String(input);
    return text.startsWith('[object') ? undefined : text;
  }
  return undefined;
}

function readXhrHeader(xhr: XMLHttpRequest, name: string): string | undefined {
  try {
    return xhr.getResponseHeader(name)?.trim().slice(0, 128) || undefined;
  } catch {
    return undefined;
  }
}

function readFetchHeader(response: Response, name: string): string | undefined {
  try {
    return response.headers?.get?.(name)?.trim().slice(0, 128) || undefined;
  } catch {
    return undefined;
  }
}

/** Body of a finished XHR when it is text or parsed JSON; blobs are skipped. */
function readXhrBody(xhr: XMLHttpRequest): string | undefined {
  try {
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

interface ReadBody {
  /** Redacted start of the body. */
  body?: string;
  /** Characters read, when the body was read to the end. */
  length?: number;
}

/** Reads a clone of a response; empty when unreadable or too slow. */
function readFetchBody(response: Response): Promise<ReadBody> {
  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    return Promise.resolve({});
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReadBody>((resolve) => {
    timer = setTimeout(() => {
      // Stop buffering the abandoned branch of the tee.
      void clone.body?.cancel?.().catch(() => {});
      resolve({});
    }, BODY_READ_TIMEOUT_MS);
  });
  const read = clone
    .text()
    .then(
      (text): ReadBody => ({
        body: sanitizeResponseBody(text, LIMITS.maxResponseBodyLength),
        length: text.length,
      }),
    )
    .catch((): ReadBody => ({}));
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

export function isFailure(statusCode: number): boolean {
  return statusCode === 0 || statusCode >= 400;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
