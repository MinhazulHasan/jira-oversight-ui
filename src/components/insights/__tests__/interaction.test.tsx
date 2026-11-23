import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Insights } from "@/lib/api/schemas";

import { Briefing } from "../briefing";
import { PrintButton } from "../print-button";
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
  const coverage = sampleBriefing().candidates.find((candidate) => candidate.kind === "coverage")!;
  const firstFinding = coverage.finding_ids[0];
  stubApi({ [`findings/${firstFinding}`]: { status: 200, body: coverageFinding(firstFinding) } });
  renderWithQuery(<Briefing insights={sampleBriefing(overrides)} />);
}

const sentenceRows = () => [...document.querySelectorAll<HTMLElement>("[data-trace-kind='sentence']")];
const candidateRow = (id: string) => document.getElementById(`candidate-${id}`)!;

beforeEach(() => {
  push.mockClear();
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
});

describe("every row leads somewhere", () => {
  it("opens a sentence's findings from anywhere on the sentence", async () => {
    const user = userEvent.setup();
    renderBriefing();
    await user.click(within(sentenceRows()[0]).getByText(/Data import pipeline has/));
    expect(push).toHaveBeenCalledWith("/findings?epic=DEMO-704&severity=breach");
  });

  it("opens a candidate's findings from anywhere on its row, but not from its own controls", async () => {
    const user = userEvent.setup();
    renderBriefing();
    const rising = candidateRow("rising-rule-r-est-01");
    await user.click(within(rising).getByText("First seen last week"));
    expect(push).toHaveBeenLastCalledWith("/findings?rule=R-EST-01&state=all&first_seen=7d");

    push.mockClear();
    const coverage = within(candidateRow("coverage-sprint-4426"));
    const more = coverage.getByRole("button", { name: "+7 more" });
    const last = coverage.getByRole("link", { name: "DEMO-1094" });
    // Hidden on screen until asked for (jsdom applies no styles), and always on paper.
    expect(last.closest("li")).toHaveClass("hidden", "print:block");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(more).toHaveTextContent("Fewer");
    expect(last.closest("li")).not.toHaveClass("hidden");
    expect(last).toHaveAttribute("href", "/issues/DEMO-1094");
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves a reader selecting a sentence to copy it", async () => {
    const user = userEvent.setup();
    renderBriefing();
    const text = within(sentenceRows()[1]).getByText(/Integrations API has/);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
    text.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(push).not.toHaveBeenCalled();
    selection.removeAllRanges();
    await user.click(text);
    expect(push).toHaveBeenCalledWith("/findings?epic=DEMO-763&severity=breach");
  });

  it("walks the rows with j and k, landing on each row's own link, and never while typing", async () => {
    const user = userEvent.setup();
    renderBriefing();
    const rows = sentenceRows();
    await user.keyboard("j");
    expect(within(rows[0]).getByRole("link", { name: "73 open breaches" })).toHaveFocus();
    await user.keyboard("jj");
    expect(within(rows[2]).getByRole("link", { name: "54 open breaches" })).toHaveFocus();
    await user.keyboard("k");
    expect(within(rows[1]).getByRole("link", { name: "57 open breaches" })).toHaveFocus();
    expect(candidateRow("hot-spot-demo-763")).toHaveAttribute("data-linked", "true");

    await user.keyboard("jjjj");
    expect(within(candidateRow("hot-spot-demo-704")).getByRole("link", { name: "73 open breaches" })).toHaveFocus();

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await user.keyboard("j");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("j");
    input.remove();
  });

  it("takes a candidate citation to the candidate, focus included", async () => {
    const user = userEvent.setup();
    renderBriefing();
    await user.click(within(sentenceRows()[4]).getByRole("link", { name: /^Candidate 5 Rising rule/ }));
    expect(window.location.hash).toBe("#candidate-rising-rule-r-est-01");
    await vi.waitFor(() =>
      expect(within(candidateRow("rising-rule-r-est-01")).getByRole("link", { name: "9 findings this week" })).toHaveFocus(),
    );
    expect(push).not.toHaveBeenCalled();
    window.location.hash = "";
  });
});

describe("the sheet's other faces", () => {
  it("says calmly when the narrative could not be verified, and what is shown instead", () => {
    renderBriefing({ verified: false });
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText("No written briefing this week")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "The candidate table" })).toBeInTheDocument();
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so in a week where nothing stood out", () => {
    renderBriefing({ sentences: [], candidates: [] });
    expect(screen.getByText("Nothing stood out this week")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "How this was written" })).toBeNull();
  });

  it("still leads a sentence that names no candidate to its findings", async () => {
    const briefing = sampleBriefing();
    const coverage = briefing.candidates.find((candidate) => candidate.kind === "coverage")!;
    const orphan = { ...briefing.sentences[3], id: "s9", candidate_ids: [] };
    renderBriefing({ sentences: [orphan] });
    const row = sentenceRows()[0];
    expect(within(row).queryByRole("link", { name: /^Candidate/ })).toBeNull();
    await vi.waitFor(() =>
      expect(within(row).getByRole("link", { name: "24 findings" })).toHaveAttribute("href", "/findings?rule=W-EST-01"),
    );
    expect(row).toHaveAttribute("data-row-href", "/findings?rule=W-EST-01");
    expect(orphan.finding_ids[0]).toBe(coverage.finding_ids[0]);
  });

  it("never names the model, even when one wrote it (go-live, SQA)", () => {
    renderBriefing({ model: "claude-sonnet-4-5" });
    expect(screen.queryByText("AI wrote the sentences")).toBeNull();
    expect(document.body).not.toHaveTextContent("claude-sonnet-4-5");
  });

  it("prints with the browser's own dialog", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderWithQuery(<PrintButton />);
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});
