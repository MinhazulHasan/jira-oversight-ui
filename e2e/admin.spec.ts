import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

/** How many of the page's requests are in flight, counted from now on (a request fails when a move cuts it off). */
function inFlight(page: Page): () => number {
  const pending = new Set<Request>();
  page.on("request", (request) => pending.add(request));
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => pending.delete(request));
  return () => pending.size;
}

async function settled(page: Page, pending: () => number) {
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
  let quietSince = Date.now();
  await expect
    .poll(
      () => {
        if (pending() > 0) quietSince = Date.now();
        return Date.now() - quietSince >= 500;
      },
      { intervals: [100], timeout: 20_000 },
    )
    .toBe(true);
}

const logTable = (page: Page) => page.getByRole("table", { name: "Access log" });
const rows = (page: Page) => logTable(page).locator("tbody tr");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
});

test("the rail has a Governance group with the Access log and Usage; Governance opens on the access log", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByRole("navigation", { name: "Primary" });
  await expect(rail.getByText("Governance", { exact: true })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Access log" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Usage" })).toBeVisible();
  await page.goto("/governance");
  await expect(page).toHaveURL(/\/governance\/access-log$/);
  await expect(page.getByRole("heading", { level: 1, name: "Access log" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Access log" })).toHaveAttribute("aria-current", "page");
});

test("Governance's own address is a real redirect to the access log, before anything is drawn, and opening it logs nothing (JO-14)", async ({
  page,
  request,
}) => {
  const answer = await request.get("/governance", { maxRedirects: 0 });
  expect(answer.status()).toBe(307);
  expect(new URL(answer.headers().location, "http://localhost").pathname).toBe("/governance/access-log");
  const problems = watchConsole(page);
  const pending = inFlight(page);
  const response = (await page.goto("/governance"))!;
  // The browser followed the server's redirect: the first page it drew is the access log.
  expect(new URL(response.request().redirectedFrom()!.url()).pathname).toBe("/governance");
  await expect(page).toHaveURL(/\/governance\/access-log$/);
  await expect(page.getByRole("heading", { level: 1, name: "Access log" })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await settled(page, pending);
  for (const from of ["/", "/issues/DEMO-1"]) {
    await page.goto(from);
    await settled(page, pending);
    await page.goto("/governance");
    await expect(page).toHaveURL(/\/governance\/access-log$/);
    await expect(rows(page).first()).toBeVisible();
    await settled(page, pending);
  }
  expect(problems).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the access log lists who read whose figures, newest first, and passes axe (${colorScheme})`, async ({ page }) => {
    const problems = watchConsole(page);
    await page.emulateMedia({ colorScheme });
    await page.goto("/governance/access-log");
    await expect(rows(page)).toHaveCount(50);
    const first = rows(page).first();
    // The reader's own zone, on the 12-hour clock every time in the app reads on; no zone named.
    await expect(first).toContainText(/4 Nov 2026, \d{1,2}:\d{2}\s[AP]M/);
    // Views of the log itself are left out unless picked (SQA): the first row is a read of someone's figures.
    await expect(rows(page).filter({ hasText: "Viewed the access log" })).toHaveCount(0);
    await expect(first).toContainText("Viewed a scorecard");
    await expect(first.getByRole("button", { name: "Ada Brooks", exact: true })).toBeVisible();
    // The table's line (the phone list carries the same words, laid out only on a phone): when it was read.
    await expect(
      page.getByText(/50 entries so far, newest first, as of .+\. Views of this log are left out\./).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Europe/London");
    expect(await axeBlocking(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test(`usage: today's figures, no budget set, the last 7 days; axe passes (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/governance/usage");
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Today's figures" })).toContainText("Questions");
    await expect(page.getByText(/No daily AI budget is set/)).toBeVisible();
    const days = page.getByRole("list", { name: "Tokens a day" });
    await expect(days.getByRole("listitem")).toHaveCount(7);
    await expect(days.getByRole("listitem").last()).toContainText("Today");
    expect(await axeBlocking(page)).toEqual([]);
  });
}

test("a person's pill filters the log to reads of their figures; the address keeps it; Clear filters undoes it", async ({ page }) => {
  await page.goto("/governance/access-log");
  await rows(page).first().getByRole("button", { name: "Ada Brooks", exact: true }).click();
  await expect(page).toHaveURL(/person=p[0-9a-f]{12}/);
  await expect(rows(page).first()).toBeVisible();
  const count = await rows(page).count();
  for (let index = 0; index < Math.min(count, 10); index += 1) {
    await expect(rows(page).nth(index)).toContainText("Ada Brooks");
  }
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/governance\/access-log$/);
  await expect(rows(page)).toHaveCount(50);
});

test("filters by action from the address, and Show 50 more follows the cursor", async ({ page }) => {
  await page.goto("/governance/access-log?action=scorecard_view");
  await expect(rows(page).first()).toContainText("Viewed a scorecard");
  const shown = await rows(page).allTextContents();
  expect(shown.every((text) => text.includes("Viewed a scorecard"))).toBe(true);

  await page.goto("/governance/access-log");
  await expect(rows(page)).toHaveCount(50);
  await page.getByRole("button", { name: "Show 50 more" }).click();
  await expect(rows(page)).toHaveCount(100);
});

test("a period from the presets: the last 7 days to the log's today, in the address as calendar days", async ({ page }) => {
  await page.goto("/governance/access-log");
  await expect(rows(page)).toHaveCount(50);
  await page.getByRole("button", { name: /^Period:/ }).click();
  await page.getByRole("radio", { name: /Last 7 days/ }).click();
  await expect(page).toHaveURL(/from=2026-10-29&to=2026-11-04/);
  await expect(page.getByRole("button", { name: "Period: Last 7 days" })).toBeVisible();
});

test("Export CSV saves every entry the filters keep, and says the export is recorded", async ({ page }) => {
  await page.goto("/governance/access-log?action=person_ask");
  await expect(rows(page).first()).toContainText("Asked about people");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^access-log-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect(page.getByText(/entries saved as/)).toBeVisible();
});

test("with a daily AI budget set, a meter of how much is used", async ({ page }) => {
  await page.route("**/api/oversight/usage", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { today: Record<string, number | null> };
    const used = Number(body.today.input_tokens) + Number(body.today.output_tokens);
    const budget = Math.round(used / 0.42);
    await route.fulfill({ response, json: { ...body, today: { ...body.today, budget_tokens: budget, budget_used_pct: Math.round((1000 * used) / budget) / 10 } } });
  });
  await page.goto("/governance/usage");
  const meter = page.getByRole("meter", { name: "Today's AI budget" });
  await expect(meter).toBeVisible();
  // The share once, as a whole percentage (the meter's), and what is left under it.
  const block = page.locator("[data-usage-budget='set']");
  await expect(block).toContainText("42%");
  await expect(block).toContainText(/tokens left today\./);
  await expect(block).not.toContainText("42.0%");
  expect(await axeBlocking(page)).toEqual([]);
});

test("the access log reads its first page anew on coming back to it, and Refresh reads it again on request", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/oversight/access-log") reads.push(request.url());
  });
  await page.goto("/governance/access-log");
  await expect(rows(page)).toHaveCount(50);
  await page.getByRole("button", { name: "Show 50 more" }).click();
  await expect(rows(page)).toHaveCount(100);
  // Away and back through the rail: the first page alone, read again (never every page read before).
  const rail = page.getByRole("navigation", { name: "Primary" });
  await rail.getByRole("link", { name: "Usage" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
  const before = reads.length;
  await rail.getByRole("link", { name: "Access log" }).click();
  await expect(rows(page)).toHaveCount(50);
  await expect.poll(() => reads.length).toBe(before + 1);
  expect(new URL(reads.at(-1)!).searchParams.get("cursor")).toBeNull();
  await page.getByRole("button", { name: "Refresh" }).filter({ visible: true }).click();
  await expect.poll(() => reads.length).toBe(before + 2);
});

test("a scorecard is never read again on its own when the window comes back into focus", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/oversight/people/scorecard") reads.push(request.url());
  });
  await page.clock.install({ time: new Date("2026-11-04T14:32:00Z") });
  await page.goto("/people");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  const before = reads.length;
  // Two minutes on (past a minute of freshness), then away and back: every read is an access log entry.
  await page.clock.fastForward("02:00");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(500);
  expect(reads.length).toBe(before);
});

test("the filters offer everyone the log holds, and a choice from the address it does not hold reads in plain words", async ({ page }) => {
  await page.goto("/governance/access-log?action=access_log_export");
  await expect(rows(page).first()).toContainText("Exported the access log");
  await page.getByRole("button", { name: /^Viewer/ }).click();
  // Every viewer the log holds, not only the ones the filtered entries show.
  await expect(page.getByRole("option", { name: "Tobias Wren" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/governance/access-log?person=p0123456789ab&viewer=${"0".repeat(32)}`);
  await expect(page.getByRole("button", { name: /^Whose figures/ })).toContainText("Someone not in the log");
  await expect(page.getByRole("button", { name: /^Viewer/ })).toContainText("Someone not in the log");
  await expect(page.locator("main")).not.toContainText("filtered by");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ["/governance/access-log", "/governance/usage"]) {
    test(`${path} never moves the page sideways, and passes axe`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // On a phone the log is one compact entry per read, never a table to scroll sideways.
      if (path.endsWith("access-log")) await expect(page.getByRole("list", { name: "Access log entries" }).getByRole("listitem")).toHaveCount(50);
      else await expect(page.getByRole("list", { name: "Tokens a day" }).getByRole("listitem")).toHaveCount(7);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});
