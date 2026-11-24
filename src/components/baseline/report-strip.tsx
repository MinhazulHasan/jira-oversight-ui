"use client";

import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { windowDays } from "./labels";

const FRAME =
  "grid grid-cols-1 gap-px overflow-hidden rounded-md border border-rule-weak bg-rule-weak @md:grid-cols-3";
const CELL = "flex min-w-0 flex-col gap-1 bg-sheet px-4 py-3.5";

function Fact({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className={CELL}>
      <dt className="micro text-ink-low">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-ink">{value}</dd>
      {detail ? <dd className="min-w-0 text-xs text-ink-low">{detail}</dd> : null}
    </div>
  );
}

/** Warnings about the report itself: stale metrics, issues left without metrics, a newer sync. */
function ReportFlags({ data }: { data: Baseline }) {
  const locale = useFigureLocale();
  const { metadata, meta } = data;
  const newerSync =
    metadata.last_synced_at !== null && new Date(meta.last_synced_at).getTime() > new Date(metadata.last_synced_at).getTime();
  if (!metadata.metrics_stale && metadata.issues_without_metrics === 0 && !newerSync) return null;
  return (
    <div className="flex flex-col gap-3">
      {metadata.metrics_stale ? (
        <Callout tone="warn" title="The derived metrics predate the sync">
          Computed
          {metadata.metrics_computed_at ? (
            <>
              {" "}
              at <Timestamp value={metadata.metrics_computed_at} mode="datetime" />
            </>
          ) : null}
          , before the latest sync. They may lag Jira.
        </Callout>
      ) : null}
      {metadata.issues_without_metrics > 0 ? (
        <Callout tone="info" title="Some issues have no derived metrics">
          <span className="mono">{formatCount(metadata.issues_without_metrics, { locale })}</span>{" "}
          {metadata.issues_without_metrics === 1 ? "issue has" : "issues have"} no metrics and are left out of those figures.
        </Callout>
      ) : null}
      {newerSync ? (
        <Callout tone="info" title="Jira has been synced since this report">
          The latest sync was at <Timestamp value={meta.last_synced_at} mode="datetime" />. This report is from an earlier sync.
        </Callout>
      ) : null}
    </div>
  );
}

function ReportStripSkeleton() {
  return (
    <SkeletonGroup label="Loading the baseline report" className="@container">
      <div className={FRAME}>
        {["w-40", "w-36", "w-36"].map((width, index) => (
          <div key={index} className={CELL}>
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className={`mt-1 h-3.5 ${width}`} />
            <Skeleton className="h-2.5 w-28" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** What the report covers and when it was taken: the window, the sync behind its figures, when it was written. */
export function ReportStrip({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  if (!data) return <ReportStripSkeleton />;
  const { metadata, figures } = data;
  const days = windowDays(metadata, locale);
  const syncedAt = metadata.last_synced_at ?? figures.snapshot.last_synced_at;

  return (
    <div id="report" role="group" aria-label="About this report" className="@container flex flex-col gap-3">
      <dl className={FRAME}>
        <Fact
          label="Window"
          value={
            <span title={days.span}>
              <time dateTime={metadata.window.start_local} className="mono" data-figure>
                {days.first}
              </time>{" "}
              –{" "}
              <span className="mono" data-figure>
                {days.last}
              </span>
            </span>
          }
          detail={`${formatCount(metadata.window_days, { locale })} days`}
        />
        <Fact
          label="As of"
          value={syncedAt ? <Timestamp value={syncedAt} mode="datetime" /> : <span className="text-ink-low">No sync recorded</span>}
        />
        <Fact label="Generated" value={<Timestamp value={metadata.generated_at} mode="datetime" />} />
      </dl>
      <ReportFlags data={data} />
    </div>
  );
}
