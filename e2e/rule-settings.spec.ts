import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const NOW = new Date("2026-11-04T14:30:00Z");

interface SettingsBody {
  revision: number;
  rules: { rule_id: string; customised: boolean; custom: boolean }[];
}

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

/** This project's own server: a change must carry its origin, as the page's own requests do. */
const origin = () => new URL(String(test.info().project.use.baseURL)).origin;

/** A save as the page sends it, against the board's revision now. */
async function saveNow(request: APIRequestContext, changes: unknown[], reason: string) {
  const settings = (await (await request.get("/api/oversight/rules/settings")).json()) as SettingsBody;
  const saved = await request.post("/api/oversight/rules/settings", { data: { revision: settings.revision, changes, reason }, headers: { origin: origin() } });
  expect(saved.status(), await saved.text()).toBe(200);
}

/** Every rule back to the catalogue's settings, and every rule the board added deleted, in one change, if any. */
async function restoreDefaults(request: APIRequestContext) {
  const settings = (await (await request.get("/api/oversight/rules/settings")).json()) as SettingsBody;
  const changes = [
    ...settings.rules.filter((rule) => !rule.custom && rule.customised).map((rule) => ({ rule_id: rule.rule_id, reset: true })),
    // A board's own rule has no catalogue to go back to: deleted, as an admin would.
    ...settings.rules.filter((rule) => rule.custom).map((rule) => ({ op: "delete", rule_id: rule.rule_id })),
  ];
  if (changes.length > 0) await saveNow(request, changes, "End-to-end tests: back to the catalogue");
}

/** Pressed from the keyboard, so every browser starts from the same focus (Safari's mouse focuses no button). */
async function pressKey(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Enter");
}

const row = (page: Page, ruleId: string) => page.locator(`[data-rule="${ruleId}"]`);
const customRows = (page: Page) => page.getByRole("list", { name: "Custom rules" }).locator("[data-rule]");
const customGroup = (page: Page) => page.getByRole("region", { name: /Custom rules/ });
const addRule = (page: Page) => page.locator("[data-add-rule]");
const threshold = (page: Page, ruleId: string, index = 0) => row(page, ruleId).getByRole("spinbutton").nth(index);
const bar = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });
const status = (page: Page) => page.locator("[data-settings-status]");
const chip = (page: Page) => status(page).locator("[data-apply]");
const history = (page: Page) => page.getByRole("list", { name: "Changes to Demo project's rule settings, newest first" });

async function settled(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openSettings(page: Page) {
  await page.goto("/governance/rules");
  await expect(page.getByRole("heading", { level: 1, name: "Rule settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hard and fast rules" })).toBeVisible();
  await expect(status(page)).toContainText("Demo project");
}

test.beforeAll(async ({ request }) => {
  await restoreDefaults(request);
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ request }) => {
  await restoreDefaults(request);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the page is Governance's, lists every rule in its group with its controls, and passes axe (${colorScheme})`, async ({ page }) => {
    const problems = watchConsole(page);
    await page.emulateMedia({ colorScheme });
    await openSettings(page);
    const rail = page.getByRole("navigation", { name: "Primary" });
    await expect(rail.getByRole("link", { name: "Rule settings" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("list", { name: "Hard and fast rules" }).locator("[data-rule]")).toHaveCount(7);
    await expect(page.getByRole("list", { name: "Early warnings" }).locator("[data-rule]")).toHaveCount(5);
    await expect(row(page, "R-EFF-01").getByRole("switch", { name: "Effort far beyond the estimate On this board" })).toBeChecked();
    await expect(row(page, "R-EFF-01").getByRole("radio", { name: "Breach" })).toBeChecked();
    await expect(threshold(page, "R-EFF-01")).toHaveValue("1.5");
    await expect(row(page, "R-EFF-01")).toContainText("Default 1.5×");
    await expect(row(page, "W-SPR-01")).toContainText("Default 2 days, 30%");
    await expect(row(page, "W-REV-01")).toContainText("Not measurable on this board");
    await expect(page.locator("main")).not.toContainText("Europe/London");
    expect(await axeBlocking(page)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test("loads in its final shape: the status, the column heads and the rules' rows stand where their placeholders stood", async ({ page }) => {
  // The settings held back until the placeholders have been measured.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/oversight/rules/settings", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/governance/rules");
  await expect(page.getByText("Loading the rule settings")).toBeAttached();
  const shape = () =>
    page.locator("li.jo-rule-row").evaluateAll((rows) =>
      rows.slice(0, 3).map((row) => {
        const box = row.getBoundingClientRect();
        return [Math.round(box.top), Math.round(box.height)];
      }),
    );
  const loading = await shape();
  expect(loading).toHaveLength(3);
  release();
  await expect(row(page, "R-EST-01")).toBeVisible();
  expect(await shape()).toEqual(loading);
});

test("an admin changes a threshold: the preview, the save, the re-check, the history, the Process page, and undo", async ({ page }) => {
  test.slow();
  const problems = watchConsole(page);
  await openSettings(page);
  const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight);
  const heightBefore = await pageHeight();

  await threshold(page, "R-EFF-01").fill("2");
  await threshold(page, "R-EFF-01").press("Tab");
  await expect(bar(page)).toContainText("1 unsaved change");
  await expect(row(page, "R-EFF-01")).toContainText("Edited");
  // The bar's room was kept: the page grew by nothing when it appeared.
  expect(await pageHeight()).toBe(heightBefore);

  await bar(page).getByRole("button", { name: "Review and save" }).click();
  const review = page.getByRole("dialog", { name: "Review and save" });
  await expect(review).toContainText("1 change to Demo project’s rule settings.");
  await expect(review.locator('[data-change="R-EFF-01.params.threshold"]')).toContainText(/1\.5×\s*to\s*2×/);
  const impact = review.locator('[data-impact="R-EFF-01"]');
  await expect(impact).toBeVisible();
  const closing = Number(await impact.locator("td").nth(0).innerText());
  expect(closing).toBeGreaterThan(0);
  await expect(impact.locator("td").nth(1)).toHaveText("0");
  await expect(impact.getByRole("link", { name: /^DEMO-\d+\s*\(opens in a new tab\)$/ }).first()).toHaveAttribute("target", "_blank");
  // It opens at its top, the dialog itself holding the focus: the changes come first, never the reason at its foot.
  await expect(review).toBeFocused();
  expect(await review.locator("[data-dialog-body]").evaluate((body) => body.scrollTop)).toBe(0);
  expect(await axeBlocking(page)).toEqual([]);
  await review.getByLabel(/Reason/).fill("Agreed with the team on Monday");
  await review.getByRole("button", { name: "Save and re-check" }).click();

  await expect(review).toBeHidden();
  await expect(page.getByText("Saved. Re-checking Demo project…")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(chip(page)).toHaveText("Re-checking…");
  // Read every two seconds while the service re-checks, then the result.
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  await expect(status(page)).toContainText(`${closing} closed, 0 opened`);
  // Date first, as every other time on screen reads (SQA).
  await expect(status(page)).toContainText(/Revision \d+ · , last changed 4 Nov 2026, 2:30\sPM by Local \(sign-in off\)/);
  const latest = history(page).locator("li[data-revision]").first();
  await expect(latest).toContainText("“Agreed with the team on Monday”");
  await expect(latest).toContainText(/Effort ratio\s*1\.5×\s*to\s*2×/);
  await expect(row(page, "R-EFF-01")).toContainText("Customised");
  await expect(threshold(page, "R-EFF-01")).toHaveValue("2");

  // The Process page reads the board's settings.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Process" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Process" })).toBeVisible();
  const effort = page.getByRole("table", { name: "Rules" }).locator("tbody tr").filter({ hasText: "R-EFF-01" });
  await expect(effort).toContainText("2×");
  await expect(effort).toContainText("Customised");
  await page.getByRole("link", { name: "Edit rule settings" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Rule settings" })).toBeVisible();

  // Undo, asked first: the latest change set back, recorded as a change of its own.
  const revision = Number(await history(page).locator("li[data-revision]").first().getAttribute("data-revision"));
  await history(page).locator("li[data-revision]").first().getByRole("button", { name: "Undo" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Undo revision ${revision}?` });
  await expect(confirm.getByRole("button", { name: "Keep it" })).toBeFocused();
  await confirm.getByRole("button", { name: `Undo revision ${revision}` }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("Undone. Re-checking Demo project…")).toBeVisible();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  await expect(history(page).locator(`li[data-revision="${revision}"]`)).toContainText(`Undone in revision ${revision + 1}`);
  await expect(history(page).locator("li[data-revision]").first()).toContainText(`Undoes revision ${revision}`);
  await expect(threshold(page, "R-EFF-01")).toHaveValue("1.5");
  await expect(row(page, "R-EFF-01")).not.toContainText("Customised");
  await page.goto("/process");
  await expect(page.getByRole("table", { name: "Rules" }).locator("tbody tr").filter({ hasText: "R-EFF-01" })).toContainText("1.5×");
  expect(problems).toEqual([]);
});

test("a rule turned off reads 'Off on this board' on the Process page, and its findings 'Closed: rule settings changed'", async ({ page }) => {
  test.slow();
  await openSettings(page);
  await row(page, "W-AGE-01").getByRole("switch").click();
  await expect(row(page, "W-AGE-01")).toContainText("Off");
  await bar(page).getByRole("button", { name: "Review and save" }).click();
  const review = page.getByRole("dialog", { name: "Review and save" });
  await expect(review.locator('[data-impact="W-AGE-01"]')).toBeVisible();
  await review.getByRole("button", { name: "Save and re-check" }).click();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });

  await page.goto("/process");
  const ageing = page.getByRole("table", { name: "Rules" }).locator("tbody tr").filter({ hasText: "W-AGE-01" });
  await expect(ageing).toContainText("Off on this board");
  await expect(ageing).toContainText("Customised");

  // Latest resolved first: the findings the change closed, at the re-check.
  await page.goto("/findings?rule=W-AGE-01&state=resolved&sort=resolved_at&order=desc");
  const closed = page.locator('[data-state="settings_changed"]').first();
  await expect(closed).toContainText(/Closed:?\s*rule settings changed/);
});

test("what cannot be saved is said beside the field and holds the review back; leaving with changes asks first", async ({ page }) => {
  await openSettings(page);
  await threshold(page, "R-EFF-01").fill("12");
  await threshold(page, "R-EFF-01").press("Tab");
  await expect(row(page, "R-EFF-01")).toContainText("Must be from 0.1× to 10×.");
  await expect(threshold(page, "R-EFF-01")).toHaveAttribute("aria-invalid", "true");
  await bar(page).getByRole("button", { name: "Review and save" }).click();
  await expect(page.getByRole("dialog", { name: "Review and save" })).toHaveCount(0);
  await expect(threshold(page, "R-EFF-01")).toBeFocused();

  // The keyboard steps a threshold within its bounds, as a number field does.
  await threshold(page, "R-EFF-01").fill("1.5");
  await threshold(page, "R-EFF-01").press("ArrowUp");
  await expect(threshold(page, "R-EFF-01")).toHaveValue("1.55");
  await threshold(page, "W-EFF-01").fill("1.6");
  await threshold(page, "W-EFF-01").press("Tab");
  await expect(row(page, "W-EFF-01")).toContainText("Must stay below R-EFF-01's 1.55× while both are on: the warning comes first.");

  // In-app navigation asks first; staying keeps the draft.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Overview" }).click();
  const leave = page.getByRole("alertdialog", { name: "Leave without saving?" });
  await expect(leave).toContainText("Your 2 unsaved changes to Demo project’s rule settings will be lost.");
  await leave.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/governance\/rules$/);
  await expect(bar(page)).toContainText("2 unsaved changes");
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(threshold(page, "R-EFF-01")).toHaveValue("1.5");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
});

test("settings changed elsewhere meanwhile: the service's refusal said beside the field (422), a save it overtook (409), Reload", async ({ page, request }) => {
  await openSettings(page);
  // Someone else moves the warning up while this page still shows it at 0.8×.
  await saveNow(request, [{ rule_id: "W-EFF-01", params: { threshold: 1.4 } }], "Changed in another tab");

  // 422: the breach below the warning as the board now has it; this page cannot know, the service can.
  await threshold(page, "R-EFF-01").fill("1.3");
  await threshold(page, "R-EFF-01").press("Tab");
  await bar(page).getByRole("button", { name: "Review and save" }).click();
  const review = page.getByRole("dialog", { name: "Review and save" });
  // Said under the title, in view: the rule, the field and the service's words, with a way to the field.
  const refused = review.locator("[data-dialog-notice]").getByRole("alert");
  await expect(refused).toContainText("R-EFF-01 Effort far beyond the estimate · Effort ratio: Must stay above W-EFF-01's 1.4× while both are on.");
  await expect(refused).toBeInViewport();
  await expect(review.getByRole("button", { name: "Save and re-check" })).toBeDisabled();
  await refused.getByRole("button", { name: "Edit R-EFF-01" }).click();
  await expect(review).toBeHidden();
  await expect(threshold(page, "R-EFF-01")).toBeFocused();
  await expect(row(page, "R-EFF-01")).toContainText("Must stay above W-EFF-01's 1.4× while both are on.");
  await expect(threshold(page, "R-EFF-01")).toHaveAttribute("aria-invalid", "true");

  // 409: a change the board would take, made against the revision this page read before the other save.
  await threshold(page, "R-EFF-01").fill("2");
  await threshold(page, "R-EFF-01").press("Tab");
  await bar(page).getByRole("button", { name: "Review and save" }).click();
  await expect(review.locator('[data-impact="R-EFF-01"]')).toBeVisible();
  await review.getByRole("button", { name: "Save and re-check" }).click();
  const conflict = review.getByRole("alert");
  await expect(conflict).toContainText("Someone else changed these settings");
  await expect(review.getByRole("button", { name: "Save and re-check" })).toBeDisabled();
  await conflict.getByRole("button", { name: "Reload" }).click();
  await expect(review).toBeHidden();
  await expect(bar(page)).toHaveCount(0);
  // Reloaded, nothing of the draft kept: the board as it now stands, the other tab's change on top of the history.
  await expect(threshold(page, "R-EFF-01")).toHaveValue("1.5");
  await expect(threshold(page, "W-EFF-01")).toHaveValue("1.4");
  await expect(history(page).locator("li[data-revision]").first()).toContainText("“Changed in another tab”");
});

test("the focus never falls to the page's body: a dialog gives it back, and an action that takes its own button away moves it", async ({ page }) => {
  test.slow();
  await openSettings(page);
  // Pressed from the keyboard throughout, so every browser starts from the same focus (Safari's mouse focuses no button).
  const press = async (control: Locator) => {
    await control.focus();
    await page.keyboard.press("Enter");
  };

  // Review and save: cancelled, then closed with Escape.
  await row(page, "W-AGE-01").getByRole("switch").press("Space");
  const reviewButton = bar(page).getByRole("button", { name: "Review and save" });
  const review = page.getByRole("dialog", { name: "Review and save" });
  await press(reviewButton);
  await expect(review.locator('[data-impact="W-AGE-01"]')).toBeVisible();
  await press(review.getByRole("button", { name: "Cancel" }));
  await expect(review).toBeHidden();
  await expect(reviewButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(review).toBeVisible();
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(review).toBeHidden();
  await expect(reviewButton).toBeFocused();

  // The question before leaving: Escape stays, on the link that asked.
  const overview = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Overview" });
  await press(overview);
  const leave = page.getByRole("alertdialog", { name: "Leave without saving?" });
  await expect(leave.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(leave).toBeHidden();
  await expect(overview).toBeFocused();

  // Discard takes the bar away: the status card has the focus.
  await press(bar(page).getByRole("button", { name: "Discard" }));
  await expect(bar(page)).toHaveCount(0);
  await expect(status(page)).toBeFocused();

  // Reset to default takes itself away: the rule's switch, the next control along, has the focus.
  await threshold(page, "R-EFF-01").fill("2");
  await threshold(page, "R-EFF-01").press("Tab");
  await press(row(page, "R-EFF-01").getByRole("button", { name: /Reset to default/ }));
  await expect(row(page, "R-EFF-01").getByRole("switch")).toBeFocused();
  await expect(bar(page)).toHaveCount(0);

  // Undo: kept, then done. Done, its Undo is gone (no longer the latest change): the status card has the focus.
  await saveNow(page.request, [{ rule_id: "W-AGE-01", enabled: false }], "End-to-end tests: the focus");
  await openSettings(page);
  const undo = history(page).locator("li[data-revision]").first().getByRole("button", { name: "Undo" });
  await press(undo);
  const confirm = page.getByRole("alertdialog", { name: /^Undo revision \d+\?$/ });
  await expect(confirm.getByRole("button", { name: "Keep it" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeHidden();
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await press(confirm.getByRole("button", { name: /^Undo revision \d+$/ }));
  await expect(confirm).toBeHidden();
  await expect(status(page)).toBeFocused();
  // The next Tab goes on through the page, not back to its top.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.classList.contains("skip-link"))).toBe(true);
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`a control the keyboard reaches is never under the bar of unsaved changes (${size.width} px)`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(size);
    await openSettings(page);
    await row(page, "W-AGE-01").getByRole("switch").press("Space");
    await expect(bar(page)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await status(page).focus();
    const covered: string[] = [];
    let reached = 0;
    for (let step = 0; step < 200; step += 1) {
      await page.keyboard.press("Tab");
      const seen = await page.evaluate(() => {
        const focused = document.activeElement;
        const barNow = document.querySelector("[data-unsaved-bar]");
        if (!(focused instanceof HTMLElement) || !barNow || barNow.contains(focused) || !document.querySelector("main")?.contains(focused)) return { done: true, overlap: 0, name: "" };
        const a = focused.getBoundingClientRect();
        const b = barNow.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return { done: false, overlap, name: `${focused.closest("[data-rule]")?.getAttribute("data-rule") ?? ""} ${focused.getAttribute("aria-label") ?? focused.textContent ?? ""}`.trim() };
      });
      if (seen.done) break;
      reached += 1;
      if (seen.overlap > 0) covered.push(seen.name);
    }
    // The walk went down the whole page (every rule's controls and the history), not one step and out.
    expect(reached).toBeGreaterThan(30);
    expect(covered).toEqual([]);
  });
}

test("Review and save opens at its top with three changes on a 13-inch MacBook, and a failed save is said in view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSettings(page);
  await row(page, "R-EST-02").getByRole("radio", { name: "Breach" }).click();
  await threshold(page, "R-EFF-01").fill("2");
  await threshold(page, "R-EFF-01").press("Tab");
  await row(page, "W-AGE-01").getByRole("switch").click();
  await bar(page).getByRole("button", { name: "Review and save" }).click();
  const review = page.getByRole("dialog", { name: "Review and save" });
  await expect(review.locator('[data-impact="R-EST-02"]')).toContainText("Re-filed as Breach");
  expect(await review.locator("[data-dialog-body]").evaluate((body) => body.scrollTop)).toBe(0);
  await expect(review.getByRole("heading", { name: "Changes" })).toBeInViewport();
  // A severity change lists its tickets once, as re-filed, never as both closing and opening.
  await expect(review.locator('[data-impact="R-EST-02"] [data-examples="Re-filed"]')).toBeVisible();
  await expect(review.locator('[data-impact="R-EST-02"] [data-examples="Closes"]')).toHaveCount(0);

  // The save fails: said under the title, in view however far down the body the button sits.
  await page.route("**/api/oversight/rules/settings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "upstream_error", message: "The oversight service failed on its side." }) })
      : route.continue(),
  );
  await review.getByRole("button", { name: "Save and re-check" }).click();
  const failure = review.locator("[data-dialog-notice]").getByRole("alert");
  await expect(failure).toContainText("Couldn’t save");
  await expect(failure).toContainText("Nothing was changed.");
  await expect(failure).toBeInViewport();
  // No toast over the footer: "Save and re-check" stays there to try again with.
  await expect(review.getByRole("button", { name: "Save and re-check" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByText("Not saved")).toHaveCount(0);
  await review.getByRole("button", { name: "Cancel" }).click();
  await bar(page).getByRole("button", { name: "Discard" }).click();
});

for (const width of [1280, 1728]) {
  test(`fits a ${width} px MacBook window: no sideways scroll, the rules set out in their columns`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 1000 });
    await openSettings(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Wide enough for a line per rule: the column heads show, and each row's controls share one line.
    await expect(page.getByText("Reported as", { exact: true }).first()).toBeVisible();
    const toggle = await row(page, "R-EFF-01").getByRole("switch").boundingBox();
    const severity = await row(page, "R-EFF-01").getByRole("radiogroup").boundingBox();
    expect(toggle && severity && Math.abs(toggle.y + toggle.height / 2 - (severity.y + severity.height / 2))).toBeLessThan(4);
  });
}

/* ------------------------------------------------ a board's own rules --- */

test("an admin adds a rule the AI drafted from their words: adjusted, reviewed with its preview, saved; its findings, the history, undo", async ({ page }) => {
  test.slow();
  const problems = watchConsole(page);
  await openSettings(page);
  await expect(customGroup(page)).toContainText("No custom rules yet");

  await pressKey(page, addRule(page));
  const sheet = page.getByRole("dialog", { name: "New rule" });
  await expect(sheet).toContainText("For Demo project only. Nothing is saved until you review and save.");
  // The example to draft from is on DEMO's own names, so it drafts as it reads.
  const describe = sheet.getByRole("textbox", { name: /Describe it/ });
  await expect(describe).toHaveAttribute("placeholder", "Bugs in progress for more than 3 days");
  await describe.fill("Bugs in progress for more than 3 days");
  await sheet.getByRole("button", { name: "Draft with AI" }).click();
  const said = sheet.getByRole("status");
  await expect(said).toContainText("Drafted by AI. Check it before you add it.");
  await expect(said).toContainText("Flags bugs that stay in progress for more than 3 days.");
  const name = sheet.getByRole("textbox", { name: "Name" });
  // The name never holds the limit, which the row shows and the admin may change.
  await expect(name).toHaveValue("Bugs in progress too long");
  await expect(sheet.getByRole("combobox", { name: "What to check" })).toContainText("Time in a status");
  await expect(sheet.getByRole("button", { name: "Statuses In Progress" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Issue types Bug" })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "Breach" })).toBeChecked();

  const hours = sheet.getByRole("spinbutton", { name: "Time in the status" });
  await hours.fill("48");
  await hours.press("Tab");
  await expect(sheet).toContainText("From 1 h to 8,760 h. That is 2 days.");
  await expect(said).toHaveText("Drafted by AI, then changed. Check it before you add it.");
  await expect(name).toHaveAccessibleDescription("From the AI's draft: check it still fits your changes.");
  await name.fill("Bugs in progress over 2 days");
  await expect(sheet).not.toContainText("From the AI's draft");
  expect(await axeBlocking(page)).toEqual([]);
  await sheet.getByRole("button", { name: "Add to changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(addRule(page)).toBeFocused();
  const fresh = page.locator("[data-new-rule]");
  await expect(fresh).toContainText("New");
  await expect(fresh).toContainText("Bugs in progress over 2 days");
  await expect(fresh).toContainText("Stays in “In Progress” for over 2 days");
  await expect(fresh).toContainText("Bug · In progress");
  await expect(bar(page)).toContainText("1 unsaved change");

  await bar(page).getByRole("button", { name: "Review and save" }).click();
  const review = page.getByRole("dialog", { name: "Review and save" });
  await expect(review.locator("[data-change-new]")).toContainText("New rule Bugs in progress over 2 days");
  const raise = review.locator("[data-impact-new] [data-would-raise]");
  await expect(raise).toHaveText(/^Would raise \d+ findings? now\.$/);
  const raised = Number(/\d+/.exec(await raise.innerText())?.[0]);
  expect(raised).toBeGreaterThan(0);
  // At most five tickets named: past five, the list says there are more.
  const opens = review.locator('[data-impact-new] [data-examples="Opens"]');
  await expect(opens.getByRole("link")).toHaveCount(Math.min(raised, 5));
  await expect(opens.locator("[data-examples-more]")).toHaveCount(raised > 5 ? 1 : 0);
  expect(await axeBlocking(page)).toEqual([]);
  await review.getByLabel(/Reason/).fill("Bugs should not sit in progress");
  await review.getByRole("button", { name: "Save and re-check" }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText("Saved. Re-checking Demo project…")).toBeVisible();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  // The re-check opened what the preview said the rule would raise.
  await expect(status(page)).toContainText(`0 closed, ${raised} opened`);

  const saved = customRows(page).first();
  await expect(saved).toContainText("Custom");
  await expect(saved).toContainText("Bugs in progress over 2 days");
  await expect(saved).toContainText("Time in a status");
  const ruleId = String(await saved.getAttribute("data-rule"));
  expect(ruleId).toMatch(/^R-CUS-\d{2,3}$/);
  const latest = history(page).locator("li[data-revision]").first();
  await expect(latest).toContainText(`${ruleId} Added rule “Bugs in progress over 2 days”`);
  await expect(latest).toContainText("Time in a status · Stays in “In Progress” for over 2 days · Bug · In progress · Breach");

  // Its findings, by its own name, on the Findings page its open count leads to.
  await saved.getByRole("link", { name: new RegExp(`open findings for ${ruleId}$`) }).click();
  await expect(page).toHaveURL(new RegExp(`/findings\\?rule=${ruleId}$`));
  const findings = page.getByRole("table", { name: "Findings" });
  await expect(findings.locator("tbody tr").first()).toContainText("Bugs in progress over 2 days");
  await expect(findings.locator("tbody tr").first()).toContainText(ruleId);

  // Undo deletes the rule it added, after saying so.
  await openSettings(page);
  const revision = Number(await history(page).locator("li[data-revision]").first().getAttribute("data-revision"));
  await history(page).locator("li[data-revision]").first().getByRole("button", { name: "Undo" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Undo revision ${revision}?` });
  await expect(confirm).toContainText("Deletes rule “Bugs in progress over 2 days”");
  await confirm.getByRole("button", { name: `Undo revision ${revision}` }).click();
  await expect(confirm).toBeHidden();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  await expect(customGroup(page)).toContainText("No custom rules yet");
  await expect(history(page).locator("li[data-revision]").first()).toContainText(`Undoes revision ${revision}`);
  expect(problems).toEqual([]);
});

test("an admin sets a rule up by hand: what it checks, its settings, what it looks at and how serious it is, each problem at its field (dark)", async ({ page }) => {
  test.slow();
  const problems = watchConsole(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await openSettings(page);
  // The empty group's own "Add rule" opens the same sheet.
  await pressKey(page, page.locator("[data-add-rule-empty]"));
  const sheet = page.getByRole("dialog", { name: "New rule" });
  await expect(sheet).toBeVisible();

  // Nothing filled in: each field says what it needs, and the first takes the focus.
  await sheet.getByRole("button", { name: "Add to changes" }).click();
  const name = sheet.getByRole("textbox", { name: "Name" });
  await expect(name).toBeFocused();
  await expect(sheet).toContainText("Give it a name of 3 to 80 characters.");
  await expect(sheet).toContainText("Pick what to check.");
  await name.fill("effort burning FAST");
  await name.press("Tab");
  await expect(sheet).toContainText("Another rule on this board has this name.");
  await name.fill("Bugs with no epic");

  await sheet.getByRole("combobox", { name: "What to check" }).click();
  await page.getByRole("option", { name: /^Missing field/ }).click();
  await sheet.getByRole("combobox", { name: "Field", exact: true }).click();
  await page.getByRole("option", { name: /^Epic/ }).click();
  await sheet.getByRole("checkbox", { name: "To do" }).check();
  await sheet.getByRole("button", { name: "Issue types All types" }).click();
  await page.getByRole("option", { name: /^Bug/ }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Issue types Bug" })).toBeVisible();
  await sheet.getByRole("radio", { name: "Warning" }).click();
  expect(await axeBlocking(page)).toEqual([]);
  await sheet.getByRole("button", { name: "Add to changes" }).click();
  await expect(sheet).toBeHidden();
  // The empty group's button went with the empty group: the header's has the focus.
  await expect(addRule(page)).toBeFocused();
  const fresh = page.locator("[data-new-rule]");
  await expect(fresh).toContainText("Bugs with no epic");
  await expect(fresh).toContainText("Missing field");
  await expect(fresh).toContainText("No epic");
  await expect(fresh).toContainText("Bug · To do and In progress");
  await expect(fresh).toContainText("Warning");

  await bar(page).getByRole("button", { name: "Review and save" }).click();
  const review = page.getByRole("dialog", { name: "Review and save" });
  await expect(review.locator("[data-change-new]")).toContainText(/Reported as\s*Warning/);
  await expect(review.locator("[data-impact-new] [data-would-raise]")).toHaveText(/^Would raise \d+ findings? now\.$/);
  await review.getByRole("button", { name: "Save and re-check" }).click();
  await expect(review).toBeHidden();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  const saved = customRows(page).first();
  const ruleId = String(await saved.getAttribute("data-rule"));
  // How serious it is decides its id: a warning's.
  expect(ruleId).toMatch(/^W-CUS-\d{2,3}$/);
  await expect(saved).toContainText("Bugs with no epic");
  await expect(saved.getByRole("radio", { name: "Warning" })).toBeChecked();

  // The Process page lists it after the catalogue's, marked Custom with its check.
  await page.goto("/process");
  const listed = page.getByRole("table", { name: "Rules" }).locator("tbody tr").filter({ hasText: ruleId });
  await expect(listed).toContainText("Custom");
  await expect(listed).toContainText("Missing field");
  await expect(listed).toContainText("Bugs with no epic");
  expect(problems).toEqual([]);
});

test("an admin edits a custom rule in its sheet, its check locked, then deletes it; the review says what each does, and undo brings it back", async ({ page, request }) => {
  test.slow();
  const rule = {
    title: "Tickets open over 60 days",
    check: "open_longer_than",
    params: { days: 60 },
    applies_to: { status_category: ["new", "indeterminate"], issue_type: null },
    severity: "breach",
  };
  await saveNow(request, [{ op: "create", rule }], "End-to-end tests: a rule to edit");
  await openSettings(page);
  const own = customRows(page).first();
  const ruleId = String(await own.getAttribute("data-rule"));
  await expect(own).toContainText("Open too long");
  await expect(own.getByRole("spinbutton")).toHaveValue("60");

  const edit = own.getByRole("button", { name: /^Edit/ });
  await pressKey(page, edit);
  const sheet = page.getByRole("dialog", { name: "Edit rule" });
  await expect(sheet).toContainText(ruleId);
  await expect(sheet.getByRole("combobox", { name: "What to check" })).toBeDisabled();
  await expect(sheet).toContainText("To use another check, delete this rule and add a new one.");
  await sheet.getByRole("textbox", { name: "Name" }).fill("Tickets open over 90 days");
  await sheet.getByRole("spinbutton", { name: "Days open" }).fill("90");
  await sheet.getByRole("button", { name: "Add to changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(edit).toBeFocused();
  await expect(own).toContainText("Edited");
  await expect(own).toContainText("Tickets open over 90 days");
  await expect(bar(page)).toContainText("2 unsaved changes");

  await bar(page).getByRole("button", { name: "Review and save" }).click();
  const review = page.getByRole("dialog", { name: "Review and save" });
  await expect(review.locator(`[data-change="${ruleId}.title"]`)).toContainText(/“Tickets open over 60 days”\s*to\s*“Tickets open over 90 days”/);
  await expect(review.locator(`[data-change="${ruleId}.params.days"]`)).toContainText(/60 days\s*to\s*90 days/);
  await expect(review.locator(`[data-impact="${ruleId}"]`)).toBeVisible();
  await review.getByRole("button", { name: "Save and re-check" }).click();
  await expect(review).toBeHidden();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  await expect(own).not.toContainText("Edited");
  await expect(own.getByRole("spinbutton")).toHaveValue("90");

  // Deleted and kept again, then deleted: the review says what the deletion closes.
  await own.getByRole("button", { name: /^Delete/ }).click();
  await expect(own).toContainText("Deleted when you save");
  await expect(own.getByRole("button", { name: /^Keep/ })).toBeFocused();
  await expect(bar(page)).toContainText("1 unsaved change");
  await own.getByRole("button", { name: /^Keep/ }).click();
  await expect(own).not.toContainText("Deleted when you save");
  await expect(bar(page)).toHaveCount(0);
  await own.getByRole("button", { name: /^Delete/ }).click();
  await bar(page).getByRole("button", { name: "Review and save" }).click();
  await expect(review.locator(`[data-change-deleted="${ruleId}"]`)).toContainText("Deleted. Its open findings close; an undo brings it back.");
  await expect(review.locator(`[data-impact="${ruleId}"] [data-would-close]`)).toHaveText(/^Would close \d+ findings?\.$/);
  await review.getByRole("button", { name: "Save and re-check" }).click();
  await expect(review).toBeHidden();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  await expect(customGroup(page)).toContainText("No custom rules yet");
  const latest = history(page).locator("li[data-revision]").first();
  await expect(latest).toContainText(`${ruleId} Deleted rule “Tickets open over 90 days”`);

  // Undo brings it back, under the same id.
  const revision = Number(await latest.getAttribute("data-revision"));
  await latest.getByRole("button", { name: "Undo" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Undo revision ${revision}?` });
  await expect(confirm).toContainText("Brings back rule “Tickets open over 90 days”");
  await confirm.getByRole("button", { name: `Undo revision ${revision}` }).click();
  await expect(confirm).toBeHidden();
  await expect(chip(page)).toHaveText("Applied", { timeout: 10_000 });
  await expect(row(page, ruleId)).toContainText("Tickets open over 90 days");
  await expect(history(page).locator("li[data-revision]").first()).toContainText(`${ruleId} Brought back rule “Tickets open over 90 days”`);
});
