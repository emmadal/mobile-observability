import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { sourceMaps } from '@/db/schema';
import { TtlCache } from '../keys/key-cache';
import { type LoadedMap, loadMap } from './symbolicator';

const MAP_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 60_000;

/** Parsed maps are large; keep a handful in memory, least recently used evicted first. */
const maps = new TtlCache<string, LoadedMap>(20);
/**
 * Misses live in their own cache so random bundle keys sent with a public
 * ingest key cannot evict parsed maps and force expensive re-parsing.
 */
const missing = new TtlCache<string, true>(50_000);

/** Loads the first available map among `bundleKeys` (cached, including misses). */
export async function findSourceMap(
  db: Database,
  projectId: string,
  platform: 'ios' | 'android',
  bundleKeys: string[],
): Promise<LoadedMap | null> {
  const cacheKey = (key: string) => `${projectId}:${platform}:${key}`;
  for (const key of bundleKeys) {
    const cached = maps.get(cacheKey(key));
    if (cached) return cached;
  }
  const candidates = bundleKeys.filter((key) => !missing.has(cacheKey(key)));
  if (candidates.length === 0) return null;

  const rows = await db
    .select({ bundleKey: sourceMaps.bundleKey, content: sourceMaps.content })
    .from(sourceMaps)
    .where(
      and(
        eq(sourceMaps.projectId, projectId),
        eq(sourceMaps.platform, platform),
        inArray(sourceMaps.bundleKey, candidates),
      ),
    );
  for (const key of candidates) {
    const row = rows.find((candidate) => candidate.bundleKey === key);
    if (!row) {
      missing.set(cacheKey(key), true, MISSING_TTL_MS);
      continue;
    }
    try {
      const loaded = loadMap(row.content.toString('utf8'));
      maps.set(cacheKey(key), loaded, MAP_TTL_MS);
      return loaded;
    } catch {
      missing.set(cacheKey(key), true, MISSING_TTL_MS);
    }
  }
  return null;
}

/** Called after an upload so the next lookup sees the new map. */
export function invalidateSourceMap(projectId: string, platform: string, bundleKey: string): void {
  maps.delete(`${projectId}:${platform}:${bundleKey}`);
  missing.delete(`${projectId}:${platform}:${bundleKey}`);
}
