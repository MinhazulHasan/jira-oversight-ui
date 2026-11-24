import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import personSample from "../../../../docs/sample-responses/people-scorecard-person.json";
import everyoneSample from "../../../../docs/sample-responses/people-scorecard.json";
import { oversightKeys, usePeopleScorecard } from "../hooks";
import { normalizeScorecardQuery } from "../params";

const HANA = personSample.people[0].person.id;
const ADA = "pbc7fe62842ca";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function server(answer: (url: URL) => unknown, gate?: Promise<void>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (gate && url.searchParams.get("days") === "30") await gate;
    return new Response(JSON.stringify(answer(url)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePeopleScorecard", () => {
  it("keys the same people in any order alike, under the people's key, and asks the canonical query", async () => {
    expect(oversightKeys.peopleScorecard(normalizeScorecardQuery({ person: [HANA, ADA] }))).toEqual(
      oversightKeys.peopleScorecard(normalizeScorecardQuery({ person: [ADA, HANA], days: 90 })),
    );
    expect(oversightKeys.peopleScorecard(normalizeScorecardQuery()).slice(0, 2)).toEqual(oversightKeys.people());
    const fetchMock = server(() => personSample);
    const { result } = renderHook(() => usePeopleScorecard({ days: 30, person: [HANA] }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/oversight/people/scorecard?days=30&person=${HANA}`);
    expect(result.current.data).toEqual(personSample);
  });

  it("asks nothing when held back (a reader not at people level)", () => {
    const fetchMock = server(() => everyoneSample);
    const { result } = renderHook(() => usePeopleScorecard({}, { enabled: false }), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the figures on screen while another period loads, but never stands one person in for another", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    server((url) => (url.searchParams.has("person") ? personSample : everyoneSample), gate);
    const { result, rerender } = renderHook(({ days, person }: { days: 30 | 90; person: string[] }) => usePeopleScorecard({ days, person }), {
      wrapper: wrapper(),
      initialProps: { days: 90 as 30 | 90, person: [] as string[] },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ days: 30, person: [] });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual(everyoneSample);
    rerender({ days: 30, person: [HANA] });
    expect(result.current.data).toBeUndefined();
    release();
    await waitFor(() => expect(result.current.data).toEqual(personSample));
  });
});
