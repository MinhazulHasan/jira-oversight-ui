import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { baselineSchema, type Baseline } from "@/lib/api/schemas";

import baselineSample from "../../../../docs/sample-responses/baseline.json";

/*
 * Shared set-up for the Baseline tests: the real sample report served through
 * a stubbed fetch, a fresh query client, the kit's providers, an en-GB reader
 * (so figures and dates read the same on every machine), and matchMedia,
 * which jsdom lacks and the reduced-motion check reads.
 */

/** The sample report, read through the contract so the tests change it in the contract's types. */
export const SAMPLE: Baseline = baselineSchema.parse(baselineSample);

/** A deep copy of the sample with some parts replaced. */
export function sampleWith(change: (body: Baseline) => void): Baseline {
  const body = structuredClone(SAMPLE);
  change(body);
  return body;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answer every request with what the test hands back, and count the calls. */
export function serve(answer: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function asReader(): void {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

export function renderWithData(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return renderKit(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
