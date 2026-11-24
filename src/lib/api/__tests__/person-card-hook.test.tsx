import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import cardSample from "../../../../docs/sample-responses/person-card.json";
import { oversightKeys, PERSON_CARD_FRESH_MS, usePersonCard } from "../hooks";
import { normalizePersonCardQuery } from "../params";

const ADA = cardSample.person.id;

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function server() {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(cardSample), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usePersonCard", () => {
  it("asks for the card under the people's key, with the period and the board only when they are not the defaults", async () => {
    expect(oversightKeys.personCard(ADA, normalizePersonCardQuery()).slice(0, 2)).toEqual(oversightKeys.people());
    const fetchMock = server();
    const { result } = renderHook(() => usePersonCard(ADA), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/oversight/people/${ADA}/card`);
    expect(result.current.data).toEqual(cardSample);

    const other = server();
    const { result: named } = renderHook(() => usePersonCard(ADA, { days: 30, board: "OPS" }), { wrapper: wrapper() });
    await waitFor(() => expect(named.current.fetchStatus).toBe("idle"));
    expect(other.mock.calls[0][0]).toBe(`/api/oversight/people/${ADA}/card?days=30&board=OPS`);
  });

  it("asks nothing while held back (no card open)", () => {
    const fetchMock = server();
    const { result } = renderHook(() => usePersonCard(ADA, {}, { enabled: false }), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads once for a minute: a card opened again, or a second name for the same person, costs nothing", async () => {
    expect(PERSON_CARD_FRESH_MS).toBe(60_000);
    const fetchMock = server();
    const Wrapper = wrapper();
    const first = renderHook(() => usePersonCard(ADA), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    const again = renderHook(() => usePersonCard(ADA), { wrapper: Wrapper });
    expect(again.result.current.data).toEqual(cardSample);
    const twice = renderHook(() => usePersonCard(ADA), { wrapper: Wrapper });
    expect(twice.result.current.isFetching).toBe(false);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
