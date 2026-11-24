import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { withExplicitSslMode } from './connection-url';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string) {
  // Idle clients close after 5s so few sockets outlive a burst of requests.
  const client = new Pool({
    connectionString: withExplicitSslMode(url),
    max: 10,
    idleTimeoutMillis: 5_000,
  });
  return drizzle({ client, schema, casing: 'snake_case' });
}

const globalForDb = globalThis as unknown as { mobsDb?: Database };

/** Shared connection pool (reused across hot reloads in development). */
export function getDb(): Database {
  if (!globalForDb.mobsDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const db = createDatabase(url);
    // On Vercel Fluid compute, keeps the function alive until idle clients
    // are closed, so a suspended instance never resumes with dead sockets.
    // No-op elsewhere (Docker, VPS, tests).
    attachDatabasePool(db.$client);
    globalForDb.mobsDb = db;
  }
  return globalForDb.mobsDb;
}
