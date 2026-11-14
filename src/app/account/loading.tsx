import { SkeletonBlock, SkeletonHeader } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-8 sm:py-14">
      <SkeletonHeader />
      <div className="flex flex-col gap-8">
        <SkeletonBlock className="h-28 w-full rounded-xl" />
        <SkeletonBlock className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
