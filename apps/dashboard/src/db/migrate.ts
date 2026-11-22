import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

/** Applies pending migrations to DATABASE_URL (or the URL given as the first argument). */
export async function runMigrations(url: string): Promise<void> {
  const db = createDatabase(url);
  try {
    await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  runMigrations(url)
    .then(() => console.log('Migrations applied'))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
