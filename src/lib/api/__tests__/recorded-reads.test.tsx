import { focusManager, onlineManager, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeQueryClient } from "@/components/providers";

import accessLogSample from "../../../../docs/sample-responses/access-log.json";
import findingsSample from "../../../../docs/sample-responses/findings.json";
import overviewSample from "../../../../docs/sample-responses/overview.json";
import scorecardSample from "../../../../docs/sample-responses/people-scorecard.json";
import personCardSample from "../../../../docs/sample-responses/person-card.json";
import { invalidateAfterSync, useAccessLog, useFindings, useOverview, usePeopleScorecard, usePersonCard } from "../hooks";

const ADA = "p3f9a2c41b0de";
const CARD = `people/${ADA}/card`;
const BODIES: Record<string, unknown> = {
  "people/scorecard": scorecardSample,
  findings: findingsSample,
  "access-log": accessLogSample,
  overview: overviewSample,
  [CARD]: personCardSample,
};

/** A fetch that answers each path with its sample (or `fail` for it), counting the requests by path. */
function server(fail: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const [path] = String(input).replace(/^\/api\/oversight\//, "").split("?");
    const failure = fail[path]?.();
    if (failure) return failure;
    return new Response(JSON.stringify(BODIES[path]), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const calls = (path: string, query?: string) =>
    fetchMock.mock.calls.filter(([input]) => {
      const target = String(input).replace(/^\/api\/oversight\//, "");
      return target.split("?")[0] === path && (query === undefined || target.includes(query));
    }).length;
  return { calls };
}

function wrapperOf(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Two minutes on, past the app's minute of freshness: anything that may read again on its own would. */
function laterByMinutes(minutes: number) {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + minutes * 60_000);
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe("reads the access log records", () => {
  it("never read a scorecard, someone's findings or a person card again on focus or a reconnect, however old", async () => {
    const { calls } = server();
    const client = makeQueryClient();
    renderHook(
      () => {
        usePeopleScorecard({});
        usePeopleScorecard({ person: [ADA] });
        useFindings({ person: [ADA] });
        useFindings({ person: ["unassigned"] });
        usePersonCard(ADA);
      },
      { wrapper: wrapperOf(client) },
    );
    await waitFor(() => expect(calls("people/scorecard")).toBe(2));
    await waitFor(() => expect(calls("findings")).toBe(2));
    await waitFor(() => expect(calls(CARD)).toBe(1));

    laterByMinutes(2);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await settle();
    expect(calls("people/scorecard")).toBe(2);
    expect(calls("findings", `person=${ADA}`)).toBe(1);
    expect(calls(CARD)).toBe(1);
    // Findings for no one (unassigned) are not recorded: they stay fresh as every other list does.
    expect(calls("findings", "person=unassigned")).toBe(2);
  });

  it("never retry a read the service may have recorded; retry one that never left the browser", async () => {
    const timedOut = () => Response.json({ error: "upstream_timeout", message: "The oversight service did not answer in time." }, { status: 503 });
    const { calls } = server({ "people/scorecard": timedOut, [CARD]: timedOut });
    const client = makeQueryClient();
    const failed = renderHook(() => ({ scorecard: usePeopleScorecard({}), card: usePersonCard(ADA) }), { wrapper: wrapperOf(client) });
    // At once: no second or third request first (the app's default would retry a 5xx twice, a second and two apart).
    await waitFor(() => expect(failed.result.current.scorecard.isError && failed.result.current.card.isError).toBe(true), { timeout: 900 });
    expect(calls("people/scorecard")).toBe(1);
    expect(calls(CARD)).toBe(1);

    let dropped = true;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (dropped) {
        dropped = false;
        throw new TypeError("Failed to fetch");
      }
      return Response.json(findingsSample);
    });
    vi.stubGlobal("fetch", fetchMock);
    const retried = renderHook(() => useFindings({ person: [ADA] }), { wrapper: wrapperOf(makeQueryClient()) });
    // The retry waits out TanStack's real one-second delay; room to spare for a busy machine.
    await waitFor(() => expect(retried.result.current.isSuccess).toBe(true), { timeout: 8000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("a sync reads the figures on screen again, never the access log's pages", async () => {
    const { calls } = server();
    const client = makeQueryClient();
    const { result } = renderHook(() => ({ log: useAccessLog({}), overview: useOverview() }), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.log.isSuccess && result.current.overview.isSuccess).toBe(true));
    await act(async () => {
      await result.current.log.fetchNextPage();
    });
    expect(calls("access-log")).toBe(2);

    await act(async () => {
      await invalidateAfterSync(client);
    });
    expect(calls("overview")).toBe(2);
    expect(calls("access-log")).toBe(2);
  });

  it("reads the access log's first page anew on coming back to it, once, never every page read before", async () => {
    const { calls } = server();
    const client = makeQueryClient();
    const first = renderHook(() => useAccessLog({}), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await act(async () => {
      await first.result.current.fetchNextPage();
    });
    expect(calls("access-log")).toBe(2);
    first.unmount();
    await settle();

    const again = renderHook(() => useAccessLog({}), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(again.result.current.isSuccess).toBe(true));
    await settle();
    expect(calls("access-log")).toBe(3);
    expect(again.result.current.data?.pages).toHaveLength(1);
  });
});
