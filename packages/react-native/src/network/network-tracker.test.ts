import { describe, expect, it, vi } from 'vitest';
import { type CompletedRequest, NetworkTracker } from './network-tracker';

type Listener = () => void;

/** Minimal XMLHttpRequest double: `respond` / `fail` drive the lifecycle. */
class FakeXhr {
  static last: FakeXhr | null = null;
  status = 0;
  readyState = 0;
  response: unknown = null;
  responseType: XMLHttpRequestResponseType = '';
  responseText = '';
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
  respond(status: number, headers: Record<string, string> = {}, body = '') {
    this.status = status;
    this.headers = headers;
    this.responseText = body;
    this.response = this.responseType === 'json' && body ? JSON.parse(body) : body;
    this.readyState = 2;
    this.emit('readystatechange');
    this.readyState = 4;
    this.emit('loadend');
  }
  fail(kind: 'error' | 'timeout' | 'abort', nativeMessage = '') {
    // React Native stores the native failure message as the text response.
    this.responseText = nativeMessage;
    this.emit(kind);
    this.emit('loadend');
  }
}

function setup(ignore: (url: string) => boolean = () => false, captureErrorBodies = false) {
  const clock = { now: 1_000 };
  const requests: CompletedRequest[] = [];
  const tracker = new NetworkTracker({
    now: () => clock.now,
    shouldIgnore: ignore,
    onRequest: (r) => requests.push(r),
    captureErrorBodies,
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

  it('keeps the native failure message of a failed request', () => {
    const { requests, request } = setup();
    request('GET', 'https://api.example.com/a').fail(
      'error',
      'Unable to resolve host "api.example.com"',
    );
    request('GET', 'https://api.example.com/b').fail('timeout', 'The request timed out.');
    expect(requests[0]).toMatchObject({
      statusCode: 0,
      error: 'network error',
      errorMessage: 'Unable to resolve host "api.example.com"',
    });
    expect(requests[1]).toMatchObject({ error: 'timeout', errorMessage: 'The request timed out.' });
  });

  it('never reads response bodies unless error bodies are enabled', () => {
    const { requests, request } = setup();
    request('POST', 'https://api.example.com/login').respond(
      401,
      { 'content-type': 'application/json' },
      '{"message":"Invalid PIN"}',
    );
    expect(requests[0]?.statusCode).toBe(401);
    expect(requests[0]).not.toHaveProperty('responseBody');
  });

  it('keeps the redacted body of error responses when enabled, never of successes', () => {
    const { requests, request } = setup(() => false, true);
    request('POST', 'https://api.example.com/login').respond(
      401,
      { 'content-type': 'application/json' },
      '{"message":"Invalid PIN","pin":"1234","data":{"access_token":"abc"}}',
    );
    request('GET', 'https://api.example.com/ok').respond(200, {}, '{"name":"secret profile"}');
    request('GET', 'https://api.example.com/gateway').respond(
      502,
      { 'content-type': 'text/html' },
      '<html><body>502 Bad Gateway</body></html>',
    );
    request('GET', 'https://api.example.com/file').respond(
      500,
      { 'content-type': 'image/png' },
      'PNG',
    );
    expect(requests[0]?.responseBody).toBe(
      '{"message":"Invalid PIN","pin":"[redacted]","data":{"access_token":"[redacted]"}}',
    );
    expect(requests[1]).not.toHaveProperty('responseBody');
    expect(requests[2]?.responseBody).toBe('<html><body>502 Bad Gateway</body></html>');
    expect(requests[3]).not.toHaveProperty('responseBody');
  });

  it('serializes JSON-typed XHR error responses', () => {
    const { requests, request } = setup(() => false, true);
    const xhr = request('GET', 'https://api.example.com/x');
    xhr.responseType = 'json';
    xhr.respond(422, {}, '{"errors":{"msisdn":"invalid"}}');
    expect(requests[0]?.responseBody).toBe('{"errors":{"msisdn":"invalid"}}');
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
  function setupFetch(impl: typeof fetch, captureErrorBodies = false) {
    const clock = { now: 1_000 };
    const requests: CompletedRequest[] = [];
    const tracker = new NetworkTracker({
      now: () => clock.now,
      shouldIgnore: (url) => url.includes('/api/v1/'),
      onRequest: (request) => requests.push(request),
      captureErrorBodies,
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
    expect(requests[0]).toMatchObject({
      statusCode: 0,
      error: 'network error',
      errorMessage: 'TypeError: Network request failed',
    });
  });

  it('classifies AbortSignal.timeout and manual aborts', async () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    const { requests, target } = setupFetch(async () => {
      throw timeout;
    });
    await expect(target.fetch?.('https://slow.example.com/')).rejects.toBe(timeout);
    expect(requests[0]).toMatchObject({
      error: 'timeout',
      errorMessage: 'TimeoutError: The operation timed out.',
    });

    const abort = new DOMException('Aborted', 'AbortError');
    const aborted = setupFetch(async () => {
      throw abort;
    });
    await expect(aborted.target.fetch?.('https://slow.example.com/')).rejects.toBe(abort);
    expect(aborted.requests[0]).toMatchObject({ error: 'aborted' });
  });

  it('reads a clone of fetch error bodies without consuming the app response', async () => {
    const { requests, target } = setupFetch(
      async () =>
        new Response('{"message":"Agent not found","token":"t"}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      true,
    );
    const response = await target.fetch?.('https://api.example.com/agents/7');
    expect(await response?.json()).toEqual({ message: 'Agent not found', token: 't' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      statusCode: 404,
      responseBody: '{"message":"Agent not found","token":"[redacted]"}',
    });
  });

  it('records a slow error body without it after the read timeout', async () => {
    vi.useFakeTimers();
    try {
      const stalled = new ReadableStream<Uint8Array>({ start() {} });
      const { requests, target } = setupFetch(
        async () => new Response(stalled, { status: 503 }),
        true,
      );
      await target.fetch?.('https://api.example.com/stream');
      expect(requests).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ statusCode: 503 });
      expect(requests[0]).not.toHaveProperty('responseBody');
    } finally {
      vi.useRealTimers();
    }
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
