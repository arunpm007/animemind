import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Two entry points, and the distinction is load-bearing:
 *
 *   asUser(userId, fn)  opens a transaction, pins `app.user_id` to it, and runs
 *                       fn. Every row-level-security policy keys off that
 *                       setting, so a query inside fn physically cannot see
 *                       another user's rows — even if the WHERE clause is wrong.
 *
 *   unscoped()          no identity. Use ONLY for the shared catalog (work,
 *                       series, episodes) and for sign-in, which must look a
 *                       user up before an identity exists.
 *
 * Any handler touching user data uses asUser. There is no third option, which
 * is what keeps "did this endpoint scope correctly?" from being a question
 * anyone has to ask during review.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and start Postgres with `pnpm db:up`.',
  );
}

declare global {
  var __animemindSql: postgres.Sql | undefined;
}

// Reuse the pool across hot reloads in development; a new pool per reload
// exhausts Postgres connections within a few minutes of editing.
const sql =
  globalThis.__animemindSql ??
  postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
if (process.env.NODE_ENV !== 'production') globalThis.__animemindSql = sql;

export const db = drizzle(sql, { schema });
export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export { sql as rawSql, schema };

/**
 * Run `fn` with the caller's identity pinned for the life of one transaction.
 *
 * `set_config(..., true)` is transaction-local on purpose. Session-local would
 * survive on a pooled connection and carry one user's identity into the next
 * request — a cross-tenant leak that only appears under concurrency. There is
 * a regression test for this in tests/rls.test.ts.
 */
export async function asUser<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      // Parameterised: a user id reaching set_config unescaped would be an
      // identity-forgery vector, not merely SQL injection.
      dsql`SELECT set_config('app.user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

/** The shared catalog and the sign-in lookup. Never user-owned rows. */
export function unscoped(): Database {
  return db;
}
