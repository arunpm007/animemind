import { z } from 'zod';
import { libraryEntry, userProgress } from './catalog';
import { instant, watchState } from './common';

/**
 * ============================================================================
 *  THE SYNC PROTOCOL
 * ============================================================================
 *
 * One endpoint — POST /api/v1/sync — performs push and pull in a single round
 * trip. That matters far more on a phone than on a laptop: a cold app launch
 * on a train gets one request instead of two, and the two can never interleave
 * to produce a torn view.
 *
 *     client                                  server
 *       │  { cursor, ops[] }                    │
 *       ├──────────────────────────────────────►│  apply ops (idempotent)
 *       │                                       │  collect rows > cursor
 *       │◄──────────────────────────────────────┤
 *       │  { changed[], deleted[], cursor }     │
 *
 * Invariants a client may rely on:
 *
 *  - Ops are idempotent by `id`. Retrying a whole batch after a timeout is
 *    always safe, which is the normal case on mobile, not the rare one.
 *  - `cursor` is an opaque monotonic token. Persist it; send it back; never
 *    parse it. It is NOT a timestamp precisely so device clock skew cannot
 *    cause silently skipped rows.
 *  - The response is authoritative. Replace local rows wholesale rather than
 *    merging on the client — there is exactly one merge implementation and it
 *    lives on the server where it can be tested.
 */

export const opId = z.string().min(20).max(40); // ULID

const base = z.object({
  id: opId,
  /** Client wall clock at the time of the action. Used only for LWW ordering. */
  clientTs: z.number().int(),
  deviceId: z.string().max(64),
});

/**
 * `pass` is the rewatch pass the op belongs to. It is what makes progress
 * merging safe: two devices on the same pass take max(), but a newer pass
 * legitimately resets to zero and must win outright.
 */
export const syncOp = z.discriminatedUnion('t', [
  base.extend({
    t: z.literal('set_progress'),
    workId: z.string(),
    pass: z.number().int().min(1),
    value: z.number().int().min(0),
  }),
  base.extend({
    t: z.literal('set_status'),
    workId: z.string(),
    value: watchState,
  }),
  base.extend({
    t: z.literal('start_rewatch'),
    workId: z.string(),
    pass: z.number().int().min(2),
  }),
  base.extend({
    t: z.literal('complete'),
    workId: z.string(),
    pass: z.number().int().min(1),
  }),
  base.extend({
    t: z.literal('rate'),
    workId: z.string(),
    value: z.number().int().min(1).max(10).nullable(),
  }),
  base.extend({
    t: z.literal('favorite'),
    workId: z.string(),
    value: z.boolean(),
  }),
  base.extend({
    t: z.literal('note'),
    workId: z.string(),
    value: z.string().max(4000).nullable(),
  }),
  base.extend({
    t: z.literal('add'),
    workId: z.string(),
    status: watchState.default('planned'),
  }),
  base.extend({ t: z.literal('remove'), workId: z.string() }),
]);
export type SyncOp = z.infer<typeof syncOp>;

export const syncRequest = z.object({
  /** Omit on a first sync to receive a full snapshot. */
  cursor: z.string().nullable().optional(),
  /** Capped so one wedged client cannot submit an unbounded batch. */
  ops: z.array(syncOp).max(500).default([]),
});
export type SyncRequest = z.infer<typeof syncRequest>;

export const opResult = z.object({
  id: opId,
  status: z.enum(['applied', 'duplicate', 'rejected']),
  /** Present when rejected. Clients should drop, not retry, a rejected op. */
  reason: z.string().optional(),
});
export type OpResult = z.infer<typeof opResult>;

export const syncResponse = z.object({
  /** Opaque. Persist and echo. */
  cursor: z.string(),
  /** Authoritative rows. Replace local copies; do not merge. */
  changed: z.array(libraryEntry),
  /** Tombstoned rows, by work id. */
  deleted: z.array(z.string()),
  results: z.array(opResult),
  /** True when more changes remain; call again immediately with the new cursor. */
  hasMore: z.boolean(),
  serverTime: instant,
});
export type SyncResponse = z.infer<typeof syncResponse>;

/** Exported so a client can render optimistic state with identical rules. */
export const progressPatch = userProgress.partial();
export type ProgressPatch = z.infer<typeof progressPatch>;
