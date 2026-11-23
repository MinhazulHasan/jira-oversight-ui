"use client";

import { useInsights } from "@/lib/api/hooks";

import { Briefing } from "./briefing";
import { BriefingError, BriefingSkeleton, NoBriefing } from "./states";

/**
 * The Insights page's one data region, in its four states: loading (the
 * sheet's own shape), no briefing yet (before the first weekly run), an
 * inline error with retry, and the briefing.
 */
export function InsightsView() {
  const query = useInsights();

  if (query.data) return <Briefing insights={query.data} />;
  if (query.status === "pending") return <BriefingSkeleton />;
  if (query.error?.notFound) return <NoBriefing />;
  return <BriefingError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
}
