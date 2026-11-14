import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { LibraryEntry, OpResult, SyncOp, SyncResponse } from '@/contracts';
import { asUser } from '../db/client';
import { appliedOp, userWork, watchSession, work } from '../db/schema';
import type { Actor } from '../http/api';
import { toLibraryEntry } from '../http/serialise';

/**
 * ============================================================================
 *  MERGE RULES
 * ============================================================================
 *
 * Last-write-wins is correct for almost every field here and catastrophically
 * wrong for exactly one: progress.
 *
 * Picture watching an episode on the sofa (phone, offline) and another on the
 * laptop. Both sync. Under LWW whichever request lands second overwrites the
 * other, and the user is silently *rewound*. Progress therefore merges with
 * max() — but only within the same rewatch pass, because starting a rewatch
 * legitimately resets to zero and that reset must win.
 *
 *   field           rule                              why
 *   ─────────────── ───────────────────────────────── ────────────────────────
 *   progress        max() within pass; higher pass    never rewind the user
 *                   wins outright
 *   status          LWW by clientTs                   intent, last one counts
 *   rewatchCount    max()                             monotonic by definition
 *   rating/notes    LWW by clientTs                   intent
 *   favorite        LWW by clientTs                   intent
 *   deletedAt       tombstone, LWW                    deletes must be visible
 *
 * The current pass is derived, never stored twice:
 *     pass = rewatchCount + 1 + (rewatching ? 1 : 0)
 */
function currentPass(row: { rewatchCount: number; rewatching: boolean }): number {
  return row.rewatchCount + 1 + (row.rewatching ? 1 : 0);
}

/** Opaque to clients; internally the global change_seq value. */
const encodeCursor = (seq: number) => Buffer.from(`v1:${seq}`).toString('base64url');

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const m = /^v1:(\d+)$/.exec(raw);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

const PAGE = 200;

export async function sync(
  actor: Actor,
  input: { cursor?: string | null; ops: SyncOp[] },
): Promise<SyncResponse> {
  return asUser(actor.userId, async (tx) => {
    const results: OpResult[] = [];

    for (const op of input.ops) {
      // Idempotency first. A retried batch — the normal case on a flaky mobile
      // connection, not the exceptional one — must be a no-op.
      const seen = await tx.query.appliedOp.findFirst({
        where: eq(appliedOp.id, op.id),
      });
      if (seen) {
        results.push({ id: op.id, status: 'duplicate' });
        continue;
      }

      try {
        await applyOne(tx, actor.userId, op);
        await tx.insert(appliedOp).values({ id: op.id, userId: actor.userId });
        results.push({ id: op.id, status: 'applied' });
      } catch (err) {
        // A rejected op is one the client should DROP, not retry: replaying it
        // would wedge the queue forever behind a permanently invalid entry.
        results.push({
          id: op.id,
          status: 'rejected',
          reason: err instanceof Error ? err.message : 'could not apply',
        });
      }
    }

    const since = decodeCursor(input.cursor);
    const rows = await tx
      .select({ uw: userWork, w: work })
      .from(userWork)
      .innerJoin(work, eq(work.id, userWork.workId))
      .where(and(eq(userWork.userId, actor.userId), gt(userWork.updatedSeq, since)))
      .orderBy(asc(userWork.updatedSeq))
      .limit(PAGE + 1);

    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;

    const changed: LibraryEntry[] = [];
    const deleted: string[] = [];
    for (const r of page) {
      if (r.uw.deletedAt) deleted.push(r.uw.workId);
      else changed.push(toLibraryEntry(r.w, r.uw));
    }

    const nextSeq = page.length ? page[page.length - 1].uw.updatedSeq : since;

    return {
      cursor: encodeCursor(nextSeq),
      changed,
      deleted,
      results,
      hasMore,
      serverTime: new Date().toISOString(),
    };
  });
}

type Tx = Parameters<Parameters<typeof asUser>[1]>[0];

async function applyOne(tx: Tx, userId: string, op: SyncOp): Promise<void> {
  const existing = await tx.query.userWork.findFirst({
    where: and(eq(userWork.userId, userId), eq(userWork.workId, op.workId)),
  });

  if (op.t === 'add') {
    if (existing) {
      // Re-adding a removed title restores it rather than erroring: the user's
      // intent ("I want this in my library") is satisfied either way.
      await tx
        .update(userWork)
        .set({ deletedAt: null, status: op.status })
        .where(and(eq(userWork.userId, userId), eq(userWork.workId, op.workId)));
      return;
    }
    await tx.insert(userWork).values({
      userId,
      workId: op.workId,
      status: op.status,
      startedAt: op.status === 'watching' ? new Date() : null,
    });
    return;
  }

  if (!existing) throw new Error('not in library');
  const where = and(eq(userWork.userId, userId), eq(userWork.workId, op.workId));
  const now = new Date(op.clientTs);

  switch (op.t) {
    case 'set_progress': {
      const pass = currentPass(existing);
      if (op.pass < pass) return; // stale device, already superseded
      if (op.pass > pass) {
        // A rewatch we have not seen yet — its start_rewatch op is still in
        // flight or was lost. Accept it rather than dropping the episode.
        await tx
          .update(userWork)
          .set({ rewatching: true, progress: op.value, lastWatchedAt: now })
          .where(where);
        return;
      }
      await tx
        .update(userWork)
        .set({
          progress: Math.max(existing.progress, op.value), // never rewind
          lastWatchedAt: now,
          status:
            existing.status === 'planned' && op.value > 0 ? 'watching' : existing.status,
          startedAt: existing.startedAt ?? now,
        })
        .where(where);

      await tx
        .insert(watchSession)
        .values({ userId, workId: op.workId, passNo: pass, progress: op.value })
        .onConflictDoUpdate({
          target: [watchSession.userId, watchSession.workId, watchSession.passNo],
          set: { progress: sql`greatest(${watchSession.progress}, ${op.value})` },
        });
      return;
    }

    case 'set_status': {
      await tx
        .update(userWork)
        .set({
          status: op.value,
          startedAt:
            existing.startedAt ?? (op.value === 'watching' ? now : existing.startedAt),
          completedAt: op.value === 'completed' ? (existing.completedAt ?? now) : null,
        })
        .where(where);
      return;
    }

    case 'start_rewatch': {
      // Status stays `completed` on purpose. Rewatching Steins;Gate must not
      // make the library's completed count drop by one.
      await tx.update(userWork).set({ rewatching: true, progress: 0 }).where(where);
      await tx
        .insert(watchSession)
        .values({ userId, workId: op.workId, passNo: op.pass, progress: 0 })
        .onConflictDoNothing();
      return;
    }

    case 'complete': {
      const w = await tx.query.work.findFirst({ where: eq(work.id, op.workId) });
      const total = w?.episodeCount ?? existing.progress;
      await tx
        .update(userWork)
        .set({
          status: 'completed',
          rewatching: false,
          progress: total,
          completedAt: existing.completedAt ?? now,
          lastWatchedAt: now,
        })
        .where(where);
      // The trigger on watch_session recomputes rewatch_count from here.
      await tx
        .insert(watchSession)
        .values({
          userId,
          workId: op.workId,
          passNo: op.pass,
          progress: total,
          completedAt: now,
        })
        .onConflictDoUpdate({
          target: [watchSession.userId, watchSession.workId, watchSession.passNo],
          set: { completedAt: now, progress: total },
        });
      return;
    }

    case 'rate':
      await tx.update(userWork).set({ rating: op.value }).where(where);
      return;

    case 'favorite':
      await tx.update(userWork).set({ favorite: op.value }).where(where);
      return;

    case 'note':
      await tx.update(userWork).set({ notes: op.value }).where(where);
      return;

    case 'remove':
      // Tombstone, never a hard delete: the other device has to learn that the
      // row went away, and a missing row is indistinguishable from one it has
      // simply not seen yet.
      await tx.update(userWork).set({ deletedAt: now }).where(where);
      return;
  }
}

/** Housekeeping: the idempotency ledger only needs a retry-sized window. */
export async function pruneAppliedOps(actor: Actor): Promise<number> {
  return asUser(actor.userId, async (tx) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await tx
      .delete(appliedOp)
      .where(and(eq(appliedOp.userId, actor.userId), sql`${appliedOp.appliedAt} < ${cutoff}`))
      .returning({ id: appliedOp.id });
    return rows.length;
  });
}

export { encodeCursor, decodeCursor, currentPass };
