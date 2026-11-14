import Link from 'next/link';
import { Clock3 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { BacklogRow } from '@/components/anime/BacklogRow';
import { Empty, Section } from '@/components/ui/primitives';
import { getUpNext } from '@/server/services/library';
import { requireActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The backlog — everything you could watch now.
 *
 * Before this page, "plan to watch" and "on hold" had no destination: the add
 * sheet told you both went to "Library", and the library is a poster wall
 * sorted by recency. The two states that mean "I'll come back to this" were
 * the two the app could not show you, so coming back meant opening each
 * series page to work out what was finished and what was not.
 *
 * Ordered by how much is already invested — time spent, then intent stated,
 * then a sequel you have not acknowledged yet — because that is the order in
 * which someone is actually likely to say yes.
 */
export default async function NextPage() {
  const actor = await requireActor('/next');
  const data = await getUpNext(actor);

  const total =
    data.paused.length + data.readyToStart.length + data.continueSeries.length;

  const accent =
    data.paused[0]?.work.accentHex ??
    data.readyToStart[0]?.work.accentHex ??
    data.continueSeries[0]?.work.accentHex ??
    null;

  return (
    <AppShell accent={accent}>
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-10">
          <h1 className="t-title">Up next</h1>
          <p className="mt-2 text-sm text-[var(--color-dim)]">
            {total === 0
              ? 'Nothing waiting on a decision.'
              : `${total} ${total === 1 ? 'thing' : 'things'} you could watch now.`}
          </p>
        </header>

        {total === 0 ? (
          <Empty
            title="Your backlog is empty"
            body="Anything you mark “plan to watch” or “on hold” shows up here, along with seasons that have aired since you finished the one before."
          />
        ) : (
          <div className="flex flex-col gap-12">
            {data.paused.length > 0 ? (
              <Section title={`Paused · ${data.paused.length}`}>
                <div className="stagger flex flex-col gap-2.5">
                  {data.paused.map((r) => (
                    <BacklogRow key={r.work.id} row={r} kind="paused" />
                  ))}
                </div>
              </Section>
            ) : null}

            {data.readyToStart.length > 0 ? (
              <Section title={`Ready to start · ${data.readyToStart.length}`}>
                <div className="stagger flex flex-col gap-2.5">
                  {data.readyToStart.map((r) => (
                    <BacklogRow key={r.work.id} row={r} kind="ready" />
                  ))}
                </div>
              </Section>
            ) : null}

            {data.continueSeries.length > 0 ? (
              <Section title={`Continue the series · ${data.continueSeries.length}`}>
                <div className="stagger flex flex-col gap-2.5">
                  {data.continueSeries.map((r) => (
                    <BacklogRow key={r.work.id} row={r} kind="continue" />
                  ))}
                </div>
              </Section>
            ) : null}
          </div>
        )}

        {/* Say where the rest went. Something added as "plan to watch" that
            has not aired is not missing — it is on Waiting — and an app that
            simply omits it looks like it lost the row. */}
        {data.notOutYet > 0 ? (
          <Link
            href="/waiting"
            className="mt-12 flex items-center gap-2.5 rounded-xl px-1 py-2 text-[13px] text-[var(--color-dim)] transition-colors duration-[160ms] hover:text-[var(--color-text)]"
          >
            <Clock3 className="size-3.5 shrink-0 text-[var(--color-mute)]" />
            <span>
              <span className="tnum">{data.notOutYet}</span> more{' '}
              {data.notOutYet === 1 ? 'is' : 'are'} not out yet — on Waiting
            </span>
          </Link>
        ) : null}
      </div>
    </AppShell>
  );
}
