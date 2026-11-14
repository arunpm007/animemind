import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Empty, Poster, Section, StatusDot } from '@/components/ui/primitives';
import { getDashboard } from '@/server/services/library';
import { requireActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The page this whole project exists for: things you finished that have a
 * continuation which has not arrived yet.
 *
 * Every row here is derived from the series graph — a sequel entry exists in
 * the catalog as soon as it is announced, so "waiting" is a query, not a
 * subscription to a news feed.
 */
export default async function WaitingPage() {
  const actor = await requireActor('/waiting');

  const data = await getDashboard(actor);

  return (
    <AppShell accent={data.waitingOn[0]?.work.accentHex ?? null}>
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-10">
          <h1 className="t-title">Waiting on</h1>
          <p className="mt-2 text-sm text-[var(--color-dim)]">
            Continuations that have been announced but have not arrived.
          </p>
        </header>

        <div className="flex flex-col gap-12">
          {data.newlyAvailable.length > 0 ? (
            <Section title="Arrived since you last looked">
              <div className="stagger flex flex-col gap-2.5">
                {data.newlyAvailable.map((item) => (
                  <article key={item.work.id} className="pane flex items-center gap-4 rounded-xl p-3 pr-5">
                    <div className="w-[48px] shrink-0">
                      <Poster work={item.work} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.work.title}</p>
                      <p className="truncate text-xs text-[var(--color-dim)]">
                        follows {item.becauseYouFinished}
                      </p>
                    </div>
                    {item.seriesSlug ? (
                      <Link
                        href={`/series/${item.seriesSlug}`}
                        className="shrink-0 rounded-full bg-[var(--color-accent)] px-4 py-2 text-xs font-medium text-white"
                      >
                        Start
                      </Link>
                    ) : null}
                  </article>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Still waiting">
            {data.waitingOn.length === 0 ? (
              <Empty
                title="Nothing pending"
                body="Every series you've finished has told us all it's going to for now. We'll keep checking."
              />
            ) : (
              <div className="stagger flex flex-col gap-2.5">
                {data.waitingOn.map((item) => (
                  <article key={item.work.id} className="pane flex items-center gap-4 rounded-xl p-3 pr-5">
                    <div className="w-[48px] shrink-0">
                      <Poster work={item.work} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.work.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusDot status={item.status} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="t-label mb-1">Expected</p>
                      <p className="tnum text-sm">
                        {/* Never invent a date. "No date yet" is the honest answer
                            and the one the user can act on. */}
                        {item.expected ?? (
                          <span className="text-[var(--color-mute)]">no date yet</span>
                        )}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
