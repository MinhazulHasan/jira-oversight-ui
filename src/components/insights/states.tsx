"use client";

import { ArrowRight, Newspaper } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

import { BRIEFING_AREAS, BRIEFING_GRID } from "./layout";

/* The briefing's other three states, each in the shape of the sheet it stands in for. */

const SENTENCE_WIDTHS = [["w-full", "w-3/5"], ["w-full", "w-1/2"], ["w-full", "w-2/3"], ["w-full", "w-11/12", "w-1/3"], ["w-full", "w-2/5"]];

function SectionHead({ className }: { className?: string }) {
  return (
    <span className="flex h-6 items-center gap-3">
      <Skeleton className={cn("h-2.5 w-24", className)} />
      <span className="h-px flex-1 bg-rule-weak" />
    </span>
  );
}

export function BriefingSkeleton() {
  return (
    <SkeletonGroup label="Loading the weekly briefing" className="reveal-late flex flex-col gap-8">
      <div className="flex flex-col gap-2.5 border-b border-rule-weak pb-5">
        <Skeleton className="h-2.5 w-36" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-48 max-w-full" />
      </div>
      <div className={BRIEFING_GRID}>
        <div className={cn(BRIEFING_AREAS.narrative, "flex max-w-[72ch] flex-col gap-3")}>
          <SectionHead />
          {SENTENCE_WIDTHS.map((widths, index) => (
            <div key={index} className="flex gap-3.5 py-2.5">
              <Skeleton className="mt-2 size-2.5 shrink-0" />
              <div className="flex flex-1 flex-col gap-2.5">
                {widths.map((width) => (
                  <Skeleton key={width} className={cn("h-3.5", width)} />
                ))}
                <span className="flex gap-4">
                  <Skeleton className="h-3 w-28" still />
                  <Skeleton className="h-3 w-24" still />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className={cn(BRIEFING_AREAS.candidates, "flex max-w-[72ch] flex-col gap-3 xl:max-w-none")}>
          <SectionHead className="w-32" />
          <Skeleton className="h-3 w-full" still />
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex gap-3 border-t border-rule-weak py-3.5 first-of-type:border-t-0">
              <Skeleton className="h-3 w-3 shrink-0" still />
              <div className="flex flex-1 flex-col gap-2.5">
                <span className="flex justify-between gap-3">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-5 w-16 rounded-pill" still />
                </span>
                <Skeleton className="h-2.5 w-2/5" />
                <Skeleton className="h-2.5 w-4/5" still />
                <Skeleton className="h-2.5 w-full" still />
                <Skeleton className="h-2.5 w-full" still />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}

/** Before the first weekly run there is nothing to read, and that is said plainly. */
export function NoBriefing() {
  return (
    <EmptyState
      icon={Newspaper}
      title="No briefing yet"
      description="One is written each week."
      action={
        <Button asChild>
          <Link href="/findings">
            See the findings
            <ArrowRight aria-hidden strokeWidth={1.75} />
          </Link>
        </Button>
      }
    />
  );
}

export function BriefingError({
  error,
  onRetry,
  retrying,
}: {
  error: ApiError | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  const status = error?.status ? `HTTP ${error.status}` : "No response";
  return (
    <ErrorState
      title="Couldn't load the briefing"
      description="The oversight service didn't answer. Try again in a moment."
      detail={`${status} · insights/latest`}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}
