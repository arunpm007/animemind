import Link from 'next/link';
import { Plus, Sparkles, Star } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Empty, Poster, PosterGrid, ProgressBar } from '@/components/ui/primitives';
import type { LibrarySeriesEntry, WatchStateDto } from '@/contracts';
import { listLibrarySeries } from '@/server/services/library';
import { requireActor } from '@/lib/session';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  watching: 'Watching',
  completed: 'Completed',
  planned: 'Planned',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

/** The order they are offered in — roughly most to least active. */
const STATUS_ORDER: WatchStateDto[] = [
  'watching',
  'planned',
  'on_hold',
  'completed',
  'dropped',
];

const SORTS = {
  recent: 'Recent',
  left: 'Most left to watch',
  title: 'Title',
} as const;
type Sort = keyof typeof SORTS;

/**
 * Order for "most left to watch".
 *
 * Ranked on what can be acted on first, then on sheer volume:
 *
 *   1. entries that have AIRED and are unwatched — the backlog you could
 *      start tonight
 *   2. known episodes still outstanding
 *
 * Sorting on episode count alone breaks on exactly the series this feature
 * exists for. A franchise with an unannounced next season has no total, and
 * any single number stands in for "unknown" badly: treat it as zero and an
 * ongoing show sinks below a finished one, invent a number and the whole
 * column is fiction. Leading with `availableNow` sidesteps the guess — it is
 * always known, and it is the thing the user is actually choosing between.
 */
function compareByLeft(a: LibrarySeriesEntry, b: LibrarySeriesEntry): number {
  if (a.availableNow !== b.availableNow) return b.availableNow - a.availableNow;
  const left = (e: LibrarySeriesEntry) =>
    e.episodesTotal === null ? 0 : Math.max(0, e.episodesTotal - e.episodesWatched);
  return left(b) - left(a);
}

/**
 * The library lists SERIES, not entries.
 *
 * Listing entries put six near-identical Attack on Titan posters in a row,
 * which reads as duplication rather than as seasons. A franchise is the thing
 * someone remembers having watched; its seasons are contents, and they live on
 * the series page one click away.
 *
 * Filter and sort live in the query string rather than in component state so
 * that a filtered library is a URL — linkable, bookmarkable, and reachable
 * from the counters on Today, which previously all pointed at this page
 * undifferentiated.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const actor = await requireActor('/library');
  const sp = await searchParams;
  const all = await listLibrarySeries(actor);

  const status =
    sp.status && STATUS_ORDER.includes(sp.status as WatchStateDto)
      ? (sp.status as WatchStateDto)
      : null;
  const sort: Sort = sp.sort === 'left' || sp.sort === 'title' ? sp.sort : 'recent';

  // Only offer a filter that would return something. A chip reading "On hold"
  // that empties the page is a worse answer than no chip.
  const counts = new Map<WatchStateDto, number>();
  for (const e of all) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);

  const entries = all
    .filter((e) => (status ? e.status === status : true))
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'left') return compareByLeft(a, b);
      return 0; // the service already returns most-recently-touched first
    });

  const totalSeasons = entries.reduce((n, e) => n + e.ownedEntries, 0);
  const href = (next: { status?: string | null; sort?: Sort }) => {
    const q = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    const o = next.sort ?? sort;
    if (s) q.set('status', s);
    if (o !== 'recent') q.set('sort', o);
    const qs = q.toString();
    return qs ? `/library?${qs}` : '/library';
  };

  const chip =
    'rounded-full border px-3 py-1.5 text-[12px] transition-colors duration-[160ms]';
  const chipOn = 'border-transparent bg-[var(--color-accent)] text-white';
  const chipOff =
    'border-[var(--color-border)] text-[var(--color-dim)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]';

  return (
    <AppShell accent={entries[0]?.accentHex ?? null}>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-6">
          <h1 className="t-title">Library</h1>
          <p className="mt-2 text-sm text-[var(--color-dim)]">
            {entries.length} {entries.length === 1 ? 'series' : 'series'}
            {totalSeasons !== entries.length ? (
              <span className="text-[var(--color-mute)]"> · {totalSeasons} entries</span>
            ) : null}
            {status ? (
              <span className="text-[var(--color-mute)]">
                {' '}
                · {STATUS_LABEL[status].toLowerCase()}
              </span>
            ) : null}
          </p>
        </header>

        {/* ── filter and sort ── */}
        {all.length > 0 ? (
          <div className="rise mb-10 flex flex-col gap-3">
            <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
              <Link
                href={href({ status: null })}
                aria-current={status === null ? 'true' : undefined}
                className={cn(chip, status === null ? chipOn : chipOff)}
              >
                All <span className="tnum opacity-70">{all.length}</span>
              </Link>
              {STATUS_ORDER.filter((s) => counts.get(s)).map((s) => (
                <Link
                  key={s}
                  href={href({ status: s })}
                  aria-current={status === s ? 'true' : undefined}
                  className={cn(chip, status === s ? chipOn : chipOff)}
                >
                  {STATUS_LABEL[s]}{' '}
                  <span className="tnum opacity-70">{counts.get(s)}</span>
                </Link>
              ))}
            </nav>

            <nav
              aria-label="Sort"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]"
            >
              <span className="t-label">Sort</span>
              {(Object.keys(SORTS) as Sort[]).map((s) => (
                <Link
                  key={s}
                  href={href({ sort: s })}
                  aria-current={sort === s ? 'true' : undefined}
                  className={cn(
                    'transition-colors duration-[160ms]',
                    sort === s
                      ? 'text-[var(--color-text)] underline decoration-[var(--color-accent)] decoration-2 underline-offset-4'
                      : 'text-[var(--color-mute)] hover:text-[var(--color-dim)]',
                  )}
                >
                  {SORTS[s]}
                </Link>
              ))}
            </nav>
          </div>
        ) : null}

        {all.length === 0 ? (
          <Empty
            title="Your library is empty"
            body="Press ⌘K and search for something you've watched. You only have to tell it once."
          />
        ) : entries.length === 0 ? (
          <Empty
            title={`Nothing ${STATUS_LABEL[status ?? ''].toLowerCase()}`}
            body="Try another filter, or clear it to see everything."
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

                  {/* How far through the WHOLE franchise, in episodes. The
                      entry count on its own ("1 of 2") badly misreads for
                      anything long — this is the line that answers "how much
                      is left" without opening the series. */}
                  {e.episodesTotal !== null && e.episodesTotal > 0 ? (
                    <ProgressBar value={e.episodesWatched} total={e.episodesTotal} />
                  ) : null}

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
                        <span className="tnum">All {e.completedEntries} watched</span>
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
                    {e.availableNow > 0 ? (
                      <span className="text-[var(--color-accent)]">
                        {' '}
                        · <span className="tnum">{e.availableNow}</span> ready
                      </span>
                    ) : null}
                  </p>

                  {/* Name what is missing. A count on its own tells someone
                      that something is absent without telling them what,
                      which is the half of the message that cannot be acted
                      on. */}
                  {e.missingEntries.length > 0 ? (
                    <Link
                      href={`/series/${e.slug}`}
                      className="group/missing mt-0.5 flex items-start gap-1 text-[11px] text-[var(--color-dim)] hover:text-[var(--color-text)]"
                    >
                      <Plus className="mt-[2px] size-2.5 shrink-0 opacity-70" />
                      <span className="line-clamp-2 leading-snug">
                        {e.missingEntries
                          .slice(0, 2)
                          .map((m) => m.title)
                          .join(', ')}
                        {e.missingEntries.length > 2
                          ? ` +${e.missingEntries.length - 2} more`
                          : ''}
                      </span>
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </PosterGrid>
        )}
      </div>
    </AppShell>
  );
}
