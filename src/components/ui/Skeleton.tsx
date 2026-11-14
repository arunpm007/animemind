/**
 * Loading placeholders.
 *
 * Every page here is `force-dynamic` with a database round trip, so
 * navigation used to simply pause — nothing moved, and a slow query was
 * indistinguishable from a dead click. These keep the shape of what is
 * coming so the layout does not jump when it lands.
 */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-[var(--color-surface)] ${className}`}
    />
  );
}

export function SkeletonPosterGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-5 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <SkeletonBlock className="aspect-[2/3] w-full rounded-lg" />
          <SkeletonBlock className="h-3 w-4/5" />
          <SkeletonBlock className="h-2.5 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="pane flex items-center gap-4 rounded-xl p-3">
          <SkeletonBlock className="h-[72px] w-[52px] shrink-0 rounded" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-3.5 w-1/3" />
            <SkeletonBlock className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The page title area, so the heading does not pop in after the body. */
export function SkeletonHeader() {
  return (
    <div className="mb-10 space-y-3">
      <SkeletonBlock className="h-7 w-44" />
      <SkeletonBlock className="h-3 w-28" />
    </div>
  );
}
