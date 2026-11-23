import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expectQuestion, questionBox, questionText } from "./question";

/*
 * Asking about people with @ (the product owner's decision of 11 Nov 2026),
 * end to end on the sample server. Sign-in is off there, so Ask answers at
 * people level, as it does for an admin (the sign-in suite holds a user to
 * team level). The people come from the API, never copied here: the sample's
 * fictional people, two of them with an abstract picture, and the board's
 * three members who hold none of its tickets (JO-10).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface Person {
  id: string;
  name: string;
  avatar: string | null;
}

async function boardPeople(request: APIRequestContext): Promise<Person[]> {
  const response = await request.get("/api/oversight/people");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { people: { person: Person | null }[] };
  return body.people.flatMap((row) => (row.person ? [row.person] : []));
}

interface DirectoryEntry {
  person: Person;
  tickets: number;
}

/** Everyone on the board, as the @ list reads them: who holds its tickets, and its members who hold none. */
async function directory(request: APIRequestContext): Promise<DirectoryEntry[]> {
  const response = await request.get("/api/oversight/people/directory");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { people: DirectoryEntry[] }).people;
}

/** The directory's address, as the @ list asks for it. */
const DIRECTORY = /\/api\/oversight\/people\/directory(\?.*)?$/;

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

/** The questions asked, as the dashboard's server received them. */
function watchAsks(page: Page): unknown[] {
  const bodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/oversight/ask")) bodies.push(request.postDataJSON());
  });
  return bodies;
}

async function shellReady(page: Page) {
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
  // The sync time is drawn once the page is live (it reads the viewer's clock): typing waits for it, or hydration
  // could take back what was typed into the server's markup.
  await expect(page.getByRole("banner").locator("[data-sync-now]").filter({ hasText: / ago/ })).toBeVisible();
}

const field = (page: Page) => questionBox(page);
const list = (page: Page) => page.getByRole("listbox", { name: "People to mention" });
const answer = (page: Page, question: string) => page.getByRole("article", { name: question });
const lastName = (person: Person) => person.name.split(/\s+/).at(-1) ?? person.name;

/** What an avatar shows, and where: decorative, round, of its set size, its picture loaded. */
async function avatarOf(locator: Locator) {
  return locator.locator("[data-avatar]").first().evaluate((element) => {
    const image = element.querySelector("img");
    const box = element.getBoundingClientRect();
    return {
      state: element.getAttribute("data-avatar"),
      hidden: element.getAttribute("aria-hidden"),
      size: [Math.round(box.width), Math.round(box.height)],
      radius: getComputedStyle(element).borderTopLeftRadius,
      loaded: image ? image.complete && image.naturalWidth > 0 : null,
      src: image?.getAttribute("src") ?? null,
    };
  });
}

async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("@ lists the board's people with their pictures; choosing one asks about them by id, and the answer marks them", async ({ page }) => {
      // The whole journey, axe twice and an answer: 16 to 23 s alone, past 30 s in WebKit under a full run's load.
      test.slow();
      const problems = watchConsole(page);
      const asks = watchAsks(page);
      await page.goto("/ask");
      await shellReady(page);
      const people = await boardPeople(page.request);
      const everyone = await directory(page.request);
      // The person with the most open breaches, who in the sample has a picture.
      const lead = people[0];

      await expect(field(page)).not.toHaveAttribute("aria-controls");
      await field(page).click();
      await page.keyboard.type("What are @");
      await expect(list(page)).toBeVisible();
      await expect(field(page)).toHaveAttribute("aria-controls", (await list(page).getAttribute("id"))!);
      await expect(list(page).getByRole("option")).toHaveCount(everyone.length);
      // Against the question box, below the question's text, and wholly on screen.
      const box = (await page.getByRole("form", { name: "Ask a question" }).boundingBox())!;
      const popup = (await list(page).boundingBox())!;
      expect(popup.y).toBeGreaterThan(box.y);
      expect(popup.x).toBeGreaterThanOrEqual(box.x);
      expect(popup.x + popup.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(await axeBlocking(page)).toEqual([]);

      await page.keyboard.type(lastName(lead).toLowerCase());
      const option = list(page).getByRole("option", { name: lead.name });
      await expect(option).toHaveAttribute("aria-selected", "true");
      const shown = await avatarOf(option);
      expect(shown).toMatchObject({ hidden: "true", size: [24, 24], radius: "50%" });
      if (lead.avatar) {
        await expect.poll(async () => (await avatarOf(option)).loaded).toBe(true);
        expect(shown.src).toBe(`/api/oversight/people/${lead.id}/avatar?v=${lead.avatar}`);
      }

      await page.keyboard.press("Enter");
      await expectQuestion(field(page), `What are @${lead.name} `);
      await expect(list(page)).toBeHidden();
      // Their chip, in the question where the @ was.
      await expect(field(page).locator(`[data-chip][data-mentioned="${lead.id}"]`)).toBeVisible();
      await page.keyboard.press("Backspace");
      await page.keyboard.type("'s open findings?");
      await page.keyboard.press("Enter");

      const question = `What are @${lead.name}'s open findings?`;
      await expect(answer(page, question)).toBeVisible();
      expect(asks).toEqual([{ question, mentions: [lead.id] }]);
      await expect(page).toHaveURL(new RegExp(`[?&]m=${lead.id}(&|$)`));
      // The answer names them, marked: their picture and their name, which opens their card (JO-13), as a mention
      // does in Jira; the card leads on to their open findings.
      const mark = answer(page, question).locator("[data-answer-prose]").locator(`[data-person-mention="${lead.id}"]`).first();
      await expect(mark).toHaveText(lead.name);
      await expect(mark).toHaveAttribute("aria-haspopup", "dialog");
      expect(await avatarOf(mark)).toMatchObject({ hidden: "true", size: [20, 20], radius: "50%" });
      await mark.click();
      const card = page.getByRole("dialog", { name: lead.name });
      await expect(card.getByRole("link", { name: "Open findings" })).toHaveAttribute("href", `/findings?person=${lead.id}`);
      await page.keyboard.press("Escape");
      await expect(card).toBeHidden();
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test("@ lists everyone on the board in two groups, says when it scrolls, and a member with no tickets gets one marked sentence", async ({ page }) => {
      // The list, its scrolling, axe and two answers: 20 to 23 s alone in WebKit, past 30 s under load (the JO-12 check).
      test.slow();
      const problems = watchConsole(page);
      const asks = watchAsks(page);
      await page.goto("/ask");
      await shellReady(page);
      const everyone = await directory(page.request);
      const holders = everyone.filter((entry) => entry.tickets > 0).map((entry) => entry.person);
      const members = everyone.filter((entry) => entry.tickets === 0).map((entry) => entry.person);
      expect(members.map((person) => person.name)).toEqual(["Noor Haddad", "Tomás Ferreira", "Yuki Tanabe"]);
      const [noor] = members;

      await field(page).click();
      await page.keyboard.type("Is @");
      const withTickets = list(page).getByRole("group", { name: "With tickets" });
      const noTickets = list(page).getByRole("group", { name: "No tickets" });
      await expect(withTickets.getByRole("option")).toHaveCount(holders.length);
      await expect(noTickets.getByRole("option")).toHaveText(members.map((person) => person.name));
      expect((await noTickets.boundingBox())!.y).toBeGreaterThan((await withTickets.boundingBox())!.y);
      // Rows as ever: one height, a 24 px avatar (initials for a member with no picture).
      const rows = await list(page).getByRole("option").evaluateAll((options) => options.map((option) => Math.round(option.getBoundingClientRect().height)));
      expect(new Set(rows)).toEqual(new Set([32]));
      expect(await avatarOf(noTickets.getByRole("option", { name: noor.name }))).toMatchObject({ state: "initials", hidden: "true", size: [24, 24] });
      // Eleven people and two headings are more than the list shows: the edge it can scroll towards fades, still.
      const frame = list(page).locator("xpath=..");
      await expect(frame).toHaveAttribute("data-more-end", "true");
      await expect(frame).toHaveAttribute("data-more-start", "false");
      const fade = (where: "::before" | "::after") =>
        frame.evaluate((element, pseudo) => {
          const style = getComputedStyle(element, pseudo);
          return { opacity: style.opacity, transition: style.transitionProperty };
        }, where);
      expect(await fade("::after")).toEqual({ opacity: "1", transition: "none" });
      expect(await fade("::before")).toEqual({ opacity: "0", transition: "none" });
      // The clipped edge cuts a row in half, never the gap between the groups: with every holder on show, the
      // "No tickets" heading is seen whole, and half its first row says there is more.
      const cut = await list(page).evaluate((element) => {
        const bottom = element.getBoundingClientRect().bottom;
        const second = element.querySelectorAll('[role="group"]')[1];
        const heading = second.querySelector('[role="presentation"]')!.getBoundingClientRect();
        const straddled = [...element.querySelectorAll('[role="option"]')]
          .map((option) => option.getBoundingClientRect())
          .find((row) => row.top < bottom && row.bottom > bottom);
        return { heading: heading.bottom <= bottom, shown: straddled ? Math.round(bottom - straddled.top) : null };
      });
      expect(cut.heading).toBe(true);
      expect(Math.abs((cut.shown ?? 0) - 16)).toBeLessThanOrEqual(1);
      expect(await axeBlocking(page)).toEqual([]);

      // The keyboard runs through both groups as one list: up from the first is the last member, scrolled to.
      await page.keyboard.press("ArrowUp");
      const last = noTickets.getByRole("option", { name: members.at(-1)!.name });
      await expect(last).toHaveAttribute("aria-selected", "true");
      await expect(last).toBeInViewport();
      await expect(frame).toHaveAttribute("data-more-end", "false");
      await expect(frame).toHaveAttribute("data-more-start", "true");
      await page.keyboard.press("ArrowDown");
      await expect(withTickets.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
      // Back on the first row, the list is at its very top: its heading whole, no fade or hairline over it.
      expect(await list(page).evaluate((element) => element.scrollTop)).toBe(0);
      await expect(frame).toHaveAttribute("data-more-start", "false");

      // A search that finds only a member: one group, its heading, and no other.
      await page.keyboard.type("noor");
      await expect(list(page).getByRole("group")).toHaveCount(1);
      await expect(withTickets).toHaveCount(0);
      await page.keyboard.press("Enter");
      await expectQuestion(field(page), `Is @${noor.name} `);
      await page.keyboard.type("working on anything?");
      await page.keyboard.press("Enter");

      const question = `Is @${noor.name} working on anything?`;
      await expect(answer(page, question)).toBeVisible();
      expect(asks).toEqual([{ question, mentions: [noor.id] }]);
      const prose = answer(page, question).locator("[data-answer-prose]");
      await expect(prose).toHaveText(`${noor.name} has no tickets on this board.`);
      const mark = prose.locator(`[data-person-mention="${noor.id}"]`);
      await expect(mark).toHaveText(noor.name);
      // The same pill, opening their card (JO-13), which says they hold no tickets here; no link to an empty Findings.
      await expect(mark).toHaveAttribute("aria-haspopup", "dialog");
      await expect(prose.getByRole("link")).toHaveCount(0);
      await expect(answer(page, question).locator("footer")).not.toContainText("scripted");
      expect(await avatarOf(mark)).toMatchObject({ state: "initials", hidden: "true", size: [20, 20], radius: "50%" });
      await expect(page.getByRole("complementary", { name: "Sources" })).toContainText("They hold no tickets on this board.");
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test("who has the most open breaches: the people named, marked in the order the answer names them", async ({ page }) => {
      const question = "Who has the most open breaches?";
      await page.goto(`/ask?q=${encodeURIComponent(question)}`);
      await expect(answer(page, question)).toBeVisible();
      // As the Ask page sends it: from the dashboard's own origin, which the route requires of every POST.
      const response = await (await page.request.post("/api/oversight/ask", { data: { question }, headers: { origin: new URL(page.url()).origin } })).json();
      const named = (response as { people: Person[] }).people;
      const marks = answer(page, question).locator("[data-answer-prose] [data-person-mention]");
      await expect(marks).toHaveCount(named.length);
      expect(await marks.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-person-mention")))).toEqual(named.map((person) => person.id));
      // One size in every mark, picture or initials, sitting on the line.
      const sizes = await marks.evaluateAll((elements) =>
        elements.map((element) => {
          const avatar = element.querySelector("[data-avatar]")?.getBoundingClientRect();
          return avatar ? [Math.round(avatar.width), Math.round(avatar.height)] : null;
        }),
      );
      expect(new Set(sizes.map((size) => JSON.stringify(size)))).toEqual(new Set([JSON.stringify([20, 20])]));
      expect(await axeBlocking(page)).toEqual([]);
    });
  });
}

/** Where a chip sits on its line: its height, the line's, and the bottoms of its name and of the text before it. */
async function chipLine(chip: Locator) {
  return chip.evaluate((element) => {
    const glyphs = (node: Node | null | undefined) => {
      if (!node) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    };
    const editor = element.closest("[data-question-editor]") as HTMLElement;
    return {
      height: element.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(editor).lineHeight),
      name: glyphs(element.lastElementChild?.firstChild)?.bottom ?? 0,
      text: glyphs(element.previousElementSibling?.firstChild)?.bottom ?? 0,
    };
  });
}

test("a person chosen is a chip in the question: inline with their picture, one step for the arrows, gone whole with one Backspace", async ({ page }) => {
  const problems = watchConsole(page);
  const asks = watchAsks(page);
  await page.goto("/ask");
  await shellReady(page);
  // The person with the most open breaches, who in the sample has a picture.
  const [lead] = await boardPeople(page.request);

  await field(page).click();
  await page.keyboard.type("What are @");
  await page.keyboard.type(lastName(lead).toLowerCase());
  await page.keyboard.press("Enter");
  const chip = field(page).locator(`[data-chip][data-mentioned="${lead.id}"]`);
  await expect(chip).toHaveText(lead.name);
  await expect(chip).toHaveAttribute("contenteditable", "false");
  // Their picture at 20 px, decorative, on the pill, which sits on the text's baseline and inside its line.
  expect(await avatarOf(chip)).toMatchObject({ hidden: "true", size: [20, 20], radius: "50%" });
  if (lead.avatar) await expect.poll(async () => (await avatarOf(chip)).loaded).toBe(true);
  const line = await chipLine(chip);
  expect(line.height).toBeLessThan(line.line);
  expect(Math.abs(line.name - line.text)).toBeLessThanOrEqual(0.5);
  // The pill is all there is: no line of mentions under the question.
  await expect(page.locator("[data-mentioned]")).toHaveCount(1);
  expect(await axeBlocking(page)).toEqual([]);

  // Typing goes on after it; the arrows step over it in one press, and text goes in either side of it, never into it.
  await page.keyboard.type("open findings");
  for (let step = 0; step < " open findings".length; step += 1) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("all ");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("'s");
  await expectQuestion(field(page), `What are all @${lead.name}'s open findings`);
  await expect(chip).toHaveText(lead.name);

  // One Backspace just after it takes it whole; undo brings it back.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect(chip).toHaveCount(0);
  await expectQuestion(field(page), "What are all 's open findings");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(chip).toBeVisible();
  await expectQuestion(field(page), `What are all @${lead.name}'s open findings`);

  // Shift+Enter is a new line; Enter asks, the chip's person going with the question by id.
  for (let step = 0; step < "'s open findings".length; step += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("this week?");
  await page.keyboard.press("Enter");
  await expect.poll(() => asks.length).toBe(1);
  expect(asks[0]).toEqual({ question: `What are all @${lead.name}'s open findings\nthis week?`, mentions: [lead.id] });
  expect(problems).toEqual([]);
});

test("↑ brings the last question back with its chip, and so does its address", async ({ page, context }) => {
  await page.goto("/ask");
  await shellReady(page);
  const [lead] = await boardPeople(page.request);
  await field(page).click();
  await page.keyboard.type(`@${lastName(lead).toLowerCase()}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("open breaches");
  await page.keyboard.press("Enter");
  const question = `@${lead.name} open breaches`;
  await expect(answer(page, question)).toBeVisible();
  await expectQuestion(field(page), "");

  await field(page).click();
  await page.keyboard.press("ArrowUp");
  await expectQuestion(field(page), question);
  await expect(field(page).locator(`[data-chip][data-mentioned="${lead.id}"]`)).toBeVisible();

  // The address holds the question and the id. Opened in a new tab, with the service failing so it stays in the box:
  // the chip is rebuilt from the two, and Try again asks about the same person.
  const fresh = await context.newPage();
  await fresh.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
  await fresh.route("**/api/oversight/ask", (route) =>
    route.fulfill({ status: 503, json: { error: "upstream_unavailable", message: "The oversight service did not answer." } }),
  );
  await fresh.goto(page.url());
  await expect(fresh.getByRole("main").getByRole("alert")).toContainText("Couldn't get an answer");
  await expect(questionBox(fresh).locator(`[data-chip][data-mentioned="${lead.id}"]`)).toBeVisible();
  await expectQuestion(questionBox(fresh), question);
  const again = watchAsks(fresh);
  await fresh.unroute("**/api/oversight/ask");
  await fresh.getByRole("button", { name: "Try again" }).click();
  await expect(answer(fresh, question)).toBeVisible();
  expect(again).toEqual([{ question, mentions: [lead.id] }]);
  await fresh.close();
});

test("a paste arrives as plain text, never HTML and never a chip; a copy gives each chip as @Name", async ({ page, context, browserName }) => {
  const problems = watchConsole(page);
  await page.goto("/ask");
  await shellReady(page);
  const [lead] = await boardPeople(page.request);
  await field(page).click();
  await page.keyboard.type(`What is @${lastName(lead).toLowerCase()}`);
  await page.keyboard.press("Enter");

  const html = `<b>doing</b> <img src="/icon.svg" alt=""> about <a href="https://example.test">@${lead.name}</a>?`;
  const plain = `doing about @${lead.name}?`;
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(
      ([markup, text]) =>
        navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([markup], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
        ]),
      [html, plain],
    );
    await page.keyboard.press("ControlOrMeta+v");
  } else {
    // WebKit has no clipboard permission to grant: the same paste, as the browser hands it to the page.
    await field(page).evaluate(
      (element, [markup, text]) => {
        const data = new DataTransfer();
        data.setData("text/html", markup);
        data.setData("text/plain", text);
        element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      },
      [html, plain],
    );
  }
  const question = `What is @${lead.name} ${plain}`;
  await expectQuestion(field(page), question);
  // One chip, the one picked: the @Name pasted is text, and nothing of the HTML came in.
  await expect(field(page).locator("[data-chip]")).toHaveCount(1);
  await expect(field(page).locator("b, a, img:not([data-avatar] img)")).toHaveCount(0);

  // A copy is the question as it is sent: plain text, each chip as its @Name.
  await page.keyboard.press("ControlOrMeta+a");
  const copied = await field(page).evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return { plain: data.getData("text/plain"), html: data.getData("text/html") };
  });
  expect(copied).toEqual({ plain: question, html: "" });
  expect(problems).toEqual([]);
});

test("an input method composes undisturbed beside a chip, and what it wrote is read back once", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "The composition is driven through Chromium's DevTools protocol.");
  await page.goto("/ask");
  await shellReady(page);
  const [lead] = await boardPeople(page.request);
  await field(page).click();
  await page.keyboard.type(`@${lastName(lead).toLowerCase()}`);
  await page.keyboard.press("Enter");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "仮名" });
  await expectQuestion(field(page), `@${lead.name} 仮名`);
  await page.keyboard.type("?");
  await expectQuestion(field(page), `@${lead.name} 仮名?`);
  await expect(field(page).locator("[data-chip]")).toHaveCount(1);
  expect(await questionText(field(page))).toBe(`@${lead.name} 仮名?`);
});

test("the arrows move, Esc closes and keeps it closed, the pointer chooses, and Tab chooses too", async ({ page }) => {
  const asks = watchAsks(page);
  await page.goto("/ask");
  await shellReady(page);
  const people = (await boardPeople(page.request)).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  await field(page).click();
  await page.keyboard.type("@");
  const options = list(page).getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  const active = await field(page).getAttribute("aria-activedescendant");
  expect(active).toBe(await options.nth(1).getAttribute("id"));
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(options.last()).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Escape");
  await expect(list(page)).toBeHidden();
  await expect(field(page)).not.toHaveAttribute("aria-controls");
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("x");
  await expect(list(page)).toBeHidden();

  // A new @: the pointer highlights a row and a click chooses it, the caret staying in the question.
  await field(page).fill("");
  await page.keyboard.type("Compare @");
  await options.nth(2).hover();
  await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
  await options.nth(2).click();
  await expectQuestion(field(page), `Compare @${people[2].name} `);
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("and @");
  await page.keyboard.type(lastName(people[0]).slice(0, 3).toLowerCase());
  await page.keyboard.press("Tab");
  await expectQuestion(field(page), `Compare @${people[2].name} and @${people[0].name} `);
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(answer(page, `Compare @${people[2].name} and @${people[0].name}`)).toBeVisible();
  expect(asks).toEqual([{ question: `Compare @${people[2].name} and @${people[0].name}`, mentions: [people[2].id, people[0].id] }]);
});

test("on a 390 px phone the list fits, a tap chooses, and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ask");
  await shellReady(page);
  const [lead] = await boardPeople(page.request);

  await field(page).click();
  await page.keyboard.type("@");
  await expect(list(page)).toBeVisible();
  const popup = await list(page).boundingBox();
  expect(popup?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((popup?.x ?? 0) + (popup?.width ?? 0)).toBeLessThanOrEqual(390);
  // Placed against the question box and inside it: the same inset from either side, never across its border.
  const form = (await page.getByRole("form", { name: "Ask a question" }).boundingBox())!;
  const menu = (await page.locator("[data-mention-menu]").boundingBox())!;
  const insets = [menu.x - form.x, form.x + form.width - (menu.x + menu.width)].map(Math.round);
  expect(insets[0]).toBeGreaterThanOrEqual(12);
  expect(insets[1]).toBe(insets[0]);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await axeBlocking(page)).toEqual([]);

  await list(page).getByRole("option", { name: lead.name }).click();
  await expectQuestion(field(page), `@${lead.name} `);
  await page.keyboard.type("open breaches");
  await page.keyboard.press("Enter");
  const question = `@${lead.name} open breaches`;
  await expect(answer(page, question)).toBeVisible();
  await expect(answer(page, question).locator(`[data-person-mention="${lead.id}"]`).first()).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await axeBlocking(page)).toEqual([]);
});

/**
 * The hint line under the question, as it is laid out: one line, nothing past its edge, and the hints it shows: those
 * on its first row (a hint with no room wraps whole onto a second row the line never shows).
 */
async function hintLine(page: Page) {
  return page.locator("form[aria-label='Ask a question'] [data-hint-line]").evaluate((line) => {
    const holder = line.parentElement!;
    const top = line.getBoundingClientRect().top;
    const shown = [...line.children].filter((hint) => getComputedStyle(hint).display !== "none" && hint.getBoundingClientRect().top - top < 4);
    return {
      height: line.getBoundingClientRect().height,
      // A hint broken across lines is more than one box tall, or wider than the line it is on.
      tallest: Math.max(...shown.map((hint) => hint.getBoundingClientRect().height)),
      widest: Math.max(0, ...shown.map((hint) => hint.getBoundingClientRect().right - line.getBoundingClientRect().right)),
      overflow: holder.scrollWidth - holder.clientWidth,
      hints: shown.map((hint) => hint.getAttribute("data-hint") ?? "basic"),
    };
  });
}

// One test per width (the JO-12 check): the three in one test ran past the 30 s limit under a full run's load.
for (const width of [1280, 1440, 1512]) {
  test(`the hint line stays one line at ${width} px: a hint steps aside whole, never word by word, and @ stays (the JO-09 item, D)`, async ({ page }) => {
    // An answer and 420 characters typed in WebKit: about 9 s alone, and well past that under a full run's load.
    test.slow();
    const long = "Which tickets went straight from To Do to Done this month, and which of them had an estimate before work started? ".repeat(4).slice(0, 420);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ask");
    await shellReady(page);
    for (const moment of ["before an answer", "after one", "with the counter"]) {
      // The box is focused rather than clicked: this is about the hint line, and under load WebKit's frames can come too
      // slowly for a click's wait for a still box (the box itself never moves: measured over 180 frames).
      if (moment === "after one") {
        await field(page).focus();
        await page.keyboard.type("Where do tickets get stuck most?");
        await page.keyboard.press("Enter");
        await expect(answer(page, "Where do tickets get stuck most?")).toBeVisible();
        await expectQuestion(field(page), "");
      }
      if (moment === "with the counter") {
        await field(page).focus();
        await page.keyboard.insertText(long);
        await expect(page.locator("form[aria-label='Ask a question']").getByText(`${long.length} / 500`)).toBeVisible();
      }
      const line = await hintLine(page);
      const where = `${width} px, ${moment}`;
      expect(line.height, where).toBeLessThanOrEqual(24);
      expect(line.tallest, where).toBeLessThanOrEqual(24);
      expect(line.widest, where).toBeLessThanOrEqual(0.5);
      expect(line.overflow, where).toBeLessThanOrEqual(0);
      // Enter to ask, then @ to mention someone, whatever the keyboard's key names: Windows' are the wider.
      expect(line.hints.slice(0, 2), where).toEqual(["basic", "mention"]);
    }
  });
}

test("on a phone the hint line says only how @ works, the counter beside it, nothing crowded", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ask");
  await shellReady(page);
  expect((await hintLine(page)).hints).toEqual(["mention"]);
  await field(page).click();
  await page.keyboard.insertText("Which tickets went straight from To Do to Done this month? ".repeat(8).slice(0, 430));
  await expect(page.locator("form[aria-label='Ask a question']").getByText("430 / 500")).toBeVisible();
  const line = await hintLine(page);
  expect(line.hints).toEqual(["mention"]);
  expect([line.widest, line.overflow]).toEqual([0, 0]);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
});

test("when the board's people fail to load, Enter in the question tries again, and says so first", async ({ page }) => {
  const people = DIRECTORY;
  await page.route(people, (route) => route.fulfill({ status: 404, json: { error: "not_found", message: "No such board." } }));
  await page.goto("/ask");
  await shellReady(page);
  await field(page).click();
  await page.keyboard.type("Open findings for @");
  await expect(page.getByText("Couldn’t load the board’s people.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Could not load people. Press Enter to retry." })).toHaveCount(1);
  expect(await axeBlocking(page)).toEqual([]);

  await page.unroute(people);
  await page.keyboard.press("Enter");
  await expect(list(page).getByRole("option").first()).toBeVisible();
  await expectQuestion(field(page), "Open findings for @");
  await expect(field(page)).toBeFocused();
  // Nothing was asked: Enter was the list's.
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("choosing someone whose name is already typed in full makes it their chip in place, and later keys land where typed", async ({ page }) => {
  await page.goto("/ask");
  await shellReady(page);
  const [lead] = await boardPeople(page.request);
  await field(page).click();
  await page.keyboard.type(`@${lead.name} open findings`);
  for (let step = 0; step < " open findings".length; step += 1) await page.keyboard.press("ArrowLeft");
  await expect(list(page).getByRole("option", { name: lead.name })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(field(page).locator(`[data-chip][data-mentioned="${lead.id}"]`)).toBeVisible();
  // The caret is past the space after the chip.
  await page.keyboard.type("*");
  await expectQuestion(field(page), `@${lead.name} *open findings`);
  await page.keyboard.press("Backspace");
  for (let step = 0; step < "open findings".length; step += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.type("?");
  await page.keyboard.type("!");
  await expectQuestion(field(page), `@${lead.name} open findings?!`);
});

test("a search that narrows a scrolled list starts it at its top, its highlighted row in view", async ({ page }) => {
  const real = (await (await page.request.get("/api/oversight/people/directory")).json()) as { people: unknown[] };
  // A board of thirty-five fictional people: more than the list shows, and twenty-four of them found by "s".
  const many = Array.from({ length: 35 }, (_, index) => ({
    person: {
      id: `p${(0xc0 + index).toString(16).padStart(12, "0")}`,
      name: index < 24 ? `Sam Tester ${String.fromCharCode(65 + index)}` : `Alex Tester ${String.fromCharCode(41 + index)}`,
      avatar: null,
    },
    tickets: index % 3 === 0 ? 0 : 1,
  }));
  await page.route(DIRECTORY, (route) => route.fulfill({ json: { ...real, people: many } }));
  await page.goto("/ask");
  await shellReady(page);
  await field(page).click();
  await page.keyboard.type("Is @");
  for (let step = 0; step < 14; step += 1) await page.keyboard.press("ArrowDown");
  await expect(list(page).getByRole("option").nth(14)).toHaveAttribute("aria-selected", "true");
  expect(await list(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.type("s");
  const first = list(page).getByRole("option").first();
  await expect(first).toHaveText("Sam Tester B");
  await expect(first).toHaveAttribute("aria-selected", "true");
  const seen = await list(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const row = element.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
    return { top: element.scrollTop, inView: row.top >= box.top && row.bottom <= box.bottom };
  });
  expect(seen).toEqual({ top: 0, inView: true });
  // Enter takes the row the reader can see.
  await page.keyboard.press("Enter");
  await expectQuestion(field(page), "Is @Sam Tester B ");
});

test("an eleventh mention is refused where it is seen, and the ten stay", async ({ page }) => {
  const real = (await (await page.request.get("/api/oversight/people/directory")).json()) as { people: unknown[] };
  // A board of twelve fictional people, so ten can be mentioned and one more tried.
  const twelve = Array.from({ length: 12 }, (_, index) => ({
    person: { id: `p${(0xb0 + index).toString(16).padStart(12, "0")}`, name: `${"ABCDEFGHIJKL"[index]}ri Tester`, avatar: null },
    tickets: index % 2,
  }));
  await page.route(DIRECTORY, (route) => route.fulfill({ json: { ...real, people: twelve } }));
  await page.goto("/ask");
  await shellReady(page);
  await field(page).click();
  for (const letter of "ABCDEFGHIJ") {
    await page.keyboard.type(`@${letter}ri`);
    await expect(list(page).getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
  }
  await expect(field(page).locator("[data-chip]")).toHaveCount(10);
  await page.keyboard.type("@Kri");
  await expect(list(page).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mention limit reached")).toBeVisible();
  await expect(page.getByText("A question can mention 10 people at most.")).toBeVisible();
  await expect(list(page)).toBeHidden();
  await expect(field(page).locator("[data-chip]")).toHaveCount(10);
  await expectQuestion(field(page), /@Jri Tester @Kri$/);
});

test("a question that judges someone is answered with figures, never refused (JO-11)", async ({ page, request }) => {
  const question = "Who is the slowest developer?";
  const comparison = ((await (await request.get("/api/oversight/people/scorecard")).json()) as { comparison: string }).comparison;
  await page.goto(`/ask?q=${encodeURIComponent(question)}`);
  await expect(answer(page, question)).toBeVisible();
  await expect(answer(page, question).getByText("I can show facts about someone's tickets and findings, but not judge their performance.")).toHaveCount(0);
  if (comparison === "on") {
    // Everyone by how closely they follow the process, next to the board, the slowest asked for: further from the
    // process first, the fewest measures closer (the JO-14 review), never called the slowest. The admin decides.
    await expect(answer(page, question).getByText(/^Measures closer to the process than the board, last 90.*days, fewest first: /)).toBeVisible();
  } else {
    await expect(answer(page, question).getByText("Comparing people side by side is turned off. Ask about one person at a time instead.", { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(await axeBlocking(page)).toEqual([]);
});
