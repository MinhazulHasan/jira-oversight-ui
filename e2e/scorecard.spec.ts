import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/*
 * The People page (JO-11): how tickets are handled, person by person, next to
 * the whole board, for people level (the sample runs with sign-in off, as an
 * admin would see it). Run against a server with SAMPLE_PEOPLE_COMPARISON on
 * (the default: the everyone table above the scorecard) and one with it off
 * (a person picker and one scorecard): each test reads which from the API and
 * checks that mode, so the same spec covers both. Expected figures are read
 * from the API, never copied.
 */

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface Value {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  enough: boolean;
  vs_board: string | null;
}
interface Card {
  comparison: "on" | "off";
  period: { days: number };
  measures: { key: string; label: string; kind: string; measurable: boolean; reason: string | null }[];
  board: { tickets: number; values: Record<string, Value> };
  people: { person: { id: string; name: string }; tickets: number; values: Record<string, Value> }[];
}

async function scorecard(request: APIRequestContext, query = ""): Promise<Card> {
  const response = await request.get(`/api/oversight/people/scorecard${query}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as Card;
}

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`Uncaught: ${error.message}`));
  return problems;
}

const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const table = (page: Page) => page.getByRole("table", { name: /Everyone with tickets/ });
const scorecardTable = (page: Page, name: string) => page.locator("[data-scorecard]").getByRole("table", { name });

/** The person picker's field names the row the keyboard is on, and that row is in the list and highlighted. */
async function expectActiveRow(page: Page) {
  const field = page.getByRole("combobox", { name: "Search people" });
  await expect(field).toHaveAttribute("aria-activedescendant", /-option-\d+$/);
  const active = (await field.getAttribute("aria-activedescendant"))!;
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("option").and(page.locator("[data-active]"))).toHaveCount(1);
}

/** The scorecard's heading shows the person's whole name, never cut short beside the count (the JO-11 check). */
async function expectWholeName(page: Page, name: string) {
  const heading = page.locator("[data-scorecard]").getByRole("heading", { name });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
}

/**
 * The Scorecard section's heading, where it stands on the page while the figures load (every scorecard call held)
 * and once they are in: it must not move (the JO-11 check found it 91 px lower once loaded with comparison on, and
 * about 690 px higher with it off, G2). Comparison on waits for everyone's table; off, for the one scorecard.
 */
async function scorecardHeadingMoves(page: Page, path: string, mode: "on" | "off" = "on"): Promise<number> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/oversight/people/scorecard**", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(path);
  const heading = page.getByRole("heading", { name: "Scorecard", exact: true });
  const waiting = mode === "on" ? "Loading everyone's figures" : "Loading the scorecard";
  await expect(page.getByRole("status").filter({ hasText: waiting })).toBeAttached();
  if (mode === "off") {
    // Never the comparison's loading state where comparing is off: no everyone table, no marks' key.
    await expect(page.getByRole("heading", { name: "Everyone with tickets" })).toHaveCount(0);
    await expect(page.getByText("Comparing people is off. One person at a time.")).toBeVisible();
  }
  const top = () => heading.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  const loading = await top();
  release();
  await expect(page.getByRole("status").filter({ hasText: waiting })).toHaveCount(0);
  await expect(page.locator(mode === "on" ? "[data-comparison]" : "[data-scorecard]").first()).toBeAttached();
  return Math.abs((await top()) - loading);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test("the People page is in the rail and the palette at people level, and g then e opens it", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByRole("navigation", { name: "Primary" });
  await expect(rail.getByRole("link", { name: "People" })).toBeVisible();
  // The shortcut is bound once the page is live: the sync time, which reads the viewer's clock, is drawn then. And the
  // chord must arrive as one (e within 1.2 s of g), so the Overview's figures are drawn first, as smoke.spec.ts waits:
  // under load, a g sent while WebKit still draws them can land too long before the e.
  await expect(page.getByRole("banner").locator("[data-sync-now]").filter({ hasText: / ago/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Headline figures" }).getByRole("link").first()).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(page.getByText("How each person handles tickets, against the board.")).toBeVisible();
  await expect(rail.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
});

test.describe("with comparison on", () => {
  test.beforeEach(async ({ request }) => {
    test.skip((await scorecard(request)).comparison !== "on", "this server has comparison turned off");
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`everyone in a table, a row opens their scorecard below, logs nothing and passes axe (${colorScheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const card = await scorecard(request);
      await page.goto("/people");
      await expect(table(page)).toBeVisible();
      const rows = table(page).locator("tbody tr[data-person]");
      await expect(rows).toHaveCount(card.people.length);
      // One column per measure the board can show; the others are said in the scorecard, never as a zero.
      const shown = card.measures.filter((measure) => measure.measurable);
      await expect(table(page).locator("thead th")).toHaveCount(shown.length + 1);
      await expect(page.getByText("No one chosen yet")).toBeVisible();

      const carmen = card.people.find((row) => row.person.name === "Carmen Ruiz")!;
      await rows.filter({ hasText: "Carmen Ruiz" }).click();
      await expect(page).toHaveURL(new RegExp(`person=${carmen.person.id}`));
      const scorecardRows = scorecardTable(page, "Carmen Ruiz").locator("tbody tr");
      await expect(scorecardRows).toHaveCount(card.measures.length);
      const rate = carmen.values.estimated_before_start;
      await expect(scorecardRows.filter({ hasText: "Estimated before work started" })).toContainText(`${rate.value}%`);
      await expect(scorecardRows.filter({ hasText: "Estimated before work started" })).toContainText(`${rate.numerator} of ${rate.denominator}`);
      for (const measure of card.measures.filter((candidate) => !candidate.measurable)) {
        await expect(scorecardRows.filter({ hasText: measure.label })).toContainText(`Not measurable. ${measure.reason}`);
      }
      await expect(page.locator("[data-scorecard]")).toContainText(
        `Figures from Jira over the last ${card.period.days} days, next to the whole board, by each ticket's current assignee.`,
      );
      await expect(rows.filter({ hasText: "Carmen Ruiz" })).toHaveAttribute("aria-current", "true");
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("sorts by any column: closer to the process first, too few tickets always last, the address keeping it", async ({ page, request }) => {
    const card = await scorecard(request);
    await page.goto("/people");
    await expect(table(page)).toBeVisible();
    await table(page).getByRole("button", { name: "Open tickets stuck in a status" }).click();
    await expect(page).toHaveURL(/sort=stuck_now/);
    const header = table(page).getByRole("columnheader", { name: /Open tickets stuck in a status/ });
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    const expected = [...card.people]
      .sort((a, b) => {
        const left = a.values.stuck_now;
        const right = b.values.stuck_now;
        const rank = (value: Value) => (value.enough && value.value !== null ? value.value : Number.POSITIVE_INFINITY);
        return rank(left) - rank(right) || a.person.name.localeCompare(b.person.name, "en");
      })
      .map((row) => row.person.name);
    const names = await table(page).locator("tbody tr[data-person] td[data-sticky] .truncate").allTextContents();
    expect(names).toEqual(expected);
    // Turned round: further first, and too few tickets still last.
    await table(page).getByRole("button", { name: "Open tickets stuck in a status" }).click();
    await expect(page).toHaveURL(/order=desc/);
    const turned = await table(page).locator("tbody tr[data-person] td[data-sticky] .truncate").allTextContents();
    const tooFew = card.people.filter((row) => !row.values.stuck_now.enough).map((row) => row.person.name);
    expect(turned.slice(-tooFew.length).sort()).toEqual([...tooFew].sort());
  });

  test("the default view keys the marks and gives the caveat; a link to someone's scorecard lands on it (the JO-11 review)", async ({ page, request }) => {
    const card = await scorecard(request);
    await page.goto("/people");
    const everyone = page.locator("#everyone");
    await expect(table(page)).toBeVisible();
    // The marks' words are on the page beside their shapes, not only in a tooltip.
    for (const words of ["Closer to the process", "Further from the process", "Level with the board", "Too few tickets"]) {
      await expect(everyone.getByText(words, { exact: true }).first()).toBeVisible();
    }
    await expect(everyone.getByText(/^Figures from Jira over the last 90 days, next to the whole board, by each ticket's current assignee\./)).toBeVisible();
    await expect(everyone).toContainText("Choose someone to open their scorecard");
    // The board's row is set apart from the people by a rule.
    const rule = await table(page).locator("tfoot td").first().evaluate((cell) => getComputedStyle(cell).boxShadow);
    expect(rule).not.toBe("none");

    const carmen = card.people.find((row) => row.person.name === "Carmen Ruiz")!;
    await page.goto(`/people?person=${carmen.person.id}`);
    await expect(page.locator("[data-scorecard]")).toBeInViewport();
  });

  test("each measure's header says what it counts, on hover and on focus", async ({ page }) => {
    await page.goto("/people");
    const button = table(page).getByRole("button", { name: "Reopened after Done" });
    await button.hover();
    await expect(page.getByRole("tooltip")).toContainText("Tickets done in the period that were reopened. Lower is closer to the process.");
    await page.mouse.move(0, 0);
    await button.focus();
    await expect(page.getByRole("tooltip")).toContainText("that were reopened");
  });

  test("the keyboard moves through the rows and Enter opens one; the period changes the figures", async ({ page, request }) => {
    const card = await scorecard(request, "?days=30");
    await page.goto("/people");
    await expect(table(page)).toBeVisible();
    await table(page).locator("tbody tr[data-person]").first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/person=p[0-9a-f]{12}/);
    await page.getByRole("radiogroup", { name: "Period" }).getByRole("radio", { name: "30 days" }).click();
    await expect(page).toHaveURL(/days=30/);
    await expect(page.getByText(new RegExp(`^Last ${card.period.days} days, `))).toBeVisible();
    await expect(page.locator("[data-scorecard]")).toContainText("Figures from Jira over the last 30 days");
  });

  test("a member with no tickets opened from a link: none to compare, and nothing shown as a zero", async ({ page, request }) => {
    const directory = (await (await request.get("/api/oversight/people/directory")).json()) as { people: { person: { id: string; name: string }; tickets: number }[] };
    const member = directory.people.find((entry) => entry.tickets === 0)!;
    await page.goto(`/people?person=${member.person.id}`);
    await expect(page.getByText(`${member.person.name} holds no tickets on this board.`)).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);
  });

  test("nothing moves when everyone's figures arrive: the skeleton holds their place (the JO-11 check)", async ({ page }) => {
    expect(await scorecardHeadingMoves(page, "/people")).toBeLessThanOrEqual(1);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("nothing moves when everyone's figures arrive, and a scorecard's heading shows the whole name (the JO-11 check)", async ({ page, request }) => {
      expect(await scorecardHeadingMoves(page, "/people")).toBeLessThanOrEqual(1);
      const card = await scorecard(request);
      for (const name of ["Carmen Ruiz", "Grace Lindqvist"]) {
        const row = card.people.find((candidate) => candidate.person.name === name)!;
        await page.goto(`/people?person=${row.person.id}`);
        await expectWholeName(page, name);
        await expect(page.locator("[data-scorecard]")).toContainText(`${row.tickets} tickets assigned now, any status`);
      }
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    });

    test("in forced colours the chosen person is still marked in the list (the JO-11 review)", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "forced colours are a Windows mode: Chromium emulates them, WebKit does not");
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto("/people");
      const list = page.getByRole("list", { name: "Everyone with tickets" });
      await list.getByRole("button").first().click();
      const chosen = list.locator('button[aria-current="true"]');
      await expect(chosen).toHaveCount(1);
      expect(await chosen.evaluate((button) => getComputedStyle(button).outlineStyle)).toBe("solid");
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`a list with the sort above it, the scorecard fits, nothing scrolls sideways, axe clean (${colorScheme})`, async ({ page, request }) => {
        await page.emulateMedia({ colorScheme });
        const card = await scorecard(request);
        await page.goto("/people?sort=estimated_before_start");
        const list = page.getByRole("list", { name: "Everyone with tickets" });
        await expect(list).toBeVisible();
        await expect(table(page)).toBeHidden();
        await expect(list.getByRole("button")).toHaveCount(card.people.length);
        await expect(page.getByRole("radio", { name: "Closer first" })).toBeChecked();
        const top = [...card.people].filter((row) => row.values.estimated_before_start.enough).sort((a, b) => b.values.estimated_before_start.value! - a.values.estimated_before_start.value!)[0];
        await expect(list.getByRole("button").first()).toContainText(top.person.name);
        await list.getByRole("button").first().click();
        await expect(page.locator("[data-scorecard]")).toBeVisible();
        await expect(page.locator("[data-scorecard]")).toBeInViewport();
        expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
        expect(await axeBlocking(page)).toEqual([]);
      });
    }
  });
});

test.describe("with comparison off", () => {
  test.beforeEach(async ({ request }) => {
    test.skip((await scorecard(request)).comparison !== "off", "this server has comparison on");
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`no table: a person picked from the board, then their scorecard; axe clean (${colorScheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      await page.goto("/people");
      await expect(page.getByText("Comparing people is off. One person at a time.")).toBeVisible();
      await expect(table(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Person: choose someone" }).click();
      const listbox = page.getByRole("listbox", { name: "People on this board" });
      await expect(listbox.getByRole("group")).toHaveCount(2);
      await expect(listbox.getByRole("group").first()).toContainText("With tickets");
      // Open, the first row is the highlighted one, and the field names it (the JO-11 check: aria-activedescendant
      // named a row that was not there once the list's height was fitted, and axe failed as soon as it opened).
      await expectActiveRow(page);
      expect(await axeBlocking(page)).toEqual([]);
      await page.keyboard.press("ArrowDown");
      await expectActiveRow(page);
      await listbox.getByRole("option", { name: /Hana Mori/ }).click();
      await expect(page).toHaveURL(/person=p[0-9a-f]{12}/);
      const card = await scorecard(request, `?person=${new URL(page.url()).searchParams.get("person")}`);
      await expect(scorecardTable(page, "Hana Mori").locator("tbody tr")).toHaveCount(card.measures.length);
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("nothing moves when one person's figures arrive: the page holds the shape it will have (the JO-11 check, G2)", async ({ page, request }) => {
    const directory = (await (await request.get("/api/oversight/people/directory")).json()) as { people: { person: { id: string; name: string } }[] };
    const carmen = directory.people.find((entry) => entry.person.name === "Carmen Ruiz")!.person.id;
    expect(await scorecardHeadingMoves(page, `/people?person=${carmen}`, "off")).toBeLessThanOrEqual(1);
  });

  test("two people at once are refused in the contract's words", async ({ request }) => {
    const card = await scorecard(request);
    expect(card.people).toEqual([]);
    const directory = (await (await request.get("/api/oversight/people/directory")).json()) as { people: { person: { id: string } }[] };
    const [first, second] = directory.people.map((entry) => entry.person.id);
    const response = await request.get(`/api/oversight/people/scorecard?person=${first}&person=${second}`);
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({
      error: "comparison_off",
      message: "Comparing people side by side is turned off. Ask about one person at a time instead.",
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("nothing moves when one person's figures arrive on a phone (the JO-11 check, G2)", async ({ page, request }) => {
      const directory = (await (await request.get("/api/oversight/people/directory")).json()) as { people: { person: { id: string; name: string } }[] };
      const carmen = directory.people.find((entry) => entry.person.name === "Carmen Ruiz")!.person.id;
      expect(await scorecardHeadingMoves(page, `/people?person=${carmen}`, "off")).toBeLessThanOrEqual(1);
    });

    test("the picker and the scorecard fit, nothing scrolls sideways", async ({ page }) => {
      await page.goto("/people");
      await page.getByRole("button", { name: "Person: choose someone" }).click();
      await expectActiveRow(page);
      expect(await axeBlocking(page)).toEqual([]);
      await page.getByRole("listbox", { name: "People on this board" }).getByRole("option", { name: /Carmen Ruiz/ }).click();
      await expect(page.locator("[data-scorecard]")).toBeVisible();
      await expectWholeName(page, "Carmen Ruiz");
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });
  });
});
