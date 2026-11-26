import type { Database } from '@/db/client';
import { sourceMaps } from '@/db/schema';
import { isForeignKeyViolation } from '../db/pg-errors';
import { BodyDecodeError, BodyTooLargeError, decodeBody, readLimitedBody } from '../ingest/body';
import { resolveKey } from '../keys/resolve';
import { invalidateSourceMap } from './store';
import { loadMap } from './symbolicator';

export const MAX_SOURCE_MAP_BYTES = 50 * 1024 * 1024;
const BUNDLE_KEY = /^(update:[0-9a-zA-Z-]{1,64}|build:[0-9A-Za-z.+_-]{1,64})$/;

/**
 * POST /api/v1/sourcemaps (AC-19). Authorization: Bearer <upload token>.
 * Query: platform=ios|android, bundleKey=update:<id>|build:<version>+<build>, fileName.
 * Body: the source map JSON (optionally gzip). Re-uploading replaces the map.
 */
export async function handleSourceMapUpload(request: Request, db: Database): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const project = await resolveKey(db, token, 'upload');
  if (!project) return Response.json({ error: 'invalid_upload_token' }, { status: 401 });

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  const bundleKey = url.searchParams.get('bundleKey') ?? '';
  const fileName = (url.searchParams.get('fileName') ?? 'bundle.map').slice(0, 255);
  if (platform !== 'ios' && platform !== 'android') {
    return Response.json({ error: 'invalid_platform' }, { status: 400 });
  }
  if (!BUNDLE_KEY.test(bundleKey))
    return Response.json({ error: 'invalid_bundle_key' }, { status: 400 });

  let text: string;
  try {
    const body = await readLimitedBody(request, MAX_SOURCE_MAP_BYTES);
    text = decodeBody(body, request.headers.get('content-encoding'), MAX_SOURCE_MAP_BYTES);
    loadMap(text); // reject anything that is not a valid source map
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    if (error instanceof BodyDecodeError)
      return Response.json({ error: 'invalid_encoding' }, { status: 400 });
    return Response.json({ error: 'invalid_source_map' }, { status: 400 });
  }

  const content = Buffer.from(text, 'utf8');
  try {
    await db
      .insert(sourceMaps)
      .values({
        projectId: project.projectId,
        platform,
        bundleKey,
        fileName,
        content,
        sizeBytes: content.byteLength,
      })
      .onConflictDoUpdate({
        target: [sourceMaps.projectId, sourceMaps.platform, sourceMaps.bundleKey],
        set: { fileName, content, sizeBytes: content.byteLength, uploadedAt: new Date() },
      });
  } catch (error) {
    // The project was deleted while this instance still cached its token.
    if (isForeignKeyViolation(error)) {
      return Response.json({ error: 'invalid_upload_token' }, { status: 401 });
    }
    throw error;
  }
  invalidateSourceMap(project.projectId, platform, bundleKey);
  return Response.json(
    { ok: true, platform, bundleKey, sizeBytes: content.byteLength },
    { status: 201 },
  );
}
