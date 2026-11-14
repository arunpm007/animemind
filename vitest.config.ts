import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Test environment.
 *
 * Defaults are inlined rather than read from a .env file because `.env*` is
 * gitignored — a fresh clone must be able to run `pnpm test` with no setup
 * beyond `pnpm db:up`. None of these are secrets: the database is disposable
 * and the signing key is used only by tests.
 *
 * Tests run against their OWN database. They previously shared the development
 * one and cleaned up by deleting catalog rows by MyAnimeList id — the same ids
 * the dev seed uses — so running the suite silently destroyed local data via
 * foreign-key cascade.
 *
 * These must be set before anything imports the db client, which reads
 * DATABASE_URL at module scope.
 */
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgres://animemind_app:animemind_app@localhost:55432/animemind_test',
  DATABASE_MIGRATION_URL:
    'postgres://animemind:animemind@localhost:55432/animemind_test',
  AUTH_SECRET: 'test-only-signing-key-not-used-outside-the-test-suite-0123456789',
  CRON_SECRET: 'test-cron-secret',
};

for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;

// Optional local override, e.g. to point at a different Postgres.
const envFile = new URL('./.env.test', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] = m[2];
  }
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    // The database tests share tables; parallel files make cleanup race.
    fileParallelism: false,
  },
});
