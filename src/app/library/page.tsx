import Link from 'next/link';
import { Sparkles, Star } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Empty, Poster, PosterGrid } from '@/components/ui/primitives';
import { listLibrarySeries } from '@/server/services/library';
import { requireActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  watching: 'Watching',
  completed: 'Completed',
  planned: 'Planned',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

/**
 * The library lists SERIES, not entries.
 *
 * Listing entries put six near-identical Attack on Titan posters in a row,
 * which reads as duplication rather than as seasons. A franchise is the thing
 * someone remembers having watched; its seasons are contents, and they live on
 * the series page one click away.
 */
export default async function LibraryPage() {
  const actor = await requireActor('/library');
  const entries = await listLibrarySeries(actor);

  const totalSeasons = entries.reduce((n, e) => n + e.ownedEntries, 0);

  return (
    <AppShell accent={entries[0]?.accentHex ?? null}>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-10">
          <h1 className="t-title">Library</h1>
          <p className="mt-2 text-sm text-[var(--color-dim)]">
            {entries.length} {entries.length === 1 ? 'series' : 'series'}
            {totalSeasons !== entries.length ? (
              <span className="text-[var(--color-mute)]">
                {' '}
                · {totalSeasons} entries
              </span>
            ) : null}
          </p>
        </header>

        {entries.length === 0 ? (
          <Empty
            title="Your library is empty"
            body="Press ⌘K and search for something you've watched. You only have to tell it once."
          />
        ) : (
          <PosterGrid>
            {entries.map((e, i) => (
              <div key={e.seriesId} className="flex flex-col gap-2">
                <div className="relative">
                  <Poster
                    work={{
                      id: e.seriesId,
                      title: e.title,
                      titleEnglish: null,
                      kind: 'tv',
                      status: 'unknown',
                      episodeCount: null,
                      startDate: null,
                      seasonYear: null,
                      coverUrl: e.coverUrl,
                      accentHex: e.accentHex,
                    }}
                    href={`/series/${e.slug}`}
                    priority={i < 12}
                  />

                  {/* A season has aired that is not in the library — the one
                      thing worth interrupting a poster wall for. */}
                  {e.hasUnwatchedNext ? (
                    <span
                      title="A later entry has aired"
                      className="pane absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]"
                    >
                      <Sparkles className="size-2.5" />
                      new
                    </span>
                  ) : null}

                  {e.favorite ? (
                    <Star className="absolute top-1.5 left-1.5 size-3 fill-[var(--color-upcoming)] text-[var(--color-upcoming)] drop-shadow" />
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  <Link
                    href={`/series/${e.slug}`}
                    className="line-clamp-2 text-[13px] leading-snug font-medium hover:text-[var(--color-accent-soft)]"
                  >
                    {e.title}
                  </Link>

                  <p className="text-[11px] text-[var(--color-mute)]">
                    {/* Say where they are, in the words they'd use. */}
                    {e.current ? (
                      <>
                        {e.current.ord && e.totalEntries > 1
                          ? `Season ${e.current.ord} · `
                          : ''}
                        <span className="tnum">
                          {e.current.progress}/{e.current.total ?? '?'}
                        </span>
                      </>
                    ) : e.status === 'completed' ? (
                      e.totalEntries > 1 ? (
                        <span className="tnum">
                          All {e.completedEntries} watched
                        </span>
                      ) : (
                        STATUS_LABEL[e.status]
                      )
                    ) : (
                      STATUS_LABEL[e.status]
                    )}
                    {e.totalEntries > e.ownedEntries ? (
                      <span className="text-[var(--color-mute)]">
                        {' '}
                        · {e.ownedEntries} of {e.totalEntries}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
            ))}
          </PosterGrid>
        )}
      </div>
    </AppShell>
  );
}
