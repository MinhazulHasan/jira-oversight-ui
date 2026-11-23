import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";

import findingSample from "../../../../docs/sample-responses/finding.json";
import sprintSample from "../../../../docs/sample-responses/finding-sprint.json";
import findingsSample from "../../../../docs/sample-responses/findings.json";
import rulesSample from "../../../../docs/sample-responses/rules.json";
import { FindingsView } from "../findings-view";

/*
 * The Findings view against the real sample responses (docs/sample-responses),
 * served through a stubbed fetch so the API client parses them exactly as it
 * does in the browser; the URL lives in nuqs's testing adapter.
 */

export const SAMPLE = { findings: findingsSample, finding: findingSample, sprint: sprintSample, rules: rulesSample };

/** DEMO-1098: a breach that W-EST-01 foreshadowed, second on the first page. */
export const BREACH_ID = findingSample.finding.finding_id;
/** Sprint 26 at risk: a sprint finding, first on the first page. */
export const SPRINT_ID = sprintSample.finding.finding_id;

export interface Reply {
  status?: number;
  body: unknown;
}

type Route = (path: string, url: URL) => Reply | undefined;

function sampleRoute(path: string): Reply {
  if (path === "findings") return { body: findingsSample };
  if (path === "rules") return { body: rulesSample };
  if (path.startsWith("findings/")) {
    const id = path.slice("findings/".length);
    if (id === BREACH_ID) return { body: findingSample };
    if (id === SPRINT_ID) return { body: sprintSample };
    // Any other finding on the page: the list item, with no synced timeline.
    const item = findingsSample.items.find((candidate) => candidate.finding_id === id);
    if (item) return { body: { meta: findingsSample.meta, finding: item, timeline: [] } };
  }
  return { status: 404, body: { error: "not_found", message: "Not in the sample data." } };
}

/** Answer /api/oversight/* from the samples, unless `route` answers first. */
export function stubApi(route?: Route) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace(/^\/api\/oversight\//, "");
    const reply = route?.(path, url) ?? sampleRoute(path);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The findings requests made so far, as their query strings. */
export function findingsRequests(fetchMock: ReturnType<typeof stubApi>): URLSearchParams[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), "http://localhost"))
    .filter((url) => url.pathname === "/api/oversight/findings")
    .map((url) => url.searchParams);
}

/** Render the view at `search` ("?severity=breach"); `url()` reads the address as it is now. */
export function renderFindings(search = "") {
  let current = new URLSearchParams(search);
  const onUrlUpdate = vi.fn((event: { searchParams: URLSearchParams }) => {
    current = new URLSearchParams(event.searchParams);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
        <FindingsView />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { ...view, onUrlUpdate, url: () => current };
}
