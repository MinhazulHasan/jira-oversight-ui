import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { readableClipboard } from "./clipboard";
import { cutText } from "./cut-text";

/*
 * The Overview: the first screen says where the work stands, every figure
 * opens the findings behind it (and is their count), and each region has
 * its four states. Sample mode, pinned to SAMPLE_NOW (playwright.config.ts),
 * with the browser clock frozen at the same moment.
 */

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const OVERVIEW_API = "**/api/oversight/overview";

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

const tiles = (page: Page) => page.getByRole("region", { name: "Headline figures" }).getByRole("link");
const hotSpotRows = (page: Page) => page.getByRole("list", { name: "Open findings by epic" }).getByRole("link");
const ruleRows = (page: Page) => page.getByRole("list", { name: "Open findings by rule" }).getByRole("link");

/** The figures have arrived once the first tile leads somewhere. */
async function figuresReady(page: Page) {
  await expect(tiles(page).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("the first screen shows the headline figures and the hot spots, logs nothing and passes axe", async ({ page }) => {
      const problems = watchConsole(page);
      await page.goto("/");
      await figuresReady(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);

      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
      await expect(tiles(page)).toHaveCount(4);
      // Whole, to WebKit's subpixel: four columns split the grid's width into quarter pixels, and WebKit's clip reads a
      // tile a third of a pixel short (0.999), though it stands well inside the first screen.
      for (const index of [0, 1, 2, 3]) await expect(tiles(page).nth(index)).toBeInViewport({ ratio: 0.99 });
      await expect(tiles(page).first()).toContainText("Open breaches");
      await expect(tiles(page).first()).toContainText("523");

      // 1440 × 900: the five hot spots sit whole above the fold.
      await expect(hotSpotRows(page)).toHaveCount(5);
      await expect(hotSpotRows(page).first()).toContainText("DEMO-704");
      await expect(hotSpotRows(page).last()).toBeInViewport({ ratio: 1 });

      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test("each region shows its figures: rules, coverage, trends, where work sits, the briefing", async ({ page }) => {
  await page.goto("/");
  await figuresReady(page);

  await expect(ruleRows(page)).toHaveCount(12);
  await expect(ruleRows(page).first()).toContainText("R-EST-01");
  await expect(ruleRows(page).nth(10)).toContainText("No code review or testing in Jira");

  const coverage = page.getByRole("region", { name: "Coverage" });
  await expect(coverage.getByRole("meter", { name: "Estimates" })).toHaveAttribute("aria-valuetext", "61%, 187 of 309 issues");
  await expect(coverage.getByText("Not measurable", { exact: true })).toHaveCount(2);

  const trends = page.getByRole("region", { name: "Trends" });
  await expect(trends.getByRole("figure")).toHaveCount(4);
  await expect(trends.getByText("Breach at 1.50× (R-EFF-01)")).toBeVisible();

  await expect(page.getByText("68 of 1,136 issues are open: 39 not started, 29 in progress.")).toBeVisible();

  const insight = page.getByRole("region", { name: "Latest insight" });
  await expect(insight.getByText(/DEMO-704 Data import pipeline has 73 open breaches/)).toBeVisible();
  await expect(insight.getByText("Week of 2 Nov 2026")).toBeVisible();
});

// The sample is built so that this holds (docs/API_CONTRACT.md section 7); a failure here is a
// disagreement between the overview and the findings it links to, not a layout problem.
test("every headline figure, hot spot and rule is the count of the findings it opens", async ({ page, request }) => {
  const overview = await (await request.get("/api/oversight/overview")).json();
  const total = async (query: string) => (await (await request.get(`/api/oversight/findings?${query}`)).json()).total;

  await page.goto("/");
  await figuresReady(page);

  const expectations: [number, string, number][] = [
    [0, "severity=breach&state=open", overview.totals.open_breaches.current],
    [1, "severity=warning&state=open", overview.totals.open_warnings.current],
    [2, "state=all&first_seen=7d", overview.totals.new_7d.current],
  ];
  for (const [index, query, figure] of expectations) {
    await expect(tiles(page).nth(index)).toHaveAttribute("href", `/findings?${query}`);
    expect(await total(query)).toBe(figure);
  }

  const lead = overview.hot_spots[0];
  await expect(hotSpotRows(page).first()).toHaveAttribute("href", `/findings?state=open&epic=${lead.epic_key}`);
  expect(await total(`state=open&epic=${lead.epic_key}`)).toBe(lead.open_breaches + lead.open_warnings);

  await expect(ruleRows(page).first()).toHaveAttribute("href", "/findings?rule=R-EST-01");
  const rule = overview.by_rule.find((entry: { rule_id: string }) => entry.rule_id === "R-EST-01");
  expect(await total("rule=R-EST-01")).toBe(rule.open);
});

test("a tile, a hot spot and a rule each open their findings; keyboard first", async ({ page }) => {
  await page.goto("/");
  await figuresReady(page);

  await tiles(page).first().click();
  await expect(page).toHaveURL(/\/findings\?severity=breach&state=open$/);
  await page.goBack();
  await figuresReady(page);

  await hotSpotRows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/findings\?state=open&epic=DEMO-704$/);
  await page.goBack();
  await figuresReady(page);

  await ruleRows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/findings\?rule=R-EST-01$/);
  await page.goBack();
  await figuresReady(page);

  // A rule Jira cannot evaluate has no findings to list; it opens the process map instead.
  await ruleRows(page).nth(10).click();
  await expect(page).toHaveURL(/\/process$/);
});

test("the hot spots switch to the same figures as a table", async ({ page }) => {
  await page.goto("/");
  await figuresReady(page);
  const hotSpots = page.getByRole("region", { name: "Hot spots" });
  await hotSpots.getByRole("radio", { name: "Table" }).click();
  const table = hotSpots.getByRole("table", { name: "Open findings by epic" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Issues" })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(6);
  expect(await axeBlocking(page)).toEqual([]);
});

test("while the figures load, every region holds its shape and says so", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(OVERVIEW_API, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");

  await expect(page.getByText("Loading open findings by epic")).toBeAttached();
  await expect(page.getByText("Loading open findings by rule")).toBeAttached();
  await expect(page.getByText("Loading the coverage")).toBeAttached();
  await expect(page.getByRole("heading", { level: 2, name: "Hot spots" })).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);

  release();
  await figuresReady(page);
  await expect(page.getByText("Loading open findings by epic")).toHaveCount(0);
});

test("when the overview cannot be loaded, one inline error offers a retry that works", async ({ page }) => {
  let fail = true;
  await page.route(OVERVIEW_API, async (route) => {
    if (!fail) return route.continue();
    return route.fulfill({
      status: 503,
      json: { error: "upstream_unavailable", message: "The oversight service could not be reached." },
    });
  });
  await page.goto("/");

  // The query retries a 5xx twice, with backoff, before it says so.
  const alert = page.getByRole("alert").filter({ hasText: "The overview could not be loaded" });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText("HTTP 503 · upstream_unavailable");
  expect(await axeBlocking(page)).toEqual([]);

  fail = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await figuresReady(page);
  await expect(alert).toHaveCount(0);
});

test("with nothing to show, each region says what it looked at", async ({ page, request }) => {
  const overview = await (await request.get("/api/oversight/overview")).json();
  overview.hot_spots = [];
  overview.latest_insight = null;
  await page.route(OVERVIEW_API, (route) => route.fulfill({ json: overview }));
  await page.goto("/");
  await figuresReady(page);

  await expect(page.getByText("No open findings in any epic")).toBeVisible();
  await expect(page.getByText("Nothing is open.")).toHaveCount(0);
  await expect(page.getByText("No weekly briefing yet")).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
});

test.describe("acknowledgement", () => {
  test.beforeEach(readableClipboard);

  test("Copy link copies the Overview's address and says so", async ({ page }) => {
    await page.goto("/");
    await figuresReady(page);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/$/);
  });
});

for (const width of [1024, 1280, 1366, 1440]) {
  test(`the headline figures stand level at ${width} px, whichever label takes a second line (the JO-14 review)`, async ({ page }) => {
    // Regression: from 1024 to about 1368 px "Rules not measurable" took a second line and pushed its figure below the
    // other four, on the Overview's most-read row.
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await figuresReady(page);
    const region = page.getByRole("region", { name: "Headline figures" });
    await expect(region.locator("[data-figure]").first()).toBeVisible();
    expect(await cutText(region)).toEqual([]);
    // Each tile's figure row: the row under its label, whether it holds a figure or says it is not measurable.
    const shown = await region.evaluate((grid) =>
      [...grid.querySelectorAll<HTMLElement>("[data-tile-label]")].map((label) => ({
        label: label.textContent,
        top: label.parentElement!.nextElementSibling!.getBoundingClientRect().top,
      })),
    );
    expect(shown).toHaveLength(4);
    for (const tile of shown) expect(Math.abs(tile.top - shown[0].top), tile.label ?? "").toBeLessThanOrEqual(0.5);
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("each rule's title and each status's stage read whole on a phone, and the effort ratio's limit stands clear of its line (JO-14)", async ({
    page,
  }) => {
    // Regression: at 390 px "Work started withou…" and "Developm…" were cut, with no way to read them on a phone (no
    // hover), and the effort ratio's line ran through its limit's name, "Breach at 1.50× (R-EFF-01)".
    await page.goto("/");
    await figuresReady(page);
    await expect(ruleRows(page).first()).toBeVisible();
    expect(await cutText(page.getByRole("list", { name: "Open findings by rule" }))).toEqual([]);
    const statuses = page.getByRole("list", { name: "Issues by status" });
    await expect(statuses.getByText("Development stage").first()).toBeVisible();
    expect(await cutText(statuses)).toEqual([]);
    const chart = page.locator("svg").filter({ has: page.locator("text", { hasText: /^Breach at 1\.50×/ }) });
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator("path.recharts-line-curve")).toBeVisible();
    // Every point along the line, every 2 px of it, against the name's box and its halo, in the chart's own units.
    const crossing = await chart.evaluate((svg) => {
      const label = [...svg.querySelectorAll("text")].find((text) => text.textContent?.startsWith("Breach at"))!;
      const box = label.getBBox();
      const near = (x: number, y: number) => x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2;
      const hits: string[] = [];
      for (const path of svg.querySelectorAll<SVGPathElement>("path.recharts-line-curve")) {
        for (let at = 0; at <= path.getTotalLength(); at += 2) {
          const point = path.getPointAtLength(at);
          if (near(point.x, point.y)) hits.push(`${Math.round(point.x)},${Math.round(point.y)}`);
        }
      }
      return hits;
    });
    expect(crossing).toEqual([]);
  });

  test("an epic's title reads whole in Hot spots on a phone, however long (the JO-14 review)", async ({ page, request }) => {
    // Regression: "Open findings by epic" cut an epic's title past about 22 characters at 390 px, and its only full
    // text was a tooltip, which a touch screen cannot open. The sample's titles are short, so one is made long here.
    const overview = await (await request.get("/api/oversight/overview")).json();
    const long = "Notification preferences and delivery schedules for every channel";
    overview.hot_spots[0].epic_title = long;
    await page.route(OVERVIEW_API, (route) => route.fulfill({ json: overview }));
    await page.goto("/");
    await figuresReady(page);
    const epics = page.getByRole("list", { name: "Open findings by epic" });
    await expect(epics.getByText(long)).toBeVisible();
    expect(await cutText(epics)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the Overview reflows without scrolling sideways", async ({ page }) => {
    await page.goto("/");
    await figuresReady(page);
    await expect(ruleRows(page).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`every headline figure's label reads whole, the figures in a row level (the JO-12 check; ${colorScheme})`, async ({ page }) => {
      // Regression: "Open breac…", "Open warnin…" and "Resolved thi…": each label cut by the hover arrow's room.
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await figuresReady(page);
      const shown = await tiles(page).evaluateAll((links) =>
        links.map((link) => {
          const label = link.querySelector<HTMLElement>("[data-tile-label]")!;
          const figure = link.querySelector<HTMLElement>("[data-figure]")!.getBoundingClientRect();
          return { label: label.textContent, cut: label.scrollWidth > label.clientWidth + 0.5 || label.scrollHeight > label.clientHeight + 0.5, left: link.getBoundingClientRect().left, top: figure.top };
        }),
      );
      expect(shown.length).toBeGreaterThanOrEqual(4);
      for (const tile of shown) expect(tile.cut, tile.label ?? "").toBe(false);
      // Two tiles to a row: each pair's figures stand at one height.
      for (let index = 0; index + 1 < shown.length; index += 2) {
        if (shown[index + 1].left > shown[index].left) expect(Math.abs(shown[index + 1].top - shown[index].top)).toBeLessThanOrEqual(0.5);
      }
    });
  }
});
