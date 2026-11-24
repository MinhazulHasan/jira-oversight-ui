import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { cutText } from "./cut-text";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const NOW = new Date("2026-11-04T14:30:00Z");

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

async function shellReady(page: Page) {
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
}

function processMap(page: Page) {
  return page.getByRole("list", { name: "The agreed process, in order" });
}

function catalogue(page: Page) {
  return page.getByRole("table", { name: "Rules" });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("the process and its rules read clearly and pass axe", async ({ page }) => {
      const problems = watchConsole(page);
      await page.goto("/process");
      await shellReady(page);

      await expect(page.getByRole("heading", { level: 1, name: "Process" })).toBeVisible();
      const stages = processMap(page).locator(":scope > li");
      await expect(stages).toHaveCount(9);
      await expect(stages.nth(0)).toContainText("Backlog");
      await expect(stages.nth(3)).toContainText("Code review");
      await expect(stages.nth(3)).toContainText("Not measurable");
      await expect(stages.nth(8)).toContainText("Done");
      await expect(page.getByText("These rules can't run: Jira doesn't record the steps they need.")).toBeVisible();

      await expect(catalogue(page).locator("tbody tr")).toHaveCount(12);
      await expect(catalogue(page).getByRole("link", { name: "270 open findings for R-EST-01" })).toBeVisible();

      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test("the first screen on a 14-inch MacBook shows the whole process and the finding", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/process");
  await shellReady(page);

  // All nine stages sit on one line, inside the first screen.
  const stages = processMap(page).locator(":scope > li");
  // The map arrives after the top bar: measure it once it is all there.
  await expect(stages).toHaveCount(9);
  const tops = await stages.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(stages.nth(8)).toBeInViewport();
  await expect(page.getByText("These rules can't run: Jira doesn't record the steps they need.")).toBeInViewport();
});

test("a rule opens in a drawer from its row, and the URL holds it", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/process");
  await shellReady(page);

  await catalogue(page).getByRole("row", { name: /R-EST-01/ }).click();
  const drawer = page.getByRole("dialog", { name: "Work started without an estimate" });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/\/process\?rule=R-EST-01$/);
  await expect(drawer.getByRole("link", { name: /View findings/ })).toHaveAttribute("href", "/findings?rule=R-EST-01");
  expect(await axeBlocking(page)).toEqual([]);

  await drawer.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Estimate first set after work started" })).toBeVisible();
  await expect(page).toHaveURL(/rule=R-EST-02/);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(/\/process$/);

  await page.goto("/process?rule=W-REV-01");
  const warning = page.getByRole("dialog", { name: "No review evidence yet" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Jira holds no code review evidence");
  await expect(warning.getByRole("button", { name: /View findings/ })).toHaveAttribute("aria-disabled", "true");
  expect(problems).toEqual([]);
});

test("keyboard: j and k move through the rules, Enter opens, Escape closes", async ({ page }) => {
  await page.goto("/process");
  await shellReady(page);
  await expect(catalogue(page).locator("tbody tr")).toHaveCount(12);

  await page.keyboard.press("j");
  await expect(catalogue(page).getByRole("row", { name: /R-EST-01/ })).toBeFocused();
  await page.keyboard.press("j");
  await expect(catalogue(page).getByRole("row", { name: /R-EST-02/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Estimate first set after work started" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(catalogue(page).getByRole("row", { name: /R-EST-02/ })).toBeFocused();
});

test("open findings lead to the filtered findings", async ({ page }) => {
  await page.goto("/process");
  await shellReady(page);
  await catalogue(page).getByRole("link", { name: "270 open findings for R-EST-01" }).click();
  await expect(page).toHaveURL(/\/findings\?rule=R-EST-01$/);
});

test("the sort lives in the URL and survives a reload", async ({ page }) => {
  await page.goto("/process");
  await shellReady(page);

  await catalogue(page).getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/sort=open&order=desc/);
  await expect(catalogue(page).locator("tbody tr").first()).toContainText("R-EST-01");
  await expect(catalogue(page).locator("tbody tr").nth(2)).toContainText("R-FLOW-02");

  await page.reload();
  await expect(catalogue(page).locator("tbody tr").nth(2)).toContainText("R-FLOW-02");
  await expect(page.getByText("sorted by open findings, most first")).toBeVisible();
});

test("Export CSV saves the catalogue as shown and says so", async ({ page }) => {
  await page.goto("/process");
  await shellReady(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("rule-catalogue-2026-11-04.csv");
  await expect(page.getByText("Export ready")).toBeVisible();
});

test("a failed load is said once, inline, with a way to try again", async ({ page }) => {
  let failing = true;
  await page.route("**/api/oversight/rules", (route) =>
    failing
      ? route.fulfill({ status: 502, json: { error: "upstream_error", message: "The oversight service failed." } })
      : route.fallback(),
  );
  await page.goto("/process");
  await shellReady(page);

  const alert = page.getByRole("alert").filter({ hasText: "Couldn't load the process and its rules" });
  // The query client retries a 5xx twice, one and then two seconds apart, before it gives up.
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText("HTTP 502 · upstream_error");
  expect(await axeBlocking(page)).toEqual([]);

  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(processMap(page)).toBeVisible();
});

test("on a phone the flow wraps and the page never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/process");
  await shellReady(page);
  await expect(processMap(page).locator(":scope > li")).toHaveCount(9);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await axeBlocking(page)).toEqual([]);
});

test("on a phone the catalogue gives its titles room, as it scrolls sideways anyway; on a MacBook it still fits whole (JO-14)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/process");
  await shellReady(page);
  // The rules themselves, not the rows drawn while they load (a loading catalogue is eight skeleton rows).
  await expect(catalogue(page).getByRole("cell", { name: "Unestimated work in the active sprint" })).toBeVisible();
  expect((await catalogue(page).getByRole("columnheader", { name: /^Title/ }).boundingBox())!.width).toBeGreaterThanOrEqual(176);
  const lines = await catalogue(page)
    .locator("tbody tr td:nth-child(2)")
    .evaluateAll((cells) =>
      cells.map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const word = cell.textContent!.indexOf("Unestimated");
        const split = (() => {
          if (word < 0) return false;
          const text = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT).nextNode()!;
          const part = document.createRange();
          part.setStart(text, text.textContent!.indexOf("Unestimated"));
          part.setEnd(text, text.textContent!.indexOf("Unestimated") + "Unestimated".length);
          return new Set([...part.getClientRects()].map((rect) => Math.round(rect.top))).size > 1;
        })();
        return { title: cell.textContent, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size, split };
      }),
    );
  expect(lines.filter((cell) => cell.lines > 2 || cell.split)).toEqual([]);
  expect(lines.some((cell) => cell.title?.includes("Unestimated"))).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  const sideways = await catalogue(page).evaluate((table) => {
    const scroller = table.closest(".jo-scroller")!;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(sideways).toBeLessThanOrEqual(0);
  const notMeasurable = catalogue(page).getByRole("cell").filter({ hasText: /^No\b/ });
  await expect(notMeasurable.first()).toBeVisible();
  const cut = await notMeasurable.evaluateAll((cells) =>
    cells.flatMap((cell) => {
      const right = cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight);
      const found: string[] = [];
      for (const element of cell.querySelectorAll("*")) {
        if (getComputedStyle(element).textOverflow === "ellipsis") found.push(`ellipsis: ${element.textContent!.trim()}`);
      }
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent!.trim() || node.parentElement!.closest(".sr-only")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some((rect) => rect.right > right + 0.5)) found.push(`past the cell: ${node.textContent!.trim()}`);
      }
      return found;
    }),
  );
  expect(cut).toEqual([]);
});

test("on a phone the rules that cannot run read whole, and no rule's title is clipped in the catalogue", async ({ page }) => {
  // Regression: at 390 px "R-FLOW-01 Reached testing without code …" was cut, with no way to read it on the page.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/process");
  await shellReady(page);
  const blocked = page.locator("[data-blocked-rule-title]");
  await expect(blocked.filter({ hasText: "Reached testing without code review" })).toBeVisible();
  const callout = page.locator("aside").filter({ has: blocked.first() });
  expect(await cutText(callout)).toEqual([]);
  await expect(catalogue(page).locator("tbody tr").first()).toBeVisible();
  // The catalogue scrolls sideways in its frame on a phone; its titles wrap there, a long word hyphenated, never cut.
  const titles = await catalogue(page)
    .locator("tbody tr td:nth-child(2)")
    .evaluateAll((cells) => cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1).map((cell) => cell.textContent));
  expect(titles).toEqual([]);
});
