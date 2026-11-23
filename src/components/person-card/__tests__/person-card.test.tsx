import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boardNavigation } from "@/components/shell/board-switcher";
import { PeopleLevelProvider } from "@/components/shell/people-level";
import { renderKit } from "@/components/ui/__tests__/kit";
import { PersonName } from "@/components/ui/person-name";
import type { Person, PersonCard, Projects } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";

import healthSample from "../../../../docs/sample-responses/health.json";
import cardSample from "../../../../docs/sample-responses/person-card.json";
import memberSample from "../../../../docs/sample-responses/person-card-member.json";
import {
  closePersonCards,
  DESKTOP_QUERY,
  GRACE_REST_MS,
  HOVER_CLOSE_MS,
  HOVER_INTENT_MS,
  NAME_TRIGGER,
  PersonCardChip,
  PersonCardHover,
  PersonCardTrigger,
} from "../person-card-trigger";

/*
 * The person card (JO-13): what it says in every state, and how it opens.
 * Resting on a name for 350 ms opens it (and only then is it read); it stays
 * while the pointer is on the name or the card and closes 150 ms after both;
 * a press pins it with focus inside, Escape closes it and gives focus back;
 * one card at a time; a touch screen or a phone gets a bottom sheet; and a
 * reader at team level gets the name exactly as before, with no card.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ADA: Person = cardSample.person;
const NOOR: Person = memberSample.person;
const ONE_BOARD: Projects = {
  default: "DEMO",
  projects: [{ key: "DEMO", name: "Demo project", issues: 1150, last_synced_at: "2026-11-04T14:28:00.000Z", synced: true, type: "software" }],
};
const THREE_BOARDS: Projects = {
  default: "DEMO",
  projects: [
    ...ONE_BOARD.projects,
    { key: "OPS", name: "Operations", issues: 40, last_synced_at: "2026-11-04T14:28:00.000Z", synced: true, type: "software" },
    { key: "WEB", name: "Web platform", issues: 0, last_synced_at: null, synced: false, type: "software" },
  ],
};

interface Server {
  cards?: Record<string, unknown | (() => Response)>;
  projects?: Projects;
}

/** The dashboard's route, as the card reads it: the card by person, the board list, and the health the shell polls. */
function server({ cards = { [ADA.id]: cardSample, [NOOR.id]: memberSample }, projects = ONE_BOARD }: Server = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    const card = /^\/api\/oversight\/people\/(p[0-9a-f]{12})\/card$/.exec(url.pathname);
    if (card) {
      const answer = cards[card[1]];
      if (typeof answer === "function") return (answer as () => Response)();
      if (answer === undefined) return Response.json({ error: "not_found", message: "This person is not on this board." }, { status: 404 });
      return Response.json(answer);
    }
    if (url.pathname === "/api/oversight/projects") return Response.json(projects);
    if (url.pathname === "/api/oversight/health") return Response.json(healthSample);
    return Response.json({ error: "not_found", message: "no" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const cardCalls = (fetchMock: ReturnType<typeof server>) => fetchMock.mock.calls.filter(([input]) => String(input).includes("/card"));

function renderCards(ui: ReactNode, { peopleLevel = true }: { peopleLevel?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return renderKit(
    <QueryClientProvider client={client}>
      <PeopleLevelProvider peopleLevel={peopleLevel}>{ui}</PeopleLevelProvider>
    </QueryClientProvider>,
  );
}

function Name({ person = ADA, ...rest }: { person?: Person } & Partial<Parameters<typeof PersonCardTrigger>[0]>) {
  return (
    <PersonCardTrigger person={person} className={NAME_TRIGGER} {...rest}>
      <PersonName person={person} />
    </PersonCardTrigger>
  );
}

/** The pointer on and off an element, as a mouse moves it (React reads enter and leave from over and out). */
const pointerOn = (element: Element) => fireEvent.pointerEnter(element, { pointerType: "mouse" });
const pointerOff = (element: Element) => fireEvent.pointerLeave(element, { pointerType: "mouse" });
/** Time passing, under fake timers, with what it sets off drawn. */
const pass = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Press a name and wait for its card's figures. */
async function pin(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  const dialog = await screen.findByRole("dialog", { name });
  await waitFor(() => expect(dialog.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
  return dialog;
}

beforeEach(() => {
  closePersonCards();
});

afterEach(() => {
  closePersonCards();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the card's words, in every state", () => {
  it("measures a ticket's time in progress on the last activity's clock; a stale snapshot says its list is as of the sync", async () => {
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const now = Date.now();
    const ago = (span: number) => new Date(now - span).toISOString();
    /** A live card synced `synced` ago, its one ticket in progress since `since` ago: that move its last activity. */
    const live = (synced: number, since: number): PersonCard => {
      const body = structuredClone(cardSample) as PersonCard;
      return {
        ...body,
        meta: { ...body.meta, data_mode: "live", last_synced_at: ago(synced) },
        work: { ...body.work, in_progress: 1 },
        in_progress_now: [{ ...body.in_progress_now[0], since: ago(since) }],
        in_progress_more: 0,
        last_activity_at: ago(since),
      };
    };
    const section = (card: HTMLElement) => card.querySelector("[data-card-working]") as HTMLElement;

    // Synced under two hours ago: both readings to now, so the move five hours ago reads five hours in both places.
    server({ cards: { [ADA.id]: live(110 * MINUTE, 5 * HOUR + 10 * MINUTE) } });
    const fresh = renderCards(<Name />);
    let working = section(await pin("Ada Brooks"));
    expect(working).toHaveAttribute("data-card-working", "now");
    expect(within(working).getByRole("heading")).toHaveTextContent(/^Working on now$/);
    expect(within(working).getByRole("heading")).not.toHaveAttribute("title");
    expect(working.querySelector("[data-card-ticket]")).toHaveTextContent("for 5 hours");
    expect(working.querySelector("[data-card-activity]")).toHaveTextContent(/^Last activity 5 h ago/);
    fresh.unmount();
    closePersonCards();

    // Synced 26 hours ago (stale, as the top bar says): what is in progress is as of that sync, and the heading says so.
    server({ cards: { [ADA.id]: live(26 * HOUR, 31 * HOUR) } });
    renderCards(<Name />);
    working = section(await pin("Ada Brooks"));
    expect(working).toHaveAttribute("data-card-working", "as-of-sync");
    expect(working).toHaveAccessibleName("In progress at last sync");
    expect(within(working).getByRole("heading")).toHaveTextContent(/^In progress at last sync$/);
    expect(within(working).getByRole("heading")).toHaveAttribute("title", expect.stringMatching(/^As of the last sync, /));
    expect(working.querySelector("[data-card-ticket]")).toHaveTextContent("for 5 hours");
    expect(working.querySelector("[data-card-activity]")).toHaveTextContent(/^Last activity 1 d ago/);
  });

  it("someone who holds tickets: their counts, findings, process, what they work on, and the ways on", async () => {
    server();
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    const body = cardSample as PersonCard;

    // The picture's place: initials at 48 px (the size Jira's picture comes in) where there is no picture, and the
    // name, never cut short.
    const avatar = card.querySelector("[data-avatar]");
    expect(avatar).toHaveAttribute("data-size", "48");
    expect(avatar).toHaveAttribute("data-initials", "AB");
    expect(within(card).getByRole("heading", { name: "Ada Brooks" })).not.toHaveClass("truncate");
    expect(card.querySelector("[data-card-line]")).toHaveTextContent(`Holds ${body.work.open_tickets} open tickets on Demo project`);
    // The board by its name, as the top bar names it; its key in the tooltip.
    expect(card.querySelector("[data-card-line]")).toHaveAttribute("title", `Holds ${body.work.open_tickets} open tickets on Demo project (DEMO)`);
    // The header band and the action bar are plain blocks: no second banner or content-information landmark on the page.
    expect(card.querySelector("header, footer")).toBeNull();

    const tiles = card.querySelector("[data-card-tiles]") as HTMLElement;
    expect(within(tiles).getByText("Open tickets")).toHaveClass("sr-only");
    expect(tiles.querySelector('[data-tile="open"] dd')).toHaveTextContent(String(body.work.open_tickets));
    expect(tiles.querySelector('[data-tile="progress"] dd')).toHaveTextContent(String(body.work.in_progress));
    expect(tiles.querySelector('[data-tile="done"] dd')).toHaveTextContent(String(body.work.done_in_period));
    // Said whole on screen, and in full to a screen reader.
    expect(within(tiles).getByText("Done in 90 days")).toHaveAttribute("aria-hidden");
    expect(within(tiles).getByText("Done in the last 90 days")).toHaveClass("sr-only");

    // What the findings cover is said where everyone sees it: on every ticket they hold, done ones too.
    const findings = card.querySelector("[data-card-findings-section]") as HTMLElement;
    expect(within(findings).getByRole("heading", { name: "Open findings on all their tickets" })).toBeVisible();
    expect(card.querySelector("[data-card-findings]")).toHaveTextContent(`${body.findings.open_breaches} breaches${body.findings.open_warnings} warnings`);
    const process = body.process!;
    expect(card).toHaveTextContent(`Closer to the process than the board on ${process.closer} of ${process.closer + process.level + process.further} measures.`);
    expect(card.querySelectorAll("[data-card-meter] [data-part]")).toHaveLength(Object.values(process).filter((value, index) => index < 4 && value > 0).length);
    expect(card).toHaveTextContent(`${process.closer} closer, ${process.level} level, ${process.further} further and ${process.too_few} with too few tickets, of ${process.measurable} measures`);
    // Neutral inks for people: never the status colours.
    expect(card.querySelector("[data-card-meter]")?.innerHTML).not.toMatch(/breach|warn|ok|cite/);

    const tickets = card.querySelectorAll("[data-card-ticket]");
    expect([...tickets].map((row) => row.getAttribute("data-card-ticket"))).toEqual(body.in_progress_now.map((ticket) => ticket.key));
    const first = body.in_progress_now[0];
    expect(within(tickets[0] as HTMLElement).getByRole("link", { name: first.key })).toHaveAttribute("href", `/issues/${first.key}`);
    expect(tickets[0]).toHaveTextContent(first.summary);
    expect(tickets[0]).toHaveTextContent(first.status);
    expect(tickets[0]).toHaveTextContent(/for \d+ days/);
    const more = within(card).getByRole("link", { name: `and ${body.in_progress_more} more` });
    expect(more).toHaveAttribute("href", `/ask?${new URLSearchParams({ q: "What is @Ada Brooks working on?", m: ADA.id }).toString()}`);
    expect(card.querySelector("[data-card-activity]")).toHaveTextContent(/^Last activity/);

    // The other boards are named, never offered as a way in where the top bar cannot open them (its list here is DEMO's
    // alone): the sample's MOB, then its made-up boards.
    const boards = card.querySelector("[data-card-boards]") as HTMLElement;
    expect(boards).toHaveTextContent(/^Also on MOB \(1 open\).*OPS \(3 open\).*WEB \(1 open\)$/);
    expect(within(boards).queryByRole("link")).not.toBeInTheDocument();

    const actions = within(card).getByRole("navigation", { name: "Ways on from Ada Brooks's card" });
    expect(within(actions).getByRole("link", { name: "View scorecard" })).toHaveClass("whitespace-nowrap", "shrink-0");
    expect(within(actions).getByRole("link", { name: "Ask about Ada" })).not.toHaveClass("whitespace-nowrap");
    expect(within(actions).getByRole("link", { name: "Ask about Ada" })).not.toHaveClass("truncate");
    expect(within(actions).getByRole("link", { name: "View scorecard" })).toHaveAttribute("href", `/people?person=${ADA.id}`);
    expect(within(actions).getByRole("link", { name: "Open findings" })).toHaveAttribute("href", `/findings?person=${ADA.id}`);
    expect(within(actions).getByRole("link", { name: "Ask about Ada" })).toHaveAttribute("href", `/ask?about=${ADA.id}`);
    // Never an email address, an account id, a time zone or Jira's picture address.
    expect(card.innerHTML).not.toMatch(/@[a-z]+\.|acc-\d|accountId|timeZone|Europe\/|atl-paas|gravatar/i);
  });

  it("a member who holds none of the board's tickets: nothing to count, compare or list, and no findings to open", async () => {
    server();
    renderCards(<Name person={NOOR} />);
    const card = await pin("Noor Haddad");
    expect(card.querySelector("[data-card-line]")).toHaveTextContent("Member of Demo project · no tickets");
    expect([...card.querySelectorAll("[data-tile] dd")].map((cell) => cell.textContent)).toEqual(["0", "0", "0"]);
    // Noughts in the secondary ink, so the figures that are there stand out.
    expect(card.querySelector('[data-tile="open"] [data-figure]')).toHaveClass("text-ink-low");
    expect(card.querySelector("[data-card-findings]")).toHaveTextContent("No open findings");
    expect(card.querySelector('[data-card-process="none"]')).toHaveTextContent("Nothing to compare: no tickets on this board.");
    expect(card.querySelector("[data-card-meter]")).toBeNull();
    expect(card.querySelector("[data-card-working]")).toHaveTextContent("Nothing in progress on this board.");
    // Nothing to show is one muted line at the top of the section's room, never an empty framed box.
    for (const empty of card.querySelectorAll('[data-card-process="none"] p, [data-card-idle]')) {
      expect(empty).not.toHaveClass("border");
      expect(empty.className).not.toMatch(/border|rounded/);
    }
    // No tickets, so no activity to speak of: the line is not said twice.
    expect(card.querySelector("[data-card-activity]")).toBeNull();
    expect(card.querySelector("[data-card-boards]")).toHaveTextContent("Also on OPS (2 open)");
    const actions = within(card).getByRole("navigation");
    expect(within(actions).queryByRole("link", { name: "Open findings" })).not.toBeInTheDocument();
    expect(within(actions).getByText("Open findings").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
    expect(within(actions).getByRole("link", { name: "Ask about Noor" })).toHaveAttribute("href", `/ask?about=${NOOR.id}`);
  });

  it("someone with tickets but too few to compare on any measure: one muted line where the meter would be", async () => {
    server({ cards: { [ADA.id]: { ...cardSample, process: null } } });
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    expect(card.querySelector('[data-card-process="none"]')).toHaveTextContent("Too few tickets to compare with the board on any measure.");
  });

  it("a ticket whose start the service does not know (since null): listed, with no time, the rest of the card as ever", async () => {
    const tickets = cardSample.in_progress_now.map((ticket, index) => (index === 2 ? { ...ticket, since: null } : ticket));
    server({ cards: { [ADA.id]: { ...cardSample, in_progress_now: tickets } } });
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    const rows = card.querySelectorAll("[data-card-ticket]");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(/for \d+ days?/);
    expect(rows[2]).toHaveTextContent(tickets[2].summary);
    expect(rows[2]).not.toHaveTextContent(/for (\d+|less)/);
  });

  it("nothing in progress, no other boards on a dashboard of several: each said plainly", async () => {
    const idle = { ...cardSample, work: { ...cardSample.work, in_progress: 0 }, in_progress_now: [], in_progress_more: 0, other_boards: [] };
    server({ cards: { [ADA.id]: idle }, projects: THREE_BOARDS });
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    expect(card.querySelector("[data-card-working]")).toHaveTextContent("Nothing in progress now.");
    expect(card.querySelector("[data-card-working] li")).toBeNull();
    expect(within(card.querySelector("[data-card-more]") as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
    expect(card.querySelector("[data-card-activity]")).toHaveTextContent(/^Last activity/);
    expect(card.querySelector("[data-card-boards]")).toHaveTextContent("No open tickets on other boards.");
  });

  it("another board the top bar can open switches to it and opens their scorecard there; one it cannot is only named", async () => {
    const assign = vi.spyOn(boardNavigation, "assign").mockImplementation(() => {});
    server({ projects: THREE_BOARDS });
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    const boards = card.querySelector("[data-card-boards]") as HTMLElement;
    // WEB has never synced: the top bar cannot open it, so it is named only.
    expect(within(boards).getAllByRole("link").map((link) => link.textContent)).toEqual(["OPS"]);
    fireEvent.click(within(boards).getByRole("link", { name: "OPS" }));
    expect(assign).toHaveBeenCalledWith(`/people?person=${ADA.id}`);
    expect(document.cookie).toMatch(/jo-board=OPS/);
    document.cookie = "jo-board=; path=/; max-age=0";
  });

  it("a picture where the service holds one, at 48 px: the size Jira gives it, never stretched to another", async () => {
    const carmen = { id: "p599114b761a6", name: "Carmen Ruiz", avatar: "0123456789ab" };
    server({ cards: { [carmen.id]: { ...memberSample, person: carmen } } });
    renderCards(<Name person={carmen} />);
    const card = await pin("Carmen Ruiz");
    const image = card.querySelector("[data-avatar] img");
    expect(image).toHaveAttribute("src", `/api/oversight/people/${carmen.id}/avatar?v=${carmen.avatar}`);
    expect(image).toHaveAttribute("width", "48");
    expect(image).toHaveAttribute("height", "48");
  });

  it("a person not on the board, and a read the access log could not record: said in plain words, the second with Try again", async () => {
    server({ cards: {} });
    renderCards(<Name />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ada Brooks" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ada Brooks is not on this board.");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
    closePersonCards();

    let failing = true;
    const unavailable = () =>
      failing
        ? Response.json({ error: "access_log_unavailable", message: "The access log could not record this read, so the figures were not shown." }, { status: 503 })
        : Response.json(cardSample);
    server({ cards: { [ADA.id]: unavailable } });
    renderCards(<Name />);
    await user.click(screen.getAllByRole("button", { name: "Ada Brooks" }).at(-1)!);
    const refused = await screen.findByRole("alert");
    expect(refused).toHaveTextContent("Couldn't load Ada Brooks's card.");
    expect(refused).toHaveTextContent("The access log could not record this read");
    failing = false;
    await user.click(within(refused).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(document.querySelector("[data-card-state]")).toHaveAttribute("data-card-state", "ready"));
  });

  it("loading: the name, the picture and the ways on at once; the figures as placeholders in their places", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server({ cards: { [ADA.id]: () => Response.json(cardSample) } });
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes("/card")) await held;
      return original(input, init);
    });
    renderCards(<Name />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ada Brooks" }));
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    expect(card.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "loading");
    expect(within(card).getByRole("status")).toHaveTextContent("Loading Ada Brooks's card");
    expect(within(card).getByRole("link", { name: "View scorecard" })).toBeInTheDocument();
    expect(card.querySelectorAll(".skeleton").length).toBeGreaterThan(5);
    // The same sections in the same order as the card with its figures.
    const sections = () => [...card.querySelectorAll("[data-card-tiles], [data-card-findings], [data-card-process], [data-card-working], [data-card-boards]")].map((node) => node.tagName);
    const loading = sections();
    act(() => release());
    await waitFor(() => expect(card.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
    expect(sections()).toEqual(loading);
  });
});

describe("how a card opens and closes", () => {
  it("rests 350 ms before opening, reads the card only then, stays while the pointer is on it, and closes 150 ms after", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = server();
    renderCards(<Name />);
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    expect(name).toHaveAttribute("aria-haspopup", "dialog");
    expect(name).toHaveAttribute("aria-expanded", "false");

    pointerOn(name);
    pass(HOVER_INTENT_MS - 50);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // A pass of the pointer reads nothing: each read is one the service records.
    expect(cardCalls(fetchMock)).toHaveLength(0);
    pass(50);
    const card = screen.getByRole("dialog", { name: "Ada Brooks" });
    expect(name).toHaveAttribute("aria-expanded", "true");
    expect(cardCalls(fetchMock)).toHaveLength(1);
    // A hover card leaves focus where it was.
    expect(card).not.toHaveFocus();
    // The read comes back (a card closed while its read is in flight lets the read go).
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(card.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready");

    // From the name to the card: it stays.
    pointerOff(name);
    pass(HOVER_CLOSE_MS - 50);
    pointerOn(card);
    pass(HOVER_CLOSE_MS * 3);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    // Off both, and off the way between them: closed 150 ms later, not before.
    pointerOff(card);
    fireEvent.pointerMove(document.body, { pointerType: "mouse", clientX: 900, clientY: 700 });
    pass(HOVER_CLOSE_MS - 50);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    pass(50);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Back again within the minute: the card is shown from what was read, not read again.
    pointerOn(name);
    pass(HOVER_INTENT_MS);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(cardCalls(fetchMock)).toHaveLength(1);
    // A touch's pointer is not a hover: it opens nothing and closes nothing.
    fireEvent.pointerLeave(name, { pointerType: "touch" });
    pass(HOVER_CLOSE_MS * 2);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
  });

  it("a pointer that leaves before the intent opens nothing, and reads nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = server();
    renderCards(<Name />);
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    pointerOn(name);
    pass(200);
    pointerOff(name);
    pass(HOVER_INTENT_MS * 2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cardCalls(fetchMock)).toHaveLength(0);
  });

  it("a press pins it, focus inside; Escape closes it and gives focus back to the name", async () => {
    server();
    renderCards(<Name />);
    const user = userEvent.setup();
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    await user.click(name);
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    // Pinned, it does not close when the pointer leaves, and it has a close button.
    await user.unhover(name);
    await new Promise((resolve) => setTimeout(resolve, HOVER_CLOSE_MS * 2));
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Close" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(name).toHaveFocus());

    // Enter on the name pins it too; its close button gives focus back the same way.
    await user.keyboard("{Enter}");
    const again = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(again).toHaveFocus());
    await user.click(within(again).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(name).toHaveFocus());
    // And Space.
    await user.keyboard(" ");
    expect(await screen.findByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
  });

  it("a press outside closes a pinned card, and focus goes back to the name unless the press took it", async () => {
    server();
    renderCards(
      <>
        <Name />
        <p data-testid="page">Somewhere on the page</p>
        <input aria-label="A field" />
      </>,
    );
    const user = userEvent.setup();
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    await user.click(name);
    await screen.findByRole("dialog", { name: "Ada Brooks" });
    await user.click(screen.getByTestId("page"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(name).toHaveFocus());

    await user.click(name);
    await screen.findByRole("dialog", { name: "Ada Brooks" });
    await user.click(screen.getByRole("textbox", { name: "A field" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "A field" })).toHaveFocus();
  });

  it("one card at a time: a pinned card holds over other names; a press on another name moves the card to it", async () => {
    server();
    renderCards(
      <>
        <Name />
        <Name person={NOOR} />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ada Brooks" }));
    await screen.findByRole("dialog", { name: "Ada Brooks" });
    await user.hover(screen.getByRole("button", { name: "Noor Haddad" }));
    await new Promise((resolve) => setTimeout(resolve, HOVER_INTENT_MS + 100));
    expect(screen.getAllByRole("dialog").map((dialog) => dialog.getAttribute("aria-labelledby") && dialog.textContent?.slice(0, 20))).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Noor Haddad" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Noor Haddad" }));
    await screen.findByRole("dialog", { name: "Noor Haddad" });
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "Ada Brooks" })).not.toBeInTheDocument();
  });

  it("in a row with its own press and keys, the name keeps its press, Enter and Space to itself, out of the Tab order", async () => {
    server();
    const rowPress = vi.fn();
    const rowKey = vi.fn();
    renderCards(
      <table>
        <tbody>
          <tr onClick={rowPress} onKeyDown={rowKey} tabIndex={0}>
            <td>
              <Name inRow tabbable={false} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    expect(name).toHaveAttribute("tabindex", "-1");
    const user = userEvent.setup();
    await user.click(name);
    expect(await screen.findByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(rowPress).not.toHaveBeenCalled();
    closePersonCards();
    name.focus();
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.keyDown(name, { key: " " });
    expect(rowKey).not.toHaveBeenCalled();
    // Other keys still reach the row (its arrows move between rows).
    fireEvent.keyDown(name, { key: "ArrowDown" });
    expect(rowKey).toHaveBeenCalledTimes(1);
  });

  it("a press on the name of its pinned card closes it, and focus goes back to the name", async () => {
    server();
    renderCards(<Name />);
    const user = userEvent.setup();
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    await user.click(name);
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    await user.click(name);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(name).toHaveFocus());
  });

  it("what happens inside a card stays there: the row, the field or the tooltip its name sits in never hears it", async () => {
    server();
    const rowPress = vi.fn();
    const rowKey = vi.fn();
    const rowPointer = vi.fn();
    const rowFocus = vi.fn();
    renderCards(
      <table>
        <tbody>
          <tr onClick={rowPress} onKeyDown={rowKey} onPointerMove={rowPointer} onFocus={rowFocus} tabIndex={0}>
            <td>
              <Name inRow tabbable={false} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    const card = await pin("Ada Brooks");
    // What the press on the name itself did (the pointer coming onto it) is the row's to hear; from here on, the card's.
    for (const handler of [rowPress, rowKey, rowPointer, rowFocus]) handler.mockClear();
    const link = within(card).getByRole("link", { name: "View scorecard" });
    fireEvent.pointerMove(link, { pointerType: "mouse" });
    fireEvent.keyDown(link, { key: "Enter" });
    fireEvent.keyDown(card, { key: "j" });
    act(() => link.focus());
    fireEvent.click(card);
    expect([rowPress, rowKey, rowPointer, rowFocus].map((handler) => handler.mock.calls.length)).toEqual([0, 0, 0, 0]);
    // Escape still closes it: the layer's own listener is the browser's, not React's.
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("on hover alone, inside a control that presses for its own sake: the press stays the control's", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server();
    const filter = vi.fn();
    renderCards(
      <PersonCardHover person={ADA}>
        <button type="button" onClick={filter}>
          Ada Brooks
        </button>
      </PersonCardHover>,
    );
    const pill = screen.getByRole("button", { name: "Ada Brooks" });
    expect(pill).not.toHaveAttribute("aria-haspopup");
    pointerOn(pill);
    pass(HOVER_INTENT_MS);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    pass(10);
    fireEvent.pointerDown(pill, { pointerType: "mouse", button: 0 });
    fireEvent.mouseDown(pill);
    fireEvent.pointerUp(pill, { pointerType: "mouse", button: 0 });
    fireEvent.mouseUp(pill);
    fireEvent.click(pill);
    pass(HOVER_CLOSE_MS);
    expect(filter).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // A press while the card is still to come puts it aside too: nothing opens over what the press opened (a menu).
    pointerOff(pill);
    pointerOn(pill);
    pass(HOVER_INTENT_MS - 100);
    fireEvent.pointerDown(pill, { pointerType: "mouse", button: 0 });
    fireEvent.click(pill);
    pass(HOVER_INTENT_MS * 2);
    expect(filter).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("while what the control opens is open, resting on the name opens no card over it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = server();
    function Filter() {
      const [menuOpen, setMenuOpen] = useState(true);
      return (
        <>
          <PersonCardHover person={ADA} disabled={menuOpen}>
            <button type="button">Ada Brooks</button>
          </PersonCardHover>
          <button type="button" onClick={() => setMenuOpen(false)}>
            Close the menu
          </button>
        </>
      );
    }
    renderCards(<Filter />);
    const pill = screen.getByRole("button", { name: "Ada Brooks" });
    pointerOn(pill);
    pass(HOVER_INTENT_MS * 2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cardCalls(fetchMock)).toHaveLength(0);

    // The menu closed: the next time the pointer comes to rest on the name, the card opens.
    fireEvent.click(screen.getByRole("button", { name: "Close the menu" }));
    pointerOff(pill);
    pointerOn(pill);
    pass(HOVER_INTENT_MS);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
  });

  it("on a touch screen or a phone, a tap opens the same card as a bottom sheet, and a toast steps aside for it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === DESKTOP_QUERY ? false : false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const dismiss = vi.spyOn(notify, "dismiss");
    const fetchMock = server();
    renderCards(<Name />);
    const user = userEvent.setup();
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    // Nothing on hover where nothing hovers.
    await user.hover(name);
    await new Promise((resolve) => setTimeout(resolve, HOVER_INTENT_MS + 50));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cardCalls(fetchMock)).toHaveLength(0);
    await user.click(name);
    const sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    expect(sheet).toHaveClass("jo-sheet-bottom");
    // The sheet rises where a toast stands: the toast, said elsewhere too, steps aside rather than cover its ways on.
    expect(dismiss).toHaveBeenCalled();
    await waitFor(() => expect(sheet.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
    expect(within(sheet).getByRole("link", { name: "View scorecard" })).toBeInTheDocument();
    expect(sheet.querySelector("[data-avatar]")).toHaveAttribute("data-size", "48");
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("a mention chip's card (Ask's question box)", () => {
  /** A chip as the question box draws one: a span that is never focused itself. */
  const chip = (onReturnFocus: () => void) => (
    <PersonCardChip person={ADA} onReturnFocus={onReturnFocus}>
      <span data-testid="chip">Ada Brooks</span>
    </PersonCardChip>
  );

  it("a press opens and pins it; Escape, the close button or a press on the chip again gives focus back to the chip's field", async () => {
    server();
    const onReturnFocus = vi.fn();
    renderCards(chip(onReturnFocus));
    const user = userEvent.setup();
    fireEvent.click(screen.getByTestId("chip"));
    let card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    expect(screen.getByTestId("chip")).toHaveAttribute("data-card-open");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReturnFocus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("chip"));
    card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await user.click(within(card).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReturnFocus).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("chip"));
    await screen.findByRole("dialog", { name: "Ada Brooks" });
    fireEvent.pointerDown(screen.getByTestId("chip"), { pointerType: "mouse", button: 0 });
    fireEvent.click(screen.getByTestId("chip"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReturnFocus).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("chip")).not.toHaveAttribute("data-card-open");
  });

  it("a press with Shift is the field's selection, not the card's", () => {
    server();
    renderCards(chip(vi.fn()));
    fireEvent.click(screen.getByTestId("chip"), { shiftKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("left for one of its links, it gives focus to no one: the page is moving on", async () => {
    server();
    const onReturnFocus = vi.fn();
    renderCards(chip(onReturnFocus));
    fireEvent.click(screen.getByTestId("chip"));
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
    fireEvent.click(within(card).getByRole("link", { name: "Ask about Ada" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReturnFocus).not.toHaveBeenCalled();
  });

  it("on a touch screen or a phone, a tap opens the bottom sheet, and closing it gives focus back to the chip's field", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    server();
    const onReturnFocus = vi.fn();
    renderCards(chip(onReturnFocus));
    fireEvent.click(screen.getByTestId("chip"));
    const sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    expect(sheet).toHaveClass("jo-sheet-bottom");
    await userEvent.setup().click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
  });
});

describe("a bottom sheet opened from a row (a touch screen, a phone)", () => {
  it("keeps its presses to itself: the row under the name never hears them", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    server();
    const rowPress = vi.fn();
    const rowKey = vi.fn();
    renderCards(
      <table>
        <tbody>
          <tr onClick={rowPress} onKeyDown={rowKey}>
            <td>
              <Name inRow tabbable={false} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Ada Brooks" }));
    const sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(sheet.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
    fireEvent.click(sheet);
    fireEvent.click(within(sheet).getByRole("link", { name: "View scorecard" }));
    fireEvent.keyDown(sheet, { key: "Enter" });
    const overlay = document.querySelector(".bg-overlay");
    if (overlay) fireEvent.click(overlay);
    expect(rowPress).not.toHaveBeenCalled();
    expect(rowKey).not.toHaveBeenCalled();
  });
});

describe("a reader at team level (a user)", () => {
  it("gets the name exactly as before: no button, no card, nothing read", async () => {
    const fetchMock = server();
    const { container } = renderCards(<Name />, { peopleLevel: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("[data-person-card-trigger]")).toBeNull();
    expect(screen.getByText("Ada Brooks")).toBeInTheDocument();
    const hover = renderCards(
      <PersonCardHover person={ADA}>
        <span>Ada Brooks, hover only</span>
      </PersonCardHover>,
      { peopleLevel: false },
    );
    await userEvent.setup().hover(within(hover.container).getByText("Ada Brooks, hover only"));
    await new Promise((resolve) => setTimeout(resolve, HOVER_INTENT_MS + 50));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cardCalls(fetchMock)).toHaveLength(0);
  });
});

describe("a card read on another board than the top bar's (an access log entry's)", () => {
  const OPS_CARD = { ...cardSample, board: { key: "OPS", name: "Operations" }, other_boards: [{ key: "DEMO", name: "Demo project", open_tickets: 4 }] };
  const PICTURED: Person = { ...ADA, avatar: "0123456789ab" };

  beforeEach(() => {
    document.cookie = "jo-board=DEMO; path=/";
  });
  afterEach(() => {
    document.cookie = "jo-board=; path=/; max-age=0";
  });

  it("is about that board throughout: its picture, its figures, and every link, which picks the board before it opens", async () => {
    const assign = vi.spyOn(boardNavigation, "assign").mockImplementation(() => {});
    const fetchMock = server({ cards: { [ADA.id]: { ...OPS_CARD, person: PICTURED } }, projects: THREE_BOARDS });
    renderCards(<Name person={PICTURED} board="OPS" />);
    const card = await pin("Ada Brooks");
    expect(cardCalls(fetchMock).map(([input]) => String(input))).toEqual([`/api/oversight/people/${ADA.id}/card?board=OPS`]);
    // The picture from that board too: the service serves one only for someone on the board it is asked about.
    expect(card.querySelector("[data-avatar] img")).toHaveAttribute("src", `/api/oversight/people/${ADA.id}/avatar?v=0123456789ab&board=OPS`);
    expect(card.querySelector("[data-card-line]")).toHaveTextContent(`Holds ${OPS_CARD.work.open_tickets} open tickets on Operations`);

    // Each way on picks OPS, then opens there: the page it leads to says what the card said.
    const ways: [string, string][] = [
      ["View scorecard", `/people?person=${ADA.id}`],
      ["Open findings", `/findings?person=${ADA.id}`],
      ["Ask about Ada", `/ask?about=${ADA.id}`],
      ["DEMO-1038", "/issues/DEMO-1038"],
      [`and ${OPS_CARD.in_progress_more} more`, `/ask?${new URLSearchParams({ q: "What is @Ada Brooks working on?", m: ADA.id }).toString()}`],
    ];
    for (const [name, href] of ways) {
      document.cookie = "jo-board=DEMO; path=/";
      assign.mockClear();
      const open = screen.queryByRole("dialog", { name: "Ada Brooks" }) ?? (await pin("Ada Brooks"));
      fireEvent.click(within(open).getByRole("link", { name }));
      expect(assign, name).toHaveBeenCalledWith(href);
      expect(document.cookie, name).toMatch(/jo-board=OPS/);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }

    // A new tab or window (a modifier, the middle button) opens on OPS; this page stays where it is.
    document.cookie = "jo-board=DEMO; path=/";
    assign.mockClear();
    let open = await pin("Ada Brooks");
    fireEvent(within(open).getByRole("link", { name: "View scorecard" }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(document.cookie).toMatch(/jo-board=OPS/);
    document.cookie = "jo-board=DEMO; path=/";
    fireEvent.click(within(open).getByRole("link", { name: "Open findings" }), { metaKey: true });
    expect(document.cookie).toMatch(/jo-board=OPS/);
    expect(assign).not.toHaveBeenCalled();

    // Among its other boards, the top bar's own is an ordinary link: nothing to pick.
    document.cookie = "jo-board=DEMO; path=/";
    open = screen.queryByRole("dialog", { name: "Ada Brooks" }) ?? (await pin("Ada Brooks"));
    fireEvent.click(within(open.querySelector("[data-card-boards]") as HTMLElement).getByRole("link", { name: "DEMO" }));
    expect(assign).not.toHaveBeenCalled();
    expect(document.cookie).toMatch(/jo-board=DEMO/);
  });

  it("on the top bar's own board, its links are ordinary links", async () => {
    const assign = vi.spyOn(boardNavigation, "assign").mockImplementation(() => {});
    server();
    renderCards(<Name board="DEMO" />);
    const card = await pin("Ada Brooks");
    fireEvent.click(within(card).getByRole("link", { name: "View scorecard" }));
    expect(assign).not.toHaveBeenCalled();
    expect(document.cookie).toMatch(/jo-board=DEMO/);
  });
});

describe("a card that could not be read", () => {
  /** Press the name, and wait for the card to say it could not be read. */
  async function failed() {
    await userEvent.setup().click(screen.getByRole("button", { name: "Ada Brooks" }));
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "error"));
    return card;
  }

  it("leaves the line under the name empty, never a placeholder still loading; Try again where trying can help", async () => {
    server({ cards: { [ADA.id]: () => Response.json({ error: "access_log_unavailable", message: "The access log could not record this read." }, { status: 503 }) } });
    renderCards(<Name />);
    const card = await failed();
    const line = card.querySelector("[data-card-line]") as HTMLElement;
    expect(line.querySelector(".skeleton")).toBeNull();
    expect(line).toBeEmptyDOMElement();
    expect(within(card).getByRole("alert")).toHaveTextContent("Couldn't load Ada Brooks's card.");
    expect(within(card).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The next read may well work: the ways on stay open.
    expect(within(card).getAllByRole("link").map((link) => link.textContent)).toEqual(["View scorecard", "Open findings", "Ask about Ada"]);
  });

  it("someone not on the board: said so, and every way on is shut, since each would only say the same", async () => {
    server({ cards: {} });
    renderCards(<Name />);
    const card = await failed();
    expect(card.querySelector("[data-card-line] .skeleton")).toBeNull();
    expect(within(card).getByRole("alert")).toHaveTextContent("Ada Brooks is not on this board.");
    const actions = within(card).getByRole("navigation", { name: "Ways on from Ada Brooks's card" });
    expect(within(actions).queryAllByRole("link")).toHaveLength(0);
    const shut = [...actions.querySelectorAll("[aria-disabled='true']")];
    expect(shut.map((cell) => [cell.textContent, cell.getAttribute("title")])).toEqual([
      ["View scorecard", "Ada Brooks is not on this board"],
      ["Open findings", "Ada Brooks is not on this board"],
      ["Ask about Ada", "Ada Brooks is not on this board"],
    ]);
  });

  it("a board the oversight service does not serve: said so, never that the person is not on it", async () => {
    const message = "The board this card is read on is not one the oversight service serves.";
    server({ cards: { [ADA.id]: () => Response.json({ error: "unknown_board", message }, { status: 404 }) } });
    renderCards(<Name board="GONE" />);
    const card = await failed();
    const alert = within(card).getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load Ada Brooks's card.");
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent("not on this board.");
    // Trying again cannot help: the board is not served.
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
    expect(card.querySelector("[data-card-actions] [aria-disabled='true']")).toHaveAttribute("title", "Not a board the oversight service serves");
  });

  it("in the bottom sheet too, the line under the name is never a placeholder once the read has failed", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    server({ cards: { [ADA.id]: () => Response.json({ error: "upstream_unavailable", message: "Try again in a moment." }, { status: 503 }) } });
    renderCards(<Name />);
    const sheet = await failed();
    expect(sheet).toHaveClass("jo-sheet-bottom");
    expect(sheet.querySelector("[data-card-line] .skeleton")).toBeNull();
  });
});

describe("a pinned card and the keyboard", () => {
  function Page({ person = ADA }: { person?: Person }) {
    return (
      <>
        <button type="button">Before the name</button>
        <Name person={person} />
        <button type="button">Just after the name</button>
        <button type="button">Last on the page</button>
      </>
    );
  }

  /** The name focused and Enter pressed, as the keyboard alone pins a card. */
  async function pinByKey(user: ReturnType<typeof userEvent.setup>) {
    act(() => screen.getByRole("button", { name: "Ada Brooks" }).focus());
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
    await waitFor(() => expect(card).toHaveFocus());
    return card;
  }

  it("Shift+Tab from the card just pinned closes it and gives focus back to the name, never to the end of the page", async () => {
    server();
    renderCards(<Page />);
    const user = userEvent.setup();
    await pinByKey(user);
    await user.tab({ shift: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ada Brooks" })).toHaveFocus();
  });

  it("Tab leads through every control in the card, links too, in any browser, then on to what follows the name", async () => {
    server();
    renderCards(<Page />);
    const user = userEvent.setup();
    await pinByKey(user);
    for (const stop of ["Close", "DEMO-1038", "DEMO-1084", "DEMO-1128", "and 1 more", "View scorecard", "Open findings", "Ask about Ada"]) {
      await user.tab();
      expect(document.activeElement).toHaveAccessibleName(stop);
    }
    await user.tab();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Just after the name" })).toHaveFocus();
  });

  it("Shift+Tab from the card's first control closes it too, focus on the name; back and forth inside it keeps it open", async () => {
    server();
    renderCards(<Page />);
    const user = userEvent.setup();
    const card = await pinByKey(user);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName("DEMO-1038");
    await user.tab({ shift: true });
    expect(within(card).getByRole("button", { name: "Close" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    await user.tab({ shift: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ada Brooks" })).toHaveFocus();
  });

  it("a chip's card: Shift+Tab gives focus back to its field; Tab past the last control moves on past the field", async () => {
    server();
    const onReturnFocus = vi.fn();
    renderCards(
      <>
        <div role="textbox" aria-label="Question" tabIndex={0}>
          <PersonCardChip person={ADA} onReturnFocus={onReturnFocus}>
            <span data-testid="chip">Ada Brooks</span>
          </PersonCardChip>
        </div>
        <button type="button">Ask</button>
      </>,
    );
    const user = userEvent.setup();
    fireEvent.click(screen.getByTestId("chip"));
    let card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card).toHaveFocus());
    await user.tab({ shift: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReturnFocus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("chip"));
    card = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(card.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
    await waitFor(() => expect(card).toHaveFocus());
    for (let stop = 0; stop < 9; stop += 1) await user.tab();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ask" })).toHaveFocus();
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
  });
});

describe("a bottom sheet (a touch screen, a phone)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  it("gives focus back to the name when it closes, where the tap that opened it focused nothing (Safari)", async () => {
    server();
    renderCards(<Name />);
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    // A tap in Safari presses a button without focusing it.
    fireEvent.click(name);
    expect(name).not.toHaveFocus();
    let sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await userEvent.setup().click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(name).toHaveFocus();

    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.click(name);
    sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(name).toHaveFocus();
  });

  it("keeps Backspace from the browser, as a pinned card does: WebKit would go Back and leave the page behind it", async () => {
    // Regression: a tap on an answer's pill on a phone, then Backspace, took WebKit back to the page before Ask, and the
    // answer and the question being written went with it. The pinned card kept Backspace; its sheet did not.
    server();
    renderCards(<Name />);
    fireEvent.click(screen.getByRole("button", { name: "Ada Brooks" }));
    const sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    await waitFor(() => expect(sheet).toHaveFocus());
    await waitFor(() => expect(sheet.querySelector("[data-person-card]")).toHaveAttribute("data-card-state", "ready"));
    // From the sheet itself, where it puts focus, and from any of its ways on: the browser never hears it.
    expect(fireEvent.keyDown(sheet, { key: "Backspace" })).toBe(false);
    expect(fireEvent.keyDown(within(sheet).getByRole("link", { name: "View scorecard" }), { key: "Backspace" })).toBe(false);
    expect(fireEvent.keyDown(within(sheet).getByRole("button", { name: "Close" }), { key: "Backspace" })).toBe(false);
    // Anything else is as it was: another key, Backspace with a modifier, and Escape, which still closes it.
    expect(fireEvent.keyDown(sheet, { key: "x" })).toBe(true);
    expect(fireEvent.keyDown(sheet, { key: "Backspace", altKey: true })).toBe(true);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBe(sheet);
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps Backspace from the browser in a mention chip's sheet too, the question's field untouched", async () => {
    server();
    const onReturnFocus = vi.fn();
    renderCards(
      <PersonCardChip person={ADA} onReturnFocus={onReturnFocus}>
        <span data-testid="chip">Ada Brooks</span>
      </PersonCardChip>,
    );
    fireEvent.click(screen.getByTestId("chip"));
    const sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    expect(sheet).toHaveClass("jo-sheet-bottom");
    await waitFor(() => expect(sheet).toHaveFocus());
    expect(fireEvent.keyDown(sheet, { key: "Backspace" })).toBe(false);
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
  });

  it("is the screen's width up to 40rem, and its body scrolls within what its header and footer leave", async () => {
    server();
    renderCards(<Name />);
    fireEvent.click(screen.getByRole("button", { name: "Ada Brooks" }));
    const sheet = await screen.findByRole("dialog", { name: "Ada Brooks" });
    expect(sheet).toHaveClass("max-w-[40rem]", "w-full", "mx-auto");
    expect(sheet).not.toHaveClass("max-w-full");
    // A touch screen's sheet names no key: Close is its way out.
    expect(within(sheet).queryByText("Esc")).not.toBeInTheDocument();
    // The panel is only as tall as its content, so the body cannot be h-full of it: it flexes in a column instead.
    const scroller = sheet.querySelector(".jo-scroller") as HTMLElement;
    expect(scroller).toHaveClass("min-h-0", "flex-1");
    expect(scroller).not.toHaveClass("h-full");
    expect(scroller.parentElement).toHaveClass("flex", "flex-col", "min-h-0", "flex-1");
  });
});

describe("the way from a name to its card (a hover card)", () => {
  /** The People table at 1440 × 900: names 160 × 36 at x 280, a row every 52 px from y 380; the card beside the first, level with it, moved up to fit. */
  const rowBox = (row: number) => ({ left: 280, top: 380 + 52 * row, right: 440, bottom: 416 + 52 * row });
  const CARD_BOX = { left: 448, top: 327, right: 788, bottom: 888 };
  const PEOPLE: Person[] = [ADA, ...[1, 2, 3].map((n) => ({ id: `p00000000000${n}`, name: `Row ${n} Person`, avatar: null }))];
  type Box = { left: number; top: number; right: number; bottom: number };
  const inside = (box: Box, x: number, y: number) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

  /** Where the open card stands: beside the first name, or where Radix measures it before placing it (off the page). */
  let cardBox: Box = CARD_BOX;
  /** As Radix measures a card before it places it: above the window, a card's height and more. */
  const MEASURED_OFF_PAGE = { left: 0, top: -1122, right: 340, bottom: -561 };

  function laidOut() {
    cardBox = CARD_BOX;
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const row = PEOPLE.findIndex((person) => this.getAttribute("data-person-card-trigger") === person.id);
      const box = row >= 0 ? rowBox(row) : this.hasAttribute("data-person-card-mode") ? cardBox : { left: 0, top: 0, right: 0, bottom: 0 };
      return { ...box, x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, toJSON: () => ({}) } as DOMRect;
    });
  }

  /** What is under a point: the open card over everything, else a name, else nothing. */
  function under(x: number, y: number): Element | null {
    const card = document.querySelector("[data-person-card-mode]");
    if (card && inside(cardBox, x, y)) return card;
    const row = PEOPLE.findIndex((_, index) => inside(rowBox(index), x, y));
    return row >= 0 ? document.querySelector(`[data-person-card-trigger="${PEOPLE[row].id}"]`) : null;
  }

  /**
   * The pointer moved at `speed` px/s, an event every 16 ms, entering and leaving what it crosses: in a straight
   * line, or along a hand's curve whose middle is `bow` px off it (positive: to the left of the way, which on a way
   * down to a card on the right is away from the card).
   */
  function glide(from: [number, number], to: [number, number], speed: number, bow = 0) {
    const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const control = [(from[0] + to[0]) / 2 - (2 * bow * (to[1] - from[1])) / chord, (from[1] + to[1]) / 2 + (2 * bow * (to[0] - from[0])) / chord];
    const along = (t: number) => [0, 1].map((axis) => (1 - t) ** 2 * from[axis] + 2 * (1 - t) * t * control[axis] + t ** 2 * to[axis]);
    let length = 0;
    for (let i = 1; i <= 100; i += 1) length += Math.hypot(...along(i / 100).map((value, axis) => value - along((i - 1) / 100)[axis]));
    const steps = Math.ceil(length / (speed * 0.016));
    let at = under(...from);
    for (let step = 1; step <= steps; step += 1) {
      const [x, y] = along(step / steps);
      const next = under(x, y);
      if (next !== at) {
        if (at) fireEvent.pointerLeave(at, { pointerType: "mouse", clientX: x, clientY: y });
        if (next) fireEvent.pointerEnter(next, { pointerType: "mouse", clientX: x, clientY: y });
        at = next;
      }
      fireEvent.pointerMove(next ?? document.body, { pointerType: "mouse", clientX: x, clientY: y });
      pass(16);
    }
  }

  /**
   * Points on a hand's curve (as `glide` draws it) one every `gap` px of its length, the first `offset` px in, and
   * its end: where a browser that delivers few moves reports the pointer (WebKit here, about every 150 px).
   */
  function reported(from: [number, number], to: [number, number], bow: number, gap: number, offset: number): [number, number][] {
    const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const control = [(from[0] + to[0]) / 2 - (2 * bow * (to[1] - from[1])) / chord, (from[1] + to[1]) / 2 + (2 * bow * (to[0] - from[0])) / chord];
    const along = (t: number) => [0, 1].map((axis) => (1 - t) ** 2 * from[axis] + 2 * (1 - t) * t * control[axis] + t ** 2 * to[axis]) as [number, number];
    const points: [number, number][] = [];
    let travelled = 0;
    let next = offset;
    for (let i = 1; i <= 2000; i += 1) {
      const [a, b] = [along((i - 1) / 2000), along(i / 2000)];
      travelled += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (travelled >= next) {
        points.push(b);
        next += gap;
      }
    }
    return [...points, to];
  }

  /** The pointer reported only at `points`, `every` ms apart, from `from`: it enters and leaves what each lands on. */
  function hop(from: [number, number], points: [number, number][], every: number) {
    let at = under(...from);
    for (const [x, y] of points) {
      const next = under(x, y);
      if (next !== at) {
        if (at) fireEvent.pointerLeave(at, { pointerType: "mouse", clientX: x, clientY: y });
        if (next) fireEvent.pointerEnter(next, { pointerType: "mouse", clientX: x, clientY: y });
        at = next;
      }
      fireEvent.pointerMove(next ?? document.body, { pointerType: "mouse", clientX: x, clientY: y });
      pass(every);
    }
  }

  async function hovered() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cards = Object.fromEntries(PEOPLE.map((person) => [person.id, { ...cardSample, person }]));
    const fetchMock = server({ cards });
    renderCards(
      <ol>
        {PEOPLE.map((person) => (
          <li key={person.id}>
            <Name person={person} />
          </li>
        ))}
      </ol>,
    );
    laidOut();
    const name = screen.getByRole("button", { name: "Ada Brooks" });
    fireEvent.pointerEnter(name, { pointerType: "mouse", clientX: 360, clientY: 398 });
    pass(HOVER_INTENT_MS);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toHaveAttribute("data-person-card-mode", "hover");
    return fetchMock;
  }

  it("holds the card while the pointer travels at an ordinary speed to its far corner, across other names, whose cards wait", async () => {
    const fetchMock = await hovered();
    // From the name's middle to View scorecard at the card's foot, at 600 px/s: about 800 ms, most of it off both.
    glide([360, 398], [480, 870], 600);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    pass(HOVER_INTENT_MS * 2);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // Only Ada's card was read: the names crossed on the way never opened theirs.
    expect(cardCalls(fetchMock).map(([input]) => String(input))).toEqual([`/api/oversight/people/${ADA.id}/card`]);
  });

  for (const bow of [30, 45, 60, -60]) {
    it(`holds the card along a hand's curve to View scorecard, the leftmost way on, bowing ${Math.abs(bow)} px ${bow > 0 ? "away from the card" : "towards it"}`, async () => {
      const fetchMock = await hovered();
      // From the name's middle to the middle of View scorecard at the card's foot, at 600 px/s, the hand's path bowed.
      glide([360, 398], [505, 870], 600, bow);
      pass(HOVER_INTENT_MS * 2);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
      expect(cardCalls(fetchMock).map(([input]) => String(input))).toEqual([`/api/oversight/people/${ADA.id}/card`]);
    });
  }

  it("closes 150 ms after the pointer leaves the way, as after it leaves the name", async () => {
    await hovered();
    // Off the name's far side, away from the card: out of the way at once, the last step 16 ms ago.
    glide([360, 398], [270, 398], 600);
    pass(HOVER_CLOSE_MS - 40);
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    pass(HOVER_CLOSE_MS);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes 150 ms after the pointer leaves by the name's far side, away from the card, though it moves no further", async () => {
    await hovered();
    fireEvent.pointerLeave(screen.getByRole("button", { name: "Ada Brooks" }), { pointerType: "mouse", clientX: 279, clientY: 398 });
    pass(HOVER_CLOSE_MS - 10);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    pass(10);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a pointer that comes to rest on another name on the straight way to the card: that name waits, then the card goes and its card opens", async () => {
    await hovered();
    // Down to the third row's name, on the straight ways to the card all along, and still.
    glide([360, 398], [380, 500], 600);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    // Past the 350 ms that name would wait anywhere else: still Ada's card.
    pass(HOVER_INTENT_MS);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Row 2 Person" })).not.toBeInTheDocument();
    pass(GRACE_REST_MS + HOVER_CLOSE_MS - HOVER_INTENT_MS);
    expect(screen.queryByRole("dialog", { name: "Ada Brooks" })).not.toBeInTheDocument();
    pass(HOVER_INTENT_MS);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole("dialog", { name: "Row 2 Person" })).toBeInTheDocument();
  });

  it("a pointer that comes to rest on another name on the way but off its straight ways: that name's card opens after 350 ms, as anywhere", async () => {
    await hovered();
    // Down and to the left, to the third row's name: on the way (the card stays) but off the straight ways to it.
    glide([360, 398], [300, 500], 600);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    pass(HOVER_CLOSE_MS * 2);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    pass(HOVER_INTENT_MS - HOVER_CLOSE_MS * 2);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole("dialog", { name: "Row 2 Person" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("holds the card when a report lands once on another name off the straight ways and the next comes 400 ms later: a pass, not a rest", async () => {
    // Regression (JO-14): WebKit here reports a hand only every 150 to 450 ms, so a pointer passing over a name on its
    // way to the card's foot stood on it long enough for that name's 350 ms, and its card took Ada's place.
    const fetchMock = await hovered();
    // Down and to the left onto the third row's name (on the way, off the straight ways), reported there once.
    hop([360, 398], [[300, 500]], 400);
    // The next report is on the card's foot.
    hop([300, 500], [[505, 870]], 16);
    pass(HOVER_INTENT_MS * 2);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(cardCalls(fetchMock).map(([input]) => String(input))).toEqual([`/api/oversight/people/${ADA.id}/card`]);
  });

  it("opens that name's card for a pointer that stops at its first report there, once its journey ends", async () => {
    await hovered();
    hop([360, 398], [[300, 500]], 16);
    // Half a second still on the way ends the journey: Ada's card goes, and the name under the pointer waits its 350 ms.
    pass(GRACE_REST_MS + HOVER_CLOSE_MS);
    expect(screen.queryByRole("dialog", { name: "Ada Brooks" })).not.toBeInTheDocument();
    pass(HOVER_INTENT_MS);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole("dialog", { name: "Row 2 Person" })).toBeInTheDocument();
  });

  it("holds the card when the pointer is reported only every 100 px: the way runs from where it crossed the name's foot", async () => {
    await hovered();
    // On the name by its left end (beside a picture), then down to View scorecard bowing 60 px away from the card,
    // reported every 166 ms at 600 px/s (WebKit's synthetic moves here): the first report off the name lies nearer
    // its far side than its foot, and read as where it left, the way would face away from the card.
    fireEvent.pointerMove(screen.getByRole("button", { name: "Ada Brooks" }), { pointerType: "mouse", clientX: 285, clientY: 398 });
    hop([285, 398], reported([285, 398], [505, 870], 60, 100, 25), 166);
    pass(HOVER_INTENT_MS * 2);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
  });

  it("draws the way once the card is placed: a pointer that leaves while Radix still measures it off the page keeps it", async () => {
    await hovered();
    cardBox = MEASURED_OFF_PAGE;
    // Off the name towards the card's foot before the card stands beside it: taken to be on its way there.
    glide([360, 398], [420, 520], 600);
    pass(HOVER_CLOSE_MS * 2);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
    // Placed: the way is drawn from where the pointer crossed the name's foot, and the hand goes on to View scorecard.
    cardBox = CARD_BOX;
    glide([420, 520], [505, 870], 600);
    pass(HOVER_INTENT_MS * 2);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Ada Brooks" })).toBeInTheDocument();
  });

  it("once placed, still closes 150 ms after a pointer that left before then is off the way", async () => {
    await hovered();
    cardBox = MEASURED_OFF_PAGE;
    glide([360, 398], [380, 430], 600);
    cardBox = CARD_BOX;
    // Back up past the name's top, away from the card below and beside it: off the way.
    glide([380, 430], [300, 330], 600);
    pass(HOVER_CLOSE_MS + 20);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("a name that opens a card", () => {
  it("has no tooltip of its own (the card says the whole name); a name that opens none keeps its tooltip", () => {
    server();
    const { unmount } = renderCards(<Name />);
    expect(screen.getByText("Ada Brooks")).not.toHaveAttribute("title");
    unmount();
    renderCards(<Name />, { peopleLevel: false });
    expect(screen.getByText("Ada Brooks")).toHaveAttribute("title", "Ada Brooks");
  });

  it("scrolls on its own, and keeps the wheel to itself, only while it holds more than it shows", async () => {
    server();
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    expect(card).not.toHaveAttribute("data-overflowing");
    expect(card.className.split(/\s+/)).not.toContain("overscroll-contain");
    expect(card.className.split(/\s+/)).toContain("data-[overflowing]:overscroll-contain");
    closePersonCards();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // A window shorter than the card.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(620);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
    expect(await pin("Ada Brooks")).toHaveAttribute("data-overflowing");
  });

  it("lists as many other boards as fit whole, then '+N more' naming the rest: none cut short, none out of sight yet reachable", async () => {
    const many = [
      { key: "LEADRSCOMS", name: "Leaders comms", open_tickets: 3 },
      { key: "LEADRSDRE", name: "Leaders DRE", open_tickets: 1 },
      { key: "OPS", name: "Operations", open_tickets: 2 },
      { key: "WEB", name: "Web platform", open_tickets: 1 },
    ];
    const synced = (key: string, name: string) => ({ key, name, issues: 10, last_synced_at: "2026-11-04T14:28:00.000Z", synced: true, type: "software" });
    server({ cards: { [ADA.id]: { ...cardSample, other_boards: many } }, projects: { default: "DEMO", projects: [synced("DEMO", "Demo project"), ...many.map((board) => synced(board.key, board.name))] } });
    // As a browser measures the line: 308 px of room, "Also on" 46, each board 100, "+N more" 52.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(308);
    const measure = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const width = this.hasAttribute("data-ruler-lead") ? 46 : this.hasAttribute("data-ruler-board") ? 100 : this.hasAttribute("data-ruler-more") ? 52 : null;
      return width === null ? measure.call(this) : ({ left: 0, top: 0, right: width, bottom: 18, x: 0, y: 0, width, height: 18, toJSON: () => ({}) } as DOMRect);
    });
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    const line = card.querySelector("[data-card-boards]") as HTMLElement;
    await waitFor(() => expect(line).toHaveTextContent("Also on LEADRSCOMS (3 open) · , LEADRSDRE (1 open) · , +2 more: OPS (2 open) and WEB (1 open)"));
    // The two that fit are links; the rest are named for a screen reader and in the tooltip, and nothing hidden can take focus.
    expect(within(line).getAllByRole("link").map((link) => link.textContent)).toEqual(["LEADRSCOMS", "LEADRSDRE"]);
    expect(line.querySelector("[data-card-boards-more]")).toHaveAttribute("title", "Also on OPS (2 open) and WEB (1 open)");
    expect(card.querySelector("[data-card-boards-ruler]")).toHaveAttribute("aria-hidden", "true");
    expect(card.querySelectorAll("[data-card-boards-ruler] a, [data-card-boards-ruler] button")).toHaveLength(0);
  });
});

describe("the card on a page", () => {
  it("adds no landmark the page already has: no second banner, no content-information region (axe)", async () => {
    server();
    renderCards(
      <>
        <header>The top bar</header>
        <main>
          <Name />
        </main>
      </>,
    );
    await pin("Ada Brooks");
    const results = await axe.run(document.body, {
      runOnly: {
        type: "rule",
        values: ["landmark-no-duplicate-banner", "landmark-no-duplicate-contentinfo", "landmark-unique", "landmark-banner-is-top-level", "landmark-contentinfo-is-top-level"],
      },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe("the process meter's quietest part (too few tickets to compare)", () => {
  /** A rule block's custom properties, from a stylesheet's text: `--name: value;` pairs between its braces. */
  function tokens(file: string, selector: string): Record<string, string> {
    const text = readFileSync(path.join(process.cwd(), "src", file), "utf8");
    const start = text.indexOf(`${selector} {`);
    expect(start, `${selector} in ${file}`).toBeGreaterThanOrEqual(0);
    const body = text.slice(start, text.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  }
  /** WCAG's contrast ratio of two #rrggbb colours. */
  function contrast(a: string, b: string): number {
    const luminance = (hex: string) => {
      const [r, g, bl] = [1, 3, 5].map((at) => {
        const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  it("is drawn in its own token, which stands off the card's ground in dark as plainly as in light", async () => {
    server({ cards: { [ADA.id]: { ...cardSample, process: { closer: 2, level: 3, further: 0, too_few: 2, measurable: 7 } } } });
    renderCards(<Name />);
    const card = await pin("Ada Brooks");
    expect(card.querySelector('[data-card-meter] [data-part="too_few"]')).toHaveClass("bg-(--chart-too-few)");
    expect(card.querySelector('[data-key="too_few"] [aria-hidden]')).toHaveClass("bg-(--chart-too-few)");

    // Each theme's value, resolved against its grounds: the card stands on the raised ground (--paper-150).
    for (const [theme, ground, chart] of [
      ["light", tokens("app/globals.css", ":root"), tokens("styles/charts.css", ":root")],
      ["dark", tokens("app/globals.css", ':root[data-theme="dark"]'), tokens("styles/charts.css", ':root[data-theme="dark"]')],
    ] as const) {
      const value = chart["--chart-too-few"] ?? tokens("styles/charts.css", ":root")["--chart-too-few"];
      const named = /^var\((--[\w-]+)\)$/.exec(value ?? "")?.[1];
      const fill = named ? (ground[named] ?? tokens("app/globals.css", ":root")[named]) : value;
      // In dark, --rule on the raised ground is about 1.26:1, all but gone; the light theme's step is about 1.48:1.
      expect(contrast(fill, ground["--paper-150"] ?? tokens("app/globals.css", ":root")["--paper-150"]), theme).toBeGreaterThanOrEqual(1.4);
    }
  });
});
