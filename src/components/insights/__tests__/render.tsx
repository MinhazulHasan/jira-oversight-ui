import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { insightsSchema, type Insights } from "@/lib/api/schemas";

import findingSample from "../../../../docs/sample-responses/finding.json";
import insightsSample from "../../../../docs/sample-responses/insights.json";

/*
 * Test helpers for the Insights page: the real sample briefing, a query
 * client that never retries, and a fetch that answers from a table of paths.
 */

export function sampleBriefing(overrides: Partial<Insights> = {}): Insights {
  return { ...insightsSchema.parse(insightsSample), ...overrides };
}

/** The coverage candidate's first finding, as the rule lookup returns it. */
export function coverageFinding(findingId: string) {
  return {
    ...findingSample,
    finding: { ...findingSample.finding, finding_id: findingId, rule_id: "W-EST-01", rule_title: "Unestimated work in the active sprint" },
  };
}

export type Answer = { status: number; body: unknown };

/** Stub fetch: each request path (after /api/oversight/) maps to an answer, or a function of how often it was asked. */
export function stubApi(routes: Record<string, Answer | ((call: number) => Answer)>) {
  const calls = new Map<string, number>();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^.*\/api\/oversight\//, "");
    const call = (calls.get(path) ?? 0) + 1;
    calls.set(path, call);
    const route = routes[path];
    const answer = typeof route === "function" ? route(call) : route;
    if (!answer) return new Response(JSON.stringify({ error: "not_found", message: `No stub for ${path}` }), { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Render inside the kit's providers and a fresh query client that never retries. */
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return renderKit(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
