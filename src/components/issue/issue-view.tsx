"use client";

import { PageBody } from "@/components/shell/page";
import { useIssueTimeline, useRules } from "@/lib/api/hooks";

import { IssueChangelog } from "./issue-changelog";
import { IssueFacts, IssueFactsLoading } from "./issue-facts";
import { IssueFindings } from "./issue-findings";
import { IssueHeader } from "./issue-header";
import { IssueError, IssueNotFound } from "./issue-states";
import { IssueTimeline } from "./issue-timeline";
import { IssueWorklogs } from "./issue-worklogs";

/**
 * One issue's story, as evidence: the header and its facts, the status
 * timeline, the findings beside the time logged, and the changelog they cite.
 * Everything comes from one response (issues/{key}/timeline); the process map
 * (rules) only shapes the timeline's lanes and the estimate in hours, so the
 * page reads without it.
 */
export function IssueView({ issueKey }: { issueKey: string }) {
  const timeline = useIssueTimeline(issueKey);
  const rules = useRules();
  const data = timeline.data ?? null;
  const process = rules.data?.process ?? null;
  const processState = rules.data ? "ready" : rules.isError ? "error" : "loading";

  if (!data && timeline.error) {
    const missing = timeline.error.notFound;
    return (
      <>
        <IssueHeader issueKey={issueKey} state={missing ? "missing" : "error"} />
        <PageBody>
          {missing ? (
            <IssueNotFound issueKey={issueKey} />
          ) : (
            <IssueError
              issueKey={issueKey}
              error={timeline.error}
              onRetry={() => void timeline.refetch()}
              retrying={timeline.isFetching}
            />
          )}
        </PageBody>
      </>
    );
  }

  return (
    <>
      {data ? <IssueHeader issueKey={issueKey} state="ready" data={data} /> : <IssueHeader issueKey={issueKey} state="loading" />}
      <PageBody className="@container flex flex-col gap-9">
        {data ? <IssueFacts data={data} hoursPerPoint={process?.estimate.hours_per_point ?? null} /> : <IssueFactsLoading />}
        <IssueTimeline
          data={data}
          process={process}
          processState={processState}
          onRetryProcess={() => void rules.refetch()}
          retryingProcess={rules.isFetching}
        />
        <div className="grid gap-9 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @4xl:gap-10">
          <IssueFindings data={data} />
          <IssueWorklogs data={data} />
        </div>
        <IssueChangelog data={data} />
      </PageBody>
    </>
  );
}
