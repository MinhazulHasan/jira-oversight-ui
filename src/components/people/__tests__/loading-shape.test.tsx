import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { peopleScorecardSchema, type PeopleScorecard } from "@/lib/api/schemas";

import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import offJson from "../../../../docs/sample-responses/people-scorecard-off.json";
import everyoneJson from "../../../../docs/sample-responses/people-scorecard.json";
import personJson from "../../../../docs/sample-responses/people-scorecard-person.json";
import { PeopleView, PeopleViewFallback } from "../people-view";

/*
 * The JO-11 check's G2: with comparison off, the People page drew the
 * comparison's loading state (the everyone table's heading, its words, the
 * marks' key and the table's skeleton), none of which ever shows in that
 * mode, and jumped about 690 px when the figures arrived. The page now holds
 * the shape the server expects (the sample's setting, or the service's as it
 * last reported it) until the figures say which it is.
 */

vi.mock("@/lib/notify", () => ({ notify: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), cite: vi.fn(), error: vi.fn() } }));

const everyone = peopleScorecardSchema.parse(everyoneJson);
const off = peopleScorecardSchema.parse(offJson);
const one = peopleScorecardSchema.parse(personJson);
const PERSON = one.people[0].person.id;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(() => vi.unstubAllGlobals());

/** The service: everyone's figures held until `release`, one person's and the directory at once. */
function serve(card: PeopleScorecard) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/people/directory")) return reply(directoryJson);
      if (url.searchParams.getAll("person").length > 0) {
        await held;
        return reply(one);
      }
      await held;
      return reply(card);
    }),
  );
  return () => release();
}

function renderPage(expected: "on" | "off", search = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} hasMemory>
        <PeopleView expected={expected} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

/** A loading state by its words (a status region is not named by its content). */
const loading = (words: string) => screen.queryAllByRole("status").filter((region) => region.textContent?.includes(words));
const sectionTitles = () => screen.queryAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);

describe("the People page while its figures load (G2)", () => {
  it("with comparison off expected, holds one person's shape: the note, the Person control and the scorecard's place", async () => {
    const release = serve(off);
    renderPage("off", `?person=${PERSON}`);
    // Never the comparison's loading state: no everyone heading, no table skeleton, no marks' key.
    expect(screen.queryByText("Everyone with tickets")).toBeNull();
    expect(loading("Loading everyone's figures")).toHaveLength(0);
    expect(screen.getByText(/Comparing people is off\. One person at a time/)).toBeInTheDocument();
    expect(loading("Loading the scorecard")).toHaveLength(1);
    expect(sectionTitles()).toEqual(["Scorecard"]);
    expect(await screen.findByRole("button", { name: /^Person/ })).toBeInTheDocument();
    release();
    // Once in, the same shape: the note, the Person control, and the scorecard where its skeleton stood.
    expect(await screen.findByRole("table", { name: one.people[0].person.name })).toBeInTheDocument();
    expect(sectionTitles()).toEqual(["Scorecard"]);
    expect(screen.getByText(/Comparing people is off\. One person at a time/)).toBeInTheDocument();
  });

  it("with comparison on expected, holds the everyone table's shape, as before", async () => {
    const release = serve(everyone);
    renderPage("on");
    expect(loading("Loading everyone's figures")).toHaveLength(1);
    expect(sectionTitles()).toEqual(["Everyone with tickets", "Scorecard"]);
    expect(screen.queryByText(/Comparing people is off/)).toBeNull();
    release();
    await waitFor(() => expect(loading("Loading everyone's figures")).toHaveLength(0));
    expect(sectionTitles()).toEqual(["Everyone with tickets", "Scorecard"]);
  });

  it("follows the figures when the expectation was wrong: they decide the shape once they are in", async () => {
    const release = serve(off);
    renderPage("on");
    expect(sectionTitles()).toEqual(["Everyone with tickets", "Scorecard"]);
    release();
    expect(await screen.findByText(/Comparing people is off\. One person at a time/)).toBeInTheDocument();
    expect(sectionTitles()).toEqual(["Scorecard"]);
  });

  it("draws the address's fallback in the expected shape too", () => {
    const { container } = renderKit(<PeopleViewFallback expected="off" />);
    expect(container.querySelector('[data-skeleton="table"]')).toBeNull();
    const { container: on } = renderKit(<PeopleViewFallback expected="on" />);
    expect(on.querySelector('[data-skeleton="table"]')).not.toBeNull();
  });
});
