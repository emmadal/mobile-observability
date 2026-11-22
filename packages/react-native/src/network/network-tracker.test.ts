import { describe, expect, it } from 'vitest';
import { type CompletedRequest, NetworkTracker } from './network-tracker';

type Listener = () => void;

/** Minimal XMLHttpRequest double: `respond` / `fail` drive the lifecycle. */
class FakeXhr {
  static last: FakeXhr | null = null;
  status = 0;
  readyState = 0;
  response: unknown = null;
  private readonly listeners = new Map<string, Listener[]>();
  private headers: Record<string, string> = {};

  open(_method: string, _url: string) {
    FakeXhr.last = this;
  }
  send(_body?: unknown) {}
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
