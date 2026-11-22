import { sanitizeUrl } from '@mobile-observability/protocol';

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
  error?: string;
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
  };
}

const RING_SIZE = 200;

export interface NetworkTrackerOptions {
  now: () => number;
  shouldIgnore: (url: string) => boolean;
  onRequest: (request: CompletedRequest) => void;
}

/**
 * Patches XMLHttpRequest (React Native's fetch is built on it) to record
 * method, sanitized URL, status, duration and sizes (AC-5). Bodies and headers
 * are never read.
 */
export class NetworkTracker {
  private readonly recent: CompletedRequest[] = [];
  private restore: (() => void) | null = null;

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

  uninstall(): void {
    this.restore?.();
    this.restore = null;
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
    };
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

export function isFailure(statusCode: number): boolean {
  return statusCode === 0 || statusCode >= 400;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
