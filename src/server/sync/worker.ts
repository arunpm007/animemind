import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { unscoped } from '../db/client';
import {
  series,
  seriesMember,
  userNotification,
  userWork,
  work,
  workEvent,
} from '../db/schema';
import { ProviderUnavailableError } from '../providers/types';
import {
  defaultProvider,
  hydrateRelations,
  recomputeSeries,
  upsertWork,
} from '../services/ingest';

/**
 * The refresh worker.
 *
 * Deliberately not a queue system. Work is selected by a `next_sync_at`
 * predicate, so the schedule is a column rather than infrastructure: nothing
 * to run, nothing to monitor, and a crashed run simply leaves the rows due.
 * BullMQ and Redis buy nothing here until there are other users, and both are
 * easy to slot in behind this same function when that day comes.
 *
 * Budget matters more than throughput. Jikan permits ~50 requests/minute, so a
 * run takes a bounded slice and leaves the rest for the next tick.
 */

export interface SyncRunResult {
  considered: number;
  refreshed: number;
  changed: number;
  failed: number;
  notified: number;
  seriesRecomputed: number;
  durationMs: number;
}

export async function runSync({
  budget = 40,
  hydrate = true,
}: { budget?: number; hydrate?: boolean } = {}): Promise<SyncRunResult> {
  const started = Date.now();
  const db = unscoped();
  const provider = defaultProvider();

  // Only refresh what someone is actually tracking. There is no value in
  // keeping a catalog row warm that nobody has in a library.
  const due = await db
    .select({ id: work.id, providerId: work.providerId })
    .from(work)
    .innerJoin(userWork, eq(userWork.workId, work.id))
    .where(
      and(
        lte(work.nextSyncAt, new Date()),
        isNull(userWork.deletedAt),
        sql`${work.syncFailures} < 8`,
      ),
    )
    .groupBy(work.id, work.providerId)
    .orderBy(asc(work.nextSyncAt))
    .limit(budget);

  let refreshed = 0;
  let changed = 0;
  let failed = 0;
  const touchedWorkIds: string[] = [];
  const newEventIds: number[] = [];

  for (const row of due) {
    try {
      const raw = await provider.getWork(row.providerId);
      const result = await upsertWork(raw, provider.id);
      refreshed += 1;
      touchedWorkIds.push(result.id);
      if (result.changed) changed += 1;
    } catch (err) {
      failed += 1;
      const retryable = !(err instanceof ProviderUnavailableError) || err.retryable;
      // Exponential backoff on the row itself. A permanently broken id parks
      // after eight tries instead of burning budget on every run forever.
      await db
        .update(work)
        .set({
          syncFailures: sql`${work.syncFailures} + 1`,
          nextSyncAt: sql`now() + (interval '1 hour' * power(2, least(${work.syncFailures}, 7)))`,
          lastSyncedAt: retryable ? work.lastSyncedAt : new Date(),
        })
        .where(eq(work.id, row.id));
    }
  }

  // Discover relations for anything not yet walked — this is how an announced
  // sequel first enters the database at all.
  let seriesRecomputed = 0;
  if (hydrate && touchedWorkIds.length) {
    const unhydrated = await db
      .select({ id: work.id })
      .from(work)
      .where(and(inArray(work.id, touchedWorkIds), eq(work.relationsHydrated, false)))
      .limit(5);

    for (const w of unhydrated) {
      try {
        await hydrateRelations(w.id, provider, { budget: 10, depth: 1 });
      } catch {
        // Non-fatal: the next run retries and the series renders meanwhile.
      }
    }
  }

  // Recompute every series touched by a change, so the spine reflects any
  // newly discovered sequel.
  if (touchedWorkIds.length) {
    const affected = await db
      .selectDistinct({ rootWorkId: series.rootWorkId })
      .from(seriesMember)
      .innerJoin(series, eq(series.id, seriesMember.seriesId))
      .where(inArray(seriesMember.workId, touchedWorkIds));

    for (const a of affected) {
      try {
        await recomputeSeries(a.rootWorkId);
        seriesRecomputed += 1;
      } catch {
        /* a bad component must not abort the run */
      }
    }
  }

  // Fan events out to the people who track the work.
  const recent = await db
    .select({ id: workEvent.id, workId: workEvent.workId })
    .from(workEvent)
    .where(sql`${workEvent.detectedAt} > now() - interval '1 hour'`);
  newEventIds.push(...recent.map((r) => r.id));

  let notified = 0;
  if (recent.length) {
    for (const ev of recent) {
      const watchers = await db
        .select({ userId: userWork.userId })
        .from(userWork)
        .where(and(eq(userWork.workId, ev.workId), isNull(userWork.deletedAt)));

      if (!watchers.length) continue;
      const inserted = await db
        .insert(userNotification)
        .values(watchers.map((w) => ({ userId: w.userId, eventId: ev.id })))
        .onConflictDoNothing()
        .returning({ id: userNotification.id });
      notified += inserted.length;
    }
  }

  return {
    considered: due.length,
    refreshed,
    changed,
    failed,
    notified,
    seriesRecomputed,
    durationMs: Date.now() - started,
  };
}
