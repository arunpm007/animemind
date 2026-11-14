import type { LibraryEntry, UserProgress, WorkDetail, WorkSummary } from '@/contracts';
import type { userWork, work } from '../db/schema';

/**
 * Database rows -> wire DTOs.
 *
 * This file is the seam that lets the schema change without breaking a shipped
 * mobile build. Returning rows directly would make every column rename a
 * breaking API change for a client that is already in an app store and cannot
 * be updated in lockstep.
 */

type WorkRow = typeof work.$inferSelect;
type UserWorkRow = typeof userWork.$inferSelect;

const day = (d: string | null) => d;
const inst = (d: Date | null) => (d ? d.toISOString() : null);

export function toWorkSummary(w: WorkRow): WorkSummary {
  return {
    id: w.id,
    title: w.titleEnglish ?? w.titleRomaji,
    titleEnglish: w.titleEnglish,
    kind: w.kind,
    status: w.releaseStatus,
    episodeCount: w.episodeCount,
    startDate: day(w.startDate),
    seasonYear: w.seasonYear,
    coverUrl: w.coverUrl,
    accentHex: w.accentHex,
  };
}

export function toWorkDetail(w: WorkRow): WorkDetail {
  return {
    ...toWorkSummary(w),
    titleNative: w.titleNative,
    synopsis: w.synopsis,
    bannerUrl: w.bannerUrl,
    durationMin: w.durationMin,
    endDate: day(w.endDate),
    genres: w.genres,
    studios: w.studios,
    broadcast:
      w.broadcastDow === null && !w.broadcastTime
        ? null
        : {
            dayOfWeek: w.broadcastDow,
            time: w.broadcastTime,
            timezone: w.broadcastTz,
          },
    lastSyncedAt: inst(w.lastSyncedAt),
  };
}

export function toUserProgress(u: UserWorkRow): UserProgress {
  return {
    status: u.status,
    progress: u.progress,
    rewatching: u.rewatching,
    rewatchCount: u.rewatchCount,
    rating: u.rating,
    favorite: u.favorite,
    notes: u.notes,
    startedAt: inst(u.startedAt),
    completedAt: inst(u.completedAt),
    lastWatchedAt: inst(u.lastWatchedAt),
    updatedSeq: u.updatedSeq,
  };
}

export function toLibraryEntry(
  w: WorkRow,
  u: UserWorkRow,
  seriesSlug: string | null = null,
): LibraryEntry {
  return { work: toWorkSummary(w), progress: toUserProgress(u), seriesSlug };
}
