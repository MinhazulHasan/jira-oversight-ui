import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [0.62, 0.84, 0.7, 0.9, 0.66, 0.78, 0.58, 0.86, 0.72, 0.8];

export function FindingsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading findings</span>
      <div aria-hidden className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 min-w-[13rem] flex-1 sm:max-w-[28rem]" />
        <Skeleton className="h-8 w-[17rem]" />
        <Skeleton className="h-8 w-[16rem]" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <div className="flex h-8 items-center justify-between">
          <Skeleton className="h-3 w-60" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="overflow-hidden rounded-md border border-rule-weak bg-sheet">
          <div className="h-9 border-b border-rule-weak bg-rail" />
          {ROWS.map((width, row) => (
            <div key={row} className="flex h-10 items-center gap-6 border-b border-rule-weak px-4 last:border-b-0">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-2.5" style={{ width: `${width * 32}%` }} />
              <Skeleton className="ml-auto h-2.5 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
