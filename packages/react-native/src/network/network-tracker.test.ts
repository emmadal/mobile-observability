import { describe, expect, it } from 'vitest';
import { type CompletedRequest, NetworkTracker } from './network-tracker';

type Listener = () => void;

/** Minimal XMLHttpRequest double: `respond` / `fail` drive the lifecycle. */
class FakeXhr {
  static last: FakeXhr | null = null;
  status = 0;
  readyState = 0;
  response: unknown = null;
  requestHeaders: Record<string, string> = {};
  private readonly listeners = new Map<string, Listener[]>();
  private headers: Record<string, string> = {};

  open(_method: string, _url: string) {
    FakeXhr.last = this;
  }
  send(_body?: unknown) {}
  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  getResponseHeader(name: string) {
    return this.headers[name] ?? null;
  }
  private emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  respond(status: number, headers: Record<string, string> = {}) {
    this.status = status;
    this.headers = headers;
    this.readyState = 2;
    this.emit('readystatechange');
    this.readyState = 4;
    this.emit('loadend');
  }
  fail(kind: 'error' | 'timeout' | 'abort') {
    this.emit(kind);
    this.emit('loadend');
  }
}

function setup(ignore: (url: string) => boolean = () => false) {
  const clock = { now: 1_000 };
  const requests: CompletedRequest[] = [];
  const tracker = new NetworkTracker({
    now: () => clock.now,
    shouldIgnore: ignore,
    onRequest: (r) => requests.push(r),
  });
  const Xhr = class extends FakeXhr {};
  tracker.install(Xhr as unknown as typeof XMLHttpRequest);
  const request = (method: string, url: string) => {
    const xhr = new Xhr();
    xhr.open(method, url);
    xhr.send('{"a":1}');
    return xhr;
  };
  return { clock, requests, tracker, request };
}

describe('NetworkTracker (AC-5)', () => {
  it('records sanitized, templated requests with duration and sizes', () => {
    const { clock, requests, request } = setup();
    const xhr = request('get', 'https://api.example.com/users/123?token=secret#x');
    clock.now += 87;
    xhr.respond(200, { 'content-length': '512' });
    expect(requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        host: 'api.example.com',
        path: '/users/:id',
        statusCode: 200,
        durationMs: 87,
        bytesReceived: 512,
        bytesSent: 7,
      }),
    ]);
    expect(JSON.stringify(requests)).not.toContain('secret');
  });

  it('injects a W3C traceparent header and records the trace id', () => {
    const { requests, request } = setup();
    const xhr = request('GET', 'https://api.example.com/orders');
    xhr.respond(200);
    const header = xhr.requestHeaders.traceparent;
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(requests[0]?.traceId).toBe(header?.slice(3, 35));
    // A second request gets its own trace id.
    const second = request('GET', 'https://api.example.com/orders');
    second.respond(200);
    expect(requests[1]?.traceId).not.toBe(requests[0]?.traceId);
  });

  it('records network failures as status 0 with the failure kind', () => {
    const { requests, request } = setup();
    request('POST', 'https://api.example.com/orders').fail('timeout');
    expect(requests[0]).toMatchObject({ statusCode: 0, error: 'timeout', method: 'POST' });
  });

  it('ignores URLs the predicate excludes (own endpoint, ignoreUrls)', () => {
    const { requests, request } = setup((url) => url.startsWith('https://obs.example.com/api/v1/'));
    request('POST', 'https://obs.example.com/api/v1/envelope').respond(202);
    request('GET', 'https://api.example.com/a').respond(200);
    expect(requests).toHaveLength(1);
  });

  it('summarizes requests that finished inside a window', () => {
    const { clock, tracker, request } = setup();
    const slow = request('GET', 'https://api.example.com/feed');
    clock.now += 400;
    slow.respond(200, { 'content-length': '1000' });
    const failed = request('GET', 'https://api.example.com/ads');
    clock.now += 50;
    failed.respond(500);
    const summary = tracker.summarize(0, clock.now);
    expect(summary).toMatchObject({
      count: 2,
      failed: 1,
      bytesReceived: 1000,
      totalDuration: 450,
      slowest: { duration: 400, host: 'api.example.com', statusCode: 200 },
    });
    expect(tracker.summarize(clock.now + 1, clock.now + 2)).toBeNull();
  });
});

describe('NetworkTracker fetch wrapping', () => {
  function setupFetch(impl: typeof fetch) {
    const clock = { now: 1_000 };
    const requests: CompletedRequest[] = [];
    const tracker = new NetworkTracker({
      now: () => clock.now,
      shouldIgnore: (url) => url.includes('/api/v1/'),
      onRequest: (request) => requests.push(request),
    });
    const target: { fetch?: typeof fetch } = { fetch: impl };
    tracker.installFetch(target);
    return { clock, requests, target, tracker };
  }

  it('records native fetch requests (expo/fetch) with status and size', async () => {
    const { requests, target, clock } = setupFetch(async () => {
      clock.now += 120;
      return new Response('{}', { status: 404, headers: { 'content-length': '2' } });
    });
    await target.fetch?.('https://api.example.com/items/9?q=secret', {
      method: 'post',
      body: 'abc',
    });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      host: 'api.example.com',
      path: '/items/:id',
      statusCode: 404,
      durationMs: 120,
      bytesReceived: 2,
      bytesSent: 3,
    });
  });

  it('records failures as status 0 and rethrows', async () => {
    const { requests, target } = setupFetch(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(target.fetch?.('https://down.example.com/')).rejects.toThrow(
      'Network request failed',
    );
    expect(requests[0]).toMatchObject({ statusCode: 0, error: 'network error' });
  });

  it('skips ignored URLs and the XHR-based polyfill', async () => {
    const { requests, target } = setupFetch(async () => new Response(null, { status: 202 }));
    await target.fetch?.('https://obs.example.com/api/v1/envelope');
    expect(requests).toHaveLength(0);

    const polyfill = Object.assign(async () => new Response(null), {
      polyfill: true,
    }) as unknown as typeof fetch;
    const { target: untouched } = setupFetch(polyfill);
    expect(untouched.fetch).toBe(polyfill);
  });

  it('restores fetch on uninstall', () => {
    const impl = (async () => new Response(null)) as typeof fetch;
    const { target, tracker } = setupFetch(impl);
    expect(target.fetch).not.toBe(impl);
    tracker.uninstall();
    expect(target.fetch).toBe(impl);
  });
});
