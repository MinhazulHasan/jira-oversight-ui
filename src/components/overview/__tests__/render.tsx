import { vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import type { ApiError } from "@/lib/api/client";
import { useOverview, usePeople } from "@/lib/api/hooks";
import type { Overview, People } from "@/lib/api/schemas";

import { OverviewView } from "../overview-view";

/*
 * Renders the Overview against a stated query result. The test file mocks
 * "@/lib/api/hooks" (useOverview and usePeople: vi.fn()), "next/link" and
 * the Recharts TrendLine; this sets what the hooks answer and returns their
 * refetches. The people (their own request) wait unless a test says otherwise.
 */

type QueryResult = ReturnType<typeof useOverview>;
type PeopleResult = ReturnType<typeof usePeople>;

export interface ServedPeople {
  data?: People;
  error?: ApiError;
  isFetching?: boolean;
}

export interface ServedState {
  data?: Overview;
  error?: ApiError;
  isFetching?: boolean;
  people?: ServedPeople;
}

export function renderOverview(state: ServedState = {}) {
  const refetch = vi.fn();
  const refetchPeople = vi.fn();
  vi.mocked(useOverview).mockReturnValue({
    data: state.data,
    error: state.error ?? null,
    isFetching: state.isFetching ?? false,
    isPending: !state.data && !state.error,
    refetch,
  } as unknown as QueryResult);
  const people = state.people ?? {};
  vi.mocked(usePeople).mockReturnValue({
    data: people.data,
    error: people.error ?? null,
    isFetching: people.isFetching ?? false,
    isPending: !people.data && !people.error,
    refetch: refetchPeople,
  } as unknown as PeopleResult);
  const view = renderKit(<OverviewView />);
  return { ...view, refetch, refetchPeople };
}
