import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { readableClipboard } from "./clipboard";

const ROUTES = [
  { path: "/", heading: "Overview", title: "Overview" },
  { path: "/findings", heading: "Findings", title: "Findings" },
  { path: "/issues/DEMO-1", heading: "DEMO-1", title: "DEMO-1" },
  { path: "/ask", heading: "Ask", title: "Ask" },
  { path: "/insights", heading: "Insights", title: "Insights" },
  { path: "/process", heading: "Process", title: "Process" },
  { path: "/baseline", heading: "Baseline", title: "Baseline" },
] as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Console errors and uncaught exceptions, including Content Security Policy violations. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`Uncaught: ${error.message}`));
  return problems;
}

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(" ")),
    }));
}

/** The shell has settled once the data source has answered. */
async function shellReady(page: Page) {
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Chromium reports CSP violations to the console, but only once per directive; the event sees all of them.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const route of ROUTES) {
      test(`${route.path} renders its header, logs nothing and passes axe`, async ({ page }) => {
        const problems = watchConsole(page);
        const response = await page.goto(route.path);
        expect(response?.status()).toBe(200);

        await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
        await expect(page).toHaveTitle(`${route.title} · Jira Oversight`);
        await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
        await expect(page.getByRole("main")).toBeVisible();
        await shellReady(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);

        expect(await axeBlocking(page)).toEqual([]);
        expect(problems).toEqual([]);
      });
    }
  });
}

test("an unknown address is a real 404, inside the shell", async ({ page }) => {
  const problems = watchConsole(page);
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Nothing at this address" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await shellReady(page);
  // SQA: the tab says what it is, and the mark's box holds its icon.
  await expect(page).toHaveTitle("Page not found · Jira Oversight");
  await expect(page.locator("[data-not-found-mark] svg")).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
  // The 404 itself is the only error the browser may report.
  expect(problems.filter((problem) => !problem.includes("404"))).toEqual([]);
});

test("Cmd/Ctrl+K opens the palette, and an issue key offers to open it", async ({ page }) => {
  await page.goto("/");
  await shellReady(page);

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
  // Go-live (SQA): the footer is key hints only, no self-praising line.
  await expect(palette).not.toContainText("Every figure traces back to Jira");

  await page.keyboard.type("demo-12");
  await expect(palette.getByRole("option", { name: /Open DEMO-12/ })).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/issues\/DEMO-12$/);
  await expect(page.getByRole("heading", { level: 1, name: "DEMO-12" })).toBeVisible();
});

test("the search button opens the palette, and a question goes to Ask", async ({ page }) => {
  await page.goto("/findings");
  await shellReady(page);

  await page.getByRole("button", { name: "Search or jump to" }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("where do tickets get stuck");
  await expect(palette.getByRole("option", { name: /Ask .where do tickets get stuck/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ask\?q=where(\+|%20)do(\+|%20)tickets/);

  await page.keyboard.press("ControlOrMeta+K");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("g then a letter navigates, and never while typing", async ({ page }) => {
  await page.goto("/");
  await shellReady(page);
  await expect(page.getByRole("region", { name: "Headline figures" }).getByRole("link").first()).toBeVisible();

  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await expect(page).toHaveURL(/\/findings$/);

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("ControlOrMeta+K");
  await expect(palette).toBeVisible();
  await page.keyboard.type("gb");
  await expect(page).toHaveURL(/\/findings$/);
  await page.keyboard.press("Escape");
  // Until it has gone, focus is still in its field, where single keys are typing.
  await expect(palette).toBeHidden();

  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("the theme menu switches the theme and remembers it", async ({ page }) => {
  await page.goto("/");
  await shellReady(page);

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("Dark theme", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: /Light/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the board picker names the board served and lists the boards", async ({ page }) => {
  await page.goto("/findings");
  await shellReady(page);

  const picker = page.getByRole("banner").getByRole("button", { name: /^Board: Demo project/ });
  await expect(picker).toBeVisible();
  await picker.click();
  const boards = page.getByRole("listbox", { name: "Boards" });
  const option = boards.getByRole("option", { name: /Demo project/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(option).toContainText(/ago/);
  await expect(boards.getByRole("group", { name: "Synced", exact: true }).getByRole("option")).toHaveCount(2);
  await expect(boards.getByRole("group", { name: "Not synced yet", exact: true }).getByRole("option", { name: /Help desk/ })).toBeVisible();

  // Picking the board already shown changes nothing.
  await option.click();
  await expect(page).toHaveURL(/\/findings$/);
});

test("on a phone the board picker sits in the navigation sheet, and nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/findings");
  await shellReady(page);
  await expect(page.getByRole("banner").getByRole("button", { name: /^Board: / })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const sheet = page.getByRole("dialog", { name: "Navigation" });
  await sheet.getByRole("button", { name: /^Board: Demo project/ }).click();
  await expect(page.getByRole("listbox", { name: "Boards" }).getByRole("option", { name: /Demo project/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Search boards" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a board the service does not serve is forgotten, not shown broken", async ({ page, context, baseURL }) => {
  // The sample answers a board it does not serve 404 unknown_board, as the service does: the pick is forgotten.
  await context.addCookies([{ name: "jo-board", value: "ZZZ", url: baseURL ?? "http://localhost:3400" }]);
  await page.goto("/");
  // The top bar forgets the pick and reloads the page on the default board.
  await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "jo-board")?.value ?? "", { timeout: 15_000 }).toBe("");
  await expect(page.getByRole("banner").getByRole("button", { name: /^Board: Demo project/ })).toBeVisible({ timeout: 15_000 });
  await shellReady(page);
});

test("on a phone the top bar still says which board the page is about (SQA)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("banner").locator("[data-board-in-bar]")).toHaveText(/DEMO/);
  await expect(page.getByRole("banner").getByText("Overview", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the data source says what it is in a line, names the board, and nothing a developer reads (SQA)", async ({ page }) => {
  await page.goto("/");
  await shellReady(page);
  await page.getByRole("banner").getByRole("button", { name: /Sample data/ }).click();
  const details = page.getByRole("dialog").filter({ hasText: "Data source" });
  await expect(details).toContainText("Fictional boards for trying the dashboard. No real work or people.");
  await expect(details.locator("dt", { hasText: /^Board$/ })).toBeVisible();
  await expect(details).not.toContainText(/API version|Projects|bundled with the interface/);
});

test("the sync time is Sync for the board on screen, and names it", async ({ page }) => {
  await page.goto("/");
  await shellReady(page);
  // Named by its action alone (SQA): the sync time is its description, not part of its name.
  const sync = page.getByRole("banner").getByRole("button", { name: "Sync Demo project", exact: true });
  await expect(sync).toHaveAttribute("data-sync-state", "synced");
  await sync.hover();
  await expect(page.getByRole("tooltip")).toContainText("Sync Demo project");
});

test("the rail collapses to icons and remembers it", async ({ page }) => {
  await page.goto("/insights");
  await shellReady(page);
  const rail = page.getByRole("complementary", { name: "Sidebar" });

  await rail.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  await expect(rail.getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  await rail.getByRole("button", { name: "Expand navigation" }).click();
  await expect(rail).toHaveAttribute("data-collapsed", "false");
});

test.describe("acknowledgement", () => {
  test.beforeEach(readableClipboard);

  test("Copy link copies the address and says so", async ({ page }) => {
    await page.goto("/findings?severity=breach");
    await shellReady(page);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/findings\?severity=breach$/);
  });
});

test("every page response carries the security headers", async ({ request }) => {
  const first = await request.get("/");
  const second = await request.get("/");
  const headers = first.headers();

  const policy = headers["content-security-policy"];
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'(;|$)/);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain("unsafe-eval");
  expect(second.headers()["content-security-policy"]).not.toBe(policy);

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("data older than two hours says so", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
  await page.route("**/api/oversight/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        data_mode: "sample",
        read_only: true,
        api_version: "0.1.0",
        last_synced_at: "2026-11-04T11:02:00.000Z",
        projects: ["DEMO"],
        report_timezone: "Europe/London",
      },
    }),
  );
  await page.goto("/");
  const button = page.getByRole("banner").getByRole("button", { name: "Sync Demo project", exact: true });
  await expect(button).toHaveAccessibleDescription(/^Stale\. Last synced /);
  // The pill the button is the mark of: the state drawn beside it.
  const synced = page.getByRole("banner").locator("[data-sync-now]");
  await expect(synced).toBeVisible();
  await expect(synced).toContainText("Stale");
  // The 12-hour clock in the reader's own zone, never named: as the rule settings page and every time in the app read.
  await expect(synced).toContainText(/11:02\sAM/);
  await expect(synced).not.toContainText("GMT");
  await expect(synced).toContainText("4 h ago");
  expect(await axeBlocking(page)).toEqual([]);
});

test("the health endpoint answers in sample mode", async ({ request }) => {
  const response = await request.get("/api/oversight/health");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body).toMatchObject({ status: "ok", data_mode: "sample", read_only: true, projects: ["DEMO"] });
});
