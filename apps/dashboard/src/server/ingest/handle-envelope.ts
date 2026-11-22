import { HEADERS, LIMITS } from '@mobile-observability/protocol';
import { parseEnvelope } from '@mobile-observability/protocol/schema';
import type { Database } from '@/db/client';
import { resolveKey } from '../keys/resolve';
import { BodyDecodeError, BodyTooLargeError, decodeBody, readLimitedBody } from './body';
import { processEnvelope } from './process-envelope';
import { RateLimiter } from './rate-limit';

const limiter = new RateLimiter();

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/**
 * POST /api/v1/envelope (AC-13): 202 accepted, 401 bad key, 400 schema error
 * with field paths, 413 too large, 429 rate limited with Retry-After.
 */
export async function handleEnvelope(
  request: Request,
  db: Database,
  options: { limiter?: RateLimiter; now?: () => number } = {},
): Promise<Response> {
  const now = options.now ?? Date.now;
  const key = request.headers.get(HEADERS.apiKey);
  const project = await resolveKey(db, key, 'ingest');
  if (!project || !key) return json(401, { error: 'invalid_api_key' });

  const waitMs = (options.limiter ?? limiter).take(project.projectId);
  if (waitMs > 0) {
    return json(
      429,
      { error: 'rate_limited' },
      { 'retry-after': String(Math.ceil(waitMs / 1000)) },
    );
  }
  if (!project.sdkEnabled) return json(202, { accepted: 0, dropped: 0, disabled: true });

  let text: string;
  try {
    const body = await readLimitedBody(request, LIMITS.maxEnvelopeBytes);
    text = decodeBody(body, request.headers.get('content-encoding'), LIMITS.maxEnvelopeBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json(413, { error: 'payload_too_large' });
    if (error instanceof BodyDecodeError) return json(400, { error: 'invalid_encoding' });
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const parsed = parseEnvelope(payload);
  if (!parsed.ok)
    return json(400, { error: 'invalid_envelope', issues: parsed.issues.slice(0, 20) });

  const result = await processEnvelope(db, project, parsed.envelope, now());
  return json(202, { accepted: result.accepted, dropped: result.dropped + parsed.droppedItems });
}
