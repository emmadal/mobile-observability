import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { sourceMaps } from '@/db/schema';
import { TtlCache } from '../keys/key-cache';
import { type LoadedMap, loadMap } from './symbolicator';

const MAP_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 60_000;

/** Parsed maps are large; keep a handful in memory. */
const cache = new TtlCache<string, LoadedMap | null>(20);

/** Loads the first available map among `bundleKeys` (cached, including misses). */
export async function findSourceMap(
  db: Database,
  projectId: string,
  platform: 'ios' | 'android',
  bundleKeys: string[],
): Promise<LoadedMap | null> {
  for (const key of bundleKeys) {
    const cached = cache.get(`${projectId}:${platform}:${key}`);
    if (cached) return cached;
  }
  const missingEverywhere = bundleKeys.every(
    (key) => cache.get(`${projectId}:${platform}:${key}`) === null,
  );
  if (missingEverywhere && bundleKeys.length > 0) return null;

  const rows = await db
    .select({ bundleKey: sourceMaps.bundleKey, content: sourceMaps.content })
    .from(sourceMaps)
    .where(
      and(
        eq(sourceMaps.projectId, projectId),
        eq(sourceMaps.platform, platform),
        inArray(sourceMaps.bundleKey, bundleKeys),
      ),
    );
  for (const key of bundleKeys) {
    const row = rows.find((candidate) => candidate.bundleKey === key);
    if (!row) {
      cache.set(`${projectId}:${platform}:${key}`, null, MISSING_TTL_MS);
      continue;
    }
    try {
      const loaded = loadMap(row.content.toString('utf8'));
      cache.set(`${projectId}:${platform}:${key}`, loaded, MAP_TTL_MS);
      return loaded;
    } catch {
      cache.set(`${projectId}:${platform}:${key}`, null, MISSING_TTL_MS);
    }
  }
  return null;
}

/** Called after an upload so the next lookup sees the new map. */
export function invalidateSourceMap(projectId: string, platform: string, bundleKey: string): void {
  cache.delete(`${projectId}:${platform}:${bundleKey}`);
}
