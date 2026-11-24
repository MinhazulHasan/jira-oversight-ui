"use client";

import { FileSearch } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useBaseline, type ApiError } from "@/lib/api/hooks";

import { CoverageBlock, StraightToDoneBlock } from "./coverage";
import { EstimatesBlock } from "./estimates";
import { FlowBlock } from "./flow";
import { IssueLinksBlock } from "./issue-links";
import { NotMeasurableBlock } from "./not-measurable";
import { ReportStrip } from "./report-strip";
import { SnapshotBlock } from "./snapshot";
import { TimeInStatusBlock } from "./time-in-status";

/* Two blocks side by side once each half has room for its figures (a 13" MacBook and up). */
const PAIR = "grid gap-10 xl:grid-cols-2 xl:gap-12";

function errorDetail(error: ApiError | null): string | undefined {
  if (!error) return undefined;
  return `${error.status > 0 ? `HTTP ${error.status}` : "No response"} · ${error.code}`;
}

export function BaselineView() {
  const query = useBaseline();
  const data = query.data;

  // A sync never writes a baseline: it is made on request, so "Check again" could never help (SQA). Say how one is made.
  if (!data && query.error?.notFound) {
    return <EmptyState icon={FileSearch} title="No baseline yet" description="Your administrator can make one for this board." />;
  }

  if (!data && query.isError) {
    return (
      <ErrorState
        title="Couldn't load the baseline report"
        description="Try again."
        detail={errorDetail(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <ReportStrip data={data} />
      <div className={PAIR}>
        <SnapshotBlock data={data} />
        <CoverageBlock data={data} />
      </div>
      <div className={PAIR}>
        <StraightToDoneBlock data={data} />
        <EstimatesBlock data={data} />
      </div>
      <TimeInStatusBlock data={data} />
      <FlowBlock data={data} />
      <div className={PAIR}>
        <IssueLinksBlock data={data} />
        <NotMeasurableBlock data={data} />
      </div>
    </div>
  );
}
