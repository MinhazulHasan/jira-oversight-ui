import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Insights } from "@/lib/api/schemas";

import { Briefing } from "../briefing";
import { coverageFinding, renderWithQuery, sampleBriefing, stubApi } from "./render";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderBriefing(overrides: Partial<Insights> = {}) {
  const briefing = sampleBriefing(overrides);
  const coverage = sampleBriefing().candidates.find((candidate) => candidate.kind === "coverage")!;
  const firstFinding = coverage.finding_ids[0];
  stubApi({ [`findings/${firstFinding}`]: { status: 200, body: coverageFinding(firstFinding) } });
  renderWithQuery(<Briefing insights={briefing} />);
  return briefing;
}

const sentenceRows = () => [...document.querySelectorAll<HTMLElement>("[data-trace-kind='sentence']")];
const candidateRow = (id: string) => document.getElementById(`candidate-${id}`)!;
const root = () => document.querySelector<HTMLElement>("[data-briefing]")!;

beforeEach(() => {
  push.mockClear();
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
});

describe("the briefing sheet", () => {
  it("opens with the week and when it was written, and nothing about how (go-live, SQA)", () => {
    renderBriefing();
    expect(screen.getByRole("heading", { level: 2, name: "Week of 2 Nov 2026" })).toBeInTheDocument();
    expect(screen.getByText(/^Written/)).toBeInTheDocument();
    // The prototype's self-description, model name and versions are gone.
    const sheet = root();
    expect(sheet).not.toHaveTextContent(/Verified|How this was written|How it was written|Written by|Rules version|Process version|from the top|sentences,|claude/i);
    expect(sheet).not.toHaveTextContent(/Score \d/);
  });

  it("reads each sentence with its tone, and links its candidate, its findings and its keys", () => {
    renderBriefing();
    const rows = sentenceRows();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(/^Serious: DEMO-704 Data import pipeline has 73 open breaches, up from 71 a week ago\./);
    expect(rows[3]).toHaveTextContent(/^Getting worse: In Sprint 26/);

    const first = within(rows[0]);
    expect(first.getByRole("link", { name: "Candidate 1 Breach hot spot: Open breaches in Data import pipeline" })).toHaveAttribute(
      "href",
      "#candidate-hot-spot-demo-704",
    );
    expect(first.getByRole("link", { name: "73 open breaches" })).toHaveAttribute("href", "/findings?epic=DEMO-704&severity=breach");
    expect(first.getByRole("link", { name: "DEMO-704" })).toHaveAttribute("href", "/issues/DEMO-704");
    expect(within(rows[4]).getByRole("link", { name: "9 findings this week" })).toHaveAttribute(
      "href",
      "/findings?rule=R-EST-01&state=all&first_seen=7d",
    );

    const legend = screen.getByRole("list", { name: "Tones" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Serious",
      "Getting worse",
    ]);
    expect(root()).not.toHaveTextContent(/Blatantly bad|On its way to being bad/);
  });

  it("finds the rule behind a coverage candidate before filtering by it", async () => {
    renderBriefing();
    const sentence = within(sentenceRows()[3]);
    expect(sentence.getByRole("link", { name: "Open the first of 24 findings" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/findings\?finding=[0-9a-f]{32}$/),
    );
    await waitFor(() => expect(sentence.getByRole("link", { name: "24 findings" })).toHaveAttribute("href", "/findings?rule=W-EST-01"));
  });

  it("ranks the problems and says what each counts and which way it is moving, with no scoring formula", () => {
    renderBriefing();
    const list = screen.getByRole("region", { name: "Top problems" });
    expect(within(list).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual([
      "Open breaches in Data import pipeline",
      "Open breaches in Integrations API",
      "Open breaches in Search and filtering",
      "Estimates and logged time in Sprint 26",
      "R-EST-01 is rising",
    ]);
    expect(candidateRow("hot-spot-demo-704")).toHaveTextContent("73 open breaches · rising");
    expect(candidateRow("coverage-sprint-4426")).toHaveTextContent("33 uncovered issues · steady");
    expect(list).not.toHaveTextContent(/Score|×/);

    const coverage = within(candidateRow("coverage-sprint-4426"));
    expect(coverage.getByText("Sprint 26")).toBeInTheDocument();
    expect(coverage.getByText("Share with an estimate").nextElementSibling).toHaveTextContent("65%");
    expect(coverage.getByText("Issues in the sprint").nextElementSibling).toHaveTextContent("94");
  });

  it("lights the candidates a sentence was written from and the figures it quotes, and back again", () => {
    renderBriefing();
    const [first, second] = sentenceRows();
    const spot = candidateRow("hot-spot-demo-704");
    const row = (label: string) => within(spot).getByText(label).parentElement!;

    fireEvent.pointerOver(first);
    expect(spot).toHaveAttribute("data-linked", "true");
    expect(candidateRow("hot-spot-demo-763")).not.toHaveAttribute("data-linked");
    expect(first.querySelector("[data-quoted='open_breaches']")).toHaveClass("text-cite");
    expect(row("Open breaches")).toHaveClass("bg-cite-tint");
    expect(row("Open breaches a week ago")).toHaveClass("bg-cite-tint");
    expect(row("Open warnings")).not.toHaveClass("bg-cite-tint");

    fireEvent.pointerOver(candidateRow("hot-spot-demo-763"));
    expect(second).toHaveAttribute("data-linked", "true");
    expect(first).not.toHaveAttribute("data-linked");
    expect(second.querySelector("[data-quoted='open_breaches']")).toHaveClass("text-cite");

    fireEvent.pointerLeave(root());
    expect(second).not.toHaveAttribute("data-linked");
    expect(spot).not.toHaveAttribute("data-linked");
  });

  it("does the same for the keyboard, by focus", () => {
    renderBriefing();
    const second = sentenceRows()[1];
    act(() => within(second).getByRole("link", { name: "57 open breaches" }).focus());
    expect(candidateRow("hot-spot-demo-763")).toHaveAttribute("data-linked", "true");
    act(() => (document.activeElement as HTMLElement).blur());
    expect(candidateRow("hot-spot-demo-763")).not.toHaveAttribute("data-linked");
  });
});
