import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "@/components/findings/filter-bar";
import { PersonFindings } from "@/components/overview/person-findings";
import { peopleFixture } from "@/components/overview/__tests__/fixture";
import { PeopleLevelProvider } from "@/components/shell/people-level";
import { renderKit } from "@/components/ui/__tests__/kit";
import { navPagesFor, pageForChord, pageForPath } from "@/lib/nav";
import { resolveShortcut } from "@/lib/shortcuts";

import findingsSample from "../../../../docs/sample-responses/findings.json";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the People page in the navigation", () => {
  it("is offered at people level only: the rail's list, the palette and the shortcut", () => {
    expect(navPagesFor(true).map((page) => page.key)).toEqual([
      "portfolio",
      "overview",
      "findings",
      "people",
      "ask",
      "insights",
      "process",
      "baseline",
      "access_log",
      "usage",
      "rule_settings",
    ]);
    expect(navPagesFor(false).map((page) => page.key)).not.toContain("people");
    expect(pageForChord("e", true)?.href).toBe("/people");
    expect(pageForChord("e", false)).toBeUndefined();
    expect(pageForPath("/people")?.label).toBe("People");
    const armed = { typing: false, chordArmedAt: 10_000, now: 10_300 };
    const key = { key: "e", metaKey: false, ctrlKey: false, altKey: false };
    expect(resolveShortcut(key, { ...armed, peopleLevel: true })).toEqual({ type: "navigate", href: "/people" });
    expect(resolveShortcut(key, armed)).toBeNull();
    expect(navPagesFor(true).find((page) => page.key === "people")?.purpose).toBe("How each person handles tickets, against the board.");
  });
});

function renderFilters(person: string[], peopleLevel: boolean) {
  const client = new QueryClient();
  const filters = { q: "", severity: null, state: "open", rule: [], epic: [], person, first_seen: "all", sort: "first_seen_at", order: "desc", page: 1 } as const;
  return renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams="">
        <PeopleLevelProvider peopleLevel={peopleLevel}>
          <FilterBar filters={{ ...filters, person: [...person], rule: [], epic: [] }} setFilters={vi.fn()} facets={findingsSample.facets as never} />
        </PeopleLevelProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

describe("View scorecard beside the Findings Person filter", () => {
  const someone = findingsSample.facets.people.find((entry) => entry.value !== "unassigned")!;

  it("leads to that person's scorecard when one person is chosen, at people level", () => {
    renderFilters([someone.value], true);
    expect(screen.getByRole("link", { name: `View scorecard of ${someone.label}` })).toHaveAttribute("href", `/people?person=${someone.value}`);
  });

  it("is not there for the unassigned tickets, for several people, or at team level", () => {
    renderFilters(["unassigned"], true);
    expect(screen.queryByRole("link", { name: /View scorecard/ })).not.toBeInTheDocument();
    renderFilters([someone.value, "unassigned"], true);
    expect(screen.queryByRole("link", { name: /View scorecard/ })).not.toBeInTheDocument();
    renderFilters([someone.value], false);
    expect(screen.queryByRole("link", { name: /View scorecard/ })).not.toBeInTheDocument();
  });
});

describe("View scorecards on the Overview's open findings by person", () => {
  it("is there at people level, beside All people, and nowhere at team level", () => {
    const view = renderKit(
      <PeopleLevelProvider peopleLevel>
        <PersonFindings data={peopleFixture()} />
      </PeopleLevelProvider>,
    );
    const region = screen.getByRole("region", { name: "People" });
    expect(within(region).getByRole("link", { name: "View scorecards" })).toHaveAttribute("href", "/people");
    expect(within(region).getByRole("link", { name: "All people" })).toBeInTheDocument();
    view.unmount();
    renderKit(<PersonFindings data={peopleFixture()} />);
    expect(screen.queryByRole("link", { name: "View scorecards" })).not.toBeInTheDocument();
  });
});
