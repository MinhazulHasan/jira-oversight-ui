import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { expectQuestion, questionBox } from "./question";

/*
 * The Ask page against the sample server: a question asked, its figures tied
 * to their rows, the keyboard model, each of the five outcomes in its own calm
 * state, the session rail, the URL, and axe in both themes throughout.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EPICS = "Which epics have the most open breaches?";
const STUCK = "Where do tickets get stuck most?";

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, help: violation.help, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`Uncaught: ${error.message}`));
  return problems;
}

/** Every POST to the ask endpoint, so a test can say how many questions were really asked. */
function countAsks(page: Page): { count: number } {
  const asks = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/oversight/ask")) asks.count += 1;
  });
  return asks;
}

async function shellReady(page: Page) {
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
  // The sync time is drawn once the page is live (it reads the viewer's clock): typing waits for it, or hydration
  // could take back what was typed into the server's markup.
  await expect(page.getByRole("banner").locator("[data-sync-now]").filter({ hasText: / ago/ })).toBeVisible();
}

// The question box (with sign-in off, the sample, it also drives the @ list), by its label.
const field = (page: Page) => questionBox(page);
const answer = (page: Page, question: string) => page.getByRole("article", { name: question });
const ledger = (page: Page) => page.getByRole("complementary", { name: "Sources" });
/**
 * A cited value by its figure and marker: "57, citation 6". The ", citation 6"
 * is visually hidden, so it is laid out apart from the figure and its name
 * reads "57 , citation 6" in a browser.
 */
const value = (page: Page, figure: string, marker: number) =>
  page.getByRole("button", { name: new RegExp(`^${figure} ?, citation ${marker}$`) });

/**
 * Put a question in the box as a reader would: focus first, then the words. (WebKit can drop a select-all and
 * insert made in the same frame as the focus the box is still settling, which a reader typing never does.)
 */
async function fillQuestion(page: Page, question: string) {
  await field(page).click();
  await field(page).fill(question);
  await expectQuestion(field(page), question);
}

async function ask(page: Page, question: string) {
  await fillQuestion(page, question);
  await field(page).press("Enter");
  await expect(answer(page, question)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("starts with what can be asked, and passes axe", async ({ page }) => {
      const problems = watchConsole(page);
      await page.goto("/ask");
      await shellReady(page);
      await expect(page.getByRole("heading", { level: 1, name: "Ask" })).toBeVisible();
      await expect(page.getByRole("list", { name: "Questions to start with" }).getByRole("button")).toHaveCount(6);
      await expect(ledger(page)).toBeVisible();
      await expect(ledger(page)).not.toContainText("Awaiting a question");
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test("an answer ties every figure to its row, and passes axe", async ({ page }) => {
      const problems = watchConsole(page);
      await page.goto("/ask");
      await shellReady(page);
      await page.getByRole("list", { name: "Questions to start with" }).getByRole("button", { name: new RegExp(EPICS.replace("?", "\\?")) }).click();
      await expect(answer(page, EPICS)).toBeVisible();
      await expect(page.getByText("Answer ready")).toBeVisible();
      await expect(page).toHaveURL(/\/ask\?q=Which(\+|%20)epics/);

      await expect(page.getByRole("button", { name: /, citation \d+$/ })).toHaveCount(8);
      // The first figure is traced as soon as the answer lands: its row tinted, the line drawn.
      await expect(ledger(page).locator("tr[data-traced]")).toHaveAttribute("data-row", "0");
      await expect(page.locator('svg[data-trace-line="1"]')).toBeAttached();
      // Go-live (SQA): no model, time taken, reference, self-praise, raw call or long hint for a project manager.
      const footer = answer(page, EPICS).locator("footer");
      await expect(footer).toContainText("Answered");
      await expect(footer).not.toContainText(/scripted|\d ms|Numbers verified|Ref /);
      await expect(ledger(page)).not.toContainText(/oversight_|SELECT /);
      await expect(page.getByText("Point at a figure to see its source.")).toBeVisible();
      await expect(page.getByText("Answer ready")).toBeVisible();

      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test("hover traces, the arrow keys step and Esc lets go", async ({ page }) => {
  await page.goto("/ask");
  await shellReady(page);
  await ask(page, EPICS);

  await value(page, "57", 6).hover();
  await expect(ledger(page).locator("tr[data-traced]")).toHaveAttribute("data-row", "1");
  await expect(page.locator('svg[data-trace-line="6"]')).toBeAttached();
  await expect(ledger(page).locator('[data-cell="F1:1:open_breaches"]')).toHaveClass(/bg-cite-tint-strong/);

  await page.mouse.move(0, 0);
  await value(page, "DEMO-704", 1).focus();
  await page.keyboard.press("ArrowRight");
  await expect(value(page, "73", 2)).toBeFocused();
  await page.keyboard.press("End");
  await expect(value(page, "54", 8)).toBeFocused();
  await expect(ledger(page).locator("tr[data-traced]")).toHaveAttribute("data-row", "2");

  await page.keyboard.press("Escape");
  await expect(ledger(page).locator("tr[data-traced]")).toHaveCount(0);
  await expect(page.locator("svg[data-trace-line]")).toHaveCount(0);
});

test("Enter asks, Shift+Enter starts a new line, and the field stops at 500 characters", async ({ page }) => {
  const asks = countAsks(page);
  await page.goto("/ask");
  await shellReady(page);

  await page.keyboard.press("/");
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("Where do tickets");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("get stuck most?");
  await expectQuestion(field(page), "Where do tickets\nget stuck most?");
  expect(asks.count).toBe(0);

  // Pasted text is cut at the cap the service plans to.
  await field(page).fill("");
  await page.keyboard.insertText("x".repeat(600));
  await expectQuestion(field(page), "x".repeat(500));
  await expect(page.getByText("Questions stop at 500 / 500")).toBeVisible();

  await fillQuestion(page, STUCK);
  await page.keyboard.press("Enter");
  await expect(answer(page, STUCK)).toBeVisible();
  expect(asks.count).toBe(1);
});

test("the field grows with the question to six lines, then scrolls with the caret in view", async ({ page }) => {
  await page.goto("/ask");
  await shellReady(page);
  await field(page).click();
  const heights: number[] = [];
  /** How much of the field lies below what it shows: none, while the caret is on its last line. */
  const below = () => field(page).evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  for (let line = 1; line <= 8; line += 1) {
    if (line > 1) {
      await page.keyboard.press("Shift+Enter");
      // The new line is in view, whole, before anything is typed on it (Chromium gives that caret no box).
      expect(await below(), `new line ${line}`).toBe(0);
    }
    await page.keyboard.type(`Line ${line}`);
    expect(await below(), `line ${line}`).toBe(0);
    heights.push(await field(page).evaluate((element) => Math.round(element.getBoundingClientRect().height)));
  }
  expect(heights).toEqual([24, 48, 72, 96, 120, 144, 144, 144]);
  const view = await field(page).evaluate((element) => {
    const caret = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { scrolled: element.scrollTop > 0, inView: caret.top >= box.top - 1 && caret.bottom <= box.bottom + 1 };
  });
  expect(view).toEqual({ scrolled: true, inView: true });
});

test("a question in the URL is prefilled and asked once", async ({ page }) => {
  const asks = countAsks(page);
  await page.goto(`/ask?q=${encodeURIComponent(EPICS)}`);
  await expect(answer(page, EPICS)).toBeVisible();
  await expect(page.getByRole("button", { name: /, citation \d+$/ })).toHaveCount(8);
  expect(asks.count).toBe(1);
});

test("a row opens where it leads, and Back shows the answer again without asking twice", async ({ page }) => {
  const asks = countAsks(page);
  await page.goto("/ask");
  await shellReady(page);
  await ask(page, EPICS);
  expect(asks.count).toBe(1);

  await ledger(page).locator('tr[data-row="1"]').click();
  await expect(page).toHaveURL(/\/findings\?(.*&)?epic=DEMO-763(&|$)/);
  await page.goBack();
  await expect(answer(page, EPICS)).toBeVisible();
  expect(asks.count).toBe(1);
});

test("the session rail goes back to an earlier answer without asking again", async ({ page }) => {
  const asks = countAsks(page);
  await page.goto("/ask");
  await shellReady(page);
  await ask(page, EPICS);
  await ask(page, STUCK);
  const session = page.getByRole("region", { name: "This session" });
  await expect(session.getByRole("button")).toHaveCount(3); // two questions and Clear
  await session.getByRole("button", { name: new RegExp(EPICS.replace("?", "\\?")) }).click();
  await expect(answer(page, EPICS)).toBeVisible();
  expect(asks.count).toBe(2);
});

const OUTCOMES = [
  { question: "Which tickets were reopened this week?", says: "Looked at" },
  { question: "Which tickets reached testing without code review?", says: "That gap is itself a finding." },
  { question: "What is the median cycle time this quarter?", says: "Only the facts are shown" },
  { question: "What is the weather?", says: "What can be asked" },
] as const;

for (const outcome of OUTCOMES) {
  test(`"${outcome.question}" gets its own calm state, not an error`, async ({ page }) => {
    await page.goto(`/ask?q=${encodeURIComponent(outcome.question)}`);
    await expect(answer(page, outcome.question)).toBeVisible();
    await expect(answer(page, outcome.question).getByText(outcome.says, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(await axeBlocking(page)).toEqual([]);
  });
}

test("a failed question is said inline, and Try again asks it again", async ({ page }) => {
  let fail = true;
  await page.route("**/api/oversight/ask", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: "upstream_unavailable", message: "The oversight service did not answer." } })
      : route.continue(),
  );
  await page.goto("/ask");
  await shellReady(page);
  await fillQuestion(page, EPICS);
  await field(page).press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn't get an answer");
  await expectQuestion(field(page), EPICS);
  expect(await axeBlocking(page)).toEqual([]);

  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(answer(page, EPICS)).toBeVisible();
});

/* ---------------------------------------------- guardrails (JO-12) -- */

test("over the service's limit on questions, the box keeps the question and says when to try again; the answer before stays", async ({ page }) => {
  const asks = countAsks(page);
  await page.goto("/ask");
  await shellReady(page);
  await ask(page, EPICS);
  // The service's limit, as the interface passes it on (contract 4.17): 429 with the contract's sentence.
  await page.route("**/api/oversight/ask", (route) =>
    route.fulfill({
      status: 429,
      headers: { "retry-after": "61" },
      json: { error: "ask_rate_limited", message: "You've asked a lot of questions in a short time. Try again in 2 minutes." },
    }),
  );
  await fillQuestion(page, STUCK);
  await field(page).press("Enter");
  const form = page.getByRole("form", { name: "Ask a question" });
  await expect(form.locator("[data-ask-notice]")).toHaveText("You've asked a lot of questions in a short time. Try again in 2 minutes.");
  await expectQuestion(field(page), STUCK);
  // Nothing was asked, so nothing failed: the answer before is still the page's, and no error took its place.
  await expect(answer(page, EPICS)).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(asks.count).toBe(2);
  expect(await axeBlocking(page)).toEqual([]);

  // Asked again once the wait is over, the line goes and the answer comes.
  await page.unroute("**/api/oversight/ask");
  await field(page).press("Enter");
  await expect(answer(page, STUCK)).toBeVisible();
  await expect(form.locator("[data-ask-notice]")).toHaveCount(0);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`an answer built without the AI model says so under it, in the muted note style (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    // The day's AI budget used up (contract 4.17): the service answers from the catalogue and sends the note.
    await page.route("**/api/oversight/ask", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...body, note: "Today's AI budget is used up, so this answer was built without the AI model." } });
    });
    await page.goto("/ask");
    await shellReady(page);
    await ask(page, EPICS);
    const note = answer(page, EPICS).locator("[data-answer-note]");
    await expect(note).toHaveText("Today's AI budget is used up, so this answer was built without the AI model.");
    expect(await axeBlocking(page)).toEqual([]);
  });
}

/* ------------------------------------------------- people level (JO-11) -- */

/*
 * At people level (the sample runs with sign-in off, as an admin would see
 * it) nothing about people is declined: a question that evaluates someone is
 * answered with figures next to the whole board's, drawn compact under the
 * words, with the caveat last; a personnel question adds that the decision is
 * the admin's. Where an organisation has turned comparison off, comparing
 * people is the one thing refused, in the contract's words. People in the
 * facts and the plan show by name and picture, never by id.
 */

interface DirectoryEntry {
  person: { id: string; name: string };
  tickets: number;
}

async function personNamed(request: APIRequestContext, name: string) {
  const directory = (await (await request.get("/api/oversight/people/directory")).json()) as { people: DirectoryEntry[] };
  return directory.people.find((entry) => entry.person.name === name)!.person;
}

async function comparisonOn(request: APIRequestContext) {
  return ((await (await request.get("/api/oversight/people/scorecard")).json()) as { comparison: string }).comparison === "on";
}

/** Ask a question about people as a link would: the words, and the people by id. */
async function askAbout(page: Page, question: string, ids: string[] = []) {
  const search = new URLSearchParams({ q: question });
  if (ids.length > 0) search.set("m", ids.join(","));
  await page.goto(`/ask?${search.toString()}`);
  await expect(answer(page, question)).toBeVisible();
}

/** No person id anywhere on the page, as text a reader sees. */
const idsOnPage = (page: Page) => page.evaluate(() => document.body.innerText.match(/\bp[0-9a-f]{12}\b/g) ?? []);

for (const colorScheme of ["light", "dark"] as const) {
  test(`"Is @Carmen Ruiz doing well?" is answered with her scorecard, compact under the words, the caveat last (${colorScheme})`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme });
    const carmen = await personNamed(request, "Carmen Ruiz");
    const question = "Is @Carmen Ruiz doing well?";
    await askAbout(page, question, [carmen.id]);
    const article = answer(page, question);
    await expect(article.getByText(/^Carmen Ruiz, last 90.*days, next to the board/)).toBeVisible();
    await expect(article.getByText(/^Figures from Jira over the last 90.*days, next to the whole board, by each ticket's current assignee\./)).toBeVisible();
    const compact = article.getByRole("table", { name: /Carmen Ruiz, last 90 days, next to the whole board/ });
    await expect(compact).toBeVisible();
    await expect(compact.getByRole("columnheader", { name: "Whole board" })).toBeVisible();
    await expect(article.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", `/people?person=${carmen.id}`);
    // The facts ledger names her (and her picture), never her id; nor does the plan.
    await expect(ledger(page).getByText("Scorecard", { exact: true })).toBeVisible();
    expect(await idsOnPage(page)).toEqual([]);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(await axeBlocking(page)).toEqual([]);
  });
}

test("a personnel question is answered with the figures, then the decision is left to the admin", async ({ page, request }) => {
  const carmen = await personNamed(request, "Carmen Ruiz");
  const question = "Should we promote @Carmen Ruiz?";
  await askAbout(page, question, [carmen.id]);
  const decision = answer(page, question).getByText("The figures are above; the decision is yours.", { exact: true });
  const figures = answer(page, question).getByRole("table", { name: /Carmen Ruiz, last 90 days/ });
  const caveat = answer(page, question).getByText(/^Figures from Jira over the last 90/);
  await expect(decision).toBeVisible();
  await expect(figures).toBeVisible();
  await expect(caveat).toBeVisible();
  // Words, then the figures, then "The figures are above", then the caveat last (the JO-11 review). Where each stands
  // is read in the page in one go, and again until it holds: a box measured element by element can come back empty in
  // WebKit while the answer settles (the JO-11 check: boundingBox() was null there).
  await expect
    .poll(() =>
      answer(page, question).evaluate((article) => {
        const top = (element: Element | undefined) => (element ? element.getBoundingClientRect().top : Number.NaN);
        const paragraphs = [...article.querySelectorAll("p")];
        const table = [...article.querySelectorAll("table")].find((element) => /Carmen Ruiz, last 90 days/.test(element.querySelector("caption")?.textContent ?? ""));
        const decided = paragraphs.find((element) => element.textContent?.trim() === "The figures are above; the decision is yours.");
        const said = paragraphs.find((element) => /^Figures from Jira over the last 90/.test(element.textContent?.trim() ?? ""));
        return [top(table) < top(decided), top(decided) < top(said)];
      }),
    )
    .toEqual([true, true]);
  expect(await idsOnPage(page)).toEqual([]);
});

test("who is best on the board: everyone in order, never called best, or the comparison-off sentence", async ({ page, request }) => {
  const question = "Who is best on the board? Rank the others";
  await askAbout(page, question);
  const article = answer(page, question);
  if (await comparisonOn(request)) {
    await expect(article.getByText(/^Measures closer to the process than the board, last 90.*days, most first: /)).toBeVisible();
    const compact = article.getByRole("table", { name: /everyone, by the measures on which each is closer/ });
    await expect(compact.locator("tbody tr")).toHaveCount(8);
    await expect(article.locator("[data-outcome] p").filter({ hasText: /\bbest\b/i })).toHaveCount(0);
  } else {
    await expect(article.getByText("Comparing people side by side is turned off. Ask about one person at a time instead.", { exact: true })).toBeVisible();
    await expect(article.getByText("Comparison turned off", { exact: true })).toBeVisible();
    // Understood and turned down, in the foot and the ledger alike: never "not understood".
    await expect(article.locator("footer")).toContainText("Turned down: comparing people is off here");
    await expect(ledger(page)).toContainText("Nothing was read. Comparing people is off.");
  }
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(await axeBlocking(page)).toEqual([]);
});

test("several people side by side, or, with comparison off, the sentence that asks for one at a time", async ({ page, request }) => {
  const ada = await personNamed(request, "Ada Brooks");
  const carmen = await personNamed(request, "Carmen Ruiz");
  const question = "How are @Ada Brooks and @Carmen Ruiz doing?";
  await askAbout(page, question, [ada.id, carmen.id]);
  const article = answer(page, question);
  if (await comparisonOn(request)) {
    const compact = article.getByRole("table", { name: /Ada Brooks, Carmen Ruiz, last 90 days/ });
    await expect(compact.getByRole("columnheader")).toHaveText(["Measure", "Ada Brooks", "Carmen Ruiz", "Whole board"]);
    // At 1440 px the whole board's figures stay in view beside both people (the JO-11 review: they were cut off), held
    // at the frame's right edge whenever the people's columns scroll.
    const edges = await compact.evaluate((table) => {
      const right = (name: string) => [...table.querySelectorAll("thead th")].find((cell) => cell.textContent?.includes(name))!.getBoundingClientRect();
      return { frame: table.closest(".jo-scroller")!.getBoundingClientRect().right, board: right("Whole board"), carmen: right("Carmen Ruiz") };
    });
    expect(edges.board.right).toBeLessThanOrEqual(edges.frame + 1);
    expect(edges.carmen.right).toBeLessThanOrEqual(edges.board.left + 2);
  } else {
    await expect(article.getByText("Comparing people side by side is turned off. Ask about one person at a time instead.", { exact: true })).toBeVisible();
  }
  expect(await idsOnPage(page)).toEqual([]);
});

test("two people asked about one measure: that measure for them beside the board, never their open breaches (the JO-12 check)", async ({ page, request }) => {
  const ada = await personNamed(request, "Ada Brooks");
  const carmen = await personNamed(request, "Carmen Ruiz");
  const question = "Time logged by @Ada Brooks and @Carmen Ruiz";
  await askAbout(page, question, [ada.id, carmen.id]);
  const article = answer(page, question);
  if (await comparisonOn(request)) {
    // The answer's words: the first prose block (the caveat is the last).
    const prose = article.locator("[data-answer-prose]").first();
    await expect(prose.getByText(/^Time logged on done work, last 90.*days, closest to the process first: /)).toBeVisible();
    await expect(prose).not.toContainText("open breaches");
    // Captioned as what it is: those two side by side, by name, never "everyone".
    await expect(article.getByText(/^Side by side, last 90 days \(F1\)$/)).toBeVisible();
    const compact = article.getByRole("table", {
      name: /^Time logged on done work, last 90 days: (Ada Brooks and Carmen Ruiz|Carmen Ruiz and Ada Brooks), closer to the process first$/,
    });
    await expect(compact.locator("tbody tr")).toHaveCount(3);
    await expect(compact.locator("tbody tr[data-board]")).toHaveCount(1);
  } else {
    await expect(article.getByText("Comparing people side by side is turned off. Ask about one person at a time instead.", { exact: true })).toBeVisible();
  }
  expect(await idsOnPage(page)).toEqual([]);
});

test("the most and the fewest: everyone in the order asked, said in the first sentence, the table, the plan and the People page's link (JO-14)", async ({ page, request }) => {
  // Regression (the JO-12 check): "Who has the most reopened tickets?" listed the fewest first.
  const cases = [
    { question: "Who has the most reopened tickets?", opening: /^Reopened after Done, last 90.*days, highest first: /, caption: "Reopened after Done, last 90 days: everyone, highest first", said: "highest first", href: "/people?sort=reopened&order=desc" },
    { question: "Who has the fewest tickets stuck in a status?", opening: /^Open tickets stuck in a status, lowest first: /, caption: "Open tickets stuck in a status, last 90 days: everyone, lowest first", said: "lowest first", href: "/people?sort=stuck_now" },
    // A count: "fewest first" in the plan too, as the answer and its table say it (the JO-14 review: the plan line
    // read "lowest first" under "Open tickets, fewest first").
    { question: "Who has the smallest backlog?", opening: /^Open tickets, fewest first: /, caption: "Open tickets: everyone, fewest first", said: "fewest first", notSaid: "lowest first", href: "/people?sort=open_tickets&order=asc" },
  ];
  for (const { question, opening, caption, said, href, notSaid } of cases as { question: string; opening: RegExp; caption: string; said: string; href: string; notSaid?: string }[]) {
    await askAbout(page, question);
    const article = answer(page, question);
    if (await comparisonOn(request)) {
      await expect(article.locator("[data-answer-prose]").first().getByText(opening)).toBeVisible();
      await expect(article.getByRole("table", { name: caption })).toBeVisible();
      await expect(ledger(page)).toContainText(said);
      if (notSaid) await expect(ledger(page)).not.toContainText(notSaid);
      await expect(article.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", href);
      // It reports the order: never "best" or "worst".
      await expect(article.locator("[data-outcome] p").filter({ hasText: /\b(?:best|worst)\b/i })).toHaveCount(0);
    } else {
      await expect(article.getByText("Comparing people side by side is turned off. Ask about one person at a time instead.", { exact: true })).toBeVisible();
    }
  }
  expect(await idsOnPage(page)).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  test("a cited figure keeps its unit on its line: no line starts with a unit (the JO-12 check)", async ({ page }) => {
    await page.goto(`/ask?q=${encodeURIComponent(STUCK)}`);
    await shellReady(page);
    const prose = answer(page, STUCK).locator("[data-answer-prose]");
    await expect(prose).toBeVisible();
    // For each figure followed by a unit symbol ("161.6 h"), where its last box and the unit stand: one line each.
    const pairs = await prose.evaluate((root) => {
      const found: { figure: string; unit: string; apart: number }[] = [];
      for (const button of root.querySelectorAll<HTMLElement>("[data-marker]")) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        walker.currentNode = button;
        let node = walker.nextNode();
        while (node && (button.contains(node) || node.parentElement?.closest("[hidden]"))) node = walker.nextNode();
        const unit = node?.textContent ? /^\s?(h|d|pts?|×|%)(?![\p{L}\p{N}_])/u.exec(node.textContent) : null;
        if (!node || !unit) continue;
        const range = document.createRange();
        range.setStart(node, unit.index + unit[0].length - unit[1].length);
        range.setEnd(node, unit.index + unit[0].length);
        const figure = [...button.querySelector("[data-bound-text]")!.getClientRects()].at(-1)!;
        const after = range.getBoundingClientRect();
        found.push({ figure: button.textContent ?? "", unit: unit[1], apart: Math.abs((after.top + after.bottom) / 2 - (figure.top + figure.bottom) / 2) });
      }
      return found;
    });
    expect(pairs.length).toBeGreaterThanOrEqual(4); // two medians and two p90s, in hours
    for (const pair of pairs) expect(pair.apart, `${pair.figure} ${pair.unit}`).toBeLessThan(6);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test("a comparison by a rate fits its frame, the people asked about or everyone: each mark its icon (the JO-12 check)", async ({ page, request }) => {
    test.skip(!(await comparisonOn(request)), "this server has comparison turned off");
    // Regression: "Next to the board" was cut at the frame's edge (a 401 px table in a 324 px frame).
    const ada = await personNamed(request, "Ada Brooks");
    const carmen = await personNamed(request, "Carmen Ruiz");
    for (const [question, ids] of [["Time logged by @Ada Brooks and @Carmen Ruiz", [ada.id, carmen.id]], ["Who reopens the most work?", []]] as const) {
      await askAbout(page, question, [...ids]);
      const table = answer(page, question).locator("[data-compact-comparison]");
      await expect(table).toBeVisible();
      const fit = await table.evaluate((element) => ({ table: element.scrollWidth, frame: element.closest(".jo-scroller")!.getBoundingClientRect().width }));
      expect(fit.table, question).toBeLessThanOrEqual(fit.frame + 0.5);
      await expect(table.locator("[data-mark-cell] [data-mark]:visible").first()).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`everyone in order fits its frame: each mark heads its column as its icon, which the key names (the JO-12 check; ${colorScheme})`, async ({ page, request }) => {
      test.skip(!(await comparisonOn(request)), "this server has comparison turned off");
      await page.emulateMedia({ colorScheme });
      // Regression: the overall comparison's five columns were a 402 px table in a 324 px frame, "Findings per 10" cut.
      const question = "Who is best on the board? Rank the others.";
      await askAbout(page, question);
      const table = answer(page, question).locator("[data-compact-comparison]");
      await expect(table).toBeVisible();
      const fit = await table.evaluate((element) => ({ table: element.scrollWidth, frame: element.closest(".jo-scroller")!.getBoundingClientRect().width }));
      expect(fit.table).toBeLessThanOrEqual(fit.frame + 0.5);
      for (const name of ["Closer to the process", "Level with the board", "Further from the process"]) {
        await expect(table.getByRole("columnheader", { name })).toBeVisible();
      }
      await expect(table.getByRole("columnheader", { name: "Findings per 10" })).toBeVisible();
      await expect(answer(page, question).getByText("Closer to the process", { exact: true }).last()).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });

    test(`the comparison never moves the page sideways, and one person's scorecard fits its frame, the whole name shown (${colorScheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme });
      if (await comparisonOn(request)) {
        // The JO-11 check: a visually hidden count in the overall table widened the page by 73 px.
        const everyone = "Who is best on the board? Rank the others.";
        await askAbout(page, everyone);
        await expect(answer(page, everyone).locator("[data-compact-comparison]")).toBeVisible();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        await page.evaluate(() => window.scrollTo(200, 0));
        expect(await page.evaluate(() => window.scrollX)).toBe(0);
      }
      // One person: their figures and the board's beside the measure, inside the frame; the name wraps, never cut.
      const carmen = await personNamed(request, "Carmen Ruiz");
      const question = "Should we let @Carmen Ruiz go?";
      await askAbout(page, question, [carmen.id]);
      const compact = answer(page, question).locator("[data-compact-scorecard]");
      await expect(compact).toBeVisible();
      const fit = await compact.evaluate((table) => {
        const frame = table.closest(".jo-scroller")!.getBoundingClientRect();
        const reasons = [...table.querySelectorAll('tr[data-measurable="false"] td')].map((cell) => cell.getBoundingClientRect().right);
        return { table: table.scrollWidth, frame: frame.width, overhang: Math.max(0, ...reasons.map((right) => right - frame.right)) };
      });
      expect(fit.table).toBeLessThanOrEqual(fit.frame);
      // The reasons a measure is not measurable read whole within the frame, not cut mid-word until scrolled.
      expect(fit.overhang).toBeLessThanOrEqual(0.5);
      expect(await compact.locator('thead [title="Carmen Ruiz"]').evaluate((name) => name.scrollWidth - name.clientWidth)).toBeLessThanOrEqual(0);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });

    test(`several people stack, one compact card each, every figure inside its frame (the JO-11 check, G6; ${colorScheme})`, async ({ page, request }) => {
      test.skip(!(await comparisonOn(request)), "this server has comparison turned off");
      await page.emulateMedia({ colorScheme });
      const ada = await personNamed(request, "Ada Brooks");
      const carmen = await personNamed(request, "Carmen Ruiz");
      const question = "How are @Ada Brooks and @Carmen Ruiz doing?";
      await askAbout(page, question, [ada.id, carmen.id]);
      const article = answer(page, question);
      // The side-by-side table is for a wider column: here, a card per person, in the facts' order.
      await expect(article.locator("[data-compact-scorecard]")).toBeHidden();
      const cards = article.locator("[data-compact-card]");
      await expect(cards).toHaveCount(2);
      for (const [index, name] of ["Ada Brooks", "Carmen Ruiz"].entries()) {
        const card = cards.nth(index);
        await expect(card).toBeVisible();
        await expect(card.getByRole("columnheader")).toHaveText(["Measure", name, "Whole board"]);
        const fit = await card.evaluate((table) => ({ table: table.scrollWidth, frame: table.closest(".jo-scroller")!.getBoundingClientRect().width }));
        expect(fit.table, name).toBeLessThanOrEqual(fit.frame);
      }
      // What the board cannot show, once, whole, under the cards.
      const unmeasured = article.getByRole("list", { name: "Not measurable on this board" });
      await expect(unmeasured).toBeVisible();
      await expect(unmeasured.getByRole("listitem")).toHaveCount(1);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});

test("someone's backlog: their open tickets, the assignee by name and picture in the facts, never an id", async ({ page, request }) => {
  const carmen = await personNamed(request, "Carmen Ruiz");
  const question = "What is @Carmen Ruiz's backlog?";
  await askAbout(page, question, [carmen.id]);
  await expect(answer(page, question).getByText(/^Carmen Ruiz has \d+.*open tickets?/)).toBeVisible();
  const table = ledger(page).getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Assignee" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Person id" })).toHaveCount(0);
  await expect(table.locator("tbody tr").first().locator(".jo-avatar")).toBeVisible();
  // The call, in words, names her with her picture.
  await expect(ledger(page).locator("p", { hasText: "Carmen Ruiz" }).first().locator(".jo-avatar")).toBeVisible();
  expect(await idsOnPage(page)).toEqual([]);
  expect(await axeBlocking(page)).toEqual([]);
});
