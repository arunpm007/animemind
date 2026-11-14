import { z } from 'zod';

/**
 * ============================================================================
 *  THE API CONTRACT
 * ============================================================================
 *
 * Everything in `src/contracts/` is the wire format. It is deliberately free
 * of any dependency on Next.js, React, Drizzle or the database schema, so that
 * this directory can be lifted out and published as `@animemind/contracts` for
 * a React Native app to consume — types and runtime validation both.
 *
 * Rules that keep that promise true:
 *
 *  1. No import from `next`, `react`, `@/server/db`, or any provider.
 *  2. DTOs are NOT database rows. A column rename must never break a shipped
 *     mobile build, so the mapping lives in `src/server/http/serialise.ts`.
 *  3. Every response is enveloped. Clients branch on the envelope, never on
 *     HTTP status alone — a fetch layer in Swift or Kotlin should need one
 *     decode path, not one per endpoint.
 *  4. Errors carry a stable machine code. Messages are for humans and may be
 *     reworded at any time; `code` may not.
 *  5. Pagination is cursor-based. Offsets skip and duplicate rows when the
 *     underlying set mutates, which it constantly does here.
 */

/* ───────────────────────────── envelope ───────────────────────────── */

export const errorCode = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'validation_failed',
  'rate_limited',
  'provider_unavailable',
  'internal',
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const apiError = z.object({
  code: errorCode,
  message: z.string(),
  /** Field-level detail for validation_failed, keyed by dotted path. */
  details: z.record(z.string(), z.array(z.string())).optional(),
  /** Echoed request id, for correlating a client report with server logs. */
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiError>;

export function apiSuccess<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    meta: z
      .object({
        cursor: z.string().nullable().optional(),
        hasMore: z.boolean().optional(),
        requestId: z.string().optional(),
        /**
         * The upstream provider was unreachable and this result came from the
         * local catalog instead. Clients should say so rather than implying
         * these are all the matches that exist.
         */
        degraded: z.boolean().optional(),
      })
      .optional(),
  });
}

export function apiResponse<T extends z.ZodTypeAny>(data: T) {
  return z.union([apiSuccess(data), z.object({ error: apiError })]);
}

/* ─────────────────────────── shared values ─────────────────────────── */

export const workKind = z.enum([
  'tv',
  'ona',
  'movie',
  'ova',
  'special',
  'music',
  'unknown',
]);
export type WorkKindDto = z.infer<typeof workKind>;

export const releaseStatus = z.enum([
  'finished',
  'airing',
  'not_yet_aired',
  'cancelled',
  'hiatus',
  'unknown',
]);
export type ReleaseStatusDto = z.infer<typeof releaseStatus>;

export const watchState = z.enum([
  'planned',
  'watching',
  'completed',
  'on_hold',
  'dropped',
]);
export type WatchStateDto = z.infer<typeof watchState>;

export const track = z.enum([
  'movie',
  'ova',
  'special',
  'spinoff',
  'side_story',
  'recap',
  'alternative',
  'other',
]);
export type TrackDto = z.infer<typeof track>;

/** ISO-8601 instant. Kept as a string so JSON round-trips losslessly. */
export const instant = z.string();
/** ISO-8601 calendar date, `YYYY-MM-DD`. Never a timestamp — air dates are
 *  calendar facts and shifting them by a timezone is a real, visible bug. */
export const calendarDate = z.string();

export const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorQuery = z.infer<typeof cursorQuery>;
