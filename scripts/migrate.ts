/**
 * Migration runner.
 *
 * Applies, in order: drizzle/_pre/*.sql, the drizzle-kit generated *.sql, then
 * drizzle/_post/*.sql. The pre/post split exists because drizzle-kit cannot
 * express sequences, roles, row-level security or triggers, and those have a
 * hard ordering relationship with the generated tables.
 *
 * Applied files are recorded so re-running is safe.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const DIR = join(process.cwd(), 'drizzle');

const url =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL ??
  'postgres://animemind:animemind@localhost:55432/animemind';

async function sqlFilesIn(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith('.sql')).sort();
  } catch {
    return [];
  }
}

async function main() {
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  await sql`
    CREATE TABLE IF NOT EXISTS _migration (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM _migration`).map((r) => r.name),
  );

  const plan: Array<{ name: string; path: string }> = [
    ...(await sqlFilesIn(join(DIR, '_pre'))).map((n) => ({
      name: `_pre/${n}`,
      path: join(DIR, '_pre', n),
    })),
    ...(await sqlFilesIn(DIR)).map((n) => ({ name: n, path: join(DIR, n) })),
    ...(await sqlFilesIn(join(DIR, '_post'))).map((n) => ({
      name: `_post/${n}`,
      path: join(DIR, '_post', n),
    })),
  ];

  let ran = 0;
  for (const step of plan) {
    if (applied.has(step.name)) {
      console.log(`  skip  ${step.name}`);
      continue;
    }
    const body = await readFile(step.path, 'utf8');
    // drizzle-kit delimits statements with this marker; ours are plain files.
    const statements = body.includes('--> statement-breakpoint')
      ? body.split('--> statement-breakpoint')
      : [body];

    try {
      await sql.begin(async (tx) => {
        for (const s of statements) {
          const trimmed = s.trim();
          if (trimmed) await tx.unsafe(trimmed);
        }
        await tx`INSERT INTO _migration (name) VALUES (${step.name})`;
      });
      console.log(`  apply ${step.name}`);
      ran += 1;
    } catch (err) {
      console.error(`\n  FAILED ${step.name}\n`);
      throw err;
    }
  }

  console.log(`\n${ran} migration(s) applied, ${plan.length - ran} already current.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
