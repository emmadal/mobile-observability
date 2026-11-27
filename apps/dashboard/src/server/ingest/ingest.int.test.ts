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

  it('groups JS thread hangs into a single AppHang issue', async () => {
    const hang = (eventId: string, seconds: number) => ({
      type: 'error' as const,
      eventId,
      timestamp: Date.now(),
      origin: 'js' as const,
      kind: 'hang' as const,
      fatal: false,
      handled: true,
      exception: {
        type: 'AppHang',
        message: `JS thread blocked for ~${seconds} s`,
        frames: [],
      },
      breadcrumbs: [],
    });
    await send(envelope([hang('h1', 2), hang('h2', 7), hang('h3', 3)]));
    const [issue] = await db.select().from(issues);
    expect(issue).toMatchObject({ kind: 'hang', type: 'AppHang', eventCount: 3 });
    const events = await db.select().from(errorEvents);
    expect(events).toHaveLength(3);
    // Hangs never mark the session crashed: they are handled stalls.
    const sessionRows = await db.select().from(sessions);
    expect(sessionRows.every((session) => session.status !== 'crashed')).toBe(true);
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

  it('captures the client ip and geo headers at ingest', async () => {
    await send(envelope([errorItem({ sessionId: 's-geo' })]), {
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-vercel-ip-country': 'FR',
      'x-vercel-ip-city': 'Paris',
    });
    const [session] = await db.select().from(sessions);
    expect(session).toMatchObject({
      clientIp: '203.0.113.7',
      clientCountry: 'FR',
      clientCity: 'Paris',
    });

    // A city header arrives percent-encoded from Vercel.
    await send(envelope([errorItem({ sessionId: 's-geo-2' })]), {
      'x-real-ip': '198.51.100.2',
      'cf-ipcountry': 'US',
      'x-vercel-ip-city': 'New%20York',
    });
    const [second] = await db.select().from(sessions).where(eq(sessions.sessionId, 's-geo-2'));
    expect(second).toMatchObject({
      clientIp: '198.51.100.2',
      clientCountry: 'US',
      clientCity: 'New York',
    });

    // Without edge headers nothing is invented.
    await send(envelope([errorItem({ sessionId: 's-geo-3' })]));
    const [third] = await db.select().from(sessions).where(eq(sessions.sessionId, 's-geo-3'));
    expect(third).toMatchObject({ clientIp: null, clientCountry: null, clientCity: null });
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

  it('attributes a session to the user identified after it started, and keeps it on sign-out', async () => {
    const startedAt = Date.now() - 10_000;
    const session = (init: boolean) =>
      ({ type: 'session', sessionId: 's1', startedAt, status: 'ok', errorCount: 0, init }) as const;
    // The session starts before the app restores or signs in its user.
    await send(envelope([session(true)]));
    await send(envelope([errorItem({ sessionId: 's1' })], { user: { id: 'user-42' } }));
    let [row] = await db.select().from(sessions);
    expect(row?.userId).toBe('user-42');

    await send(envelope([session(false)]));
    [row] = await db.select().from(sessions);
    expect(row?.userId).toBe('user-42');

    await send(envelope([session(false)], { user: { id: 'user-43' } }));
    [row] = await db.select().from(sessions);
    expect(row?.userId).toBe('user-43');
  });

  it('links a session to the user carried by its requests, events and metrics', async () => {
    const startedAt = Date.now() - 10_000;
    await send(
      envelope([
        { type: 'session', sessionId: 's1', startedAt, status: 'ok', errorCount: 0, init: true },
      ]),
    );
    const request = {
      type: 'request',
      eventId: 'r-user',
      timestamp: Date.now(),
      sessionId: 's1',
      method: 'GET',
      host: 'api.example.com',
      path: '/agents/me',
      statusCode: 200,
      durationMs: 80,
    } as const;
    await send(envelope([request], { user: { id: 'kya:231770000002' } }));
    let [row] = await db.select().from(sessions);
    expect(row).toMatchObject({
      userId: 'kya:231770000002',
      userPhone: null,
      userSegment: 'kya',
    });

    // A 0.3 SDK names the phone and segment; the session follows the latest user.
    await send(
      envelope(
        [{ type: 'event', eventId: 'e-user', timestamp: Date.now(), sessionId: 's1', name: 'x.y' }],
        { user: { id: 'agent-9', phone: '231770000009', segment: 'merchant' } },
      ),
    );
    [row] = await db.select().from(sessions);
    expect(row).toMatchObject({
      userId: 'agent-9',
      userPhone: '231770000009',
      userSegment: 'merchant',
    });

    // Signed out: the session keeps its last user, phone and segment.
    await send(
      envelope([
        { type: 'session', sessionId: 's1', startedAt, status: 'ok', errorCount: 0, init: false },
      ]),
    );
    [row] = await db.select().from(sessions);
    expect(row).toMatchObject({ userId: 'agent-9', userPhone: '231770000009' });
  });

  it('stores the phone and segment sent with a session', async () => {
    await send(
      envelope(
        [
          {
            type: 'session',
            sessionId: 's2',
            startedAt: Date.now(),
            status: 'ok',
            errorCount: 0,
            init: true,
          },
        ],
        { user: { id: 'ftth:0886000000', phone: '0886000000' } },
      ),
    );
    const [row] = await db.select().from(sessions);
    expect(row).toMatchObject({ userPhone: '0886000000', userSegment: 'ftth' });
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

  it('stores request timings and the propagated trace id', async () => {
    await send(
      envelope([
        {
          type: 'request',
          eventId: 'r-trace',
          timestamp: Date.now(),
          method: 'POST',
          host: 'api.example.com',
          path: '/api/v1/payments',
          statusCode: 500,
          durationMs: 1250,
          timeToFirstByteMs: 1180,
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          networkType: 'wifi',
          responseBody: '{"message":"Payment provider unavailable"}',
        },
        {
          type: 'request',
          eventId: 'r-offline',
          timestamp: Date.now(),
          method: 'GET',
          host: 'api.example.com',
          path: '/api/v1/balance',
          statusCode: 0,
          durationMs: 30_000,
          error: 'timeout',
          errorMessage: 'The request timed out.',
        },
      ]),
    );
    const [offline] = await db.select().from(requests).where(eq(requests.eventId, 'r-offline'));
    expect(offline).toMatchObject({
      statusCode: 0,
      error: 'timeout',
      errorMessage: 'The request timed out.',
      responseBody: null,
    });
    const [row] = await db.select().from(requests).where(eq(requests.eventId, 'r-trace'));
    expect(row).toMatchObject({
      method: 'POST',
      statusCode: 500,
      durationMs: 1250,
      timeToFirstByteMs: 1180,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      networkType: 'wifi',
      errorMessage: null,
      responseBody: '{"message":"Payment provider unavailable"}',
    });
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
