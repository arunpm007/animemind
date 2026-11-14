/**
 * Refetch works that are missing cover art.
 *
 * Neighbours discovered through relation hints used to be created with
 * `coverUrl: null` even though the provider had sent the art in the same
 * payload. New rows no longer have this problem; this repairs the ones that do.
 *
 *   pnpm backfill-art [limit]
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { unscoped } from '../src/server/db/client';
import { work } from '../src/server/db/schema';
import { defaultProvider, upsertWork } from '../src/server/services/ingest';

async function main() {
  const limit = Number(process.argv[2] ?? 200);
  const db = unscoped();
  const provider = defaultProvider();

  const broken = await db
    .select({ id: work.id, providerId: work.providerId, title: work.titleRomaji })
    .from(work)
    .where(and(isNull(work.coverUrl), eq(work.provider, 'kitsu')))
    .orderBy(sql`${work.createdAt} desc`)
    .limit(limit);

  console.log(`${broken.length} works missing art`);
  let fixed = 0;
  let failed = 0;

  for (const w of broken) {
    try {
      const raw = await provider.getWork(w.providerId);
      await upsertWork(raw, 'kitsu');
      if (raw.coverUrl) fixed += 1;
      process.stdout.write('.');
    } catch {
      failed += 1;
      process.stdout.write('x');
    }
  }

  console.log(`\n  repaired ${fixed}, failed ${failed}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
