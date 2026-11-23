import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { Tooltip } from "radix-ui";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closePersonCards } from "@/components/person-card/person-card-trigger";
import { PeopleLevelProvider } from "@/components/shell/people-level";
import { ShellProvider } from "@/components/shell/shell-context";
import { installDomShims, renderKit } from "@/components/ui/__tests__/kit";
import { oversightKeys } from "@/lib/api/hooks";
import { askResponseSchema, healthSchema, type AskLevel } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";

import answeredJson from "../../../../docs/sample-responses/ask-answered.json";
import trendJson from "../../../../docs/sample-responses/ask-answered-trend.json";
import notUnderstoodJson from "../../../../docs/sample-responses/ask-not-understood.json";
import noTicketsJson from "../../../../docs/sample-responses/ask-person-no-tickets.json";
import personJson from "../../../../docs/sample-responses/ask-person.json";
import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import cardJson from "../../../../docs/sample-responses/person-card.json";
import { AskView } from "../ask-view";
import { sameQuestion } from "../describe";
import { remember, resetHistoryCache } from "../history";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ask",
  useSearchParams: () => new URLSearchParams(),
}));

const HEALTH = {
  status: "ok",
  message: null,
  data_mode: "sample",
  read_only: true,
  api_version: "0.1.0",
  last_synced_at: "2026-11-04T14:28:00.000Z",
  projects: ["DEMO"],
  report_timezone: "Europe/London",
};
const ANSWERS = [answeredJson, trendJson];
const EPICS = answeredJson.question;
const TREND = trendJson.question;
/** "What are @Carmen Ruiz's open findings?", and the id of the fictional person it mentions. */
const PERSON_Q = personJson.question;
const CARMEN = personJson.people[0].id;
/** "What is @Noor Haddad working on?", about a member of the board who holds none of its tickets. */
const NOOR = noTicketsJson.people[0].id;

/** The oversight API, in memory: health, everyone on the board, and POST ask answered from the sample responses. */
function server(fail: (count: number) => boolean = () => false) {
  const asked: string[] = [];
  const bodies: unknown[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) return Response.json(HEALTH);
    if (url.endsWith("/people/directory")) return Response.json(directoryJson);
    if (/\/people\/p[0-9a-f]{12}\/card(\?|$)/.test(url)) return Response.json(cardJson);
    if (url.endsWith("/ask") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { question: string; mentions?: string[] };
      asked.push(body.question);
      bodies.push(body);
      if (fail(asked.length)) return Response.json({ error: "upstream_unavailable", message: "The service did not answer." }, { status: 503 });
      if (body.mentions?.includes(NOOR)) return Response.json({ ...noTicketsJson, question: body.question });
      if (body.mentions?.length) return Response.json({ ...personJson, question: body.question });
      const match = ANSWERS.find((answer) => sameQuestion(answer.question, body.question));
      return Response.json(match ?? { ...notUnderstoodJson, question: body.question });
    }
    return Response.json({ error: "not_found", message: "none" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { asked, bodies, fetchMock };
}

function renderAsk({ search = "", strict = false, level, cards = false }: { search?: string; strict?: boolean; level?: AskLevel; cards?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onUrlUpdate = vi.fn();
  const view = renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
        {/* `cards`: the shell's people level, so names open person cards (JO-13), as in the app for an admin. */}
        <PeopleLevelProvider peopleLevel={cards}>
          <AskView level={level} />
        </PeopleLevelProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
    { reactStrictMode: strict },
  );
  return { ...view, onUrlUpdate };
}

const field = () => screen.getByRole("textbox", { name: "Your question" });
/** The question in the field, as plain text (no chips in these). */
const typed = () => (field().textContent ?? "").replaceAll("​", "");
// The skeleton is titled with the question too; the answer is the article.
const answerTitle = (question: string) => screen.findByRole("article", { name: question });

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

beforeEach(() => {
  window.sessionStorage.clear();
  resetHistoryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Ask page", () => {
  it("starts with what can be asked, an empty ledger and an empty session", async () => {
    server();
    renderAsk();
    expect(within(screen.getByRole("list", { name: "Questions to start with" })).getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("complementary", { name: "Sources" })).not.toHaveTextContent(/Awaiting a question/);
    expect(screen.getByText("No questions yet.")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-multiline", "true");
    expect(field()).toHaveAttribute("data-page-search");
    await waitFor(() => expect(field()).toHaveAttribute("aria-placeholder", "Ask about the work in DEMO, in plain English"));
    expect(screen.getByText("Ask about the work in DEMO, in plain English")).toHaveAttribute("aria-hidden");
  });

  it("asks on Enter, never on Shift+Enter, and acknowledges the answer", async () => {
    const { asked } = server();
    const cite = vi.spyOn(notify, "cite");
    const { onUrlUpdate } = renderAsk();

    fireEvent.paste(field(), { clipboardData: { getData: () => `  ${EPICS}  ` } });
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(asked).toEqual([]);

    fireEvent.keyDown(field(), { key: "Enter" });
    expect(await answerTitle(EPICS)).toBeInTheDocument();
    expect(asked).toEqual([EPICS]);
    expect(cite).toHaveBeenCalledWith("Answer ready", expect.objectContaining({ description: undefined }));
    expect(onUrlUpdate).toHaveBeenCalledWith(expect.objectContaining({ queryString: expect.stringContaining("q=Which") }));
    // The field clears for the next question; the last one is a key press away.
    expect(typed()).toBe("");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(typed()).toBe(EPICS);

    const session = screen.getByRole("region", { name: "This session" });
    expect(within(session).getByRole("button", { name: new RegExp(EPICS.replace("?", "\\?")) })).toHaveAttribute("aria-current", "true");
  });

  it("asks a question from the URL once, with the box empty while it is asked (the question is the heading)", async () => {
    const { asked } = server();
    renderAsk({ search: `?q=${encodeURIComponent(EPICS)}`, strict: true });
    // The product owner (13 Nov 2026): a question sent leaves the box at once; it shows as the heading being answered.
    expect(typed()).toBe("");
    expect(await answerTitle(EPICS)).toBeInTheDocument();
    expect(asked).toEqual([EPICS]);
  });

  it("empties the box the moment a question is sent, and puts it back if the question fails", async () => {
    const { asked } = server((count) => count === 1);
    renderAsk();
    fireEvent.click(screen.getByRole("button", { name: /Which epics have the most open breaches\?/ }));
    // Sent: the box is empty at once, before any answer comes back.
    expect(typed()).toBe("");
    // It failed: the question is back in the box, so nothing typed is lost.
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get an answer");
    expect(typed()).toBe(EPICS);
    expect(asked).toEqual([EPICS]);
  });

  it("shows an answer this tab has just received rather than asking again", async () => {
    const { asked } = server();
    remember(askResponseSchema.parse(answeredJson));
    renderAsk({ search: `?q=${encodeURIComponent(EPICS)}` });
    expect(await answerTitle(EPICS)).toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it("says inline when the question could not be answered, and tries again", async () => {
    const { asked } = server((count) => count === 1);
    const warn = vi.spyOn(notify, "warn");
    renderAsk();
    fireEvent.click(screen.getByRole("button", { name: /Which epics have the most open breaches\?/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get an answer");
    expect(warn).toHaveBeenCalledWith("Couldn't get an answer", expect.anything());
    expect(screen.getByText("Nothing read")).toBeInTheDocument();
    // The question stays in the field to be edited or sent again.
    expect(typed()).toBe(EPICS);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await answerTitle(EPICS)).toBeInTheDocument();
    expect(asked).toEqual([EPICS, EPICS]);
  });

  it("goes back to an earlier answer from the session without asking twice", async () => {
    const { asked } = server();
    renderAsk();
    fireEvent.click(screen.getByRole("button", { name: /Which epics have the most open breaches\?/ }));
    expect(await answerTitle(EPICS)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TREND }));
    expect(await answerTitle(TREND)).toBeInTheDocument();

    const session = screen.getByRole("region", { name: "This session" });
    fireEvent.click(within(session).getByRole("button", { name: /Which epics have the most open breaches\?/ }));
    expect(await answerTitle(EPICS)).toBeInTheDocument();
    expect(asked).toEqual([EPICS, TREND]);
  });

  it("forgets the session on request, and says so", async () => {
    server();
    const info = vi.spyOn(notify, "info");
    renderAsk();
    fireEvent.click(screen.getByRole("button", { name: /Which epics have the most open breaches\?/ }));
    expect(await answerTitle(EPICS)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear this session's questions" }));
    expect(info).toHaveBeenCalledWith("Session cleared", expect.anything());
    expect(await screen.findByRole("list", { name: "Questions to start with" })).toBeInTheDocument();
    expect(screen.getByText("No questions yet.")).toBeInTheDocument();
  });
});

describe("the Ask page, for a reader Ask answers about people", () => {
  const box = () => screen.getByRole("textbox", { name: "Your question" });

  it("asks about the person picked with @: their id goes with the question, the address keeps it, and the answer marks them", async () => {
    const { bodies } = server();
    const user = userEvent.setup();
    const { onUrlUpdate } = renderAsk({ level: "people" });
    await user.type(box(), "What are @car");
    expect(await screen.findByRole("option", { name: "Carmen Ruiz" })).toBeInTheDocument();
    await user.keyboard("{Enter}{Backspace}'s open findings?{Enter}");

    const answer = await answerTitle(PERSON_Q);
    expect(bodies).toEqual([{ question: PERSON_Q, mentions: [CARMEN] }]);
    expect(onUrlUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ queryString: expect.stringContaining(`m=${CARMEN}`) }));
    expect(within(answer).getAllByRole("link", { name: "Carmen Ruiz" })[0]).toHaveAttribute("href", `/findings?state=open&person=${CARMEN}`);
    // The session keeps the question as it was typed.
    const session = screen.getByRole("region", { name: "This session" });
    expect(within(session).getByRole("button", { name: /What are @Carmen Ruiz's open findings\?/ })).toBeInTheDocument();

    // Asked again for a fresh answer, it is about the same person.
    fireEvent.click(screen.getByRole("button", { name: "Ask again for a fresh answer" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ question: PERSON_Q, mentions: [CARMEN] });
  });

  it("lists the members with no tickets in a group of their own, and marks the one picked in the sentence that answers", async () => {
    const { bodies, fetchMock } = server();
    const user = userEvent.setup();
    renderAsk({ level: "people" });
    await user.type(box(), "What is @");
    const none = await screen.findByRole("group", { name: "No tickets" });
    expect(within(none).getAllByRole("option").map((option) => option.textContent)).toEqual(["Noor Haddad", "Tomás Ferreira", "Yuki Tanabe"]);
    expect(screen.getByRole("group", { name: "With tickets" })).toBeInTheDocument();
    await user.click(within(none).getByRole("option", { name: "Noor Haddad" }));
    await user.keyboard("working on?{Enter}");

    const question = "What is @Noor Haddad working on?";
    const answer = await answerTitle(question);
    expect(bodies).toEqual([{ question, mentions: [NOOR] }]);
    const prose = answer.querySelector("[data-answer-prose]") as HTMLElement;
    expect(prose).toHaveTextContent("Noor Haddad has no tickets on this board.");
    // Marked, but leading nowhere: Findings has nothing of theirs to show.
    expect(prose.querySelector(`[data-person-mention="${NOOR}"]`)).toHaveTextContent("Noor Haddad");
    expect(within(prose).queryByRole("link")).not.toBeInTheDocument();
    // The @ list reads the directory, and only the directory.
    const read = fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => /\/people(\/|$)/.test(url));
    expect(new Set(read)).toEqual(new Set(["/api/oversight/people/directory"]));
  });

  it("puts a question from a link back in the field with its chip while it is asked, and Try again asks about the same person", async () => {
    const { bodies } = server((count) => count === 1);
    renderAsk({ level: "people", search: `?q=${encodeURIComponent(PERSON_Q)}&m=${CARMEN}` });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get an answer");
    // Her chip, rebuilt from the text and the address's id once the board's people are in.
    await waitFor(() => expect(box().querySelector(`[data-chip][data-mentioned="${CARMEN}"]`)).not.toBeNull());
    expect(typed()).toBe("What are Carmen Ruiz's open findings?");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await answerTitle(PERSON_Q)).toBeInTheDocument();
    expect(bodies).toEqual([
      { question: PERSON_Q, mentions: [CARMEN] },
      { question: PERSON_Q, mentions: [CARMEN] },
    ]);
  });

  it("asks a question from a link about the people the link names, checked as person ids", async () => {
    const { bodies } = server();
    renderAsk({ level: "people", search: `?q=${encodeURIComponent(PERSON_Q)}&m=${CARMEN},not-an-id,${CARMEN}` });
    expect(await answerTitle(PERSON_Q)).toBeInTheDocument();
    expect(bodies).toEqual([{ question: PERSON_Q, mentions: [CARMEN] }]);
  });

  it("a card's Ask about on this page puts the person into the question being written: the answer, the draft and the address stay", async () => {
    closePersonCards();
    const { bodies } = server();
    const info = vi.spyOn(notify, "info");
    const user = userEvent.setup();
    const { onUrlUpdate } = renderAsk({ level: "people", cards: true, search: `?q=${encodeURIComponent(PERSON_Q)}&m=${CARMEN}` });
    const answer = await answerTitle(PERSON_Q);
    await user.click(box());
    await user.keyboard("Why so many warnings?");
    const urls = onUrlUpdate.mock.calls.length;

    // From the answer's pill: her card, then Ask about.
    fireEvent.click(answer.querySelector(`[data-person-mention="${CARMEN}"]`) as HTMLElement);
    const card = await screen.findByRole("dialog", { name: "Carmen Ruiz" });
    await user.click(await within(card).findByRole("link", { name: "Ask about Carmen" }));
    await waitFor(() => expect(box().querySelector(`[data-chip][data-mentioned="${CARMEN}"]`)).not.toBeNull());
    expect(typed()).toBe("Why so many warnings? Carmen Ruiz ");
    expect(box()).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Nothing asked, nothing navigated: the answer is still on screen and the address still holds its question.
    expect(screen.getByRole("article", { name: PERSON_Q })).toBe(answer);
    expect(bodies).toHaveLength(1);
    expect(onUrlUpdate.mock.calls.slice(urls)).toEqual([]);
    expect(info).toHaveBeenLastCalledWith("Person mentioned", { description: "Carmen Ruiz is in the question. Press Enter to ask." });

    // Again, from her chip's own card: no second chip; the caret goes just after hers, and what is typed lands there.
    fireEvent.click(answer.querySelector(`[data-person-mention="${CARMEN}"]`) as HTMLElement);
    await user.click(await within(await screen.findByRole("dialog", { name: "Carmen Ruiz" })).findByRole("link", { name: "Ask about Carmen" }));
    await waitFor(() => expect(info).toHaveBeenLastCalledWith("Already in the question", { description: "Carmen Ruiz is already mentioned." }));
    expect(box().querySelectorAll("[data-chip]")).toHaveLength(1);
    expect(box()).toHaveFocus();
    await user.keyboard(", today,");
    expect(typed()).toBe("Why so many warnings? Carmen Ruiz, today, ");
    expect(screen.getByRole("article", { name: PERSON_Q })).toBe(answer);
    expect(bodies).toHaveLength(1);
    expect(onUrlUpdate.mock.calls.slice(urls)).toEqual([]);
    closePersonCards();
  }, 20_000);

  it("starts with a question about people among the starters, and says @ is there", async () => {
    server();
    renderAsk({ level: "people" });
    const starters = screen.getByRole("list", { name: "Questions to start with" });
    expect(within(starters).getByRole("button", { name: /Who has the most open breaches\?/ })).toBeInTheDocument();
    expect(screen.getByText(/Type @ to ask about someone on this board/)).toBeInTheDocument();
  });
});

describe("the Ask page, for a reader Ask answers at team level", () => {
  it("never sends a mention, whatever a link says, and never asks for the board's people", async () => {
    const { bodies, fetchMock } = server();
    renderAsk({ search: `?q=${encodeURIComponent(PERSON_Q)}&m=${CARMEN}` });
    expect(await answerTitle(PERSON_Q)).toBeInTheDocument();
    expect(bodies).toEqual([{ question: PERSON_Q }]);
    expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => /\/people(\/|$)/.test(url))).toEqual([]);
    expect(field()).not.toHaveAttribute("aria-autocomplete");
    expect(field()).not.toHaveAttribute("aria-haspopup");
  });
});

describe("the Ask page, rendered on the server and then hydrated", () => {
  it("says the same in the server's HTML and while hydrating, then names the board", async () => {
    server();
    installDomShims();
    const page = (client: QueryClient) => (
      <ShellProvider initialRailCollapsed={false} platform="other">
        <Tooltip.Provider delayDuration={0}>
          <QueryClientProvider client={client}>
            <NuqsTestingAdapter searchParams="" hasMemory>
              <AskView />
            </NuqsTestingAdapter>
          </QueryClientProvider>
        </Tooltip.Provider>
      </ShellProvider>
    );
    const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    container.innerHTML = renderToString(page(client()));
    document.body.append(container);

    // The top bar hydrates first, so health can already be in the cache when this part of the stream hydrates.
    const warm = client();
    warm.setQueryData(oversightKeys.health(), healthSchema.parse(HEALTH));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, page(warm));
    });

    const mismatches = errors.mock.calls.map((call) => String(call[0])).filter((message) => /hydrat|didn't match/i.test(message));
    expect(mismatches).toEqual([]);
    expect(container.querySelector("[data-question-editor]")).toHaveAttribute("aria-placeholder", "Ask about the work in DEMO, in plain English");
    act(() => root?.unmount());
    container.remove();
  });
});

describe("the Ask page, over the service's limit on questions (JO-12)", () => {
  const LIMITED = "You've asked a lot of questions in a short time. Try again in 2 minutes.";

  it("keeps the question in the box and says there when to try again; the answer before stays, and nothing fails", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/health")) return Response.json(HEALTH);
        if (url.endsWith("/ask") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { question: string };
          asked.push(body.question);
          if (asked.length === 2) {
            return Response.json({ error: "ask_rate_limited", message: LIMITED }, { status: 429, headers: { "retry-after": "90" } });
          }
          return Response.json(ANSWERS.find((answer) => sameQuestion(answer.question, body.question)) ?? { ...notUnderstoodJson, question: body.question });
        }
        return Response.json({ error: "not_found", message: "none" }, { status: 404 });
      }),
    );
    const warn = vi.spyOn(notify, "warn");
    renderAsk();
    fireEvent.click(screen.getByRole("button", { name: /Which epics have the most open breaches\?/ }));
    expect(await answerTitle(EPICS)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: TREND }));
    const form = screen.getByRole("form", { name: "Ask a question" });
    expect(await within(form).findByText(LIMITED)).toBeInTheDocument();
    expect(typed()).toBe(TREND);
    // The answer before is still the page's; no error took its place.
    expect(screen.getByRole("article", { name: EPICS })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith("Not asked yet", expect.objectContaining({ description: LIMITED }));
    expect(asked).toEqual([EPICS, TREND]);
  });
});
