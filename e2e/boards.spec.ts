import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The pages that read the board picked in the top bar, by their heading. */
const BOARD_PAGES = [
  { path: "/", heading: "Overview" },
  { path: "/findings", heading: "Findings" },
  { path: "/people", heading: "People" },
  { path: "/ask", heading: "Ask" },
  { path: "/insights", heading: "Insights" },
  { path: "/process", heading: "Process" },
  { path: "/baseline", heading: "Baseline" },
  { path: "/governance/rules", heading: "Rule settings" },
  { path: "/issues/HELP-1", heading: "Issue" },
] as const;

/** The pages that belong to no one board: the same whichever board is picked. */
const BOARDLESS_PAGES = [
  { path: "/portfolio", heading: "Portfolio" },
  { path: "/governance/access-log", heading: "Access log" },
  { path: "/governance/usage", heading: "Usage" },
] as const;

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
    .map((violation) => ({ id: violation.id, help: violation.help, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

async function pickBoard(page: Page, key: string, baseURL: string | undefined) {
  await page.context().addCookies([{ name: "jo-board", value: key, url: baseURL ?? "http://localhost:3400" }]);
}

const notSynced = (page: Page) => page.getByRole("region", { name: "Help desk hasn’t been synced yet." });

test.describe("the board picker", () => {
  test("is keyboard-complete: open it, type to search, arrow to a board, and Enter opens that board", async ({ page }) => {
    await page.goto("/findings");
    const picker = page.getByRole("banner").getByRole("button", { name: /^Board: Demo project/ });
    await expect(picker).toBeVisible();
    await picker.focus();
    await page.keyboard.press("Enter");
    const search = page.getByRole("combobox", { name: "Search boards" });
    await expect(search).toBeFocused();
    await page.keyboard.type("mob");
    const boards = page.getByRole("listbox", { name: "Boards" });
    await expect(boards.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    // The same page, on the board picked: its own figures.
    await expect(page).toHaveURL(/\/findings$/);
    await expect(page.getByRole("banner").getByRole("button", { name: /^Board: Mobile app/ })).toBeVisible();
    await expect(page.getByRole("main").getByText(/^MOB-\d+$/).first()).toBeVisible();
    expect((await page.context().cookies()).find((cookie) => cookie.name === "jo-board")?.value).toBe("MOB");
  });

  test("clears the search with the first Escape and closes with the next, back on its button", async ({ page }) => {
    await page.goto("/");
    const picker = page.getByRole("banner").getByRole("button", { name: /^Board: / });
    await picker.click();
    const search = page.getByRole("combobox", { name: "Search boards" });
    await search.fill("nothing like it");
    await expect(page.getByText("No board matches “nothing like it”.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    await expect(picker).toBeFocused();
  });

  test("holds dozens of boards, grouped, searchable by name or key, and passes axe in both themes", async ({ page }) => {
    const sample = (await (await page.request.get("/api/oversight/projects")).json()) as { default: string; projects: Record<string, unknown>[] };
    const synced = sample.projects.find((board) => board.key === "DEMO")!;
    const extra = Array.from({ length: 36 }, (_, index) =>
      index % 4 === 0
        ? { key: `NEW${index + 10}`, name: `New programme ${index + 10}`, issues: 0, last_synced_at: null, synced: false, type: "business" }
        : { ...synced, key: `TEAM${index + 10}`, name: `Team ${index + 10} delivery` },
    );
    await page.route("**/api/oversight/projects", (route) => route.fulfill({ json: { ...sample, projects: [...sample.projects, ...extra] } }));
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/findings");
      await page.getByRole("banner").getByRole("button", { name: /^Board: / }).click();
      const boards = page.getByRole("listbox", { name: "Boards" });
      await expect(boards.getByRole("group", { name: "Synced", exact: true }).getByRole("option")).toHaveCount(29);
      await expect(boards.getByRole("group", { name: "Not synced yet", exact: true }).getByRole("option")).toHaveCount(10);
      // The list scrolls inside the picker; the page never does.
      const box = await boards.boundingBox();
      expect(box?.height ?? 0).toBeLessThanOrEqual(400);
      expect(await axeBlocking(page)).toEqual([]);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("banner").getByRole("button", { name: /^Board: / }).click();
    await page.getByRole("combobox", { name: "Search boards" }).fill("team3");
    await expect(page.getByRole("listbox", { name: "Boards" }).getByRole("option")).toHaveCount(7);
  });
});

test.describe("a board that has never synced", () => {
  test("can be picked, and every page that reads it offers its first sync instead of an error", async ({ page, baseURL }) => {
    const problems = watchConsole(page);
    await pickBoard(page, "HELP", baseURL);
    for (const { path, heading } of BOARD_PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
      await expect(notSynced(page), path).toBeVisible();
      await expect(notSynced(page).getByText("The first sync of a large board can take a few minutes."), path).toBeVisible();
      await expect(notSynced(page).getByRole("button", { name: "Sync Help desk" }), path).toBeVisible();
      await expect(page.getByText(/could not be loaded|Something went wrong/), path).toHaveCount(0);
      // Settled before the next page: a link's prefetch cut short by leaving is no fault of the page.
      await page.waitForLoadState("networkidle");
    }
    const cutPrefetch = (problem: string) => problem.includes("?_rsc=") && problem.includes("access control checks");
    expect(problems.filter((problem) => !problem.includes("409") && !cutPrefetch(problem))).toEqual([]);
  });

  test("says so in the top bar, where Sync names it, and on the board picker's button", async ({ page, baseURL }) => {
    await pickBoard(page, "HELP", baseURL);
    await page.goto("/findings");
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("button", { name: /^Board: Help desk/ })).toBeVisible();
    const sync = banner.getByRole("button", { name: "Sync Help desk", exact: true });
    await expect(sync).toBeVisible();
    await expect(sync).toHaveAttribute("data-sync-state", "not-synced");
    await expect(banner.getByRole("button", { name: /Data source unreachable/ })).toHaveCount(0);
  });

  test("leaves the pages that belong to no one board as they are", async ({ page, baseURL }) => {
    await pickBoard(page, "HELP", baseURL);
    for (const { path, heading } of BOARDLESS_PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
      await expect(notSynced(page), path).toHaveCount(0);
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`its state passes axe and fits a phone (${colorScheme})`, async ({ page, baseURL }) => {
      await page.emulateMedia({ colorScheme });
      await pickBoard(page, "HELP", baseURL);
      await page.goto("/");
      await expect(notSynced(page)).toBeVisible();
      expect(await axeBlocking(page)).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(notSynced(page).getByRole("button", { name: "Sync Help desk" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }
});
