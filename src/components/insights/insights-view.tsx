"use client";

import { useInsights } from "@/lib/api/hooks";

import { Briefing } from "./briefing";
import { BriefingError, BriefingSkeleton, NoBriefing } from "./states";

export function InsightsView() {
  const query = useInsights();

  if (query.data) return <Briefing insights={query.data} />;
  if (query.status === "pending") return <BriefingSkeleton />;
  if (query.error?.notFound) return <NoBriefing />;
  return <BriefingError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
}
