import { gunzipSync } from 'node:zlib';

export class BodyTooLargeError extends Error {}
export class BodyDecodeError extends Error {}

/** Reads a request body without buffering more than `maxBytes`. */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Gunzips when needed, enforcing the decompressed size limit (zip-bomb safe). */
export function decodeBody(body: Buffer, contentEncoding: string | null, maxBytes: number): string {
  const gzipped =
    contentEncoding?.toLowerCase().includes('gzip') || (body[0] === 0x1f && body[1] === 0x8b);
  if (!gzipped) {
    if (body.byteLength > maxBytes) throw new BodyTooLargeError();
    return body.toString('utf8');
  }
  try {
    return gunzipSync(body, { maxOutputLength: maxBytes }).toString('utf8');
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
    ) {
      throw new BodyTooLargeError();
    }
    throw new BodyDecodeError();
  }
}
