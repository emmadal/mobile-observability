import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { apiKeys, projects } from '@/db/schema';
import { TtlCache } from './key-cache';
import { hashKey, type KeyKind, looksLikeKey } from './keys';

export interface ResolvedProject {
  projectId: string;
  organizationId: string;
  sdkEnabled: boolean;
  sampleRate: number;
  retentionDays: number;
}

/** Revoked keys stop working within this window (AC-30: <= 60 s). */
export const KEY_CACHE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 10_000;

const cache = new TtlCache<string, ResolvedProject | null>();

/** Resolves an API key to its project, or null when unknown or revoked. */
export async function resolveKey(
  db: Database,
  rawKey: string | null | undefined,
  kind: KeyKind,
): Promise<ResolvedProject | null> {
  if (!looksLikeKey(rawKey, kind)) return null;
  const hash = hashKey(rawKey);
  const cacheKey = `${kind}:${hash}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({
      projectId: projects.id,
      organizationId: projects.organizationId,
      sdkEnabled: projects.sdkEnabled,
      sampleRate: projects.sampleRate,
      retentionDays: projects.retentionDays,
    })
    .from(apiKeys)
    .innerJoin(projects, eq(apiKeys.projectId, projects.id))
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.kind, kind), isNull(apiKeys.revokedAt)))
    .limit(1);

  const resolved = row ?? null;
  cache.set(cacheKey, resolved, resolved ? KEY_CACHE_TTL_MS : NEGATIVE_TTL_MS);
  return resolved;
}

/** Drops cached lookups (after rotation in the same process, and in tests). */
export function clearKeyCache(): void {
  cache.clear();
}
