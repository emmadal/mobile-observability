import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string) {
  const client = postgres(url, { max: 10, prepare: true });
  return drizzle({ client, schema, casing: 'snake_case' });
}

const globalForDb = globalThis as unknown as { mobsDb?: Database };

/** Shared connection pool (reused across hot reloads in development). */
export function getDb(): Database {
  if (!globalForDb.mobsDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForDb.mobsDb = createDatabase(url);
  }
  return globalForDb.mobsDb;
}
