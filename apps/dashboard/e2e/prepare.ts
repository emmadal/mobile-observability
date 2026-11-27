/**
 * Runs before the e2e server starts: recreates the throwaway e2e database,
 * applies the migrations and creates the demo owner, workspace and project
 * (scripts/dev-project.ts). The owner's credentials and the ingest key land in
 * e2e/.cache/seed.json for the setup project.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const target = new URL(url);
  const name = target.pathname.slice(1);
  // Never drop a real database: only names ending in _e2e are recreated.
  if (!/^[a-z0-9_]+_e2e$/.test(name)) {
    throw new Error(`Refusing to recreate "${name}": the e2e database name must end in _e2e`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
  await runMigrations(url);

  const output = execFileSync('tsx', ['scripts/dev-project.ts'], {
    env: process.env,
    encoding: 'utf8',
  });
  const seed = JSON.parse(output.slice(output.indexOf('{')));
  mkdirSync('e2e/.cache', { recursive: true });
  writeFileSync('e2e/.cache/seed.json', JSON.stringify(seed, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
