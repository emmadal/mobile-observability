import type { ItemInput } from '@mobile-observability/protocol';
import { describe, expect, it } from 'vitest';
import { type EnvelopeContext, PersistentQueue, type QueueStorage } from './queue';

function memoryStorage(): QueueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: async (key, value) => {
      if (value === null) data.delete(key);
      else data.set(key, value);
    },
  };
}

const context = (version = '1.0.0'): EnvelopeContext => ({
  installationId: 'i',
  app: { version, build: '1' },
  device: { platform: 'ios', osVersion: '26' },
});

const event = (n: number): ItemInput => ({
  type: 'event',
  eventId: `e${n}`,
  timestamp: n,
  name: 'x',
  severity: 'info',
});

describe('PersistentQueue (AC-9)', () => {
  it('survives a restart', async () => {
    const storage = memoryStorage();
    const queue = new PersistentQueue(storage);
    queue.enqueue(context(), event(1));
    await queue.persist();
    const restored = new PersistentQueue(storage);
    expect(restored.length).toBe(1);
    expect(restored.nextBatch(10, 1e6)?.items).toEqual([event(1)]);
  });

  it('drops the oldest items above the item cap', () => {
    const queue = new PersistentQueue(memoryStorage(), { maxItems: 3, maxBytes: 1e9 });
    for (let n = 1; n <= 5; n += 1) queue.enqueue(context(), event(n));
    expect(queue.length).toBe(3);
    expect(queue.droppedCount).toBe(2);
    expect(
      queue.nextBatch(10, 1e6)?.items.map((item) => (item as { eventId: string }).eventId),
    ).toEqual(['e3', 'e4', 'e5']);
  });

  it('drops the oldest items above the byte cap', () => {
    const size = JSON.stringify(event(1)).length;
    const queue = new PersistentQueue(memoryStorage(), { maxItems: 100, maxBytes: size * 2 });
    for (let n = 1; n <= 4; n += 1) queue.enqueue(context(), event(n));
    expect(queue.length).toBe(2);
  });

  it('batches only items that share a context, oldest first', () => {
    const queue = new PersistentQueue(memoryStorage());
    queue.enqueue(context('1'), event(1));
    queue.enqueue(context('1'), event(2));
    queue.enqueue(context('2'), event(3));
    const first = queue.nextBatch(10, 1e6);
    expect(first?.items).toHaveLength(2);
    expect(first?.context.app.version).toBe('1');
    if (first) queue.remove(first);
    expect(queue.nextBatch(10, 1e6)?.context.app.version).toBe('2');
  });

  it('respects the batch item limit', () => {
    const queue = new PersistentQueue(memoryStorage());
    for (let n = 1; n <= 5; n += 1) queue.enqueue(context(), event(n));
    expect(queue.nextBatch(2, 1e6)?.items).toHaveLength(2);
  });

  it('starts empty when the stored queue is corrupt', () => {
    const storage = memoryStorage();
    storage.data.set('queue.v1', '{not json');
    expect(new PersistentQueue(storage).length).toBe(0);
  });
});
