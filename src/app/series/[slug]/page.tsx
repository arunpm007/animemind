import Image from 'next/image';
import { notFound } from 'next/navigation';
import { AlertCircle, Play, RotateCcw } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { AddButton } from '@/components/anime/AddButton';
import { EpisodeStepper } from '@/components/anime/EpisodeStepper';
import { Poster, ProgressBar, Section, StatusDot } from '@/components/ui/primitives';
import type { ExtraEntry, TrackDto } from '@/contracts';
import { getSeries } from '@/server/services/library';
import { requireActor } from '@/lib/session';
import { HttpError } from '@/server/http/api';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

const TRACK_LABEL: Record<TrackDto, string> = {
  movie: 'Films',
  ova: 'OVAs',
  special: 'Specials',
  spinoff: 'Spin-offs',
  side_story: 'Side stories',
  recap: 'Recaps',
  alternative: 'Alternative versions',
  other: 'Other',
};

// Films and OVAs first: those are things people actually choose to watch.
// Recaps last, because the useful information about a recap is that you can
// skip it.
const TRACK_ORDER: TrackDto[] = [
  'movie',
  'ova',
  'special',
  'side_story',
  'spinoff',
  'alternative',
  'other',
  'recap',
];

export default async function SeriesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Requires a session, like every other page.
  //
  // This was `currentActor()` so a signed-out visitor could view a series.
  // The effect was that an EXPIRED token rendered the page as if signed out —
  // every season showing 0 progress and no controls — which reads as "my
  // library was wiped", not "please sign in again". There is no sharing
  // feature here, so a public series page serves nobody and that trade was
  // all cost.
  const actor = await requireActor(`/series/${slug}`);

  let series;
  try {
    series = await getSeries(actor, slug);
  } catch (err) {
    // Only a genuine miss becomes a 404. Catching everything here turned real
    // failures — a bad query, a dead connection — into "page not found", which
    // is the most misleading thing a server can say about its own bug.
    if (err instanceof HttpError && err.code === 'not_found') notFound();
    throw err;
  }

  const hero = series.spine[0]?.work ?? series.extras[0]?.work;
  const grouped = new Map<TrackDto, ExtraEntry[]>();
  for (const e of series.extras) {
    const list = grouped.get(e.track) ?? [];
    list.push(e);
    grouped.set(e.track, list);
  }

  return (
    <AppShell accent={hero?.accentHex ?? null}>
      {/* ── z0: the work's own art, far out of focus ── */}
      {hero?.coverUrl ? (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[46vh] overflow-hidden">
          <Image
            src={hero.coverUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="scale-110 object-cover opacity-[0.22] blur-3xl"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, transparent 10%, var(--color-bg) 92%)',
            }}
          />
        </div>
      ) : null}

      <div className="relative z-10 mx-auto w-full max-w-4xl px-4 py-10 sm:px-8 sm:py-14">
        {/* ── header ── */}
        <header className="rise mb-12 flex flex-col gap-6 sm:flex-row sm:items-end">
          {hero ? (
            <div className="w-[128px] shrink-0 sm:w-[168px]">
              <Poster work={hero} priority />
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="t-label mb-3">Series</p>
            <h1 className="t-display mb-4">{series.title}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-dim)]">
              {series.releaseSummary.airing ? <StatusDot status="airing" /> : null}
              <span className="tnum">
                {series.spine.length}{' '}
                {series.spine.length === 1 ? 'entry' : 'entries'} in the main story
              </span>
              {series.extras.length > 0 ? (
                <span className="tnum">{series.extras.length} extra</span>
              ) : null}
            </div>
          </div>
        </header>

        {/* ── the honest answer when there isn't one ── */}
        {series.ambiguous ? (
          <div className="pane mb-10 flex gap-3 rounded-xl border-[var(--color-upcoming)]/25 p-4">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-upcoming)]" />
            <div>
              <p className="mb-1 text-sm font-medium">This franchise has parallel story lines.</p>
              <p className="text-sm text-[var(--color-dim)]">
                Some entries retell the same story rather than continuing it, so there
                is no single correct order. The main line is shown below; the
                alternatives are listed separately.
              </p>
            </div>
          </div>
        ) : null}

        {/* ── next up ── */}
        {series.nextUp ? (
          <div className="pane-raised rise mb-12 flex items-center gap-4 rounded-xl p-4">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'var(--color-accent)' }}
            >
              {series.nextUp.reason === 'rewatch_available' ? (
                <RotateCcw className="size-4 text-white" />
              ) : (
                <Play className="size-4 fill-white text-white" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="t-label mb-1">
                {series.nextUp.reason === 'continue_episode'
                  ? 'Continue'
                  : series.nextUp.reason === 'start_next_season'
                    ? 'Next season'
                    : series.nextUp.reason === 'start_series'
                      ? 'Start here'
                      : 'Caught up'}
              </p>
              <p className="truncate font-medium">{series.nextUp.work.title}</p>
              {series.nextUp.episode ? (
                <p className="tnum text-sm text-[var(--color-dim)]">
                  Episode {series.nextUp.episode}
                </p>
              ) : (
                <p className="text-sm text-[var(--color-dim)]">
                  You&apos;ve seen everything available.
                </p>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-12">
          {/* ── the spine ── */}
          <Section title="Main story">
            <ol className="flex flex-col">
              {series.spine.map((entry, i) => {
                const p = entry.progress;
                const done = p?.status === 'completed' && !p.rewatching;
                const unaired = entry.work.status === 'not_yet_aired';
                const last = i === series.spine.length - 1;

                return (
                  <li key={entry.work.id} className="relative flex gap-4 pb-5">
                    {/* the connecting line, drawn between markers not through them */}
                    {!last ? (
                      <span
                        aria-hidden
                        className="absolute top-[26px] bottom-0 left-[11px] w-px"
                        style={{
                          background: done
                            ? 'var(--color-accent)'
                            : 'var(--color-border)',
                          opacity: done ? 0.4 : 1,
                        }}
                      />
                    ) : null}

                    <span
                      aria-hidden
                      className={cn(
                        'relative z-10 mt-[7px] flex size-[23px] shrink-0 items-center justify-center rounded-full border-2 text-[10px]',
                        done
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                          : unaired
                            ? 'border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-mute)]'
                            : 'border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-dim)]',
                      )}
                    >
                      {entry.ord}
                    </span>

                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p
                            className={cn(
                              'truncate font-medium',
                              unaired && 'text-[var(--color-dim)]',
                            )}
                          >
                            {entry.work.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2.5">
                            <StatusDot status={entry.work.status} short />
                            {p?.rewatchCount ? (
                              <span className="flex items-center gap-1 text-[11px] text-[var(--color-mute)]">
                                <RotateCcw className="size-3" />
                                watched {p.rewatchCount + 1}×
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {unaired ? null : p ? (
                          <EpisodeStepper
                            workId={entry.work.id}
                            progress={p.progress}
                            total={entry.work.episodeCount}
                            pass={p.rewatchCount + 1 + (p.rewatching ? 1 : 0)}
                          />
                        ) : (
                          // Not in the library yet — this is the control that
                          // lets "next season" actually be started.
                          <AddButton workId={entry.work.id} label="Add" />
                        )}
                      </div>

                      {!unaired ? (
                        p ? (
                          <div className="mt-2.5 max-w-sm">
                            <ProgressBar
                              value={p.progress}
                              total={entry.work.episodeCount}
                            />
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-[var(--color-mute)]">
                            {entry.work.episodeCount
                              ? `${entry.work.episodeCount} episodes · not in your library`
                              : 'Not in your library'}
                          </p>
                        )
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-mute)]">
                          {entry.work.startDate ?? 'No release date announced'}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>

          {/* ── extras, grouped by medium ── */}
          {TRACK_ORDER.filter((t) => grouped.has(t)).map((t) => (
            <Section key={t} title={TRACK_LABEL[t]}>
              <div className="stagger flex flex-col gap-2">
                {grouped.get(t)!.map((e) => (
                  <article
                    key={e.work.id}
                    className="flex items-center gap-3 rounded-lg px-1 py-1.5"
                  >
                    <div className="w-[44px] shrink-0">
                      <Poster work={e.work} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{e.work.title}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-mute)]">
                        <span className="uppercase">{e.work.kind}</span>
                        {e.work.startDate ? <span>· {e.work.startDate.slice(0, 4)}</span> : null}
                        {t === 'recap' ? (
                          <span className="text-[var(--color-mute)]">· skippable</span>
                        ) : null}
                      </div>
                    </div>
                    {e.progress?.status === 'completed' ? (
                      <span className="shrink-0 text-[11px] text-[var(--color-airing)]">
                        watched
                      </span>
                    ) : null}
                  </article>
                ))}
              </div>
            </Section>
          ))}
        </div>

        <p className="mt-16 text-[11px] text-[var(--color-mute)]">
          Structure derived {new Date(series.computedAt).toLocaleString()}
        </p>
      </div>
    </AppShell>
  );
}
