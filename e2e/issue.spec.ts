import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { cutText } from "./cut-text";

/*
 * The Issue page against the sample server (pinned to SAMPLE_NOW in
 * playwright.config.ts), with the browser's clock frozen just after it.
 * DEMO-1 is the showcase: an estimate set five days into development, a
 * reopen, and 1.82× its estimate logged. DEMO-3 skipped development;
 * DEMO-1016 is still in development; DEMO-9999 does not exist.
 */

const NOW = new Date("2026-11-04T14:32:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EFFORT_FINDING = "45834de40a31472113e2898410f13062";

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
    .map((violation) => ({ id: violation.id, help: violation.help, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

async function openDemo1(page: Page, path = "/issues/DEMO-1") {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "DEMO-1 Document help tooltips" })).toBeVisible();
}

const bodyRows = (page: Page, table: string) => page.getByRole("table", { name: table }).locator("tbody tr");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("DEMO-1 tells its story as evidence, logs nothing and passes axe", async ({ page }) => {
      const problems = watchConsole(page);
      await openDemo1(page);
      await expect(page).toHaveTitle("DEMO-1 · Jira Oversight");

      const facts = page.getByRole("region", { name: "Facts" });
      await expect(facts.getByRole("link", { name: /Effort ratio.*Over the 1\.50× threshold/ })).toHaveAttribute(
        "href",
        `/findings?finding=${EFFORT_FINDING}`,
      );
      await expect(facts).toContainText("24.0 h at 8 h a point");
      await expect(facts.getByRole("link", { name: /Estimate set.*After work began/ })).toBeVisible();
      await expect(facts.getByRole("link", { name: /Reopens.*Done → In Progress/ })).toBeVisible();

      const timeline = page.getByRole("group", { name: "DEMO-1, status timeline" });
      await expect(timeline).toBeVisible();
      await expect(timeline.getByRole("img", { name: /^Story points set: 3/ })).toBeVisible();
      await expect(page.getByTestId("timeline-cut")).toContainText("had no changes");

      await expect(bodyRows(page, "Findings on DEMO-1")).toHaveCount(3);
      await expect(bodyRows(page, "Changelog of DEMO-1")).toHaveCount(6);
      await expect(page.getByRole("list", { name: "Hours logged a week on DEMO-1" }).getByRole("listitem")).toHaveCount(3);

      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test("a changelog entry opens in its drawer, which passes axe", async ({ page }) => {
      const response = await page.goto("/issues/DEMO-1?change=310131");
      expect(response?.status()).toBe(200);
      const drawer = page.getByRole("dialog", { name: "Done → In Progress" });
      await expect(drawer).toBeVisible();
      // The drawer is modal, so the page behind it, its h1 included, is hidden from assistive technology.
      await expect(
        page.getByRole("heading", { level: 1, name: "DEMO-1 Document help tooltips", includeHidden: true }),
      ).toBeVisible();
      await expect(drawer.getByRole("link", { name: /R-FLOW-03 Reopened after Done/ })).toBeVisible();
      expect(await axeBlocking(page)).toEqual([]);
    });
  });
}

test("the first screen of a MacBook shows the facts and the whole timeline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo1(page);
  await expect(page.getByRole("region", { name: "Facts" })).toBeInViewport();
  await expect(page.getByRole("group", { name: "DEMO-1, status timeline" })).toBeInViewport({ ratio: 0.9 });
});

test("the timeline reads out each mark on focus, walks with the arrows, and opens as a table", async ({ page }) => {
  await openDemo1(page);
  const timeline = page.getByRole("group", { name: "DEMO-1, status timeline" });
  // Hours are written with a no-break space before the unit, hence \s.
  await timeline.getByRole("img", { name: /^To Do \(Backlog\): 50\.0\sh/ }).focus();
  await expect(page.getByText("in this status")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(timeline.getByRole("img", { name: /^In Progress \(Development\): 120\.6\sh/ })).toBeFocused();

  await page.getByRole("radiogroup", { name: "Status by stage: show as" }).getByRole("radio", { name: "Table" }).click();
  const table = page.getByRole("table", { name: "Status by stage" });
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(table).toContainText("310131");
  await expect(table).toContainText("Still here");
});

test("a finding row opens its evidence on the Findings page, from the mouse or the keyboard", async ({ page }) => {
  await openDemo1(page);
  await bodyRows(page, "Findings on DEMO-1").filter({ hasText: "R-EFF-01" }).click();
  await expect(page).toHaveURL(new RegExp(`/findings\\?(.*&)?finding=${EFFORT_FINDING}(&|$)`));

  await openDemo1(page);
  await page.keyboard.press("j");
  await expect(bodyRows(page, "Findings on DEMO-1").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/findings\?(.*&)?finding=[0-9a-f]{32}(&|$)/);
});

test("the epic leads to its findings", async ({ page }) => {
  await openDemo1(page);
  await page.getByRole("link", { name: /DEMO-4 Onboarding flow/ }).click();
  await expect(page).toHaveURL(/\/findings\?(.*&)?epic=DEMO-4(&|$)/);
});

test("Open in Jira stays in place for sample data, dimmed, and says why", async ({ page }) => {
  await openDemo1(page);
  const open = page.getByRole("button", { name: "Open in Jira" });
  await expect(open).toHaveAttribute("aria-disabled", "true");
  await open.hover();
  await expect(page.getByRole("tooltip")).toContainText("Sample data: no Jira link");
});

test("a changelog row opens its drawer; Esc closes it and Back brings it back", async ({ page }) => {
  await openDemo1(page);
  // Found by what it says: Jira's changelog ids are no longer a column (SQA).
  await bodyRows(page, "Changelog of DEMO-1").filter({ hasText: "Story points" }).click();
  await expect(page).toHaveURL(/\?change=310037$/);
  const drawer = page.getByRole("dialog", { name: "Story points set to 3" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("After work began");
  await expect(drawer).toContainText("120.4 h");

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/issues\/DEMO-1$/);
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Story points set to 3" })).toBeVisible();
});

test("a skipped stage is marked on the lanes it jumped", async ({ page }) => {
  await page.goto("/issues/DEMO-3");
  const timeline = page.getByRole("group", { name: "DEMO-3, status timeline" });
  await expect(timeline.getByRole("img", { name: /^Skipped Development/ })).toBeVisible();
});

test("open work is never cut short: its long spell is the evidence", async ({ page }) => {
  await page.goto("/issues/DEMO-1016");
  await expect(page.getByRole("group", { name: "DEMO-1016, status timeline" })).toBeVisible();
  await expect(page.getByTestId("timeline-cut")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Facts" })).toContainText("Not done yet");
});

test("an unknown key is a calm not-found with the ways back", async ({ page }) => {
  const problems = watchConsole(page);
  const response = await page.goto("/issues/DEMO-9999");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 2, name: "No issue DEMO-9999" })).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
  await page.getByRole("link", { name: "Go to Overview" }).click();
  await expect(page).toHaveURL(/\/$/);
  // The 404 from the data is the only error the browser may report.
  expect(problems.filter((problem) => !problem.includes("404"))).toEqual([]);
});

test("a malformed key is a real 404", async ({ page }) => {
  const response = await page.goto("/issues/not-a-key");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Nothing at this address" })).toBeVisible();
});

test("a failed load is inline, and Try again brings the issue back", async ({ page }) => {
  let failing = true;
  await page.route("**/api/oversight/issues/DEMO-1/timeline", (route) =>
    failing
      ? route.fulfill({ status: 503, json: { error: "upstream_unavailable", message: "The oversight service is down." } })
      : route.continue(),
  );
  await page.goto("/issues/DEMO-1");
  const alert = page.getByRole("alert").filter({ hasText: "Couldn't load DEMO-1" });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "DEMO-1 Document help tooltips" })).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`the changelog and the findings read whole at ${width} px: values, claims and headers wrap rather than being cut (JO-14)`, async ({ page }) => {
    // Regression: "To Do → In…", "FROM → TO" and "CHANG…" in the changelog, and the findings' titles and claims
    // ("…(1.82×, threshol…"), cut with no tooltip, at 390 px and at 1440 px.
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openDemo1(page);
    const changelog = page.getByRole("table", { name: "Changelog of DEMO-1" });
    const findings = page.getByRole("table", { name: "Findings on DEMO-1" });
    await expect(changelog.locator("tbody tr").first()).toContainText("→");
    await expect(findings.locator("tbody tr").first()).toBeVisible();
    expect(await cutText(changelog)).toEqual([]);
    expect(await cutText(findings)).toEqual([]);
    await expect(findings.getByText(/Logged 43\.8 h against an estimate of 24\.0 h \(1\.82×, threshold 1\.5×\)/)).toBeVisible();
    // Each value whole on its line (DEMO-1's are all short): "In Progress" never split across two.
    const split = await changelog.locator("tbody td .inline-block").evaluateAll((values) =>
      values
        .filter((value) => {
          const range = document.createRange();
          range.selectNodeContents(value);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size > 1;
        })
        .map((value) => value.textContent),
    );
    expect(split).toEqual([]);
    // A row still opens the change it records, with the values in full.
    await changelog.locator("tbody tr").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

interface TimelineFinding {
  finding_id: string;
  state: string;
  resolved_at: string | null;
  resolved_why: string | null;
  last_seen_at: string;
  evidence: { changelog_id?: string | null }[];
}

/**
 * DEMO-1's timeline as live data gives it after a rules version bump: one finding superseded (the sample only ever
 * clears), and one change cited by two findings (a superseded finding and its replacement cite the same entry).
 */
async function supersededAndCitedTwice(page: Page) {
  await page.route("**/api/oversight/issues/DEMO-1/timeline", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { findings: TimelineFinding[] };
    const [first, second] = body.findings;
    const resolved = body.findings.find((finding) => finding.state === "resolved") ?? second;
    Object.assign(resolved, { state: "resolved", resolved_why: "superseded", resolved_at: resolved.resolved_at ?? resolved.last_seen_at });
    const cited = first.evidence.find((item) => item.changelog_id) ?? body.findings.flatMap((finding) => finding.evidence).find((item) => item.changelog_id)!;
    const other = body.findings.find((finding) => !finding.evidence.some((item) => item.changelog_id === cited.changelog_id))!;
    other.evidence.push(cited);
    await route.fulfill({ response, json: body });
  });
}

for (const { locale, timezoneId } of [
  { locale: "en-US", timezoneId: "America/New_York" },
  { locale: "de-DE", timezoneId: "Europe/Berlin" },
]) {
  test.describe(`read in ${locale}`, () => {
    test.use({ locale, timezoneId });

    for (const width of [390, 1440]) {
      test(`the changelog's times, a superseded finding and a change cited twice read whole at ${width} px (the JO-14 review)`, async ({ page }) => {
        // Regression: "Nov 14, 2026, 12:28 P…" in the changelog's When column, "superseded 12 Nov 2…" in the findings'
        // State, and a second rule id clipped in Cited by, with no way to read them; en-GB, the only locale tested,
        // fitted.
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await supersededAndCitedTwice(page);
        await openDemo1(page);
        const changelog = page.getByRole("table", { name: "Changelog of DEMO-1" });
        const findings = page.getByRole("table", { name: "Findings on DEMO-1" });
        await expect(changelog.locator("tbody tr").first()).toContainText("→");
        await expect(findings.getByText(/^superseded /)).toBeVisible();
        // Two citations in one changelog row.
        await expect(changelog.locator("tbody td").filter({ hasText: /[RW]-[A-Z]+-\d{2}.*[RW]-[A-Z]+-\d{2}/ }).first()).toBeVisible();
        expect(await cutText(changelog)).toEqual([]);
        expect(await cutText(findings)).toEqual([]);
        // The time in the reader's conventions and zone, whole, on the 12-hour clock with no zone named, as every time
        // in the dashboard reads (src/lib/format.ts): the same change, at 11:12 UTC, reads 6:12 AM in New York, and
        // 12:12 PM in Berlin in English words with German conventions (en-DE, as format.ts reads a German browser).
        // Never the server's first render (UTC, en-GB: "12 Nov 2025, 11:12 AM").
        const when = changelog.locator("tbody time").first();
        await expect(when).toHaveAttribute("datetime", "2025-11-12T11:12:00.000Z");
        await expect(when).toHaveText(locale === "en-US" ? /^Nov 12, 2025, 6:12\sAM$/ : /^12 Nov 2025, 12:12\sPM$/);
      });
    }
  });
}

test("a phone gets the whole page without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo1(page);
  await expect(page.getByRole("group", { name: "DEMO-1, status timeline" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
