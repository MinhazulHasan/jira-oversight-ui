"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/error-state";
import { Timestamp } from "@/components/ui/timestamp";
import { useOverview, usePeople, type ApiError } from "@/lib/api/hooks";

import { Coverage } from "./coverage";
import { HeadlineTiles } from "./headline-tiles";
import { HotSpots } from "./hot-spots";
import { InsightTeaser } from "./insight-teaser";
import { PersonFindings } from "./person-findings";
import { RuleFindings } from "./rule-findings";
import { StatusMix } from "./status-mix";
import { Trends } from "./trends";

function errorDetail(error: ApiError): string {
  return error.status > 0 ? `HTTP ${error.status} · ${error.code}` : error.code;
}

export function OverviewView() {
  const { data, error, refetch, isFetching } = useOverview();
  const people = usePeople();
  const retry = () => void refetch();

  if (!data && error) {
    return (
      <ErrorState
        title="The overview could not be loaded"
        description={`${error.message}`}
        detail={errorDetail(error)}
        onRetry={retry}
        retrying={isFetching}
      />
    );
  }

  return (
    <div className="flex flex-col gap-9">
      {data && error ? (
        <Callout
          tone="warn"
          title="The overview could not be refreshed"
          action={
            <Button size="sm" icon={RotateCcw} loading={isFetching} onClick={retry}>
              {isFetching ? "Retrying" : "Try again"}
            </Button>
          }
        >
          These figures are as of <Timestamp value={data.meta.generated_at} mode="datetime" />. {error.message}
        </Callout>
      ) : null}

      <HeadlineTiles data={data} />

      <div className="grid items-start gap-9 xl:grid-cols-2 xl:gap-x-12">
        <HotSpots data={data} />
        <RuleFindings data={data} />
      </div>

      <PersonFindings
        data={people.data}
        error={people.error}
        onRetry={() => void people.refetch()}
        retrying={people.isFetching}
      />

      <Coverage data={data} />

      <Trends data={data} />

      <div className="grid items-start gap-9 lg:grid-cols-2 lg:gap-x-12">
        <StatusMix data={data} />
        <InsightTeaser data={data} />
      </div>
    </div>
  );
}
