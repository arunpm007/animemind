import { SkeletonBlock, SkeletonRows } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-8 sm:py-14">
      <div className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-end">
        <SkeletonBlock className="aspect-[2/3] w-[128px] shrink-0 rounded-lg sm:w-[168px]" />
        <div className="flex-1 space-y-3">
          <SkeletonBlock className="h-2.5 w-16" />
          <SkeletonBlock className="h-9 w-3/4" />
          <SkeletonBlock className="h-3 w-1/2" />
        </div>
      </div>
      <SkeletonRows count={3} />
    </div>
  );
}
