/**
 * Merge catalog rows that are the same anime under different providers.
 *
 * Repairs the duplicates that existed before cross-provider identity was
 * tracked. New rows reconcile on ingest and will not need this.
 *
 *   pnpm dedupe:works          # dry run — prints what it WOULD merge
 *   pnpm dedupe:works --apply  # actually merge
 *
 * Named `dedupe:works` because `pnpm dedupe` is a built-in pnpm command and
 * would shadow a script called plain `dedupe`.
 *
 * Dry run by default because a merge rewrites watch history. The matcher is
 * deliberately narrow (same title, same episode count, different providers):
 * a missed duplicate is a tidiness problem, a wrong merge costs someone their
 * progress.
 */
import { eq } from 'drizzle-orm';
import { unscoped } from '../src/server/db/client';
import { work } from '../src/server/db/schema';
import { findDuplicatePairs, mergeWorks } from '../src/server/services/identity';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = unscoped();
  const pairs = await findDuplicatePairs();

  if (!pairs.length) {
    console.log('no duplicates found');
    return process.exit(0);
  }

  console.log(`${pairs.length} duplicate pair(s)${apply ? '' : ' — DRY RUN'}\n`);

  let merged = 0;
  for (const p of pairs) {
    const [keeper, loser] = await Promise.all([
      db.query.work.findFirst({ where: eq(work.id, p.keeper) }),
      db.query.work.findFirst({ where: eq(work.id, p.loser) }),
    ]);
    // A previous merge in this run may already have removed one of them.
    if (!keeper || !loser) continue;

    console.log(
      `  ${p.title}\n` +
        `      keep  ${keeper.provider}:${keeper.providerId}  (${keeper.createdAt.toISOString().slice(0, 10)})\n` +
        `      merge ${loser.provider}:${loser.providerId}  (${loser.createdAt.toISOString().slice(0, 10)})`,
    );

    if (apply) {
      await mergeWorks(keeper.id, loser.id);
      merged += 1;
    }
  }

  console.log(
    apply
      ? `\nmerged ${merged}`
      : '\nnothing changed. re-run with --apply to merge.',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
