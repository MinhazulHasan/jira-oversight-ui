import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerProse, PersonMention } from "@/components/ask/answer-prose";
import { AskScorecards } from "@/components/ask/ask-scorecards";
import { AskPeopleProvider, peopleIndex, PersonCell } from "@/components/ask/people-in-facts";
import { QuestionBox } from "@/components/ask/question-box";
import { FINDING_COLUMNS } from "@/components/findings/columns";
import { FindingEvidence } from "@/components/findings/finding-evidence";
import { FilterBar } from "@/components/findings/filter-bar";
import { DEMO_1 } from "@/components/issue/__tests__/fixtures";
import { IssueHeader } from "@/components/issue/issue-header";
import { PersonFindings } from "@/components/overview/person-findings";
import { peopleFixture } from "@/components/overview/__tests__/fixture";
import { Comparison } from "@/components/people/comparison";
import { Scorecard } from "@/components/people/scorecard";
import { AccessLogView } from "@/components/governance/access-log-view";
import { PeopleLevelProvider } from "@/components/shell/people-level";
import { renderKit } from "@/components/ui/__tests__/kit";
import { DataTable } from "@/components/ui/data-table";
import { accessLogSchema, askResponseSchema, findingsPageSchema, peopleScorecardSchema, type DirectoryEntry, type Person } from "@/lib/api/schemas";

import accessLogJson from "../../../../docs/sample-responses/access-log.json";
import comparisonJson from "../../../../docs/sample-responses/ask-comparison.json";
import healthSample from "../../../../docs/sample-responses/health.json";
import cardSample from "../../../../docs/sample-responses/person-card.json";
import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import everyoneJson from "../../../../docs/sample-responses/people-scorecard.json";
import findingsJson from "../../../../docs/sample-responses/findings.json";
import { closePersonCards, HOVER_INTENT_MS } from "../person-card-trigger";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ADA: Person = cardSample.person;
const findings = findingsPageSchema.parse(findingsJson);
const everyone = peopleScorecardSchema.parse(everyoneJson);

function server() {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (/\/people\/p[0-9a-f]{12}\/card$/.test(url.pathname)) return Response.json({ ...cardSample, person: { ...cardSample.person, id: url.pathname.split("/")[4] } });
    if (url.pathname.endsWith("/projects")) return Response.json({ default: "DEMO", projects: [{ key: "DEMO", name: "Demo project", issues: 1150, last_synced_at: "2026-11-04T14:28:00.000Z" }] });
    if (url.pathname.endsWith("/health")) return Response.json(healthSample);
    if (url.pathname.endsWith("/people/directory")) return Response.json(directoryJson);
    if (url.pathname.endsWith("/access-log")) return Response.json(accessLogJson);
    return Response.json({ error: "not_found", message: "no" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(ui: ReactNode, peopleLevel: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams="">
        <PeopleLevelProvider peopleLevel={peopleLevel}>{ui}</PeopleLevelProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

/** A name that opens a card: a button that says it opens a dialog, named by the person. */
const trigger = (scope: HTMLElement, name: string | RegExp) =>
  within(scope).queryAllByRole("button", { name }).find((button) => button.getAttribute("aria-haspopup") === "dialog");

beforeEach(() => {
  closePersonCards();
  server();
});

afterEach(() => {
  closePersonCards();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Ask", () => {
  it("an answer's pill opens the person's card at people level; anywhere else it is the link to their findings, as before", async () => {
    const { container, unmount } = renderAt(<PersonMention person={ADA} />, true);
    const pill = container.querySelector(`[data-person-mention="${ADA.id}"]`) as HTMLElement;
    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveTextContent("Ada Brooks");
    fireEvent.click(pill);
    expect(await screen.findByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    unmount();
    const team = renderAt(<PersonMention person={ADA} />, false);
    const link = team.container.querySelector(`[data-person-mention="${ADA.id}"]`) as HTMLElement;
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", `/findings?state=open&person=${ADA.id}`);
  });

  it("marks people in an answer's prose as pills that open cards, the figures still bound", () => {
    const { container } = renderAt(<AnswerProse segments={[{ kind: "text", text: "Ada Brooks has the most open breaches." }]} describe={() => ""} people={[ADA]} />, true);
    expect(trigger(container, "Ada Brooks")).toHaveAttribute("data-person-mention", ADA.id);
  });

  it("a facts table's person opens their card with a pointer, keeping the row's press and its one tab stop", () => {
    const rowPress = vi.fn();
    const { container } = renderAt(
      <AskPeopleProvider resolve={(id) => (id === ADA.id ? ADA : null)}>
        <table>
          <tbody>
            <tr onClick={rowPress}>
              <td>
                <PersonCell id={ADA.id} name="Ada Brooks" />
              </td>
            </tr>
          </tbody>
        </table>
      </AskPeopleProvider>,
      true,
    );
    const name = trigger(container, "Ada Brooks")!;
    expect(name).toHaveAttribute("tabindex", "-1");
    fireEvent.click(name);
    expect(rowPress).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
  });

  /** The question box holding "Is @Ada Brooks doing well?", Ada as a chip, and what it would send. */
  function ChipBox({ onSubmit = () => {} }: { onSubmit?: (question: string, mentions: string[]) => void }) {
    const entries = directoryJson.people as DirectoryEntry[];
    const [value, setValue] = useState(`Is @${ADA.name} doing well?`);
    return (
      <>
        <QuestionBox
          value={value}
          onChange={setValue}
          onSubmit={onSubmit}
          busy={false}
          placeholder="Ask"
          mention={{ people: entries, state: "success", retry: () => {}, ids: [ADA.id] }}
        />
        <output data-testid="value">{value}</output>
      </>
    );
  }
  const field = () => screen.getByRole("textbox", { name: "Your question" });
  const chipIn = (container: HTMLElement) => container.querySelector(`[data-chip][data-mentioned="${ADA.id}"]`) as HTMLElement;
  /** A press on the chip as a mouse makes it: the editor keeps it from moving the caret; the chip's click opens the card. */
  const pressChip = (chip: HTMLElement) => {
    fireEvent.pointerDown(chip, { pointerType: "mouse", button: 0 });
    const kept = fireEvent.mouseDown(chip, { button: 0 });
    fireEvent.pointerUp(chip, { pointerType: "mouse", button: 0 });
    fireEvent.mouseUp(chip, { button: 0 });
    fireEvent.click(chip, { button: 0 });
    return kept;
  };
  /** Where the caret is, as the question's text before it (each chip as "@Name", no caret holders). */
  const textBeforeCaret = () => {
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStart(field(), 0);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    const holder = document.createElement("div");
    holder.append(range.cloneContents());
    holder.querySelectorAll("[data-chip]").forEach((chip) => chip.replaceWith(`@${chip.textContent}`));
    return (holder.textContent ?? "").replaceAll("​", "");
  };

  it("a chip in the question box opens the card on hover, and the question keeps its focus", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = renderAt(<ChipBox />, true);
    const chip = chipIn(container);
    expect(chip).not.toHaveAttribute("title");
    expect(chip).toHaveAttribute("contenteditable", "false");
    act(() => field().focus());
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS);
    });
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(chip).toHaveAttribute("data-card-open");
    // A hover card takes no focus from the question.
    expect(field()).toHaveFocus();
  });

  it("a press on a chip opens and pins its card, the question untouched; Escape gives focus back with the caret just after the chip", async () => {
    const onSubmit = vi.fn();
    const { container } = renderAt(<ChipBox onSubmit={onSubmit} />, true);
    const chip = chipIn(container);
    /** The question as drawn: each run's text and each chip's person, in order. */
    const shape = () => [...field().children].map((node) => node.getAttribute("data-mentioned") ?? node.textContent);
    const before = shape();
    // The press never reaches the caret: the editor refuses the browser's own handling of it.
    expect(pressChip(chip)).toBe(false);
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    expect(card.closest("[data-person-card-mode]")).toHaveAttribute("data-person-card-mode", "pinned");
    // Nothing in the question changed: not its text, not its chips, nothing selected in it.
    expect(screen.getByTestId("value")).toHaveTextContent(`Is @${ADA.name} doing well?`);
    expect(shape()).toEqual(before);
    expect(chip).not.toHaveAttribute("data-selected");
    expect(onSubmit).not.toHaveBeenCalled();

    // Escape closes it, and the question has focus again with the caret just after the chip.
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(field()).toHaveFocus());
    expect(textBeforeCaret()).toBe(`Is @${ADA.name}`);
    // What is typed goes in there; Enter still asks, the chip's person with the question.
    act(() => {
      field().dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: ", today,", bubbles: true, cancelable: true }));
    });
    expect(screen.getByTestId("value")).toHaveTextContent(`Is @${ADA.name}, today, doing well?`);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(`Is @${ADA.name}, today, doing well?`, [ADA.id]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a press on the chip again closes its card the same way; a press in the text closes it and the caret goes where pressed", async () => {
    const user = userEvent.setup();
    const { container } = renderAt(<ChipBox />, true);
    const chip = chipIn(container);
    pressChip(chip);
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    pressChip(chip);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(field()).toHaveFocus());
    expect(textBeforeCaret()).toBe(`Is @${ADA.name}`);

    pressChip(chip);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toHaveFocus());
    const words = [...field().querySelectorAll("[data-run]")].find((run) => run.textContent?.includes("doing well?")) as HTMLElement;
    await user.click(words);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(field()).toHaveFocus();
    expect(screen.getByTestId("value")).toHaveTextContent(`Is @${ADA.name} doing well?`);
  });

  it("what is typed never opens a card, and keys pressed in the box are the box's", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const onSubmit = vi.fn();
    const { container } = renderAt(<ChipBox onSubmit={onSubmit} />, true);
    const chip = chipIn(container);
    act(() => field().focus());
    // The pointer comes to rest on the chip, then a key: the card about to open does not.
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS - 100);
    });
    fireEvent.keyDown(field(), { key: "a" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS * 2);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // A chip drawn under a resting pointer as someone types (its arrival right after a key) opens nothing either...
    fireEvent.pointerLeave(chip, { pointerType: "mouse" });
    fireEvent.keyDown(field(), { key: "b" });
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS * 2);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // ...until the pointer moves on it: then it is a hover like any other.
    fireEvent.pointerMove(chip, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS);
    });
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    // Enter in the box still asks, with the hover card open.
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(`Is @${ADA.name} doing well?`, [ADA.id]);
  });

  it("at team level a chip opens nothing, and a press puts the caret beside it as before", () => {
    const { container } = renderAt(<ChipBox />, false);
    const chip = chipIn(container);
    expect(chip).not.toHaveClass("cursor-pointer");
    act(() => field().focus());
    pressChip(chip);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a card's Ask about puts the person in the question as a chip, the caret after it, nothing asked", async () => {
    const entries = directoryJson.people as DirectoryEntry[];
    const onSubmit = vi.fn();
    const onSeeded = vi.fn();
    function Box({ seed }: { seed: string }) {
      const [value, setValue] = useState("");
      const [request] = useState(() => ({ id: seed }));
      return (
        <>
          <QuestionBox value={value} onChange={setValue} onSubmit={onSubmit} busy={false} placeholder="Ask" mention={{ people: entries, state: "success", retry: () => {}, ids: [] }} seed={request} onSeeded={onSeeded} />
          <output data-testid="value">{value}</output>
        </>
      );
    }
    const noor = entries.find((entry) => entry.person.name === "Noor Haddad")!.person;
    renderAt(<Box seed={noor.id} />, true);
    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(`@${noor.name}`));
    const field = screen.getByRole("textbox", { name: "Your question" });
    expect(field.querySelector(`[data-chip][data-mentioned="${noor.id}"]`)).not.toBeNull();
    expect(field).toHaveFocus();
    expect(onSeeded).toHaveBeenCalledWith(noor, "added");
    expect(onSubmit).not.toHaveBeenCalled();

    // Someone not on the board: no chip, and the page is told so.
    onSeeded.mockClear();
    renderAt(<Box seed="p000000000000" />, true);
    await waitFor(() => expect(onSeeded).toHaveBeenCalledWith(null, "not-on-board"));
  });

  it("Ask about someone the question already names adds no second chip: the caret goes just after theirs; each press is done", async () => {
    const entries = directoryJson.people as DirectoryEntry[];
    const onSeeded = vi.fn();
    const carmen = entries.find((entry) => entry.person.name === "Carmen Ruiz")!.person;
    let press: (id: string) => void = () => {};
    function Box() {
      const [value, setValue] = useState(`Compare @${ADA.name} and @${carmen.name} on estimates`);
      const [seed, setSeed] = useState<{ id: string } | null>(null);
      press = (id) => setSeed({ id });
      return (
        <>
          <QuestionBox
            value={value}
            onChange={setValue}
            onSubmit={() => {}}
            busy={false}
            placeholder="Ask"
            mention={{ people: entries, state: "success", retry: () => {}, ids: [ADA.id, carmen.id] }}
            seed={seed}
            onSeeded={onSeeded}
          />
          <output data-testid="value">{value}</output>
        </>
      );
    }
    renderAt(<Box />, true);
    const question = `Compare @${ADA.name} and @${carmen.name} on estimates`;
    await waitFor(() => expect(chipIn(document.body)).not.toBeNull());
    act(() => press(ADA.id));
    await waitFor(() => expect(onSeeded).toHaveBeenCalledWith(expect.objectContaining({ id: ADA.id }), "already"));
    expect(screen.getByTestId("value").textContent).toBe(question);
    expect([...field().querySelectorAll("[data-chip]")].map((chip) => chip.getAttribute("data-mentioned"))).toEqual([ADA.id, carmen.id]);
    expect(field()).toHaveFocus();
    expect(textBeforeCaret()).toBe(`Compare @${ADA.name}`);

    // A second press for the same person is a request of its own, done too (never ignored as one already seen).
    onSeeded.mockClear();
    act(() => press(carmen.id));
    await waitFor(() => expect(onSeeded).toHaveBeenCalledWith(carmen, "already"));
    expect(textBeforeCaret()).toBe(`Compare @${ADA.name} and @${carmen.name}`);
    onSeeded.mockClear();
    act(() => press(carmen.id));
    await waitFor(() => expect(onSeeded).toHaveBeenCalledWith(carmen, "already"));
    expect(screen.getByTestId("value").textContent).toBe(question);
  });

  it("keys pressed in a pinned chip's card never change the question, though Safari sends them to the caret the press left in the box", async () => {
    const onSubmit = vi.fn();
    const { container } = renderAt(<ChipBox onSubmit={onSubmit} />, true);
    const chip = chipIn(container);
    /** A caret at the end of the question, where a reader leaves it before pressing the chip. */
    const caretAtEnd = () =>
      act(() => {
        const range = document.createRange();
        range.selectNodeContents(field());
        range.collapse(false);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(range);
      });
    act(() => field().focus());
    caretAtEnd();
    expect(pressChip(chip)).toBe(false);
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    // The caret the press left in the box is let go as the card takes focus: nothing is left for a key to type at.
    const selection = document.getSelection()!;
    expect(selection.rangeCount === 0 || !field().contains(selection.anchorNode)).toBe(true);

    // And were an edit still sent to the box (Safari's, at a caret put back there), the box refuses it: focus is not its.
    caretAtEnd();
    for (const [inputType, data] of [
      ["insertText", "x"],
      ["insertText", " "],
      ["deleteContentBackward", null],
      ["deleteWordBackward", null],
      ["insertParagraph", null],
      ["insertLineBreak", null],
    ] as const) {
      act(() => {
        field().dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
      });
    }
    expect(screen.getByTestId("value").textContent).toBe(`Is @${ADA.name} doing well?`);
    expect(field().querySelectorAll("[data-chip]")).toHaveLength(1);
    expect(card).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
    // Backspace in the card is kept from the browser: WebKit would otherwise leave the page for the one before it.
    expect(fireEvent.keyDown(card, { key: "Backspace" })).toBe(false);

    // Escape: focus back in the box, the caret just after the chip, and typing works there again.
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => expect(field()).toHaveFocus());
    expect(textBeforeCaret()).toBe(`Is @${ADA.name}`);
    act(() => {
      field().dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: ", today,", bubbles: true, cancelable: true }));
    });
    expect(screen.getByTestId("value").textContent).toBe(`Is @${ADA.name}, today, doing well?`);
  });
});

describe("Ask's everyone in order", () => {
  it("each person's name opens their card over the comparison's period, in the Tab order (the table has no row press)", async () => {
    const comparison = askResponseSchema.parse(comparisonJson);
    const known = peopleIndex(comparison, directoryJson.people as DirectoryEntry[]);
    renderAt(
      <AskPeopleProvider resolve={(id) => known.get(id) ?? null}>
        <AskScorecards facts={comparison.facts} />
      </AskPeopleProvider>,
      true,
    );
    const table = screen.getByRole("table", { name: /everyone, by the measures on which each is closer/ });
    const first = comparison.people[0];
    const name = trigger(table, first.name)!;
    expect(name).not.toHaveAttribute("tabindex");
    fireEvent.click(name);
    expect(screen.getByRole("dialog", { name: first.name })).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes(`/people/${first.id}/card`))).toBe(true));
  });
});

describe("the ticket page's assignee", () => {
  it("opens the person's card on hover at people level, the press still the link's to their open findings; team level keeps its tooltip", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const person = DEMO_1.issue.assignee!;
    const { unmount } = renderAt(<IssueHeader issueKey="DEMO-1" state="ready" data={DEMO_1} />, true);
    const link = screen.getByRole("link", { name: `${person.name}: show their open findings` });
    expect(link).toHaveAttribute("href", `/findings?person=${person.id}`);
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS);
    });
    expect(screen.getByRole("dialog", { name: person.name })).toBeInTheDocument();
    unmount();
    closePersonCards();
    renderAt(<IssueHeader issueKey="DEMO-1" state="ready" data={DEMO_1} />, false);
    const plain = screen.getByRole("link", { name: `${person.name}: show their open findings` });
    fireEvent.pointerEnter(plain, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS * 2);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Findings", () => {
  it("the Assignee column's name opens the card with a pointer; the row still opens the drawer; team level as before", () => {
    const onRowOpen = vi.fn();
    const table = (peopleLevel: boolean) =>
      renderAt(<DataTable data={findings.items} columns={FINDING_COLUMNS} getRowId={(row) => row.finding_id} caption="Findings" onRowOpen={onRowOpen} />, peopleLevel);
    const { container, unmount } = table(true);
    const assignee = findings.items.find((item) => item.assignee !== null)!.assignee!;
    const name = trigger(container, assignee.name)!;
    expect(name).toHaveAttribute("tabindex", "-1");
    fireEvent.click(name);
    expect(onRowOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: assignee.name })).toBeInTheDocument();
    unmount();
    closePersonCards();
    const team = table(false);
    expect(team.container.querySelector("[data-person-card-trigger]")).toBeNull();
  });

  it("the Person filter's chosen person opens their card on hover; a press opens the filter's own list", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const someone = findings.facets.people.find((entry) => entry.value !== "unassigned")!;
    const filters = { q: "", severity: null, state: "open", rule: [], epic: [], person: [someone.value], first_seen: "all", sort: "first_seen_at", order: "desc", page: 1 } as const;
    renderAt(<FilterBar filters={{ ...filters, person: [someone.value], rule: [], epic: [] }} setFilters={vi.fn()} facets={findings.facets} />, true);
    const chosen = document.querySelector("[data-person-filter-name]") as HTMLElement;
    expect(chosen).toHaveTextContent(someone.label);
    fireEvent.pointerEnter(chosen, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS);
    });
    expect(screen.getByRole("dialog", { name: someone.label })).toBeInTheDocument();
  });
});

describe("the drawer's assignee", () => {
  it("opens the card from the keyboard as well as the pointer: a name on its own, in the Tab order", () => {
    const finding = findings.items.find((item) => item.assignee !== null)!;
    const detail = { data: undefined, isPending: true, isError: false, error: null, refetch: () => {} } as unknown as Parameters<typeof FindingEvidence>[0]["detail"];
    renderAt(<FindingEvidence finding={finding} detail={detail} onOpenFinding={() => {}} />, true);
    const name = screen.getByRole("button", { name: finding.assignee!.name });
    expect(name).toHaveAttribute("aria-haspopup", "dialog");
    expect(name).not.toHaveAttribute("tabindex");
    fireEvent.click(name);
    expect(screen.getByRole("dialog", { name: finding.assignee!.name })).toBeInTheDocument();
  });
});

describe("the access log's people", () => {
  it("open their card on hover, read on the entry's board; a press still shows only the reads of their figures", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log = accessLogSchema.parse(accessLogJson);
    let address = new URLSearchParams();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderKit(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter searchParams="" onUrlUpdate={(event) => (address = new URLSearchParams(event.searchParams))} hasMemory>
          <PeopleLevelProvider peopleLevel>
            <AccessLogView />
          </PeopleLevelProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(50));
    const table = screen.getByRole("table", { name: "Access log" });
    const entry = log.entries.findIndex((item) => item.subjects.some((person) => person.name === "Ada Brooks"));
    const pill = within(within(table).getAllByRole("row")[entry + 1]).getByRole("button", { name: "Ada Brooks" });
    // The pill says what a press does, to a screen reader; no tooltip stands over the card.
    expect(pill).toHaveAccessibleDescription("Show only reads of Ada Brooks's figures");
    fireEvent.pointerEnter(pill, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(HOVER_INTENT_MS);
    });
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10));
    const reads = vi.mocked(fetch).mock.calls.map(([input]) => String(input)).filter((url) => url.includes("/card"));
    expect(reads).toEqual([`/api/oversight/people/${ADA.id}/card?board=${log.entries[entry].project}`]);
    fireEvent.pointerDown(pill, { pointerType: "mouse", button: 0 });
    fireEvent.click(pill);
    // The address is written a moment later (it is throttled), as every filter's is.
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(address.get("person")).toBe(ADA.id);
  });

  /** The access log, the row of the first entry that read Ada's figures, and that entry's board. */
  async function accessLog() {
    const log = accessLogSchema.parse(accessLogJson);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderKit(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter searchParams="">
          <PeopleLevelProvider peopleLevel>
            <AccessLogView />
          </PeopleLevelProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    );
    const table = await screen.findByRole("table", { name: "Access log" });
    const entry = log.entries.findIndex((item) => item.subjects.some((person) => person.name === "Ada Brooks"));
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(entry + 1));
    return { row: within(table).getAllByRole("row")[entry + 1], board: log.entries[entry].project };
  }

  it("open their card from the keyboard too: the picture is the card's own button, read on the entry's board", async () => {
    const { row, board } = await accessLog();
    const opener = within(row).getByRole("button", { name: "Ada Brooks's card" });
    expect(opener).toHaveAttribute("aria-haspopup", "dialog");
    // The name beside it is still the filter.
    expect(within(row).getByRole("button", { name: "Ada Brooks" })).toHaveAccessibleDescription("Show only reads of Ada Brooks's figures");
    const user = userEvent.setup();
    act(() => opener.focus());
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    const reads = vi.mocked(fetch).mock.calls.map(([input]) => String(input)).filter((url) => url.includes("/card"));
    expect(reads).toEqual([`/api/oversight/people/${ADA.id}/card?board=${board}`]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("open their card on a touch screen too: a tap on the picture opens the bottom sheet; a tap on the name still filters", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const { row } = await accessLog();
    const user = userEvent.setup();
    await user.click(within(row).getByRole("button", { name: "Ada Brooks's card" }));
    const sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    expect(sheet).toHaveClass("jo-sheet-bottom");
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(row).getByRole("button", { name: "Ada Brooks's card" })).toHaveFocus();
    await user.click(within(row).getByRole("button", { name: "Ada Brooks" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the Overview's open findings by person", () => {
  it("a person's name opens their card; the rest of the row still leads to their open findings", () => {
    const { container } = renderAt(<PersonFindings data={peopleFixture()} />, true);
    const list = within(container).getByRole("list", { name: "Open findings by person" });
    const first = peopleFixture().people[0];
    const name = trigger(list, first.person!.name)!;
    expect(name.closest("li")!.querySelector("a")).toHaveAttribute("href", `/findings?state=open&person=${first.person!.id}`);
    expect(within(list).getAllByRole("link")[0]).toHaveAccessibleName(new RegExp(`^${first.person!.name}: .*open findings$`));
    fireEvent.click(name);
    expect(screen.getByRole("dialog", { name: first.person!.name })).toBeInTheDocument();
    // The unassigned tickets are no one's: no card.
    expect(trigger(list, "Unassigned")).toBeUndefined();
  });

  it("at team level is exactly as before: each row one link, no card", () => {
    const { container } = renderAt(<PersonFindings data={peopleFixture()} />, false);
    expect(container.querySelector("[data-person-card-trigger]")).toBeNull();
    expect(within(container).getAllByRole("link").length).toBeGreaterThan(8);
  });

  it("the Table view's names open the card too, each a stop of its own; the unassigned row's, and at team level every one, stay plain", async () => {
    const user = userEvent.setup();
    const shown = peopleFixture().people.slice(0, 8);
    const { container, unmount } = renderAt(<PersonFindings data={peopleFixture()} />, true);
    await user.click(within(container).getByRole("radio", { name: "Table" }));
    const table = within(container).getByRole("table");
    const named = shown.filter((row) => row.person !== null);
    expect(table.querySelectorAll("[data-person-card-trigger]")).toHaveLength(named.length);
    const first = named[0].person!;
    const name = trigger(table, first.name)!;
    expect(name).not.toHaveAttribute("tabindex", "-1");
    expect(name.querySelector("[data-avatar]")).not.toBeNull();
    fireEvent.click(name);
    expect(screen.getByRole("dialog", { name: first.name })).toBeInTheDocument();
    expect(trigger(table, "Unassigned")).toBeUndefined();
    closePersonCards();
    unmount();

    const team = renderAt(<PersonFindings data={peopleFixture()} />, false);
    await user.click(within(team.container).getByRole("radio", { name: "Table" }));
    expect(within(team.container).getByRole("table").querySelector("[data-person-card-trigger]")).toBeNull();
    expect(within(team.container).getByRole("table")).toHaveTextContent(first.name);
  });
});

describe("the People page", () => {
  it("the table's names open cards over the page's period, the row still choosing the scorecard", () => {
    const onSelect = vi.fn();
    const { container } = renderAt(<Comparison data={everyone} selectedId={null} onSelect={onSelect} sort="name" order="asc" onSort={() => {}} />, true);
    const table = container.querySelector('[data-comparison="table"]') as HTMLElement;
    const first = everyone.people[0];
    const name = trigger(table, new RegExp(first.person.name))!;
    expect(name).toHaveAttribute("tabindex", "-1");
    fireEvent.click(name);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: first.person.name })).toBeInTheDocument();
  });

  it("the scorecard's heading is the person's name, which opens their card with the keyboard too", () => {
    const row = everyone.people[0];
    renderAt(<Scorecard person={row.person} tickets={row.tickets} values={row.values} board={everyone.board} measures={everyone.measures} days={30} />, true);
    const heading = screen.getByRole("heading", { level: 2, name: row.person.name });
    const name = within(heading).getByRole("button", { name: row.person.name });
    expect(name).not.toHaveAttribute("tabindex");
    name.focus();
    fireEvent.click(name);
    expect(screen.getByRole("dialog", { name: row.person.name })).toBeInTheDocument();
  });
});
