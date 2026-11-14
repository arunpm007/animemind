/**
 * A search result must say whether the user already owns it.
 *
 * The regression this guards was visible and confusing: add a title from
 * search, click the very same row again, and the sheet offered "Add to
 * library" as though nothing had happened — on a title already marked
 * "Watching" two rows above.
 *
 * The server was never wrong. `search()` has always echoed ownership back,
 * but nothing tested it, so the three fields the sheet reads were free to
 * drift: `libraryProgress` did not exist on the contract at all until the
 * fix, and the sheet had no way to tell an add from an edit.
 *
 * The ownership mapping sits BELOW the provider try/catch, so forcing the
 * provider down exercises the same code on a deterministic local corpus
 * instead of whatever Kitsu happens to return today.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { asUser, unscoped } from '@/server/db/client';
import { account, userWork, work } from '@/server/db/schema';
import { ProviderUnavailableError } from '@/server/providers/types';
import * as ingest from '@/server/services/ingest';
import { search } from '@/server/services/library';
import type { Actor } from '@/server/http/api';

const TAG = `owned-${Date.now()}`;
const ids: string[] = [];
let actor: Actor;
let userId = '';

/** Held, mid-watch. The case that produced the bug report. */
const HELD = `Mashle ${TAG}`;
/** Added, then removed. Must read as NOT held. */
const REMOVED = `Undead Unluck ${TAG}`;
/** Never added. The control. */
const UNHELD = `Blue Lock ${TAG}`;

beforeAll(async () => {
  const db = unscoped();

  for (const [n, title] of [
    ['1', HELD],
    ['2', REMOVED],
    ['3', UNHELD],
  ] as const) {
    const [row] = await db
      .insert(work)
      .values({
        provider: 'kitsu',
        providerId: `${TAG}-${n}`,
        kind: 'tv',
        titleRomaji: title,
        titleEnglish: title,
        episodeCount: 12,
        releaseStatus: 'finished',
        contentHash: `h-${TAG}-${n}`,
      })
      .returning({ id: work.id });
    ids.push(row.id);
  }

  const [a] = await db
    .insert(account)
    .values({ email: `${TAG}@test.local`, passwordHash: 'x' })
    .returning();
  userId = a.id;
  actor = { userId: a.id, role: 'member', tier: 'free' };

  await asUser(a.id, async (tx) => {
    await tx.insert(userWork).values([
      { userId: a.id, workId: ids[0], status: 'watching', progress: 7 },
      // Removal is a soft delete, which is what makes this worth testing:
      // the row is still there and still joins.
      {
        userId: a.id,
        workId: ids[1],
        status: 'completed',
        progress: 12,
        deletedAt: new Date(),
      },
    ]);
  });

  // Force the local-catalog path; see the file header.
  vi.spyOn(ingest, 'defaultProvider').mockReturnValue({
    id: 'kitsu',
    capabilities: { inlinesRelationMetadata: true, maxRequestsPerMinute: 60 },
    search: async () => {
      throw new ProviderUnavailableError('kitsu', 'forced down for this test');
    },
    getWork: async () => {
      throw new ProviderUnavailableError('kitsu', 'down');
    },
    getRelations: async () => [],
    getEpisodes: async () => [],
  });
});

afterAll(async () => {
  const db = unscoped();
  if (userId) await db.delete(account).where(eq(account.id, userId));
  await db.delete(work).where(inArray(work.id, ids));
  vi.restoreAllMocks();
});

const find = async (title: string, who: Actor | null) => {
  const { results } = await search(who, title, 10);
  return results.find((r) => r.title === title);
};

describe('search echoes the caller’s library state', () => {
  it('reports status AND progress for a title the caller is watching', async () => {
    const r = await find(HELD, actor);
    expect(r).toBeDefined();
    expect(r!.inLibrary).toBe(true);
    expect(r!.libraryStatus).toBe('watching');
    // The sheet opens its episode field on this number. Dropping it is what
    // reset a user sitting on episode 7 back to episode 1.
    expect(r!.libraryProgress).toBe(7);
  });

  it('reports a removed title as NOT held, so it offers to add again', async () => {
    const r = await find(REMOVED, actor);
    expect(r).toBeDefined();
    // The userWork row still exists — only deletedAt distinguishes it. A join
    // that forgets that turns every title the user ever removed into an
    // un-addable "already in your library".
    expect(r!.inLibrary).toBe(false);
    expect(r!.libraryStatus).toBeNull();
    expect(r!.libraryProgress).toBeNull();
  });

  it('reports an unowned title as not held', async () => {
    const r = await find(UNHELD, actor);
    expect(r).toBeDefined();
    expect(r!.inLibrary).toBe(false);
    expect(r!.libraryStatus).toBeNull();
    expect(r!.libraryProgress).toBeNull();
  });

  it('never leaks one account’s library into an anonymous search', async () => {
    const r = await find(HELD, null);
    expect(r).toBeDefined();
    expect(r!.inLibrary).toBe(false);
    expect(r!.libraryStatus).toBeNull();
    expect(r!.libraryProgress).toBeNull();
  });
});

describe('the userWork row behind it', () => {
  it('keeps progress and status where search claims they are', async () => {
    // Guards against search() reading a cached or derived column that drifts
    // from the row the rest of the app writes.
    const row = await asUser(userId, async (tx) =>
      tx
        .select()
        .from(userWork)
        .where(and(eq(userWork.userId, userId), eq(userWork.workId, ids[0]))),
    );
    expect(row[0].status).toBe('watching');
    expect(row[0].progress).toBe(7);
  });
});
