import { createHash, randomBytes } from 'node:crypto';

export type KeyKind = 'ingest' | 'upload';

const PREFIX: Record<KeyKind, string> = { ingest: 'mobs_pk_', upload: 'mobs_sk_' };

export interface GeneratedKey {
  key: string;
  hash: string;
  prefix: string;
}

/** Ingest keys are public (shipped in apps); upload tokens are secrets for CI. */
export function generateKey(kind: KeyKind): GeneratedKey {
  const key = `${PREFIX[kind]}${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, PREFIX[kind].length + 6) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function looksLikeKey(value: string | null | undefined, kind: KeyKind): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX[kind]) && value.length <= 128;
}
