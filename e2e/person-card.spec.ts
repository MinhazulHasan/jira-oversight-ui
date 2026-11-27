import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expectQuestion, questionBox, questionText } from "./question";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BREACH_ID = "0b7b3b0f61c477e61699982f24892735";
const CARD = /\/api\/oversight\/people\/p[0-9a-f]{12}\/card(\?.*)?$/;

interface Person {
  id: string;
  name: string;
  avatar: string | null;
}

/** axe's landmark rules (best practice, not run with the WCAG tags): a card must add no landmark the page already has. */
async function landmarkProblems(page: Page) {
  const results = await new AxeBuilder({ page })
    .withRules(["landmark-no-duplicate-banner", "landmark-no-duplicate-contentinfo", "landmark-unique", "landmark-banner-is-top-level", "landmark-contentinfo-is-top-level"])
    .analyze();
  return results.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, speed = 600, bow = 0) {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const control = { x: (from.x + to.x) / 2 - (2 * bow * (to.y - from.y)) / chord, y: (from.y + to.y) / 2 + (2 * bow * (to.x - from.x)) / chord };
  const along = (t: number) => ({
    x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x,
    y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y,
  });
  // The curve measured in fine steps, so the pointer keeps its speed along it.
  const STEPS = 200;
  const lengths = [0];
  for (let i = 1; i <= STEPS; i += 1) {
    const [a, b] = [along((i - 1) / STEPS), along(i / STEPS)];
    lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = lengths[STEPS];
  const started = Date.now();
  for (;;) {
    const travelled = Math.min(length, ((Date.now() - started) / 1000) * speed);
    const i = Math.max(1, lengths.findIndex((sum) => sum >= travelled));
    const point = along((i - 1 + (travelled - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1)) / STEPS);
    await page.mouse.move(point.x, point.y);
    if (travelled >= length) return;
    await page.waitForTimeout(16);
  }
}

/** The middle of an element on the screen. */
async function middle(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function axeBlocking(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  const results = await (include ? builder.include(include) : builder).analyze();
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

/** The reads of person cards a page makes, by person id. */
function watchCards(page: Page): string[] {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (CARD.test(request.url())) reads.push(new URL(request.url()).pathname.split("/")[4]);
  });
  return reads;
}

async function holders(request: APIRequestContext): Promise<Person[]> {
  const body = (await (await request.get("/api/oversight/people")).json()) as { people: { person: Person | null }[] };
  return body.people.flatMap((row) => (row.person ? [row.person] : []));
}

/** A name that opens a card (a button that says it opens a dialog). */
const nameIn = (scope: Locator | Page, name: string) => scope.locator(`[data-person-card-trigger]`).filter({ hasText: name }).first();
/** The open card, by whose it is. */
const cardOf = (page: Page, name: string) => page.getByRole("dialog", { name });
/** Waits for the card's figures. */
const ready = (card: Locator) => expect(card.locator("[data-person-card]")).toHaveAttribute("data-card-state", "ready");
const placed = (card: Locator) =>
  expect
    .poll(async () => {
      const box = await card.boundingBox();
      return box !== null && box.x >= 0 && box.y >= 0;
    })
    .toBe(true);

/** The questions the page asks: each POST /ask body. */
function watchAsks(page: Page): unknown[] {
  const bodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/oversight/ask")) bodies.push(request.postDataJSON());
  });
  return bodies;
}

function whereIs(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}?${[...url.searchParams].map(([key, value]) => `${key}=${value}`).join("&")}`;
}

/** The shell is live (it draws the sync time once hydrated): typing waits for it, or hydration could take back what was typed. */
async function shellReady(page: Page) {
  await expect(page.getByRole("banner").locator("[data-sync-now]").filter({ hasText: / ago/ })).toBeVisible();
}

/** Ask with "Is @<lead> on track?" typed in its box, the person picked from the @ list: their chip in the question. */
async function askWithChip(page: Page, lead: Person): Promise<Locator> {
  await page.goto("/ask");
  await shellReady(page);
  const box = questionBox(page);
  await box.click();
  await page.keyboard.type("Is @");
  await page.keyboard.type(lead.name.split(" ").at(-1)!.toLowerCase());
  await expect(page.getByRole("listbox", { name: "People to mention" }).getByRole("option").first()).toContainText(lead.name);
  await page.keyboard.press("Enter");
  await page.keyboard.type("on track?");
  await expectQuestion(box, `Is @${lead.name} on track?`);
  return box.locator(`[data-chip][data-mentioned="${lead.id}"]`);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
});

test.describe("on a desktop", () => {
  test("resting on a name opens its card after 350 ms and reads it once; it stays from the name to the card, and closes after both", async ({ page }) => {
    const problems = watchConsole(page);
    const reads = watchCards(page);
    await page.goto("/people");
    const table = page.getByRole("table", { name: /Everyone with tickets/ });
    const name = table.locator("[data-person-card-trigger]").first();
    await expect(name).toBeVisible();
    const who = (await name.locator("[data-person-name]").textContent())!.trim();

    // A pass of the pointer opens nothing and reads nothing.
    const at = (await name.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(reads).toEqual([]);

    // Resting on it: the card, not before 350 ms after the pointer arrived (timed in the page, where it happens), read once.
    await name.evaluate((element) => {
      const times = { entered: 0, opened: 0 };
      (window as unknown as { cardTimes: typeof times }).cardTimes = times;
      element.addEventListener("pointerenter", () => (times.entered ||= performance.now()));
      new MutationObserver(() => {
        if (!times.opened && document.querySelector('[role="dialog"]')) times.opened = performance.now();
      }).observe(document.body, { childList: true, subtree: true });
    });
    await name.hover();
    const card = cardOf(page, who);
    await expect(card).toBeVisible();
    const times = await page.evaluate(() => (window as unknown as { cardTimes: { entered: number; opened: number } }).cardTimes);
    expect(times.entered).toBeGreaterThan(0);
    expect(times.opened - times.entered).toBeGreaterThanOrEqual(340);
    await ready(card);
    expect(reads).toHaveLength(1);
    await expect(name).toHaveAttribute("aria-expanded", "true");
    // A hover card leaves focus where it was.
    await expect(card).not.toBeFocused();

    // From the name onto the card, and about on it: it stays.
    await placed(card);
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.waitForTimeout(400);
    await expect(card).toBeVisible();
    // Off both: gone.
    await page.mouse.move(5, 5);
    await expect(card).toBeHidden();

    // Back within the minute: the card again, from what was read.
    await name.hover();
    await expect(cardOf(page, who)).toBeVisible();
    expect(reads).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  test("a press pins the card with focus inside; Escape closes it and gives focus back to the name; Space and Enter too", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto(`/people?person=${lead.id}`);
    const heading = page.locator("[data-scorecard]").getByRole("heading", { name: lead.name });
    const name = heading.getByRole("button", { name: lead.name });
    await name.click();
    const card = cardOf(page, lead.name);
    await expect(card).toBeVisible();
    await expect(card).toBeFocused();
    await ready(card);
    // Pinned: the pointer leaving does not close it, and it has a close button.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
    // Tab moves through the card's links.
    await page.keyboard.press("Tab");
    await expect(card.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(name).toBeFocused();

    // The keyboard alone: Enter pins it, Escape gives focus back; Space pins it too.
    await page.keyboard.press("Enter");
    await expect(cardOf(page, lead.name)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(name).toBeFocused();
    await page.keyboard.press(" ");
    await expect(cardOf(page, lead.name)).toBeFocused();
    // A press on the page outside closes it, and focus goes back to the name.
    await page.locator("main h1").click();
    await expect(cardOf(page, lead.name)).toBeHidden();
    await expect(name).toBeFocused();
  });

  test("one card at a time: a pinned card holds over other names, and a press on another name moves the card to it", async ({ page, request }) => {
    const [first, second] = await holders(request);
    await page.goto("/");
    const list = page.getByRole("list", { name: "Open findings by person" });
    await nameIn(list, first.name).click();
    await expect(cardOf(page, first.name)).toBeVisible();
    await nameIn(list, second.name).hover();
    await page.waitForTimeout(700);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(cardOf(page, second.name)).toHaveCount(0);
    await nameIn(list, second.name).click();
    await expect(cardOf(page, second.name)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("nothing moves while the card's figures load: the skeleton is the card's own size", async ({ page, request }) => {
    const [lead] = await holders(request);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(CARD, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`/people?person=${lead.id}`);
    await page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name }).click();
    const card = cardOf(page, lead.name);
    await expect(card.locator("[data-person-card]")).toHaveAttribute("data-card-state", "loading");
    await placed(card);
    const before = (await card.boundingBox())!;
    const sections = async () =>
      card.evaluate((element) =>
        [...element.querySelectorAll("[data-card-tiles], [data-card-findings], [data-card-process], [data-card-working], [data-card-boards], [data-card-actions]")].map((node) => {
          const rect = node.getBoundingClientRect();
          return [Math.round(rect.top), Math.round(rect.height)];
        }),
      );
    const loading = await sections();
    release();
    await ready(card);
    const after = (await card.boundingBox())!;
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
    expect(await sections()).toEqual(loading);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`the open card passes axe, says its figures plainly and leads on (${colorScheme})`, async ({ page, request }) => {
      // Three axe passes: the card, the page, and the page's landmarks with the card open (WebKit takes its time).
      test.slow();
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const [lead] = await holders(request);
      await page.goto(`/people?person=${lead.id}`);
      await page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name }).click();
      const card = cardOf(page, lead.name);
      await ready(card);
      await expect(card.locator("[data-card-line]")).toHaveText(/^([\d,]+ open tickets? on Demo project|No open tickets on Demo project)$/);
      await expect(card.getByRole("heading", { name: "Open findings on their tickets" })).toBeVisible();
      await expect(card.locator("[data-tile]")).toHaveCount(3);
      await expect(card.getByText("Process, last 90 days")).toBeVisible();
      await expect(card.getByRole("link", { name: "View scorecard" })).toHaveAttribute("href", `/people?person=${lead.id}`);
      await expect(card.getByRole("link", { name: "Open findings" })).toHaveAttribute("href", `/findings?person=${lead.id}`);
      await expect(card.getByRole("link", { name: `Ask about ${lead.name.split(" ")[0]}` })).toHaveAttribute("href", `/ask?about=${lead.id}`);
      // The card is 340 px wide and lies inside the window.
      await placed(card);
      const box = (await card.boundingBox())!;
      expect(Math.round(box.width)).toBe(340);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      await expect(card.locator("[data-card-ticket]").first()).toBeVisible();
      const clipped = await card.evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
          const style = getComputedStyle(element);
          const clips = [style.overflowX, style.overflowY].some((overflow) => overflow === "hidden" || overflow === "clip");
          const box = element.getBoundingClientRect();
          if (!clips || box.width < 2 || !element.textContent?.trim()) return [];
          const size = parseFloat(style.fontSize);
          const line = style.lineHeight === "normal" ? size * 1.2 : parseFloat(style.lineHeight);
          return line + 0.01 < size * 1.2 ? [`${element.textContent.trim().slice(0, 24)}: ${line}px for ${size}px type`] : [];
        }),
      );
      expect(clipped).toEqual([]);
      // Never an email address, an account id, a time zone or a picture's address.
      expect(await card.innerHTML()).not.toMatch(/acc-\d|accountId|emailAddress|timeZone|atl-paas|gravatar|@[a-z]+\.[a-z]/i);
      expect(await axeBlocking(page, "[data-person-card]")).toEqual([]);
      expect(await axeBlocking(page)).toEqual([]);
      // Best practice too: the card adds no second banner and no content-information landmark to the page.
      expect(await landmarkProblems(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("a member who holds none of the board's tickets, from Ask's answer: said so, nothing to compare, no findings to open", async ({ page }) => {
    const members = ((await (await page.request.get("/api/oversight/people/directory")).json()) as { people: { person: Person; tickets: number }[] }).people;
    const noor = members.find((entry) => entry.tickets === 0)!.person;
    const question = `Is @${noor.name} working on anything?`;
    await page.goto(`/ask?${new URLSearchParams({ q: question, m: noor.id })}`);
    const pill = page.locator("[data-answer-prose]").locator(`[data-person-mention="${noor.id}"]`);
    await expect(pill).toBeVisible();
    await pill.click();
    const card = cardOf(page, noor.name);
    await ready(card);
    await expect(card.locator("[data-card-line]")).toHaveText("Member of Demo project · no tickets");
    await expect(card.locator('[data-card-process="none"]')).toContainText("Nothing to compare: no tickets on this board.");
    await expect(card.getByRole("link", { name: "Open findings" })).toHaveCount(0);
    expect(await axeBlocking(page, "[data-person-card]")).toEqual([]);
  });

  test("Ask about someone puts their chip in the question box, the caret after it, and asks nothing", async ({ page, request }) => {
    const [lead] = await holders(request);
    const asks: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "POST" && sent.url().endsWith("/api/oversight/ask")) asks.push(sent.url());
    });
    await page.goto(`/people?person=${lead.id}`);
    await page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name }).click();
    const card = cardOf(page, lead.name);
    await ready(card);
    await card.getByRole("link", { name: `Ask about ${lead.name.split(" ")[0]}` }).click();
    await expect(page).toHaveURL(/\/ask$/);
    const box = questionBox(page);
    await expect(box.locator(`[data-chip][data-mentioned="${lead.id}"]`)).toBeVisible();
    await expect(box).toBeFocused();
    await page.keyboard.type("is working on what?");
    await expect(box).toContainText("is working on what?");
    expect(asks).toEqual([]);
  });

  test("a chip in the question box: a click opens and pins its card, the question untouched; Escape, the caret just after the chip; Enter asks", async ({
    page,
    request,
  }) => {
    const problems = watchConsole(page);
    const asks = watchAsks(page);
    const [lead] = await holders(request);
    const chip = await askWithChip(page, lead);
    const box = questionBox(page);

    // A click on the chip: the card opens anchored to it, pinned, with focus inside; the question is as it was.
    await chip.click();
    const card = cardOf(page, lead.name);
    await expect(card).toBeVisible();
    await expect(card).toBeFocused();
    await ready(card);
    await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
    await placed(card);
    const at = (await chip.boundingBox())!;
    const where = (await card.boundingBox())!;
    expect(where.y).toBeGreaterThanOrEqual(at.y + at.height);
    expect(where.y - (at.y + at.height)).toBeLessThanOrEqual(12);
    expect(Math.abs(where.x - at.x)).toBeLessThanOrEqual(1);
    expect(await questionText(box)).toBe(`Is @${lead.name} on track?`);
    await expect(chip).toHaveCount(1);
    await expect(chip).not.toHaveAttribute("data-selected", /.*/);
    expect(await axeBlocking(page, "[data-person-card]")).toEqual([]);

    // Escape: the card closes, the box has focus again, and the caret is just after the chip: what is typed goes there.
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(box).toBeFocused();
    await page.keyboard.type(", today,");
    await expectQuestion(box, `Is @${lead.name}, today, on track?`);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Enter asks, the chip's person going with the question by id.
    expect(asks).toEqual([]);
    await page.keyboard.press("Enter");
    await expect.poll(() => asks.length).toBe(1);
    expect(asks[0]).toEqual({ question: `Is @${lead.name}, today, on track?`, mentions: [lead.id] });
    expect(problems).toEqual([]);
  });

  test("a chip's card closes on a click back in the text, the caret where the click was; a click on the chip again closes it too", async ({ page, request }) => {
    const [lead] = await holders(request);
    const chip = await askWithChip(page, lead);
    const box = questionBox(page);

    // A click at the end of the text: closed, and the caret is where the click put it.
    await chip.click();
    const card = cardOf(page, lead.name);
    await expect(card).toBeFocused();
    const words = box.locator("[data-run]").filter({ hasText: "on track?" });
    const end = (await words.boundingBox())!;
    await page.mouse.click(end.x + end.width - 1, end.y + end.height / 2);
    await expect(card).toBeHidden();
    await expect(box).toBeFocused();
    await page.keyboard.type(" Really");
    await expectQuestion(box, `Is @${lead.name} on track? Really`);

    await chip.click();
    await expect(card).toBeFocused();
    await chip.click();
    await expect(card).toBeHidden();
    await expect(box).toBeFocused();
    await page.keyboard.press("Space");
    await expectQuestion(box, `Is @${lead.name}  on track? Really`);
    await page.keyboard.press("Backspace");
    await expectQuestion(box, `Is @${lead.name} on track? Really`);
    await page.keyboard.press("Backspace");
    await expectQuestion(box, "Is  on track? Really");
    await expect(chip).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("keys pressed in a pinned card never change the question: a chip's card, and a pill's after typing in the box", async ({ page, request }) => {
    const asks = watchAsks(page);
    const [lead] = await holders(request);
    const chip = await askWithChip(page, lead);
    const box = questionBox(page);
    const question = `Is @${lead.name} on track?`;
    /** Whether a caret or a selection is still in the box, where Safari would type. */
    const caretInBox = () => box.evaluate((root) => {
      const selection = getSelection();
      return selection !== null && selection.rangeCount > 0 && root.contains(selection.anchorNode);
    });
    await chip.click();
    const card = cardOf(page, lead.name);
    await expect(card).toBeFocused();
    await ready(card);
    expect(await caretInBox()).toBe(false);
    for (const key of ["x", "y", "Space", "Backspace", "Delete", "Enter", "Shift+Enter"]) await page.keyboard.press(key);
    expect(await questionText(box)).toBe(question);
    await expect(chip).toHaveCount(1);
    await expect(card).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("a");
    expect(await questionText(box)).toBe(question);
    // Escape gives the caret back just after the chip, as ever, and typing lands there.
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(box).toBeFocused();
    await page.keyboard.type(", today,");
    await expectQuestion(box, `Is @${lead.name}, today, on track?`);
    expect(asks).toEqual([]);

    // An answer's pill, with a question typed in the box first.
    const asked = "Who has the most open breaches?";
    await page.goto(`/ask?q=${encodeURIComponent(asked)}`);
    const pill = page.locator("[data-answer-prose]").locator(`[data-person-mention="${lead.id}"]`).first();
    await expect(pill).toBeVisible();
    await box.click();
    await page.keyboard.type("Draft");
    await expectQuestion(box, "Draft");
    await pill.click();
    const pinned = cardOf(page, lead.name);
    await expect(pinned).toBeFocused();
    expect(await caretInBox()).toBe(false);
    for (const key of ["x", "y", "Enter", "Backspace"]) await page.keyboard.press(key);
    expect(await questionText(box)).toBe("Draft");
    await page.keyboard.press("Escape");
    await expect(pinned).toBeHidden();
    await expect(pill).toBeFocused();
    // The one question asked is the address's: nothing pressed in a card asked another.
    expect(asks).toHaveLength(1);
  });

  test("Ask about from a card on the Ask page: the person joins the question being written, the answer and the address stay", async ({ page, request }) => {
    const asks = watchAsks(page);
    const [lead] = await holders(request);
    const first = lead.name.split(" ")[0];
    const asked = "Who has the most open breaches?";
    await page.goto(`/ask?q=${encodeURIComponent(asked)}`);
    const prose = page.locator("[data-answer-prose]");
    const pill = prose.locator(`[data-person-mention="${lead.id}"]`).first();
    await expect(pill).toBeVisible();
    const address = whereIs(page);
    const box = questionBox(page);
    await box.click();
    await page.keyboard.type("Why so many warnings?");

    // From the answer's pill.
    await pill.click();
    await ready(cardOf(page, lead.name));
    await cardOf(page, lead.name).getByRole("link", { name: `Ask about ${first}` }).click();
    await expect(cardOf(page, lead.name)).toBeHidden();
    await expectQuestion(box, `Why so many warnings? @${lead.name} `);
    await expect(box).toBeFocused();
    await expect(prose).toBeVisible();
    expect(whereIs(page)).toBe(address);
    await expect(page.getByText(`${lead.name} is in the question. Press Enter to ask.`)).toBeVisible();

    // From the facts ledger, the same person: no second chip; the caret just after theirs.
    const facts = page.getByRole("complementary", { name: "Sources" });
    await facts.locator("[data-person-card-trigger]").filter({ hasText: lead.name }).first().hover();
    await ready(cardOf(page, lead.name));
    await cardOf(page, lead.name).getByRole("link", { name: `Ask about ${first}` }).click();
    await expect(page.getByText(`${lead.name} is already mentioned.`)).toBeVisible();
    await expect(box.locator("[data-chip]")).toHaveCount(1);
    await expect(box).toBeFocused();
    await page.keyboard.type(", today,");
    await expectQuestion(box, `Why so many warnings? @${lead.name}, today, `);

    // From the chip's own card: still one chip.
    const chip = box.locator(`[data-chip][data-mentioned="${lead.id}"]`);
    await chip.click();
    await ready(cardOf(page, lead.name));
    await cardOf(page, lead.name).getByRole("link", { name: `Ask about ${first}` }).click();
    await expect(box.locator("[data-chip]")).toHaveCount(1);
    await expect(box).toBeFocused();
    await page.keyboard.type(" now");
    await expectQuestion(box, `Why so many warnings? @${lead.name} now, today, `);
    await expect(prose).toBeVisible();
    expect(whereIs(page)).toBe(address);
    expect(asks).toHaveLength(1);
  });

  test("typing never opens a card: a chip drawn under a resting pointer opens nothing until the pointer moves", async ({ page, request }) => {
    const reads = watchCards(page);
    const [lead] = await holders(request);
    await page.goto("/ask");
    await shellReady(page);
    const box = questionBox(page);
    await box.click();
    // The pointer comes to rest where the chip will be drawn: at the start of the question's first line.
    const field = (await box.boundingBox())!;
    await page.mouse.move(field.x + 24, field.y + 12);
    await page.keyboard.type("@");
    await page.keyboard.type(lead.name.split(" ").at(-1)!.toLowerCase());
    await expect(page.getByRole("listbox", { name: "People to mention" }).getByRole("option").first()).toContainText(lead.name);
    await page.keyboard.press("Enter");
    const chip = box.locator(`[data-chip][data-mentioned="${lead.id}"]`);
    await expect(chip).toBeVisible();
    const under = (await chip.boundingBox())!;
    expect(field.x + 24).toBeGreaterThan(under.x);
    expect(field.x + 24).toBeLessThan(under.x + under.width);
    await page.keyboard.type("is on track?");
    await page.waitForTimeout(900);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(reads).toEqual([]);
    // Moved, the pointer is a hover like any other: the card after the wait.
    await page.mouse.move(field.x + 26, field.y + 12);
    await expect(cardOf(page, lead.name)).toBeVisible();
    await expect(box).toBeFocused();
  });
});

test.describe("every surface that names someone opens their card", () => {
  test("the Overview's open findings by person: the name opens the card, the row still opens their findings", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto("/");
    const list = page.getByRole("list", { name: "Open findings by person" });
    await nameIn(list, lead.name).hover();
    await ready(cardOf(page, lead.name));
    await page.mouse.move(5, 5);
    await expect(cardOf(page, lead.name)).toBeHidden();
    await list.getByRole("link", { name: new RegExp(`^${lead.name}: `) }).click();
    await expect(page).toHaveURL(new RegExp(`/findings\\?state=open&person=${lead.id}$`));
  });

  test("Findings: the Assignee column, the Person filter's chosen person, and the drawer's assignee", async ({ page }) => {
    // Three pages and a dozen steps: about 12 s in WebKit alone, past 30 s when the machine is busy.
    test.slow();
    const reads = watchCards(page);
    await page.goto("/findings");
    const firstAssignee = page.locator("table tbody [data-person-card-trigger]").first();
    await expect(firstAssignee).toBeVisible();
    const who = (await firstAssignee.locator("[data-person-name]").textContent())!.trim();
    await firstAssignee.hover();
    await ready(cardOf(page, who));
    // Pressing the name pins its card; the row's drawer stays shut.
    await firstAssignee.click();
    await expect(cardOf(page, who)).toBeFocused();
    await expect(page).not.toHaveURL(/finding=/);
    // Nothing pressed in the card reaches the row under the name (its drawer): a press on the card, then a link.
    await ready(cardOf(page, who));
    await cardOf(page, who).locator("[data-card-tiles]").click();
    await expect(cardOf(page, who)).toBeVisible();
    await expect(page).not.toHaveURL(/finding=/);
    await cardOf(page, who).getByRole("link", { name: "View scorecard" }).click();
    await expect(page).toHaveURL(/\/people\?person=p[0-9a-f]{12}$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/findings$/);

    const id = reads[0];
    await page.goto(`/findings?person=${id}`);
    const chosen = page.locator("[data-person-filter-name]");
    await expect(chosen).toHaveText(who);
    await chosen.hover();
    await ready(cardOf(page, who));
    // The filter's own press is still the filter's: it opens the Person menu.
    await page.getByRole("button", { name: `Person ${who}` }).click();
    await expect(page.getByRole("listbox", { name: "Person" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto(`/findings?finding=${BREACH_ID}`);
    const drawer = page.getByRole("dialog", { name: "Work started without an estimate" });
    await expect(drawer).toBeVisible();
    const assignee = drawer.locator("[data-person-card-trigger]");
    const drawn = (await assignee.textContent())!.trim();
    await assignee.click();
    const card = cardOf(page, drawn);
    await expect(card).toBeFocused();
    await ready(card);
    // Escape closes the card, not the drawer under it.
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(assignee).toBeFocused();
  });

  test("People: the table's names and the scorecard's heading", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto("/people");
    const table = page.getByRole("table", { name: /Everyone with tickets/ });
    await nameIn(table, lead.name).click();
    await ready(cardOf(page, lead.name));
    // The row's own press is still the row's: its scorecard opens below.
    await page.keyboard.press("Escape");
    await table.getByRole("row").filter({ hasText: lead.name }).locator("td").nth(2).click();
    await expect(page).toHaveURL(new RegExp(`person=${lead.id}`));
    await page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name }).hover();
    await ready(cardOf(page, lead.name));
  });

  test("Ask: the answer's pills, the facts table and the question's chips", async ({ page, request }) => {
    const [lead] = await holders(request);
    const question = "Who has the most open breaches?";
    await page.goto(`/ask?q=${encodeURIComponent(question)}`);
    const pill = page.locator("[data-answer-prose]").locator(`[data-person-mention="${lead.id}"]`).first();
    await expect(pill).toBeVisible();
    await pill.hover();
    await ready(cardOf(page, lead.name));
    await page.mouse.move(5, 5);
    await expect(cardOf(page, lead.name)).toBeHidden();

    const facts = page.getByRole("complementary", { name: "Sources" });
    const cell = facts.locator("[data-person-card-trigger]").filter({ hasText: lead.name }).first();
    await cell.hover();
    await ready(cardOf(page, lead.name));
    await page.mouse.move(5, 5);
    await expect(cardOf(page, lead.name)).toBeHidden();

    await page.goto(`/ask?about=${lead.id}`);
    const chip = questionBox(page).locator(`[data-chip][data-mentioned="${lead.id}"]`);
    await expect(chip).toBeVisible();
    await chip.hover();
    await ready(cardOf(page, lead.name));
    // The question keeps its focus: a hover card is looked at, not stepped into.
    await expect(questionBox(page)).toBeFocused();
  });

  test("Ask's everyone in order: each name opens the card, from the keyboard too", async ({ page }) => {
    const question = "Who is best on the board? Rank the others.";
    await page.goto(`/ask?q=${encodeURIComponent(question)}`);
    const table = page.locator("[data-compact-comparison]");
    await expect(table).toBeVisible();
    const name = table.locator("[data-person-card-trigger]").first();
    const who = (await name.locator("[data-person-name]").textContent())!.trim();
    await name.click();
    const card = cardOf(page, who);
    await expect(card).toBeFocused();
    await ready(card);
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(name).toBeFocused();
  });

  test("the ticket page's assignee: resting on it opens the card; a press still opens their findings", async ({ page }) => {
    await page.goto("/issues/DEMO-1");
    const link = page.getByRole("link", { name: /: show their open findings$/ });
    const who = (await link.locator("[data-assignee-name]").textContent())!.trim();
    await link.hover();
    await ready(cardOf(page, who));
    await page.mouse.move(5, 5);
    await expect(cardOf(page, who)).toBeHidden();
    await link.click();
    await expect(page).toHaveURL(/\/findings\?person=p[0-9a-f]{12}$/);
  });

  test("Governance: the access log's people open their card on hover and from the keyboard, a press on the name still filters", async ({ page }) => {
    // Two pages, a card twice and axe on it (WebKit takes its time).
    test.slow();
    await page.goto("/governance/access-log");
    const table = page.getByRole("table", { name: "Access log" });
    const pill = table.getByRole("button", { name: "Ada Brooks", exact: true }).first();
    await expect(pill).toBeVisible();
    await pill.hover();
    await ready(cardOf(page, "Ada Brooks"));
    await page.mouse.move(5, 5);
    await expect(cardOf(page, "Ada Brooks")).toBeHidden();
    // The picture is the card's own button: Enter pins the card, Escape gives focus back to it.
    const picture = table.getByRole("button", { name: "Ada Brooks's card" }).first();
    await picture.focus();
    await page.keyboard.press("Enter");
    const card = cardOf(page, "Ada Brooks");
    await expect(card).toBeFocused();
    await ready(card);
    expect(await axeBlocking(page, "[data-person-card]")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(picture).toBeFocused();
    await pill.click();
    await expect(page).toHaveURL(/person=p[0-9a-f]{12}/);
    await page.goto("/governance/access-log?action=person_card_view");
    await expect(table.getByRole("row").nth(1)).toContainText("Viewed a person card");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`a tap opens the same card as a bottom sheet, and it passes axe (${colorScheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const [lead] = await holders(request);
      await page.goto(`/people?person=${lead.id}`);
      const name = page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name });
      await name.tap();
      const sheet = cardOf(page, lead.name);
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveClass(/jo-sheet-bottom/);
      await ready(sheet);
      const box = (await sheet.boundingBox())!;
      // Across the screen, resting on its bottom edge, within the screen.
      expect(Math.round(box.width)).toBe(390);
      expect(Math.round(box.y + box.height)).toBe(844);
      expect(box.y).toBeGreaterThan(0);
      await expect(sheet.getByRole("link", { name: "View scorecard" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      expect(await axeBlocking(page)).toEqual([]);
      await sheet.getByRole("button", { name: "Close" }).tap();
      await expect(sheet).toBeHidden();
      expect(problems).toEqual([]);
    });
  }

  test("a tap on a chip in the question box opens the sheet, the question untouched; closed, the caret is just after the chip", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto(`/ask?about=${lead.id}`);
    const box = questionBox(page);
    const chip = box.locator(`[data-chip][data-mentioned="${lead.id}"]`);
    await expect(chip).toBeVisible();
    await expectQuestion(box, `@${lead.name} `);
    await chip.tap();
    const sheet = cardOf(page, lead.name);
    await expect(sheet).toHaveClass(/jo-sheet-bottom/);
    await ready(sheet);
    // The sheet is modal, so the page behind it is hidden from the accessibility tree: the box by its own mark.
    expect(await questionText(page.locator("[data-question-editor]"))).toBe(`@${lead.name} `);
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toBeHidden();
    await expect(box).toBeFocused();
    await page.keyboard.type(",");
    await expectQuestion(box, `@${lead.name}, `);
  });

  test("an answer's pill opens the sheet too", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto(`/ask?q=${encodeURIComponent("Who has the most open breaches?")}`);
    const pill = page.locator("[data-answer-prose]").locator(`[data-person-mention="${lead.id}"]`).first();
    await pill.tap();
    await expect(cardOf(page, lead.name)).toHaveClass(/jo-sheet-bottom/);
  });

  test("Backspace in the sheet keeps the page: the answer, and the question being written, stay", async ({ page, request }) => {
    const asks = watchAsks(page);
    const [lead] = await holders(request);
    /** A mark on the page's window: anything but leaving the page (for the one before it) keeps it. */
    const mark = () => page.evaluate(() => Object.assign(window, { stayedOnAsk: true }));
    const stayed = () => page.evaluate(() => (window as Window & { stayedOnAsk?: boolean }).stayedOnAsk === true);
    // A page before Ask, for Back to go to.
    await page.goto("/people");
    const asked = "Who has the most open breaches?";
    await page.goto(`/ask?q=${encodeURIComponent(asked)}`);
    const prose = page.locator("[data-answer-prose]");
    const pill = prose.locator(`[data-person-mention="${lead.id}"]`).first();
    await expect(pill).toBeVisible();
    const address = whereIs(page);
    await pill.tap();
    const sheet = cardOf(page, lead.name);
    await expect(sheet).toBeFocused();
    await ready(sheet);
    await mark();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(sheet).toBeVisible();
    await expect(sheet).toBeFocused();
    // Escape still closes it, and gives focus back to the pill: the page is the one it was.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(pill).toBeFocused();
    await expect(prose).toBeVisible();
    expect(whereIs(page)).toBe(address);
    expect(await stayed()).toBe(true);

    // A chip's sheet, from a question being written: the question stays as it was, and nothing is asked.
    const box = questionBox(page);
    await box.click();
    await page.keyboard.type("Is @");
    await page.keyboard.type(lead.name.split(" ").at(-1)!.toLowerCase());
    await expect(page.getByRole("listbox", { name: "People to mention" }).getByRole("option").first()).toContainText(lead.name);
    await page.keyboard.press("Enter");
    await page.keyboard.type("on track?");
    await expectQuestion(box, `Is @${lead.name} on track?`);
    await box.locator(`[data-chip][data-mentioned="${lead.id}"]`).tap();
    await expect(sheet).toBeFocused();
    await ready(sheet);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(sheet).toBeVisible();
    // The sheet is modal, so the page behind it is hidden from the accessibility tree: the box by its own mark.
    expect(await questionText(page.locator("[data-question-editor]"))).toBe(`Is @${lead.name} on track?`);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(box).toBeFocused();
    await expectQuestion(box, `Is @${lead.name} on track?`);
    await expect(prose).toBeVisible();
    expect(whereIs(page)).toBe(address);
    expect(await stayed()).toBe(true);
    // The one question asked is the address's.
    expect(asks).toHaveLength(1);
  });
});

test.describe("reaching a card, leaving it, and its failures (on a desktop)", () => {
  test("a hand's speed reaches the card beside a name, its header and its foot, across other names, and its ways on work", async ({ page }) => {
    const reads = watchCards(page);
    await page.goto("/people");
    const table = page.getByRole("table", { name: /Everyone with tickets/ });
    const names = table.locator("[data-person-card-trigger]");
    await expect(names.nth(3)).toBeVisible();
    // A name in the window's middle band, where the card fits neither below nor above it, with names below it to cross.
    let index = 0;
    for (; index < (await names.count()) - 2; index += 1) {
      const box = (await names.nth(index).boundingBox())!;
      if (box.y + box.height > 300 && box.y < 560) break;
    }
    const name = names.nth(index);
    const who = (await name.locator("[data-person-name]").textContent())!.trim();
    const start = await middle(name.locator("[data-person-name]"));
    await page.mouse.move(start.x, start.y);
    const card = cardOf(page, who);
    await ready(card);
    // Beside the name (the window is too short for it below or above), level with it: its header next to the name.
    await expect(card).toHaveAttribute("data-side", "right");
    await placed(card);

    // To the card's own name in its header, at 600 px/s: it stays.
    await glide(page, start, await middle(card.getByRole("heading", { name: who })));
    await page.waitForTimeout(300);
    await expect(card).toBeVisible();
    await glide(page, await middle(card.getByRole("heading", { name: who })), start);
    const findings = card.getByRole("link", { name: "Open findings" });
    await glide(page, start, await middle(findings));
    await page.waitForTimeout(300);
    await expect(card).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(new Set(reads).size).toBe(1);
    await findings.click();
    await expect(page).toHaveURL(/\/findings\?person=p[0-9a-f]{12}$/);
  });

  test("a hand's curve to the leftmost way on keeps the card: Findings' assignee, bowing up to 60 px either way, from the name or its picture", async ({
    page,
  }) => {
    // Six journeys to the card's foot at a hand's speed, each from a fresh card: about 15 s in WebKit.
    test.slow();
    const reads = watchCards(page);
    await page.goto("/findings");
    const names = page.locator("table tbody [data-person-card-trigger]");
    await expect(names.nth(5)).toBeVisible();
    // A name in the window's middle band (the final check's case): its card opens beside it, reaching far below it.
    let index = 0;
    for (; index < (await names.count()) - 1; index += 1) {
      const box = (await names.nth(index).boundingBox())!;
      if (box.y > 330 && box.y + box.height < 560) break;
    }
    const name = names.nth(index);
    const who = (await name.locator("[data-person-name]").textContent())!.trim();
    const card = cardOf(page, who);
    const scorecard = card.getByRole("link", { name: "View scorecard" });
    const journeys = [
      { from: name.locator("[data-person-name]"), bow: 30 },
      { from: name.locator("[data-person-name]"), bow: 45 },
      { from: name.locator("[data-person-name]"), bow: 60 },
      { from: name.locator("[data-person-name]"), bow: -30 },
      { from: name.locator("[data-avatar]"), bow: 45 },
      { from: name.locator("[data-person-name]"), bow: 60 },
    ];
    for (const [step, { from, bow }] of journeys.entries()) {
      const start = await middle(from);
      await page.mouse.move(start.x, start.y);
      await ready(card);
      await expect(card).toHaveAttribute("data-side", "right");
      // Where it stands, before the hand sets off for it: opened again, its figures are ready before it is placed.
      await placed(card);
      // At 600 px/s to the middle of View scorecard, about 440 px, the hand's path bowed: positive away from the card.
      await glide(page, start, await middle(scorecard), 600, bow);
      await page.waitForTimeout(300);
      await expect(card, `bowing ${bow} px`).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      if (step === journeys.length - 1) break;
      // Off past the card's far side: it closes, for the next journey.
      await page.mouse.move(1400, 600, { steps: 3 });
      await expect(card).toBeHidden();
    }
    expect(new Set(reads).size).toBe(1);
    // And the way on it reached works.
    await scorecard.click();
    await expect(page).toHaveURL(/\/people\?person=p[0-9a-f]{12}$/);
  });

  test("the keyboard leaves a pinned card where it entered it: Shift+Tab to the name, Tab past its last control to what follows the name", async ({
    page,
    request,
  }) => {
    const [lead] = await holders(request);
    await page.goto(`/people?person=${lead.id}`);
    const name = page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name });
    await name.focus();
    await page.keyboard.press("Enter");
    const card = cardOf(page, lead.name);
    await expect(card).toBeFocused();
    await ready(card);
    // Shift+Tab from the card just pinned: closed, and focus is on the name again, not at the end of the page.
    await page.keyboard.press("Shift+Tab");
    await expect(card).toBeHidden();
    await expect(name).toBeFocused();

    // Tab: Close, then its links (in Safari too, whose Tab passes over links elsewhere), and Shift+Tab back.
    await page.keyboard.press("Enter");
    await expect(card).toBeFocused();
    await ready(card);
    await page.keyboard.press("Tab");
    await expect(card.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(card.locator("[data-card-ticket] a").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(card.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(card).toBeHidden();
    await expect(name).toBeFocused();

    // Tab past the last control: closed, and focus moves on to what follows the name on the page, never lost.
    await page.keyboard.press("Enter");
    await expect(card).toBeFocused();
    await ready(card);
    const stops = await card.locator("a[href], button").count();
    for (let stop = 0; stop <= stops; stop += 1) await page.keyboard.press("Tab");
    await expect(card).toBeHidden();
    expect(
      await name.evaluate((element) => {
        const now = document.activeElement;
        return now !== null && now !== document.body && (element.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      }),
    ).toBe(true);
  });

  test("the wheel over a pinned card that has nothing more to show scrolls the page under it", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto("/people");
    const table = page.getByRole("table", { name: /Everyone with tickets/ });
    await nameIn(table, lead.name).click();
    const card = cardOf(page, lead.name);
    await ready(card);
    await expect(card).not.toHaveAttribute("data-overflowing");
    await placed(card);
    const at = await middle(card);
    await page.mouse.move(at.x, at.y);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  });

  test("a card that could not be read says so, the line under the name empty, never still loading", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.route(CARD, (route) => route.fulfill({ status: 503, json: { error: "upstream_unavailable", message: "The oversight service is busy or starting up. Try again in a moment." } }));
    await page.goto(`/people?person=${lead.id}`);
    await page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name }).click();
    const card = cardOf(page, lead.name);
    // A recorded read: a 5xx is shown at once, never retried (the card's skeleton never waits out retries).
    await expect(card.locator("[data-person-card]")).toHaveAttribute("data-card-state", "error");
    await expect(card.getByRole("alert")).toContainText(`Couldn't load ${lead.name}'s card.`);
    await expect(card.locator("[data-card-line] .skeleton")).toHaveCount(0);
    expect(await axeBlocking(page, "[data-person-card]")).toEqual([]);
  });

  test("many other boards: as many as fit whole, then +N more naming the rest; nothing cut short, nothing hidden takes focus", async ({ page, request }) => {
    const [lead] = await holders(request);
    const boards = [
      { key: "LEADRSCOMS", name: "Leaders comms", open_tickets: 123 },
      { key: "LEADRSDRE", name: "Leaders DRE", open_tickets: 14 },
      { key: "OPS", name: "Operations", open_tickets: 2 },
      { key: "WEB", name: "Web platform", open_tickets: 1 },
    ];
    await page.route(CARD, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), other_boards: boards } });
    });
    await page.route(/\/api\/oversight\/projects$/, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { default: string; projects: { key: string }[] };
      const synced = boards.map((board) => ({ key: board.key, name: board.name, issues: 40, last_synced_at: "2026-11-04T14:28:00.000Z", synced: true, type: "software" }));
      await route.fulfill({ response, json: { ...body, projects: [...body.projects, ...synced] } });
    });
    await page.goto(`/people?person=${lead.id}`);
    await page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name }).click();
    const card = cardOf(page, lead.name);
    await ready(card);
    const line = card.locator("[data-card-boards]");
    await expect(line.locator("[data-card-boards-more]")).toBeVisible();
    // Nothing on the line runs past its edge (no ellipsis eats a board), and the boards left out are not on it at all.
    expect(await line.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const listed = await line.locator("[data-card-board]").count();
    expect(listed).toBeGreaterThanOrEqual(1);
    expect(listed).toBeLessThan(boards.length);
    await expect(line.locator("[data-card-boards-more]")).toContainText(`+${boards.length - listed} more`);
    await expect(line.getByRole("link")).toHaveCount(listed);
  });
});

test.describe("on a short phone screen", () => {
  for (const viewport of [
    { width: 375, height: 548 },
    { width: 844, height: 390 },
  ]) {
    test.describe(`${viewport.width} × ${viewport.height}`, () => {
      test.use({ viewport, hasTouch: true, isMobile: true });

      test("the sheet's body scrolls inside it: every way on can be tapped, and the other boards' line reached", async ({ page, request }) => {
        const [lead] = await holders(request);
        await page.goto(`/people?person=${lead.id}`);
        const name = page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name });
        await name.tap();
        const sheet = cardOf(page, lead.name);
        await expect(sheet).toHaveClass(/jo-sheet-bottom/);
        await ready(sheet);
        // Within the screen, its foot on the screen's bottom edge.
        const box = (await sheet.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(Math.round(box.y + box.height)).toBe(viewport.height);
        // Each cell of the ways on is what a tap at its middle reaches: nothing of the body is drawn over it.
        const cells = sheet.locator("[data-card-actions] > a, [data-card-actions] > [aria-disabled]");
        await expect(cells).toHaveCount(3);
        for (const cell of await cells.all()) {
          const at = await middle(cell);
          const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-card-actions] > *")?.textContent ?? null, at);
          expect(hit).toBe(await cell.textContent());
        }
        // The body scrolls within the sheet, down to its last line.
        const boards = sheet.locator("[data-card-boards]");
        await boards.scrollIntoViewIfNeeded();
        await expect(boards).toBeInViewport({ ratio: 1 });
        const lastLine = (await boards.boundingBox())!;
        const footer = (await sheet.locator("[data-card-actions]").boundingBox())!;
        expect(lastLine.y + lastLine.height).toBeLessThanOrEqual(footer.y + 0.5);
        await sheet.getByRole("link", { name: "View scorecard" }).tap();
        await expect(sheet).toBeHidden();
      });
    });
  }
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("the sheet is the screen's width up to 40rem, centred", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto(`/people?person=${lead.id}`);
    await page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name }).tap();
    const sheet = cardOf(page, lead.name);
    await expect(sheet).toHaveClass(/jo-sheet-bottom/);
    await ready(sheet);
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.width)).toBe(640);
    expect(Math.round(box.x)).toBe(64);
  });
});

test.describe("on a phone, more", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("closing the sheet gives focus back to the name that opened it (Safari focuses nothing on a tap)", async ({ page, request }) => {
    const [lead] = await holders(request);
    await page.goto(`/people?person=${lead.id}`);
    const name = page.locator("[data-scorecard]").getByRole("heading", { name: lead.name }).getByRole("button", { name: lead.name });
    await name.tap();
    const sheet = cardOf(page, lead.name);
    await ready(sheet);
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toBeHidden();
    await expect(name).toBeFocused();
  });

  test("the access log's people: a tap on the picture opens the sheet, a tap on the name still filters", async ({ page }) => {
    await page.goto("/governance/access-log");
    const list = page.getByRole("list", { name: "Access log entries" });
    const picture = list.getByRole("button", { name: "Ada Brooks's card" }).first();
    await picture.tap();
    const sheet = cardOf(page, "Ada Brooks");
    await expect(sheet).toHaveClass(/jo-sheet-bottom/);
    await ready(sheet);
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toBeHidden();
    await expect(picture).toBeFocused();
    await list.getByRole("button", { name: "Ada Brooks", exact: true }).first().tap();
    await expect(page).toHaveURL(/person=p[0-9a-f]{12}/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
