/**
 * Development seed.
 *
 * Builds two real franchises and their relation graphs offline, runs the
 * series builder over them, and attaches them to an account. This exists
 * because the upstream provider is a scraper of MyAnimeList and inherits its
 * downtime — being unable to develop the UI because someone else's server is
 * having a bad afternoon is not acceptable.
 *
 *   pnpm seed                      # seeds the first account found
 *   pnpm seed you@example.com      # seeds a specific account
 *
 * Data is real (genuine MAL ids, titles, dates and relation types) so that
 * what you see locally matches what the live provider would produce.
 */
import { eq } from 'drizzle-orm';
import { unscoped } from '../src/server/db/client';
import { account } from '../src/server/db/schema';
import { seedSampleLibrary } from '../src/server/demo/sample-library';

async function main() {
  const db = unscoped();
  const wanted = process.argv[2];

  const user = wanted
    ? await db.query.account.findFirst({ where: eq(account.email, wanted.toLowerCase()) })
    : await db.query.account.findFirst();

  if (!user) {
    console.error(
      wanted
        ? `No account for ${wanted}. Create one at /sign-in first.`
        : 'No accounts yet. Create one at /sign-in first.',
    );
    process.exit(1);
  }

  const entries = await seedSampleLibrary(user, (m) => console.log(m));
  console.log(`  ${entries} library entries for ${user.email}`);
  console.log('\nseeded.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
