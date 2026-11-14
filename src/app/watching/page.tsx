import { AppShell } from '@/components/AppShell';
import { Empty, PosterCard, PosterGrid, ProgressBar } from '@/components/ui/primitives';
import { listLibrary } from '@/server/services/library';
import { requireActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function WatchingPage() {
  const actor = await requireActor('/watching');

  const all = await listLibrary(actor);
  // A rewatch keeps status `completed` so the completed count never dips, so
  // this view has to ask for it explicitly.
  const entries = all.filter(
    (e) => e.progress.status === 'watching' || e.progress.rewatching,
  );

  return (
    <AppShell accent={entries[0]?.work.accentHex ?? null}>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-10">
          <h1 className="t-title">Watching</h1>
          <p className="mt-2 text-sm text-[var(--color-dim)]">
            {entries.length} in progress
          </p>
        </header>

        {entries.length === 0 ? (
          <Empty title="Nothing in progress" body="Everything you've started is finished." />
        ) : (
          <PosterGrid>
            {entries.map((e) => (
              <PosterCard
                key={e.work.id}
                work={e.work}
                href={e.seriesSlug ? `/series/${e.seriesSlug}` : undefined}
                footer={
                  <div className="flex flex-col gap-1">
                    <ProgressBar value={e.progress.progress} total={e.work.episodeCount} />
                    {e.progress.rewatching ? (
                      <span className="text-[10px] text-[var(--color-mute)]">
                        Rewatching
                      </span>
                    ) : null}
                  </div>
                }
              />
            ))}
          </PosterGrid>
        )}
      </div>
    </AppShell>
  );
}
