import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface Board {
  project: { key: string; name: string };
  open_breaches: number;
  open_warnings: number;
  new_findings_7d: number;
  resolved_findings_7d: number;
  open_tickets: number;
  top_rule: { id: string; title: string; open: number } | null;
}
interface Portfolio {
  boards: Board[];
  boards_not_synced: number;
  attention: { project: string; issue_key: string; rule_id: string; title: string; opened_at: string; last_seen_at: string; age_days: number }[];
}

const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);

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

const boardsTable = (page: Page) => page.getByRole("table", { name: "Boards" });

async function live(page: Page) {
  await expect(boardsTable(page).getByText(/synced .+ ago/).first()).toBeVisible();
}

/** A text as drawn (innerText: a line of its own reads apart), its runs of space, a no-break one among them, one plain space. */
const spaced = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the Portfolio shows each board with the Overview's own figures, and passes axe (${colorScheme})`, async ({ page, request }) => {
    const problems = watchConsole(page);
    await page.emulateMedia({ colorScheme });
    const portfolio = (await (await request.get("/api/oversight/portfolio")).json()) as Portfolio;
    const overview = (await (await request.get("/api/oversight/overview")).json()) as { totals: { open_breaches: { current: number }; open_warnings: { current: number } } };
    const [board] = portfolio.boards;
    expect(portfolio.boards.map((each) => each.project.key)).toEqual(["DEMO", "MOB"]);
    expect(board.open_breaches).toBe(overview.totals.open_breaches.current);
    expect(board.open_warnings).toBe(overview.totals.open_warnings.current);

    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Portfolio" })).toHaveAttribute("aria-current", "page");
    const row = boardsTable(page).getByRole("row").filter({ hasText: board.project.name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(count(board.open_breaches));
    await expect(row).toContainText(count(board.open_warnings));
    await expect(row).toContainText(board.top_rule!.title);
    const total = (pick: (each: Board) => number) => count(portfolio.boards.reduce((sum, each) => sum + pick(each), 0));
    await expect(page.locator("[data-portfolio-summary]")).toContainText(
      `Across 2 boards: ${total((each) => each.open_breaches)} open breaches and ${total((each) => each.open_warnings)} open warnings; ${total((each) => each.new_findings_7d)} new and ${total((each) => each.resolved_findings_7d)} resolved in the last 7 days.`,
    );
    // HELP has never synced: counted in one line under the boards, never a row.
    expect(portfolio.boards_not_synced).toBe(1);
    await expect(page.locator("[data-portfolio-not-synced]")).toHaveText("1 more board in Jira isn\u2019t synced yet. Choose a board");
    await expect(boardsTable(page).getByRole("row").filter({ hasText: "Help desk" })).toHaveCount(0);
    // The 8-week trend is drawn, with an accessible summary.
    await expect(row.getByRole("img", { name: /Open findings on Demo project, last 8 weeks/ })).toBeVisible();

    const attention = page.getByRole("list", { name: "The oldest open breaches" });
    await expect(attention.getByRole("link")).toHaveCount(portfolio.attention.length);
    await expect(attention.getByRole("link").first()).toContainText(portfolio.attention[0].issue_key);

    expect(await axeBlocking(page)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test("a row opens its board's Overview, the board picked in the top bar", async ({ page }) => {
  await page.goto("/portfolio");
  await boardsTable(page).getByRole("row").filter({ hasText: "Demo project" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  expect((await page.context().cookies()).find((cookie) => cookie.name === "jo-board")?.value).toBe("DEMO");
});

test("the oldest breach opens its ticket, with the evidence", async ({ page, request }) => {
  const portfolio = (await (await request.get("/api/oversight/portfolio")).json()) as Portfolio;
  const oldest = portfolio.attention[0];
  await page.goto("/portfolio");
  await page.getByRole("list", { name: "The oldest open breaches" }).getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/issues/${oldest.issue_key}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(oldest.issue_key);
});

test("a board with no figures yet, or in its first tracked week, says so, and one never synced does not press", async ({ page }) => {
  await page.route("**/api/oversight/portfolio", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { meta: { projects: string[]; generated_at: string }; boards: Record<string, unknown>[] };
    const [demo] = body.boards;
    const never = {
      ...demo, project: { key: "LATE", name: "Late programme" }, last_sync_at: null, stale: true, open_tickets: 0, in_progress: 0,
      open_breaches: 0, open_warnings: 0, new_findings_7d: 0, resolved_findings_7d: 0, open_findings_trend: [0, 0, 0, 0, 0, 0, 0, 0],
      tracking_since: null, active_sprint: false, unestimated_in_active_sprint: null, sprint_at_risk: null, top_rule: null,
    };
    const fresh = {
      ...demo, project: { key: "FRESH", name: "Fresh board" }, active_sprint: false, unestimated_in_active_sprint: null, sprint_at_risk: null,
      tracking_since: new Date(Date.parse(body.meta.generated_at) - 2 * 86_400_000).toISOString(),
    };
    // The sample's synced boards stay (its oldest breaches are on them), with the two made up beside them.
    await route.fulfill({ response, json: { ...body, meta: { ...body.meta, projects: [...body.meta.projects, "LATE", "FRESH"] }, boards: [...body.boards, never, fresh] } });
  });
  await page.goto("/portfolio");
  const late = boardsTable(page).getByRole("row").filter({ hasText: "Late programme" });
  await expect(late).toBeVisible();
  // Not dressed as a link, and says why it does not open; a dash read as "No figures yet", never a clean board of zeros.
  await expect(late).not.toHaveAttribute("data-interactive", "true");
  await expect(late).toHaveAttribute("title", "Not synced yet: no Overview to open");
  await expect(late.getByText("No figures yet").first()).toBeAttached();
  await expect(late).not.toContainText("Nothing open");
  await late.click();
  await expect(page).toHaveURL(/\/portfolio$/);
  const fresh = boardsTable(page).getByRole("row").filter({ hasText: "Fresh board" });
  await expect(fresh).toContainText("Tracking since");
  await expect(fresh).toContainText("No active sprint");
  await expect(fresh).not.toContainText("unestimated");
  await expect(page.locator("[data-portfolio-summary]")).toContainText("leaving out Fresh board, first tracked this week.");
  await expect(page.locator("[data-portfolio-summary]")).toContainText("1 board has not synced yet.");
  // The age of a breach counts from when the rules first saw it, and says so.
  await expect(page.getByText("First seen", { exact: true })).toBeVisible();
  await expect(page.getByText("Seen for", { exact: true })).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
});

test("the sort lives in the address, and a header changes it", async ({ page }) => {
  await page.goto("/portfolio");
  await live(page);
  const header = boardsTable(page).getByRole("columnheader", { name: /Warnings/ });
  await expect(header).not.toHaveAttribute("aria-sort", "descending");
  await header.getByRole("button").click();
  await expect(page).toHaveURL(/\/portfolio\?sort=warnings&order=desc$/);
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByText("Sorted by open warnings, most first.")).toBeVisible();
  await page.reload();
  await expect(boardsTable(page).getByRole("columnheader", { name: /Warnings/ })).toHaveAttribute("aria-sort", "descending");
});

test("a board's staleness is the top bar's: at the sample's own time both say synced 4 min ago, neither Stale (JO-14)", async ({ page }) => {
  await page.goto("/portfolio");
  await live(page);
  const row = boardsTable(page).getByRole("row").filter({ hasText: "Demo project" });
  await expect(row).toContainText("synced 4 min ago");
  await expect(row).not.toContainText("Stale");
  await expect(page.locator("[data-portfolio-summary]")).not.toContainText("not synced in the last");
  await expect(page.getByRole("banner").locator("[data-sync-now]")).not.toContainText("Stale");
  // Its breaches are aged to now, as Findings ages them on a fresh board: nothing said of the last sync.
  await expect(page.locator("[data-attention-age]").first()).not.toContainText("at last sync");
  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.getByRole("list", { name: "Boards" }).getByRole("listitem").first();
  await expect(card).toContainText("synced 4 min ago");
  await expect(card).not.toContainText("Stale");
});

test("days later the board is stale on the Portfolio as in the top bar, and a breach's Seen for is Findings' Open for, as at the last sync (JO-14)", async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-13T09:00:00Z"));
  await page.goto("/portfolio");
  await live(page);
  await expect(boardsTable(page).getByRole("row").filter({ hasText: "Demo project" })).toContainText("Stale");
  await expect(page.getByRole("banner").locator("[data-sync-now]")).toContainText("Stale");
  await expect(page.locator("[data-portfolio-summary]")).toContainText("2 boards have not synced in the last 2 hours.");
  const age = page.locator("[data-attention-age]").first();
  await expect(age).toContainText("at last sync");
  const seenFor = spaced(await age.innerText());

  // The same breach in Findings: found by its ticket and rule, its drawer's "Open for".
  const [item] = ((await (await request.get("/api/oversight/portfolio")).json()) as Portfolio).attention;
  const found = (await (await request.get(`/api/oversight/findings?q=${item.issue_key}&rule=${item.rule_id}&state=open`)).json()) as {
    items: { finding_id: string; issue_key: string | null }[];
  };
  const finding = found.items.find((entry) => entry.issue_key === item.issue_key)!;
  await page.goto(`/findings?finding=${finding.finding_id}`);
  const drawer = page.getByRole("dialog", { name: item.title });
  const openFor = drawer.locator("dt", { hasText: /^Open for$/ }).locator("xpath=following-sibling::dd[1]");
  await expect(openFor).toContainText("at last sync");
  expect(spaced(await openFor.innerText())).toBe(seenFor);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`a card per board with the sort above, nothing wider than the screen, and axe passes (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/portfolio");
      const cards = page.getByRole("list", { name: "Boards" });
      await expect(cards.getByRole("link", { name: "Demo project", exact: true })).toBeVisible();
      await expect(boardsTable(page)).toBeHidden();
      await expect(page.getByRole("combobox", { name: "Sort by" })).toBeVisible();
      await expect(page.getByRole("list", { name: "The oldest open breaches" }).getByRole("link").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }

  test("a card opens its board's Overview", async ({ page }) => {
    await page.goto("/portfolio");
    // Anywhere on the card, its figures as much as its name: the name's link covers the whole card.
    await page.getByRole("list", { name: "Boards" }).getByRole("listitem").first().click({ position: { x: 24, y: 140 } });
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });
});

test("g then h goes to the Portfolio from anywhere", async ({ page }) => {
  await page.goto("/findings");
  await expect(page.getByRole("heading", { level: 1, name: "Findings" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Sync Demo project", exact: true })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/portfolio$/);
});

test("the line about boards not synced yet opens the board picker, on a desktop and in the navigation sheet on a phone (JO-17)", async ({
  page,
}) => {
  await page.goto("/portfolio");
  await live(page);
  await page.locator("[data-portfolio-not-synced]").getByRole("button", { name: "Choose a board" }).click();
  const search = page.getByRole("combobox", { name: "Search boards" });
  await expect(search).toBeFocused();
  await expect(page.getByRole("group", { name: "Not synced yet", exact: true }).getByRole("option", { name: /Help desk/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-portfolio-not-synced]").getByRole("button", { name: "Choose a board" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search boards" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
