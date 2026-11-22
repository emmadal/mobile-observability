import { runMigrations } from '../src/db/migrate';

/** Applies migrations to the test database once per run. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://mobs:mobs@localhost:5433/mobs_test';
  await runMigrations(url);
}
