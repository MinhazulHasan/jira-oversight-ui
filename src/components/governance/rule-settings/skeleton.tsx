import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

import { SettingsNote } from "./apply-status";
import { RuleListHead } from "./rule-row";

/** One rule's row: the row's own grid, its id line, title and "What it checks"; its controls; its thresholds and default. */
function RowSkeleton() {
  return (
    <li className="jo-rule-row px-4 py-3.5">
      <span className="flex min-w-0 flex-col" style={{ gridArea: "rule" }}>
        <span className="flex min-h-5 items-center">
          <Skeleton className="h-2.5 w-14" />
        </span>
        <span className="mt-0.5 flex h-[1lh] items-center text-sm">
          <Skeleton className="h-3.5 w-48 max-w-full" />
        </span>
        <span className="mt-0.5 flex min-h-6 items-center text-xs">
          <Skeleton className="h-2.5 w-24" />
        </span>
      </span>
      <span className="flex h-7 items-center gap-2" style={{ gridArea: "state" }}>
        <Skeleton className="h-[18px] w-8 rounded-pill" />
        <Skeleton className="h-2.5 w-5" />
      </span>
      <span className="flex h-7 items-center" style={{ gridArea: "severity" }}>
        <Skeleton className="h-7 w-[7.5rem] rounded-md" />
      </span>
      <span className="flex min-w-0 flex-col gap-1" style={{ gridArea: "threshold" }}>
        <span className="flex h-7 items-center">
          <Skeleton className="h-7 w-56 max-w-full rounded-sm" />
        </span>
        <span className="flex h-[1lh] items-center text-xs">
          <Skeleton className="h-2.5 w-20" />
        </span>
      </span>
      <span className="flex h-7 items-center justify-end" style={{ gridArea: "open" }}>
        <Skeleton className="h-3 w-6" />
      </span>
    </li>
  );
}

/** A group of rules: its heading and line, its one-line description, and its framed list under the column heads. */
function GroupSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center gap-3">
        <Skeleton className="h-2.5 w-32" />
        <span aria-hidden className="h-px flex-1 bg-rule-weak" />
      </div>
      <span className="-mt-1 flex h-[1lh] items-center text-sm">
        <Skeleton className="h-3 w-[min(30rem,80%)]" />
      </span>
      <div className="@container/rules overflow-hidden rounded-md border border-rule-weak">
        <div className="pt-2.5">
          <RuleListHead />
        </div>
        <ul className="flex flex-col divide-y divide-rule-weak">
          {Array.from({ length: rows }, (_, index) => (
            <RowSkeleton key={index} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CustomGroupSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center gap-3">
        <Skeleton className="h-2.5 w-28" />
        <span aria-hidden className="h-px flex-1 bg-rule-weak" />
      </div>
      <span className="-mt-1 flex h-[1lh] items-center text-sm">
        <Skeleton className="h-3 w-48" />
      </span>
      <div className="flex flex-col items-center gap-2.5 rounded-md border border-rule-weak px-4 py-7">
        <Skeleton className="size-9 rounded-md" />
        <span className="flex flex-col items-center gap-1">
          <span className="flex h-[1lh] items-center text-sm">
            <Skeleton className="h-3.5 w-36" />
          </span>
          <span className="flex h-[1lh] items-center text-xs">
            <Skeleton className="h-2.5 w-64 max-w-full" />
          </span>
        </span>
        <Skeleton className="mt-1 h-7 w-24 rounded-md" />
      </div>
    </div>
  );
}

/** The rule settings page while it loads, in its final shape: the status and its note, the rules' groups. */
export function RuleSettingsSkeleton() {
  return (
    <SkeletonGroup label="Loading the rule settings" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-0.5 rounded-md border border-rule-weak bg-rail px-4 py-3">
          <span className="flex h-[1lh] items-center text-sm">
            <Skeleton className="h-3.5 w-36" />
          </span>
          <span className="flex h-[1lh] items-center text-sm">
            <Skeleton className="h-3 w-72 max-w-full" />
          </span>
        </div>
        <SettingsNote />
      </div>
      <GroupSkeleton rows={7} />
      <GroupSkeleton rows={5} />
      <CustomGroupSkeleton />
    </SkeletonGroup>
  );
}
