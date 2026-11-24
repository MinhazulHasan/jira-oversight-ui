import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { readableClipboard } from "./clipboard";
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

function aboutReport(page: Page) {
  return page.getByRole("group", { name: "About this report" });
}

/** The status table, the last block to draw its rows: once it has them, the report is in. */
function statuses(page: Page) {
  return page.getByRole("table", { name: "Hours in each status" });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("the report reads in full and passes axe", async ({ page }) => {
      const problems = watchConsole(page);
      await page.goto("/baseline");
      await shellReady(page);

      await expect(page.getByRole("heading", { level: 1, name: "Baseline" })).toBeVisible();
      await expect(aboutReport(page)).toContainText("6 Aug 2026 – 3 Nov 2026");
      await expect(aboutReport(page)).toContainText("90 days");

      await expect(page.getByRole("meter", { name: "Story points" })).toHaveAttribute("aria-valuetext", "62%, 192 of 308 issues");
      await expect(page.getByRole("meter", { name: "Logged time" })).toHaveAttribute("aria-valuetext", "84%, 260 of 308 issues");
      await expect(page.getByRole("meter", { name: "Straight from To Do to Done" })).toHaveAttribute(
        "aria-valuetext",
        "10%, 30 of 308 issues",
      );
      await expect(page.getByRole("table", { name: "Hours in each status" }).getByRole("rowheader")).toHaveCount(3);
      await expect(page.getByText("Jira holds no evidence for 5 steps of the agreed process")).toBeVisible();
      // Go-live (SQA): no audit comparison, run id or process version, which only the prototype needed.
      await expect(page.locator("main")).not.toContainText(/reference audit|figures match|ticket 4|run 996e1dde|process 0\.1\.0/i);

      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test("the first screen on a 14-inch MacBook shows the window, the snapshot and the coverage", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/baseline");
  await shellReady(page);

  await expect(aboutReport(page)).toBeInViewport();
  await expect(page.getByRole("region", { name: "Snapshot totals" })).toBeInViewport();
  await expect(page.getByRole("meter", { name: "Original estimates" })).toBeInViewport();
  await expect(page.getByRole("meter", { name: "Logged time" })).toBeInViewport();
});

test.describe("page actions", () => {
  test.beforeEach(readableClipboard);

  test("Copy link and Print each do their job and say so", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => {
        (window as unknown as { printed: number }).printed += 1;
      };
    });
    await page.goto("/baseline");
    await shellReady(page);
    await expect(statuses(page).getByRole("rowheader")).toHaveCount(3);

    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/baseline$/);

    await page.getByRole("button", { name: "Print" }).click();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  });
});

test("printed, the report keeps its content and drops the controls", async ({ page }) => {
  await page.goto("/baseline");
  await shellReady(page);
  await expect(statuses(page).getByRole("rowheader")).toHaveCount(3);

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.getByRole("meter", { name: "Logged time" })).toBeVisible();
  await expect(statuses(page)).toBeVisible();
});

test("before the first report, the page says there is no baseline yet", async ({ page }) => {
  const problems = watchConsole(page);
  await page.route("**/api/oversight/baseline/latest", (route) =>
    route.fulfill({ status: 404, json: { error: "not_found", message: "No baseline report has been generated yet." } }),
  );
  await page.goto("/baseline");
  await shellReady(page);

  await expect(page.getByText("No baseline yet")).toBeVisible();
  // In the page: Next's route announcer is an alert of its own, outside main.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(await axeBlocking(page)).toEqual([]);
  // The 404 itself is the only error the browser may report.
  expect(problems.filter((problem) => !problem.includes("404"))).toEqual([]);
});

test("a failed load is said once, inline, with a way to try again", async ({ page }) => {
  let failing = true;
  await page.route("**/api/oversight/baseline/latest", (route) =>
    failing
      ? route.fulfill({ status: 503, json: { error: "upstream_unavailable", message: "The oversight service is unavailable." } })
      : route.fallback(),
  );
  await page.goto("/baseline");
  await shellReady(page);

  const alert = page.getByRole("alert").filter({ hasText: "Couldn't load the baseline report" });
  // The query client retries a 5xx twice, one and then two seconds apart, before it gives up.
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText("HTTP 503 · upstream_unavailable");
  expect(await axeBlocking(page)).toEqual([]);

  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(aboutReport(page)).toBeVisible();
});

test("every tile's label reads whole on a MacBook, the figures under them level, and each link type on a phone (JO-14)", async ({ page }) => {
  await page.goto("/baseline");
  await shellReady(page);
  const flow = page.getByRole("region", { name: "Cycle time and reopens" });
  await expect(flow.getByText("Reopened after Done")).toBeVisible();
  // Measured once the figures are in: a tile draws its label over a skeleton while it loads.
  await expect(flow.locator("[data-figure]")).toHaveCount(2);
  expect(await cutText(flow)).toEqual([]);
  const tops = await flow.locator("[data-figure]").evaluateAll((figures) => figures.map((figure) => figure.getBoundingClientRect().top));
  expect(tops).toHaveLength(2);
  for (const top of tops) expect(Math.abs(top - tops[0])).toBeLessThanOrEqual(0.5);
  for (const tiles of await page.locator("main section[aria-label]").filter({ has: page.locator("[data-tile-label]") }).all()) {
    expect(await cutText(tiles)).toEqual([]);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const links = page.getByRole("list", { name: "Links by type" });
  await expect(links.getByText("is duplicated by")).toBeVisible();
  expect(await cutText(links)).toEqual([]);
  expect(await cutText(flow)).toEqual([]);
});

for (const width of [1280, 1320, 1440]) {
  test(`the snapshot's figures stand level at ${width} px, whichever label takes a second line (the JO-14 review)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/baseline");
    await shellReady(page);
    const snapshot = page.getByRole("region", { name: "Snapshot totals" });
    await expect(snapshot.locator("[data-figure]")).toHaveCount(2);
    expect(await cutText(snapshot)).toEqual([]);
    const tops = await snapshot.locator("[data-figure]").evaluateAll((figures) => figures.map((figure) => figure.getBoundingClientRect().top));
    expect(Math.abs(tops[1] - tops[0])).toBeLessThanOrEqual(0.5);
  });
}

test("on a phone the report stacks and the page never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/baseline");
  await shellReady(page);
  await expect(statuses(page).getByRole("rowheader")).toHaveCount(3);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await axeBlocking(page)).toEqual([]);
});

/** Where the status table draws its scale's ticks and each status's bar, as the reader sees them. */
async function statusPicture(page: Page) {
  const table = page.getByRole("table", { name: "Hours in each status" });
  await expect(table.getByRole("rowheader")).toHaveCount(3);
  await table.scrollIntoViewIfNeeded();
  return table.evaluate((element) => {
    const drawn = (node: Element) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const box = element.getBoundingClientRect();
    const ticks = [...element.querySelectorAll(".jo-chart-text")].filter(drawn).map((tick) => {
      const at = tick.getBoundingClientRect();
      return { text: tick.textContent, left: at.left, right: at.right, top: at.top };
    });
    const tracks = [...new Set([...element.querySelectorAll(".jo-segment")].filter(drawn).map((segment) => segment.parentElement!))];
    const bars = tracks.map((track) => {
      const at = track.getBoundingClientRect();
      return { left: at.left, right: at.right, width: at.width, top: at.top, bottom: at.bottom };
    });
    return { left: box.left, right: box.right, width: box.width, ticks, bars };
  });
}

test("on a phone nothing is cut short: each status's bar runs across the table under a scale that reads", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/baseline");
  await shellReady(page);
  const picture = await statusPicture(page);
  // One scale of five ticks, each clear of the next, all within the table.
  expect(picture.ticks.map((tick) => tick.text)).toEqual(["0 h", "150 h", "300 h", "450 h", "600 h"]);
  for (const [index, tick] of picture.ticks.entries()) {
    if (index > 0) expect(tick.left).toBeGreaterThan(picture.ticks[index - 1].right + 4);
    expect(tick.left).toBeGreaterThanOrEqual(picture.left - 0.5);
    expect(tick.right).toBeLessThanOrEqual(picture.right + 0.5);
  }
  // A bar for each status, as wide as the table, each on its own line under the scale.
  expect(picture.bars).toHaveLength(3);
  for (const [index, bar] of picture.bars.entries()) {
    expect(bar.width).toBeGreaterThan(picture.width - 1);
    expect(bar.top).toBeGreaterThan(index === 0 ? picture.ticks[0].top : picture.bars[index - 1].bottom);
  }

  await expect(statuses(page).locator("[data-range-bar]").first()).toContainText("Backlog · 319 intervals");
  expect(await cutText(statuses(page))).toEqual([]);
  // The worklog facts, and every other description list on the page.
  await expect(page.getByText("People who logged time")).toBeVisible();
  for (const list of await page.locator("main dl").all()) expect(await cutText(list)).toEqual([]);
  expect(await axeBlocking(page)).toEqual([]);
});

test("on a wide screen each status's bar stands in its column, between the status and its figures, the scale above", async ({ page }) => {
  await page.goto("/baseline");
  await shellReady(page);
  const picture = await statusPicture(page);
  const column = await page
    .getByRole("table", { name: "Hours in each status" })
    .getByRole("columnheader", { name: "Distribution" })
    .evaluate((header) => {
      const at = header.getBoundingClientRect();
      return { left: at.left, right: at.right };
    });
  expect(picture.ticks).toHaveLength(5);
  for (const tick of picture.ticks) {
    expect(tick.left).toBeGreaterThanOrEqual(column.left);
    expect(tick.right).toBeLessThanOrEqual(column.right);
  }
  expect(picture.bars).toHaveLength(3);
  for (const bar of picture.bars) {
    expect(bar.left).toBeGreaterThanOrEqual(column.left);
    expect(bar.right).toBeLessThanOrEqual(column.right);
  }
  await expect(page.locator("[data-range-bar]").first()).toBeHidden();
});
