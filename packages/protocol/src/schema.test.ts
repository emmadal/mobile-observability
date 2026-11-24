import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, isSupportedSchemaVersion, LIMITS } from './constants.js';
import { parseEnvelope } from './schema.js';

const baseEnvelope = () => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  sentAt: 1_763_800_000_000,
  sdk: { name: '@mobile-observability/react-native', version: '0.1.0' },
  installationId: 'inst-1',
  app: { version: '1.2.0', build: '42', environment: 'production' },
  device: { platform: 'ios', osVersion: '26.1' },
  items: [] as unknown[],
});

const errorItem = (overrides: Record<string, unknown> = {}) => ({
  type: 'error',
  eventId: '0b9a3b3e-4c7e-4b0b-9d0c-2f3e1d3a6b7c',
  timestamp: 1_763_800_000_000,
  origin: 'js',
  kind: 'exception',
  fatal: false,
  handled: true,
  exception: {
    type: 'TypeError',
    message: "Cannot read property 'x' of undefined",
    frames: [{ function: 'onPress', file: 'app/index.tsx', line: 12, column: 4, inApp: true }],
  },
  breadcrumbs: [],
  ...overrides,
});

describe('isSupportedSchemaVersion (AC-16)', () => {
  it('accepts the current and the previous version only', () => {
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION - 1)).toBe(CURRENT_SCHEMA_VERSION > 1);
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION + 1)).toBe(false);
    expect(isSupportedSchemaVersion(0)).toBe(false);
  });
});

describe('parseEnvelope', () => {
  it('accepts a valid envelope with an error item', () => {
    const result = parseEnvelope({ ...baseEnvelope(), items: [errorItem()] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.items).toHaveLength(1);
      expect(result.droppedItems).toBe(0);
    }
  });

  it('ignores unknown fields at every level (AC-16)', () => {
    const result = parseEnvelope({
      ...baseEnvelope(),
      futureField: 'x',
      items: [errorItem({ futureItemField: 1 })],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope).not.toHaveProperty('futureField');
      expect(result.envelope.items[0]).not.toHaveProperty('futureItemField');
    }
  });

  it('drops items with an unknown type and counts them', () => {
    const result = parseEnvelope({
      ...baseEnvelope(),
      items: [errorItem(), { type: 'hologram', eventId: 'x' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.items).toHaveLength(1);
      expect(result.droppedItems).toBe(1);
    }
  });

  it('rejects an unsupported schema version', () => {
    const result = parseEnvelope({ ...baseEnvelope(), schemaVersion: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('schemaVersion');
  });

  it('reports the field path of an invalid item (AC-13)', () => {
    const result = parseEnvelope({ ...baseEnvelope(), items: [errorItem({ origin: 'martian' })] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('items.0.origin');
  });

  it('rejects more than the maximum number of items', () => {
    const items = Array.from({ length: LIMITS.maxItemsPerEnvelope + 1 }, () => errorItem());
    const result = parseEnvelope({ ...baseEnvelope(), items });
    expect(result.ok).toBe(false);
  });

  it('truncates oversized messages and frame lists instead of rejecting', () => {
    const frames = Array.from({ length: 150 }, (_, i) => ({ function: `f${i}`, inApp: true }));
    const result = parseEnvelope({
      ...baseEnvelope(),
      items: [
        errorItem({
          exception: { type: 'Error', message: 'x'.repeat(5000), frames },
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const item = result.envelope.items[0];
      if (item?.type !== 'error') throw new Error('expected error item');
      expect(item.exception.message.length).toBe(LIMITS.maxMessageLength);
      expect(item.exception.frames).toHaveLength(LIMITS.maxFrames);
      expect(item.exception.frames[0]?.function).toBe('f0');
    }
  });

  it('accepts every item type', () => {
    const ts = 1_763_800_000_000;
    const result = parseEnvelope({
      ...baseEnvelope(),
      items: [
        {
          type: 'session',
          sessionId: 's1',
          startedAt: ts,
          status: 'ok',
          errorCount: 0,
          init: true,
        },
        {
          type: 'metric',
          eventId: 'm1',
          timestamp: ts,
          name: 'app_startup.cold_launch_time',
          valueMs: 812,
        },
        {
          type: 'metric',
          eventId: 'm2',
          timestamp: ts,
          name: 'navigation.cold_ttr',
          valueMs: 120,
          routeName: '/product/[id]',
          params: { isAppLaunch: false },
        },
        {
          type: 'request',
          eventId: 'r1',
          timestamp: ts,
          method: 'GET',
          host: 'api.example.com',
          path: '/users/:id',
          statusCode: 200,
          durationMs: 87,
          timeToFirstByteMs: 41,
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        },
        {
          type: 'event',
          eventId: 'e1',
          timestamp: ts,
          name: 'onboarding.completed',
          severity: 'info',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.items).toHaveLength(5);
  });

  it('rejects an unknown metric name', () => {
    const result = parseEnvelope({
      ...baseEnvelope(),
      items: [{ type: 'metric', eventId: 'm1', timestamp: 1, name: 'cpu.temp', valueMs: 1 }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an oversized trace id on a request', () => {
    const result = parseEnvelope({
      ...baseEnvelope(),
      items: [
        {
          type: 'request',
          eventId: 'r1',
          timestamp: 1,
          method: 'GET',
          host: 'api.example.com',
          path: '/x',
          statusCode: 200,
          durationMs: 1,
          traceId: `${'a'.repeat(64)}overflow`,
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe('parseEnvelope hardening', () => {
  it('drops items whose type is an Object.prototype key instead of throwing', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const result = parseEnvelope({ ...baseEnvelope(), items: [{ type }] });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.droppedItems).toBe(1);
    }
  });

  it('rejects deeply nested attributes without overflowing the stack', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 100_000; i += 1) nested = { n: nested };
    const result = parseEnvelope({
      ...baseEnvelope(),
      items: [{ type: 'event', eventId: 'e1', timestamp: 1, name: 'deep', attributes: nested }],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts attributes nested within the limit', () => {
    const result = parseEnvelope({
      ...baseEnvelope(),
      items: [
        {
          type: 'event',
          eventId: 'e1',
          timestamp: 1,
          name: 'ok',
          attributes: { a: { b: { c: [1, 2, { d: 'x' }] } } },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});
