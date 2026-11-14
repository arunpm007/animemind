import Link from 'next/link';
import { ArrowRight, Layers, Pause } from 'lucide-react';
import type { UpNextRow } from '@/contracts';
import { Poster, ProgressBar } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/relative';

/**
 * One row of the backlog.
 *
 * The complaint this is built for: "I don't want to go to the library of each
 * one and check what is completed and what is not." So every row has to carry
 * the whole answer — where you are in the franchise, in episodes, and how much
 * is sitting there ready — without a click.
 *
 * Deliberately a list row and not a poster tile. A poster wall is for
 * browsing something you already own; this is a decision queue, and a decision
 * needs numbers next to the name.
 */
export function BacklogRow({ row, kind }: { row: UpNextRow; kind: 'paused' | 'ready' | 'continue' }) {
  const href = row.seriesSlug ? `/series/${row.seriesSlug}` : undefined;
  const stopped = relativeTime(row.lastWatchedAt);

  /**
   * Franchise progress, in episodes.
   *
   * Entries alone mislead badly — "1 of 2 entries" of a 1000-episode show
   * reads as halfway. Shown together so neither can be read on its own.
   */
  const multi = row.entriesTotal > 1;
  const episodeLine =
    row.episodesTotal !== null
      ? `${row.episodesWatched}/${row.episodesTotal} eps`
      : row.episodesWatched > 0
        ? `${row.episodesWatched} eps watched`
        : null;

  /**
   * A single unstarted title has nothing to roll up.
   *
   * Its bar would sit at zero under a line already reading "51 episodes ·
   * 2003", so the row would say the same nothing twice. The block earns its
   * space when there is a franchise behind the title, or when some of it has
   * actually been watched.
   */
  const showRollup = multi || row.episodesWatched > 0;

  return (
    <article className="pane flex items-center gap-4 rounded-xl p-3 pr-4">
      <div className="w-[52px] shrink-0">
        <Poster work={row.work} href={href} quiet />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="min-w-0">
          {href ? (
            <Link href={href} className="block truncate font-medium hover:text-[var(--color-accent-soft)]">
              {row.work.title}
            </Link>
          ) : (
            <p className="truncate font-medium">{row.work.title}</p>
          )}

          <p className="truncate text-xs text-[var(--color-dim)]">
            {kind === 'paused' ? (
              <>
                <Pause className="mr-1 inline size-3 -translate-y-px" />
                {/* Where they stopped is the whole reason this row exists —
                    but "stopped at episode 0 of 11" is a contradiction, and
                    putting something on hold before starting it is a normal
                    thing to do. */}
                {row.progress ? (
                  <>
                    stopped at episode <span className="tnum">{row.progress}</span>
                    {row.work.episodeCount ? (
                      <span className="tnum"> of {row.work.episodeCount}</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    not started
                    {row.work.episodeCount ? (
                      <span className="tnum"> · {row.work.episodeCount} episodes</span>
                    ) : null}
                  </>
                )}
                {stopped ? <span className="text-[var(--color-mute)]"> · {stopped}</span> : null}
              </>
            ) : kind === 'continue' ? (
              row.reason
            ) : (
              <>
                {row.work.episodeCount ? (
                  <span className="tnum">{row.work.episodeCount} episodes</span>
                ) : null}
                {row.work.seasonYear ? (
                  <span className="text-[var(--color-mute)]">
                    {row.work.episodeCount ? ' · ' : ''}
                    {row.work.seasonYear}
                  </span>
                ) : null}
              </>
            )}
          </p>
        </div>

        {/* ── the franchise roll-up ── */}
        {showRollup ? (
          <div className="flex flex-col gap-1">
            <ProgressBar
              value={row.episodesWatched}
              total={row.episodesTotal}
              className="max-w-[260px]"
            />
            <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--color-mute)]">
              {multi ? (
                <span className="flex items-center gap-1">
                  <Layers className="size-2.5" />
                  <span className="tnum">
                    {row.entriesWatched} of {row.entriesTotal}
                  </span>{' '}
                  watched
                </span>
              ) : null}
              {episodeLine ? <span className="tnum">{episodeLine}</span> : null}
              {/* The actionable number: how deep the backlog is for THIS
                  franchise. Accented because it is the one thing here that
                  invites a click. */}
              {row.availableNow > 0 ? (
                <span className="text-[var(--color-accent)]">
                  <span className="tnum">{row.availableNow}</span> ready
                </span>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>

      {href ? (
        <Link
          href={href}
          aria-label={`Open ${row.work.title}`}
          className="shrink-0 rounded-lg p-2 text-[var(--color-mute)] transition-colors duration-[160ms] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </article>
  );
}
