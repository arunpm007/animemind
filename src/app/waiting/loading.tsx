import { SkeletonHeader, SkeletonRows } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
      <SkeletonHeader />
      <SkeletonRows count={3} />
    </div>
  );
}
