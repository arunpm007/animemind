import { execFileSync } from 'node:child_process';
import postgres from 'postgres';

/**
 * Create and migrate the test database before the suite runs.
 *
 * Every connection string is derived from DATABASE_MIGRATION_URL rather than
 * hardcoded. The local stack runs Postgres on :55432 to avoid colliding with
 * other projects, but CI runs it on :5432 — a hardcoded host here passes
 * locally and fails on every pull request, which is the worst place to find out.
 *
 * Idempotent: re-running is a no-op once the database exists and is current.
 */
export default async function setup() {
  const migrationUrl =
    process.env.DATABASE_MIGRATION_URL ??
    'postgres://animemind:animemind@localhost:55432/animemind_test';

  const target = new URL(migrationUrl);
  const dbName = target.pathname.replace(/^\//, '') || 'animemind_test';
  const owner = decodeURIComponent(target.username) || 'animemind';

  // Connect to the maintenance database to issue CREATE DATABASE, which
  // cannot run from inside the database it is creating.
  const adminUrl = new URL(migrationUrl);
  adminUrl.pathname = '/postgres';

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const [existing] = await admin`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;
    if (!existing) {
      // Identifiers cannot be parameterised; dbName comes from our own config,
      // never from user input.
      await admin.unsafe(
        `CREATE DATABASE "${dbName.replace(/"/g, '')}" OWNER "${owner.replace(/"/g, '')}"`,
      );
    }
  } finally {
    await admin.end();
  }

  execFileSync('pnpm', ['exec', 'tsx', 'scripts/migrate.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_MIGRATION_URL: migrationUrl },
  });
}
