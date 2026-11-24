import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { readableClipboard } from "./clipboard";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BRIEFING_API = "**/api/oversight/insights/latest";

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

const sentences = (page: Page) => page.locator("[data-trace-kind='sentence']");
const candidate = (page: Page, id: string) => page.locator(`#candidate-${id}`);

/** The briefing has arrived, including the rule lookup that makes the coverage link exact. */
async function briefingReady(page: Page) {
  await expect(page.getByRole("heading", { level: 2, name: "Week of 2 Nov 2026" })).toBeVisible();
  await expect(sentences(page)).toHaveCount(5);
  await expect(sentences(page).nth(3).getByRole("link", { name: /24 findings/ })).toHaveAttribute("href", "/findings?rule=W-EST-01");
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:32:00Z"));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("the briefing reads as a sheet, logs nothing and passes axe", async ({ page }) => {
      const problems = watchConsole(page);
      await page.goto("/insights");
      await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
      await briefingReady(page);

      await expect(page.locator("[data-trace-kind='candidate']")).toHaveCount(5);
      await expect(page.getByRole("heading", { level: 3, name: "Top problems" })).toBeVisible();
      // Go-live (SQA): no method notes, model name, versions, badge, scoring formula or prototype tone words.
      await expect(page.locator("main")).not.toContainText(
        /How this was written|Written by|Rules version|Process version|Verified|Score \d|Blatantly bad|On its way to being bad|sentences, \d+ words/,
      );
      await expect(page.getByText("The latest weekly briefing.")).toBeVisible();
      // This week's briefing, by the page's clock: nothing says it is from an earlier week.
      await expect(page.locator("[data-earlier-week]")).toHaveCount(0);
      await expect(sentences(page).first()).toContainText("DEMO-704 Data import pipeline has 73 open breaches, up from 71 a week ago.");

      expect(await axeBlocking(page)).toEqual([]);
      // Lit: the tick-and-tie colours must hold their contrast too.
      await sentences(page).first().hover();
      await expect(candidate(page, "hot-spot-demo-704")).toHaveAttribute("data-linked", "true");
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test("the other states pass axe: no briefing yet, failed, not verified", async ({ page }) => {
      test.slow();
      await page.route(BRIEFING_API, (route) =>
        route.fulfill({ status: 404, json: { error: "not_found", message: "No weekly briefing has been written yet." } }),
      );
      await page.goto("/insights");
      await expect(page.getByText("No briefing yet")).toBeVisible();
      expect(await axeBlocking(page)).toEqual([]);

      await page.unroute(BRIEFING_API);
      await page.route(BRIEFING_API, (route) => route.fulfill({ status: 503, json: { error: "unavailable", message: "Down." } }));
      await page.reload();
      await expect(page.locator("main").getByRole("alert")).toContainText("Couldn't load the briefing", { timeout: 15_000 });
      expect(await axeBlocking(page)).toEqual([]);

      await page.unroute(BRIEFING_API);
      await page.route(BRIEFING_API, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), verified: false } });
      });
      await page.reload();
      await expect(page.getByRole("heading", { level: 3, name: "The candidate table" })).toBeVisible();
      expect(await axeBlocking(page)).toEqual([]);
    });
  });
}

test("the first screen of a 14-inch MacBook already holds the briefing and its top candidate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/insights");
  await briefingReady(page);
  await expect(page.getByRole("heading", { level: 2, name: "Week of 2 Nov 2026" })).toBeInViewport();
  await expect(sentences(page).first()).toBeInViewport();
  await expect(sentences(page).nth(2)).toBeInViewport();
  await expect(candidate(page, "hot-spot-demo-704")).toBeInViewport();
});

test("a sentence lights the candidates it was written from, and a candidate the sentences that quote it", async ({ page }) => {
  await page.goto("/insights");
  await briefingReady(page);
  const first = sentences(page).first();

  await first.hover();
  await expect(candidate(page, "hot-spot-demo-704")).toHaveAttribute("data-linked", "true");
  await expect(candidate(page, "hot-spot-demo-763")).not.toHaveAttribute("data-linked", "true");
  await expect(first.locator("[data-quoted='open_breaches']")).toHaveClass(/text-cite/);

  await candidate(page, "rising-rule-r-est-01").hover();
  await expect(sentences(page).nth(4)).toHaveAttribute("data-linked", "true");
  await expect(first).not.toHaveAttribute("data-linked", "true");
});

test("every sentence clicks through to the findings behind it", async ({ page }) => {
  await page.goto("/insights");
  await briefingReady(page);
  const first = sentences(page).first();
  await expect(first.getByRole("link", { name: /73 open breaches/ })).toHaveAttribute("href", "/findings?epic=DEMO-704&severity=breach");
  await expect(sentences(page).nth(4).getByRole("link", { name: /9 findings this week/ })).toHaveAttribute(
    "href",
    "/findings?rule=R-EST-01&state=all&first_seen=7d",
  );

  await first.getByText(/Data import pipeline has/).click();
  await expect(page).toHaveURL(/\/findings\?(?=.*epic=DEMO-704)(?=.*severity=breach)/);
});

test("j and k walk the rows, focus lights them, Enter opens", async ({ page }) => {
  await page.goto("/insights");
  await briefingReady(page);
  const firstLink = sentences(page).first().getByRole("link", { name: /73 open breaches/ });

  await page.keyboard.press("j");
  await expect(firstLink).toBeFocused();
  await expect(candidate(page, "hot-spot-demo-704")).toHaveAttribute("data-linked", "true");
  await page.keyboard.press("j");
  await expect(sentences(page).nth(1).getByRole("link", { name: /57 open breaches/ })).toBeFocused();
  await page.keyboard.press("k");
  await expect(firstLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/findings\?(?=.*epic=DEMO-704)/);
});

test("a candidate citation lands on the candidate, and the link to it reopens there", async ({ page }) => {
  await page.goto("/insights");
  await briefingReady(page);
  await sentences(page).nth(4).getByRole("link", { name: /Candidate 5 Rising rule/ }).click();
  await expect(page).toHaveURL(/\/insights#candidate-rising-rule-r-est-01$/);
  await expect(candidate(page, "rising-rule-r-est-01").getByRole("link", { name: /9 findings this week/ })).toBeFocused();

  await page.reload();
  await briefingReady(page);
  await expect(candidate(page, "rising-rule-r-est-01")).toBeInViewport();
});

test("no briefing yet says what produces one, and fails inline before recovering on retry", async ({ page }) => {
  await page.route(BRIEFING_API, (route) =>
    route.fulfill({ status: 404, json: { error: "not_found", message: "No weekly briefing has been written yet." } }),
  );
  await page.goto("/insights");
  await expect(page.getByText("No briefing yet")).toBeVisible();
  await expect(page.getByText("One is written each week.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See the findings" })).toHaveAttribute("href", "/findings");

  let failing = true;
  await page.unroute(BRIEFING_API);
  await page.route(BRIEFING_API, (route) =>
    failing ? route.fulfill({ status: 503, json: { error: "unavailable", message: "Down." } }) : route.fallback(),
  );
  await page.reload();
  // In the page: Next's route announcer is an alert of its own, outside main.
  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toContainText("HTTP 503 · insights/latest", { timeout: 15_000 });
  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await briefingReady(page);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("prints as a document: no actions, every candidate and every key on paper", async ({ page }) => {
  await page.goto("/insights");
  await briefingReady(page);
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = "true";
    };
  });
  await page.getByRole("button", { name: "Print" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-printed", "true");

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeHidden();
  const coverage = candidate(page, "coverage-sprint-4426");
  await expect(coverage.getByRole("link", { name: "DEMO-1094" })).toBeVisible();
  await expect(coverage.getByRole("button", { name: /more/ })).toBeHidden();
  await expect(page.locator("[data-trace-kind='candidate']")).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 3, name: "Top problems" })).toBeVisible();
});

test("a briefing from a week that is over says so beside its date, here and on the Overview (SQA)", async ({ page }) => {
  // The sample's briefing is a past week; once that week is over its figures may have moved on.
  await page.clock.setFixedTime(new Date("2026-11-17T09:00:00Z"));
  await page.goto("/insights");
  await briefingReady(page);
  await expect(page.locator("main [data-earlier-week]")).toHaveText("From an earlier week. Figures may have changed since.");
  await page.goto("/");
  await expect(page.locator("#latest-insight [data-earlier-week]")).toHaveText("From an earlier week. Figures may have changed since.");
});

test.describe("acknowledgement", () => {
  test.beforeEach(readableClipboard);

  test("Copy link copies the view, the candidate in focus included", async ({ page }) => {
    await page.goto("/insights#candidate-coverage-sprint-4426");
    await briefingReady(page);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/insights#candidate-coverage-sprint-4426$/);
  });
});
