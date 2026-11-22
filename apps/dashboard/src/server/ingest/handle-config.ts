import { HEADERS } from '@mobile-observability/protocol';
import type { Database } from '@/db/client';
import { resolveKey } from '../keys/resolve';

/** GET /api/v1/config: remote kill switch and sampling, cached by the SDK for 1 h. */
export async function handleConfig(request: Request, db: Database): Promise<Response> {
  const project = await resolveKey(db, request.headers.get(HEADERS.apiKey), 'ingest');
  if (!project) return Response.json({ error: 'invalid_api_key' }, { status: 401 });
  return Response.json(
    { enabled: project.sdkEnabled, sampleRate: project.sampleRate },
    { headers: { 'cache-control': 'private, max-age=300' } },
  );
}
