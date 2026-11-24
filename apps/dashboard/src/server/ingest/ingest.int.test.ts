import { gzipSync } from 'node:zlib';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiKeys, errorEvents, issues, logEvents, metrics, requests, sessions } from '@/db/schema';
import { clearKeyCache } from '@/server/keys/resolve';
import {
  CART_FRAMES,
  createTestProject,
  db,
  envelope,
  errorItem,
  ingestRequest,
  resetDatabase,
  type TestProject,
} from '../../../test/fixtures';
import { handleEnvelope } from './handle-envelope';
import { MAX_ENDPOINT_TEMPLATES_PER_DAY } from './process-envelope';
import { RateLimiter } from './rate-limit';

let project: TestProject;

beforeEach(async () => {
  await resetDatabase();
  project = await createTestProject();
});

const send = (body: unknown, headers: Record<string, string> = {}, key = project.ingestKey) =>
  handleEnvelope(ingestRequest(key, body, headers), db, { limiter: new RateLimiter(1_000, 1_000) });

describe('POST /api/v1/envelope status codes (AC-13)', () => {
  it('202 for a valid gzip envelope', async () => {
    const body = gzipSync(JSON.stringify(envelope([errorItem()])));
    const response = await send(new Uint8Array(body), { 'content-encoding': 'gzip' });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1, dropped: 0 });
  });

  it('401 for an unknown or revoked key', async () => {
    expect((await send(envelope([]), {}, 'mobs_pk_doesnotexist')).status).toBe(401);
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.projectId, project.projectId));
    clearKeyCache();
    expect((await send(envelope([]))).status).toBe(401);
  });

  it('400 with the field path for a schema error', async () => {
    const response = await send(envelope([errorItem({ origin: 'martian' as never })]));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues[0]?.path).toBe('items.0.origin');
  });

  it('400 for malformed JSON', async () => {
    expect((await send('{nope')).status).toBe(400);
  });

  it('413 when the decompressed body exceeds 1 MB (zip bomb safe)', async () => {
    const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x20));
    const response = await send(new Uint8Array(bomb), { 'content-encoding': 'gzip' });
    expect(response.status).toBe(413);
    expect((await send('x'.repeat(1_100_000))).status).toBe(413);
  });

  it('429 with Retry-After over the per-key rate limit', async () => {
    const limiter = new RateLimiter(1, 1);
    const first = await handleEnvelope(ingestRequest(project.ingestKey, envelope([])), db, {
      limiter,
    });
    const second = await handleEnvelope(ingestRequest(project.ingestKey, envelope([])), db, {
      limiter,
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });
});

describe('ingest processing', () => {
  it('stores a duplicate eventId once (AC-14)', async () => {
    const item = errorItem();
    await send(envelope([item]));
    await send(envelope([item]));
    const rows = await db.select().from(errorEvents);
    expect(rows).toHaveLength(1);
    const [issue] = await db.select().from(issues);
    expect(issue?.eventCount).toBe(1);
  });

  it('stores the device brand, model, locale and emulator flag', async () => {
    const item = errorItem({ sessionId: 's-device' });
    await send(
      envelope([item], {
        device: {
          platform: 'ios',
          osVersion: '26.1',
          model: 'iPhone18,1',
          manufacturer: 'Apple',
          locale: 'fr-FR',
          isEmulator: false,
        },
      }),
    );
    const [event] = await db.select().from(errorEvents);
    expect(event).toMatchObject({
      deviceBrand: 'Apple',
      deviceModel: 'iPhone18,1',
      deviceLocale: 'fr-FR',
      isEmulator: false,
    });
    const [session] = await db.select().from(sessions);
    expect(session).toMatchObject({
      deviceBrand: 'Apple',
      deviceModel: 'iPhone18,1',
      deviceLocale: 'fr-FR',
      isEmulator: false,
    });
  });

  it('shifts timestamps when the device clock is off by more than 60 s (AC-15)', async () => {
    const now = Date.now();
    const skew = 2 * 60 * 60_000; // device two hours behind
    await handleEnvelope(
      ingestRequest(
        project.ingestKey,
        envelope(
          [
            {
              type: 'metric',
              eventId: 'm-skew',
              timestamp: now - skew - 1_000,
              name: 'app_startup.ttr',
              valueMs: 900,
            },
          ],
          { sentAt: now - skew },
        ),
      ),
      db,
      { limiter: new RateLimiter(1_000, 1_000), now: () => now },
    );
    const [metric] = await db.select().from(metrics);
    expect(Math.abs((metric?.timestamp.getTime() ?? 0) - (now - 1_000))).toBeLessThan(5);
  });

  it('groups errors by cause, not by message (AC-18)', async () => {
    const withMessage = (message: string) =>
      errorItem({ exception: { type: 'TypeError', message, frames: CART_FRAMES } });
    await send(envelope([withMessage('user 123 failed')]));
    await send(envelope([withMessage('user 456 failed')]));
    await send(
      envelope([
        errorItem({
          exception: {
            type: 'TypeError',
            message: 'user 789 failed',
            frames: [{ function: 'applyCoupon', file: 'src/coupons.ts', line: 3, column: 1 }],
          },
        }),
      ]),
    );
    const rows = await db.select().from(issues).orderBy(issues.eventCount);
    expect(rows.map((row) => row.eventCount)).toEqual([1, 2]);
    expect(rows[1]?.culprit).toBe('src/cart.ts:12 in computeCartTotal');
  });

  it('reopens a resolved issue as regressed on a new event (AC-21)', async () => {
    await send(envelope([errorItem()]));
    const [issue] = await db.select().from(issues);
    await db
      .update(issues)
      .set({ status: 'resolved', resolvedAt: new Date(Date.now() - 60_000) })
      .where(eq(issues.id, issue?.id ?? ''));
    await send(envelope([errorItem({ timestamp: Date.now() })]));
    const [after] = await db.select().from(issues);
    expect(after).toMatchObject({
      status: 'open',
      regressed: true,
      resolvedAt: null,
      eventCount: 2,
    });
  });

  it('keeps ignored issues ignored', async () => {
    await send(envelope([errorItem()]));
    await db.update(issues).set({ status: 'ignored' });
    await send(envelope([errorItem()]));
    const [after] = await db.select().from(issues);
    expect(after?.status).toBe('ignored');
  });

  it('marks the session crashed for a fatal error and keeps severity monotonic', async () => {
    const startedAt = Date.now() - 10_000;
    await send(
      envelope([
        { type: 'session', sessionId: 's1', startedAt, status: 'ok', errorCount: 0, init: true },
        errorItem({ sessionId: 's1', fatal: true }),
      ]),
    );
    await send(
      envelope([
        { type: 'session', sessionId: 's1', startedAt, status: 'ok', errorCount: 0, init: false },
      ]),
    );
    const [session] = await db.select().from(sessions);
    expect(session?.status).toBe('crashed');
    expect(session?.endedAt).not.toBeNull();
  });

  it('labels JS issues for OTA updates and native issues for new builds', async () => {
    await send(
      envelope([
        errorItem(),
        errorItem({
          origin: 'native',
          kind: 'signal',
          fatal: true,
          exception: {
            type: 'SIGSEGV',
            message: 'SIGSEGV at 0x10',
            frames: [{ function: 'App + 0x1a', module: 'App', native: true, inApp: true }],
          },
        }),
      ]),
    );
    const rows = await db.select({ origin: issues.origin }).from(issues);
    expect(rows.map((row) => row.origin).sort()).toEqual(['js', 'native']);
  });

  it('never stores query strings and re-templates paths (AC-31)', async () => {
    await send(
      envelope([
        {
          type: 'request',
          eventId: 'r1',
          timestamp: Date.now(),
          method: 'get',
          host: 'api.example.com',
          path: '/users/42?token=secret',
          statusCode: 200,
          durationMs: 80,
        },
      ]),
    );
    const [row] = await db.select().from(requests);
    expect(row).toMatchObject({ method: 'GET', host: 'api.example.com', path: '/users/:id' });
    expect(JSON.stringify(row)).not.toContain('secret');
  });

  it('collapses new endpoints into /:other above the daily cap', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const values = Array.from({ length: MAX_ENDPOINT_TEMPLATES_PER_DAY }, (_, i) => ({
      projectId: project.projectId,
      day,
      endpoint: `GET h/${i}`,
    }));
    const { endpointTemplates } = await import('@/db/schema');
    await db.insert(endpointTemplates).values(values);
    await send(
      envelope([
        {
          type: 'request',
          eventId: 'r-over',
          timestamp: Date.now(),
          method: 'GET',
          host: 'api.example.com',
          path: '/brand-new',
          statusCode: 200,
          durationMs: 5,
        },
      ]),
    );
    const [row] = await db.select().from(requests).where(eq(requests.eventId, 'r-over'));
    expect(row?.path).toBe('/:other');
  });

  it('stores events and drops items older than retention', async () => {
    await send(
      envelope([
        {
          type: 'event',
          eventId: 'e1',
          timestamp: Date.now(),
          name: 'cart.checkout',
          severity: 'info',
          attributes: { items: 3 },
        },
        {
          type: 'event',
          eventId: 'e-old',
          timestamp: Date.now() - 40 * 86_400_000,
          name: 'old',
          severity: 'info',
        },
      ]),
    );
    const rows = await db
      .select()
      .from(logEvents)
      .where(and(eq(logEvents.projectId, project.projectId)));
    expect(rows.map((row) => row.name)).toEqual(['cart.checkout']);
  });

  it('accepts but discards data while the SDK kill switch is off', async () => {
    const { projects } = await import('@/db/schema');
    await db.update(projects).set({ sdkEnabled: false });
    clearKeyCache();
    const response = await send(envelope([errorItem()]));
    expect(response.status).toBe(202);
    expect(await db.select().from(errorEvents)).toHaveLength(0);
  });
});
