import type { EnvelopeInput } from '@mobile-observability/protocol';
import { describe, expect, it } from 'vitest';
import { decodeBody } from '../__tests__/helpers';
import { backoffDelay, parseRetryAfter } from './backoff';
import { PersistentQueue } from './queue';
import { type HttpPost, Transport } from './transport';

function setup(statuses: (number | 'network')[], retryAfter: string | null = null) {
  const storage = new Map<string, string>();
  const queue = new PersistentQueue({
    get: (key) => storage.get(key) ?? null,
    set: async (key, value) => {
      if (value === null) storage.delete(key);
      else storage.set(key, value);
    },
  });
  const clock = { now: 1_000_000 };
  const sent: { envelope: EnvelopeInput; headers: Record<string, string> }[] = [];
  const post: HttpPost = async (_url, init) => {
    sent.push({ envelope: decodeBody(init.body), headers: init.headers });
    const status = statuses.shift() ?? 202;
    if (status === 'network') throw new Error('offline');
    return { status, headers: { get: (name) => (name === 'retry-after' ? retryAfter : null) } };
  };
  const transport = new Transport({
    endpoint: 'https://obs.example.com/',
    apiKey: 'pk_test',
    sdk: { name: 'sdk', version: '1' },
    queue,
    post,
    now: () => clock.now,
  });
  queue.enqueue(
    {
      installationId: 'i',
      app: { version: '1', build: '1' },
      device: { platform: 'ios', osVersion: '26' },
    },
    { type: 'event', eventId: 'e1', timestamp: 1, name: 'x', severity: 'info' },
  );
  return { queue, transport, sent, clock };
}

describe('Transport (AC-9)', () => {
  it('sends a gzip envelope with the key header and removes items on 2xx', async () => {
    const { queue, transport, sent } = setup([202]);
    expect(transport.envelopeUrl).toBe('https://obs.example.com/api/v1/envelope');
    expect(await transport.flush()).toBe('sent');
    expect(queue.length).toBe(0);
    expect(sent[0]?.headers['content-encoding']).toBe('gzip');
    expect(sent[0]?.headers['x-mobs-key']).toBe('pk_test');
    expect(sent[0]?.envelope.items).toHaveLength(1);
    expect(sent[0]?.envelope.schemaVersion).toBe(1);
  });

  it('keeps items and backs off on network failure', async () => {
    const { queue, transport, sent, clock } = setup(['network', 202]);
    expect(await transport.flush()).toBe('retry');
    expect(queue.length).toBe(1);
    expect(await transport.flush()).toBe('backoff');
    expect(sent).toHaveLength(1);
    clock.now += 5 * 60_000;
    expect(await transport.flush()).toBe('sent');
    expect(queue.length).toBe(0);
  });

  it('honors Retry-After on 429', async () => {
    const { transport, clock } = setup([429, 202], '30');
    expect(await transport.flush()).toBe('retry');
    clock.now += 29_000;
    expect(await transport.flush()).toBe('backoff');
    clock.now += 2_000;
    expect(await transport.flush()).toBe('sent');
  });

  it('drops a batch the server rejects as invalid (no poison retries)', async () => {
    const { queue, transport } = setup([400]);
    expect(await transport.flush()).toBe('dropped');
    expect(queue.length).toBe(0);
  });

  it('retries on 5xx', async () => {
    const { queue, transport } = setup([503]);
    expect(await transport.flush()).toBe('retry');
    expect(queue.length).toBe(1);
  });
});

describe('backoff', () => {
  it('grows exponentially within [1 s, 5 min]', () => {
    expect(backoffDelay(0, () => 1)).toBe(1_000);
    expect(backoffDelay(3, () => 1)).toBe(8_000);
    expect(backoffDelay(30, () => 1)).toBe(300_000);
    expect(backoffDelay(3, () => 0)).toBe(4_000);
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('12', 0)).toBe(12_000);
    expect(parseRetryAfter(new Date(60_000).toUTCString(), 0)).toBe(60_000);
    expect(parseRetryAfter('garbage', 0)).toBeNull();
    expect(parseRetryAfter('99999', 0)).toBe(300_000);
  });
});
