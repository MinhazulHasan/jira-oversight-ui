"use client";

import { Meter } from "@/components/charts/meter";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

/* Each figure, with its meter. */
const FIGURE = "flex flex-col gap-3";

/** Meters waiting for their figures, in their final shape. */
export function MetersSkeleton({ label, count }: { label: string; count: number }) {
  return (
    <SkeletonGroup label={label} className="flex flex-col gap-6">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <span className="flex items-center justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-4 w-10" />
          </span>
          <Skeleton className="h-1.5 w-full rounded-pill" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

function NothingResolved() {
  return (
    <EmptyState
      size="compact"
      title="Nothing was resolved in the window"
      description={"No issue was resolved in this window."}
    />
  );
}

/** How much of the work resolved in the window carries an estimate, story points and logged time. */
export function CoverageBlock({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  const resolved = data?.figures.resolved;

  return (
    <Section
      id="coverage"
      title="Coverage of resolved work"
      count={resolved ? formatCount(resolved.in_window, { locale }) : undefined}
      description={
        resolved ? (
          <>
            Of the{" "}
            <span id="fig-resolved">
              {formatCount(resolved.in_window, { locale })} issues resolved in the window
            </span>{" "}
            ({formatCount(resolved.done_entered_in_window, { locale })} entered Done in it), how many carry each record.
          </>
        ) : (
          "Of the issues resolved in the window, how many carry each record."
        )
      }
    >
      {!data || !resolved ? (
        <MetersSkeleton label="Loading the coverage of resolved work" count={3} />
      ) : resolved.in_window === 0 ? (
        <NothingResolved />
      ) : (
        <div className="flex flex-col gap-5">
          <div id="fig-original-estimate" className={FIGURE}>
            <Meter label="Original estimates" value={resolved.with_original_estimate.count} total={resolved.in_window} />
          </div>
          <div id="fig-story-points" className={FIGURE}>
            <Meter label="Story points" value={resolved.with_story_points.count} total={resolved.in_window} />
          </div>
          <div id="fig-logged-time" className={FIGURE}>
            <Meter label="Logged time" value={resolved.with_logged_time.timespent.count} total={resolved.in_window} />
          </div>
        </div>
      )}
    </Section>
  );
}

/** Resolved work Jira shows no work on: moved straight from To Do to Done, or created in Done. */
export function StraightToDoneBlock({ data }: { data: Baseline | undefined }) {
  const resolved = data?.figures.resolved;
  const straight = resolved?.straight_todo_to_done;
  const from = straight && straight.from_statuses.length > 0 ? straight.from_statuses.join(" or ") : "To Do";
  const to = straight && straight.to_statuses.length > 0 ? straight.to_statuses.join(" or ") : "Done";

  return (
    <Section
      id="straight-to-done"
      title="Straight to Done"
      description="Moved from To Do straight to Done, or created Done."
    >
      {!data || !resolved || !straight ? (
        <MetersSkeleton label="Loading the work that went straight to Done" count={2} />
      ) : resolved.in_window === 0 ? (
        <NothingResolved />
      ) : (
        <div className="flex flex-col gap-5">
          <div id="fig-straight-todo-done" className={FIGURE}>
            <Meter label={`Straight from ${from} to ${to}`} value={straight.count} total={resolved.in_window} />
          </div>
          <div id="fig-created-in-done" className={FIGURE}>
            <Meter label="Created in Done" value={resolved.created_in_done.count} total={resolved.in_window} />
          </div>
        </div>
      )}
    </Section>
  );
}
