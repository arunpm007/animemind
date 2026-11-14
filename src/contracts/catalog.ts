import { z } from 'zod';
import {
  calendarDate,
  instant,
  releaseStatus,
  track,
  watchState,
  workKind,
} from './common';

/* ──────────────────────────────── work ──────────────────────────────── */

/** The compact shape used in grids, search results and lists. */
export const workSummary = z.object({
  id: z.string(),
  title: z.string(),
  titleEnglish: z.string().nullable(),
  kind: workKind,
  status: releaseStatus,
  episodeCount: z.number().int().nullable(),
  startDate: calendarDate.nullable(),
  seasonYear: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  /** Dominant cover colour. Lets a client light its own UI without sampling. */
  accentHex: z.string().nullable(),
});
export type WorkSummary = z.infer<typeof workSummary>;

export const workDetail = workSummary.extend({
  titleNative: z.string().nullable(),
  synopsis: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  durationMin: z.number().int().nullable(),
  endDate: calendarDate.nullable(),
  genres: z.array(z.string()),
  studios: z.array(z.string()),
  broadcast: z
    .object({
      dayOfWeek: z.number().int().min(0).max(6).nullable(),
      time: z.string().nullable(),
      timezone: z.string().nullable(),
    })
    .nullable(),
  lastSyncedAt: instant.nullable(),
});
export type WorkDetail = z.infer<typeof workDetail>;

/* ─────────────────────────── user progress ─────────────────────────── */

export const userProgress = z.object({
  status: watchState,
  /** Episodes watched on the CURRENT pass. */
  progress: z.number().int().min(0),
  /** A rewatch is in flight. `status` stays `completed` while this is true. */
  rewatching: z.boolean(),
  /** Completed passes after the first. */
  rewatchCount: z.number().int().min(0),
  rating: z.number().int().min(1).max(10).nullable(),
  favorite: z.boolean(),
  notes: z.string().nullable(),
  startedAt: instant.nullable(),
  completedAt: instant.nullable(),
  lastWatchedAt: instant.nullable(),
  /** Sync cursor for this row. Clients use it to detect staleness. */
  updatedSeq: z.number().int(),
});
export type UserProgress = z.infer<typeof userProgress>;

export const libraryEntry = z.object({
  work: workSummary,
  progress: userProgress,
  /**
   * Where to navigate when this entry is clicked. Null only while the series
   * is still being derived in the background, just after the title was added.
   *
   * Its absence was why library posters did nothing at all: there was no
   * destination to link to, so none was rendered.
   */
  seriesSlug: z.string().nullable(),
});
export type LibraryEntry = z.infer<typeof libraryEntry>;

/* ─────────────────────────────── series ─────────────────────────────── */

export const spineEntry = z.object({
  ord: z.number().int().min(1),
  work: workSummary,
  progress: userProgress.nullable(),
});
export type SpineEntry = z.infer<typeof spineEntry>;

export const extraEntry = z.object({
  track,
  via: z.string(),
  work: workSummary,
  progress: userProgress.nullable(),
});
export type ExtraEntry = z.infer<typeof extraEntry>;

export const seriesDetail = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  /**
   * True when the franchise has parallel retellings and cannot honestly be
   * reduced to one order. A client MUST render a story-line switcher and MUST
   * NOT present `nextUp` as the single answer when this is set.
   */
  ambiguous: z.boolean(),
  spine: z.array(spineEntry),
  extras: z.array(extraEntry),
  alternativeLines: z.array(workSummary),
  /**
   * The single most useful action, precomputed server-side so that every
   * client — web, iOS, Android — agrees on what "next" means. Null when the
   * user is fully caught up or when `ambiguous` makes the question unanswerable.
   */
  nextUp: z
    .object({
      reason: z.enum([
        'continue_episode',
        'start_next_season',
        'start_series',
        'rewatch_available',
      ]),
      work: workSummary,
      episode: z.number().int().nullable(),
    })
    .nullable(),
  /** Aggregate release state across the spine, for the library badge. */
  releaseSummary: z.object({
    airing: z.boolean(),
    hasUnairedSequel: z.boolean(),
    nextEpisodeAt: instant.nullable(),
  }),
  computedAt: instant,
});
export type SeriesDetail = z.infer<typeof seriesDetail>;

/* ─────────────────────────────── search ─────────────────────────────── */

export const searchResult = workSummary.extend({
  /** Set when the work is already in the caller's library — solves
   *  "have I already watched this?" without a second round trip. */
  inLibrary: z.boolean(),
  libraryStatus: watchState.nullable(),
});
export type SearchResult = z.infer<typeof searchResult>;

export const searchQuery = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuery>;

/* ───────────────────────────── dashboard ───────────────────────────── */

export const dashboard = z.object({
  greetingName: z.string().nullable(),
  counts: z.object({
    watching: z.number().int(),
    waiting: z.number().int(),
    completed: z.number().int(),
    planned: z.number().int(),
    total: z.number().int(),
  }),
  continueWatching: z.array(
    z.object({
      work: workSummary,
      seriesSlug: z.string().nullable(),
      nextEpisode: z.number().int().nullable(),
      progress: userProgress,
    }),
  ),
  newlyAvailable: z.array(
    z.object({
      work: workSummary,
      seriesSlug: z.string().nullable(),
      becauseYouFinished: z.string(),
    }),
  ),
  waitingOn: z.array(
    z.object({
      work: workSummary,
      seriesSlug: z.string().nullable(),
      expected: z.string().nullable(),
      status: releaseStatus,
    }),
  ),
});
export type Dashboard = z.infer<typeof dashboard>;
