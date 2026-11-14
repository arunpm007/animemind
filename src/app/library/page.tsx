import { AppShell } from '@/components/AppShell';
import { Empty, PosterCard, PosterGrid, ProgressBar } from '@/components/ui/primitives';
import { listLibrary } from '@/server/services/library';
import { requireActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const actor = await requireActor('/library');

  const entries = await listLibrary(actor);

  return (
    <AppShell accent={entries[0]?.work.accentHex ?? null}>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="rise mb-10">
          <h1 className="t-title">Library</h1>
          <p className="mt-2 text-sm text-[var(--color-dim)]">
            {entries.length} {entries.length === 1 ? 'title' : 'titles'}
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
              <PosterCard
                key={e.work.id}
                work={e.work}
                priority={i < 12}
                footer={
                  <ProgressBar
                    value={e.progress.progress}
                    total={e.work.episodeCount}
                  />
                }
              />
            ))}
          </PosterGrid>
        )}
      </div>
    </AppShell>
  );
}
