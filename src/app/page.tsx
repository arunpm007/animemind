import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { EpisodeProgress } from '@/components/anime/EpisodeProgress';
import { Empty, Poster, Section, StatusDot } from '@/components/ui/primitives';
import { getDashboard } from '@/server/services/library';
import { requireActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function TodayPage() {
  const actor = await requireActor('/');

  const data = await getDashboard(actor);
  const attention = data.continueWatching.length + data.newlyAvailable.length;
  const accent = data.continueWatching[0]?.work.accentHex ?? null;

  return (
    <AppShell accent={accent}>
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-12">
          <p className="t-label mb-3">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <h1 className="t-display">
            {greeting()}
            {data.greetingName ? `, ${data.greetingName}` : ''}.
          </h1>
          <p className="mt-3 text-[15px] text-[var(--color-dim)]">
            {attention === 0
              ? 'Nothing is waiting on you.'
              : `${attention} ${attention === 1 ? 'thing wants' : 'things want'} your attention.`}
          </p>
        </header>

        <div className="flex flex-col gap-14">
          {/* ── the payoff of the whole series graph ── */}
          {data.newlyAvailable.length > 0 ? (
            <Section title="New season available">
              <div className="stagger flex flex-col gap-3">
                {data.newlyAvailable.map((item) => (
                  <article
                    key={item.work.id}
                    className="pane flex items-center gap-4 rounded-xl p-3 pr-5"
                  >
                    <div className="w-[52px] shrink-0">
                      <Poster work={item.work} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <Sparkles className="size-3.5 text-[var(--color-accent)]" />
                        <span className="text-[11px] tracking-wide text-[var(--color-accent)] uppercase">
                          Now available
                        </span>
                      </div>
                      <p className="truncate font-medium">{item.work.title}</p>
                      <p className="truncate text-xs text-[var(--color-dim)]">
                        because you finished {item.becauseYouFinished}
                      </p>
                    </div>
                    {item.seriesSlug ? (
                      <Link
                        href={`/series/${item.seriesSlug}`}
                        className="shrink-0 rounded-full bg-[var(--color-accent)] px-4 py-2 text-xs font-medium text-white transition-transform duration-[160ms] ease-[var(--ease-state)] active:scale-95"
                      >
                        Start
                      </Link>
                    ) : null}
                  </article>
                ))}
              </div>
            </Section>
          ) : null}

          {/* ── continue watching ── */}
          <Section
            title="Continue watching"
            action={
              <Link
                href="/watching"
                className="flex items-center gap-1 text-xs text-[var(--color-dim)] transition-colors hover:text-[var(--color-text)]"
              >
                All <ArrowRight className="size-3" />
              </Link>
            }
          >
            {data.continueWatching.length === 0 ? (
              <Empty
                title="Nothing in progress"
                body="Add something you're partway through and it will show up here."
              />
            ) : (
              <div className="stagger flex flex-col gap-2.5">
                {data.continueWatching.map((item) => (
                  <article
                    key={item.work.id}
                    className="pane flex items-center gap-4 rounded-xl p-3 pr-4"
                  >
                    <div className="w-[52px] shrink-0">
                      <Poster
                        work={item.work}
                        href={
                          item.seriesSlug ? `/series/${item.seriesSlug}` : undefined
                        }
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {item.seriesSlug ? (
                          <Link
                            href={`/series/${item.seriesSlug}`}
                            className="hover:text-[var(--color-accent-soft)]"
                          >
                            {item.work.title}
                          </Link>
                        ) : (
                          item.work.title
                        )}
                      </p>
                      <div className="mt-1.5 max-w-sm">
                        <EpisodeProgress
                          workId={item.work.id}
                          progress={item.progress.progress}
                          total={item.work.episodeCount}
                          pass={
                            item.progress.rewatchCount +
                            1 +
                            (item.progress.rewatching ? 1 : 0)
                          }
                          status={item.progress.status}
                        />
                      </div>
                      {item.progress.rewatching ? (
                        <p className="mt-1 text-[11px] text-[var(--color-mute)]">
                          Rewatching · pass {item.progress.rewatchCount + 2}
                        </p>
                      ) : null}
                    </div>

                  </article>
                ))}
              </div>
            )}
          </Section>

          {/* ── waiting ── */}
          {data.waitingOn.length > 0 ? (
            <Section
              title="Waiting on"
              action={
                <Link
                  href="/waiting"
                  className="flex items-center gap-1 text-xs text-[var(--color-dim)] transition-colors hover:text-[var(--color-text)]"
                >
                  All {data.counts.waiting} <ArrowRight className="size-3" />
                </Link>
              }
            >
              <div className="stagger grid gap-2.5 sm:grid-cols-2">
                {data.waitingOn.slice(0, 4).map((item) => (
                  <article
                    key={item.work.id}
                    className="pane flex items-center gap-3 rounded-xl p-3"
                  >
                    <div className="w-[40px] shrink-0">
                      <Poster work={item.work} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.work.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusDot status={item.status} short />
                        <span className="text-[11px] text-[var(--color-mute)]">
                          {item.expected ?? 'no date yet'}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </Section>
          ) : null}

          {/* ── the library lives one link away, not on this page ── */}
          <Section title="Your library">
            <Link
              href="/library"
              className="pane flex items-center justify-between rounded-xl px-5 py-4 transition-colors duration-[160ms] hover:border-[var(--color-border-strong)]"
            >
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                {(
                  [
                    ['Total', data.counts.total],
                    ['Watching', data.counts.watching],
                    ['Completed', data.counts.completed],
                    ['Planned', data.counts.planned],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="t-label mb-1">{label}</dt>
                    <dd className="tnum text-xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <ArrowRight className="size-4 shrink-0 text-[var(--color-mute)]" />
            </Link>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
