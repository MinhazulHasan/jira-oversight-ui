import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import directorySample from "../../../../docs/sample-responses/people-directory.json";
import peopleSample from "../../../../docs/sample-responses/people.json";
import { oversightKeys, useAsk, useFinding, useFindings, useHealth, useIssueTimeline, usePeople, usePeopleDirectory, useTrend } from "../hooks";
import { normalizeFindingsQuery } from "../params";

const META = {
  data_mode: "sample",
  last_synced_at: "2026-11-04T14:28:00.000Z",
  projects: ["DEMO"],
  rules_version: "0.1.0",
  process_version: "0.1.0",
  generated_at: "2026-11-04T14:30:00.000Z",
  report_timezone: "Europe/London",
};

function page(number: number) {
  return { meta: META, items: [], total: 80, page: number, page_size: 25, facets: { rules: [], epics: [], people: [], severity: [], state: [] } };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** A fetch that answers by path and query, then by path alone; anything else is a 404. */
function server(routes: Record<string, () => unknown>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const target = String(input).replace(/^\/api\/oversight\//, "");
    const route = routes[target] ?? routes[target.split("?")[0]];
    if (!route) return new Response(JSON.stringify({ error: "not_found", message: "none" }), { status: 404 });
    return new Response(JSON.stringify(await route()), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the query hooks", () => {
  it("key equivalent findings queries alike, so they share one cache entry", () => {
    expect(oversightKeys.findingsList(normalizeFindingsQuery({ rule: ["R-FLOW-02", "R-EST-01"], state: "open" }))).toEqual(
      oversightKeys.findingsList(normalizeFindingsQuery({ rule: ["R-EST-01", "R-FLOW-02"] })),
    );
    expect(oversightKeys.findingsList(normalizeFindingsQuery({ person: ["unassigned", "p3f9a2c41b0de", "unassigned"] }))).toEqual(
      oversightKeys.findingsList(normalizeFindingsQuery({ person: ["p3f9a2c41b0de", "unassigned"] })),
    );
    expect(oversightKeys.findingsList(normalizeFindingsQuery({ person: ["unassigned"] }))).not.toEqual(
      oversightKeys.findingsList(normalizeFindingsQuery()),
    );
    expect(oversightKeys.finding("abc").slice(0, 2)).toEqual(oversightKeys.findings());
  });

  it("pass the person filter through to the findings request", async () => {
    const { fetchMock } = server({ findings: () => page(1) });
    const { result } = renderHook(() => useFindings({ person: ["unassigned", "p3f9a2c41b0de"], state: "all" }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/findings?state=all&person=p3f9a2c41b0de&person=unassigned");
  });

  it("give the board's people", async () => {
    const { fetchMock } = server({ people: () => peopleSample });
    const { result } = renderHook(() => usePeople(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/people");
    expect(result.current.data?.people.at(-1)?.person).toBeNull();
    expect(result.current.data).toEqual(peopleSample);
  });

  it("give everyone on the board for the @ list, only when asked to, under the people's key so a sync clears both", async () => {
    const { fetchMock } = server({ "people/directory": () => directorySample });
    const held = renderHook(() => usePeopleDirectory({ enabled: false }), { wrapper: wrapper() });
    expect(held.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
    const { result } = renderHook(() => usePeopleDirectory(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/people/directory");
    expect(result.current.data).toEqual(directorySample);
    expect(oversightKeys.peopleDirectory().slice(0, 2)).toEqual(oversightKeys.people());
  });

  it("keep the previous page on screen while the next one loads", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server({
      "findings?page=2": () => gate.then(() => page(2)),
      findings: () => page(1),
    });
    const { result, rerender } = renderHook(({ pageNumber }) => useFindings({ page: pageNumber }), {
      wrapper: wrapper(),
      initialProps: { pageNumber: 1 },
    });
    await waitFor(() => expect(result.current.data?.page).toBe(1));

    rerender({ pageNumber: 2 });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.page).toBe(1);

    await act(async () => release());
    await waitFor(() => expect(result.current.data?.page).toBe(2));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it("stay idle until a finding id or issue key is well formed", async () => {
    const { fetchMock } = server({});
    const finding = renderHook(() => useFinding("not-an-id"), { wrapper: wrapper() });
    const issue = renderHook(() => useIssueTimeline(undefined), { wrapper: wrapper() });
    expect(finding.result.current.fetchStatus).toBe("idle");
    expect(issue.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("read issue keys in any case", async () => {
    const { fetchMock } = server({});
    const { result } = renderHook(() => useIssueTimeline("demo-12"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/issues/DEMO-12/timeline");
    expect(result.current.error?.status).toBe(404);
  });

  it("give the shell its health, with a typed error when it fails", async () => {
    server({ health: () => ({ ...META, status: "ok", data_mode: "sample", read_only: true, api_version: "0.1.0", projects: ["DEMO"], report_timezone: "Europe/London" }) });
    const { result } = renderHook(() => useHealth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data_mode).toBe("sample");
    expect(result.current.data?.message).toBeNull();
  });

  it("ask a question once per call, never retrying it", async () => {
    const { fetchMock } = server({});
    const { result } = renderHook(() => useAsk(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ question: "Where do tickets get stuck most?", mentions: [] }).catch(() => undefined);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    // No mentions, no mentions key: a team-level question is exactly what it always was.
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ question: "Where do tickets get stuck most?" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("ask for twelve weeks of a trend unless told otherwise", async () => {
    const { fetchMock } = server({});
    renderHook(() => useTrend("median_cycle_time_h"), { wrapper: wrapper() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/trends?metric=median_cycle_time_h&period=week&last_n=12");
  });
});
