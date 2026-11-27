import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// Serial, on a server of its own: these tests ignore findings, and every other spec reads the same sample.
test.describe.configure({ mode: "serial" });

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LOCAL = "Local (sign-in off)";
const ON_THE_DAY = "4 Nov 2026";

interface Finding {
  finding_id: string;
  issue_key: string | null;
  rule_id: string;
  rule_title: string;
  severity: "breach" | "warning";
  state: string;
  scope: "issue" | "sprint";
}

interface FindingsBody {
  total: number;
  items: Finding[];
}

const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const findings = (value: number) => `${count(value)} ${value === 1 ? "finding" : "findings"}`;

/** This project's own server: a change must carry its origin, as the page's own requests do. */
const origin = () => new URL(String(test.info().project.use.baseURL)).origin;

async function api(request: APIRequestContext, search = ""): Promise<FindingsBody> {
  const response = await request.get(`/api/oversight/findings${search}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as FindingsBody;
}

async function everyFinding(request: APIRequestContext, search: string): Promise<Finding[]> {
  const found: Finding[] = [];
  for (let page = 1; ; page += 1) {
    const body = await api(request, `?${search}&page_size=100&page=${page}`);
    found.push(...body.items);
    if (body.items.length === 0 || found.length >= body.total) return found;
  }
}

/** A ticket with open findings of two rules or more, and how many it holds. */
async function ticketWithRules(request: APIRequestContext, search = "ticket=open"): Promise<{ key: string; open: number }> {
  const rules = new Map<string, Finding[]>();
  for (const finding of await everyFinding(request, search)) {
    if (finding.issue_key) rules.set(finding.issue_key, [...(rules.get(finding.issue_key) ?? []), finding]);
  }
  const [key, held] = [...rules].find(([, list]) => new Set(list.map((finding) => finding.rule_id)).size > 1) ?? ["", []];
  expect(key).not.toBe("");
  return { key, open: held.length };
}

/** Every ignore that stands, restored through the route as an admin would. */
async function restoreEverything(request: APIRequestContext) {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request.get(`/api/oversight/findings/ignored?page_size=100&page=${page}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = (await response.json()) as { total: number; items: { ignore_id: string }[] };
    ids.push(...body.items.map((item) => item.ignore_id));
    if (body.items.length === 0 || ids.length >= body.total) break;
  }
  if (ids.length === 0) return;
  const restored = await request.post("/api/oversight/findings/restore", { data: { ignore_ids: ids }, headers: { origin: origin() } });
  expect(restored.status(), await restored.text()).toBe(200);
}

async function ignoreThrough(request: APIRequestContext, data: unknown) {
  const response = await request.post("/api/oversight/findings/ignore", { data, headers: { origin: origin() } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { ignored: { findings: number; tickets: number }; ignore_ids: string[] };
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

/** "809 open findings · 523 breaches": the one live region that starts with a figure. */
const resultLine = (page: Page) => page.getByRole("status").filter({ hasText: /^\s*[\d,]+ / });
const table = (page: Page) => page.getByRole("table", { name: "Findings" });
const bodyRows = (page: Page) => table(page).locator("tbody tr");
/** Rows a reader can select: every ticket's finding (a sprint is no ticket to ignore). */
const selectable = (page: Page) => bodyRows(page).filter({ has: page.getByRole("checkbox") });
const rowOf = (page: Page, finding: Finding) => bodyRows(page).filter({ hasText: finding.issue_key ?? "" }).filter({ hasText: finding.rule_title });
const ignoreDialog = (page: Page, value: number) => page.getByRole("dialog", { name: `Ignore ${findings(value)}?` });
const finishedDialog = (page: Page) => page.getByRole("dialog", { name: "Findings on finished tickets" });
const selected = (page: Page, value: number) => page.getByText(new RegExp(`^\\s*${count(value)}\\s+selected\\s*$`));

async function listReady(page: Page) {
  await expect(resultLine(page)).toContainText(/\d/);
}

/** Opens a row's actions (the kit's menu) and picks one. */
async function rowAction(page: Page, row: Locator, action: string) {
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

/** A restore of several findings may say first what comes back: confirmed when it does, and done once nothing is ignored. */
async function restoreConfirmed(page: Page, request: APIRequestContext) {
  const confirm = page.getByRole("dialog").or(page.getByRole("alertdialog")).filter({ has: page.getByRole("button", { name: /^Restore/ }) });
  const settled = async () => (await confirm.isVisible()) || (await api(request, "?state=ignored")).total === 0;
  await expect.poll(settled).toBe(true);
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: /^Restore/ }).click();
  await expect.poll(async () => (await api(request, "?state=ignored")).total).toBe(0);
}

test.beforeAll(async ({ request }) => {
  await restoreEverything(request);
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ request }) => {
  await restoreEverything(request);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`Findings offers selection, the Ticket filter and the Ignored state, and passes axe (${colorScheme})`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme });
    const problems = watchConsole(page);
    const shown = await api(request);
    await page.goto("/findings");
    await listReady(page);

    await expect(table(page).locator("thead").getByRole("checkbox")).toHaveCount(1);
    await expect(selectable(page)).toHaveCount(shown.items.filter((finding) => finding.scope === "issue").length);
    await expect(selectable(page).first().getByRole("button", { name: /^Actions for/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Ticket\b/ })).toContainText("Any");
    await expect(page.getByRole("radio", { name: /^Ignored\b/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ignore findings on finished tickets…" })).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test("the Ticket filter narrows to open or finished tickets and writes the address", async ({ page, request }) => {
  const finished = await api(request, "?ticket=finished");
  const open = await api(request, "?ticket=open");
  await page.goto("/findings");
  await listReady(page);

  await page.getByRole("button", { name: /^Ticket\b/ }).click();
  await page.getByRole("menuitemradio", { name: /^Finished\b/ }).click();

  await expect(page).toHaveURL(/[?&]ticket=finished\b/);
  await expect(resultLine(page)).toContainText(`${count(finished.total)} open findings`);
  await expect(page.getByRole("button", { name: /^Ticket\b/ })).toContainText("Finished");
  await page.getByRole("button", { name: /^Ticket\b/ }).click();
  await page.getByRole("menuitemradio", { name: /^Open\b/ }).click();
  await expect(page).toHaveURL(/[?&]ticket=open\b/);
  await expect(resultLine(page)).toContainText(`${count(open.total)} open findings`);
  await page.getByRole("button", { name: /^Ticket\b/ }).click();
  await page.getByRole("menuitemradio", { name: /^Any\b/ }).click();
  await expect(page).not.toHaveURL(/ticket=/);
});

test("three rows selected: one bulk ignore with a reason, the count said first, and Undo brings them back", async ({ page, request }) => {
  const problems = watchConsole(page);
  const before = await api(request, "?ticket=finished");
  const picked = before.items.filter((finding) => finding.scope === "issue").slice(0, 3);
  await page.goto("/findings?ticket=finished");
  await listReady(page);

  for (const finding of picked) await rowOf(page, finding).getByRole("checkbox").check();

  await expect(selected(page, 3)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ignore", exact: true }).click();
  const dialog = ignoreDialog(page, 3);
  await expect(dialog).toBeVisible();
  for (const finding of picked) await expect(dialog).toContainText(finding.rule_title);
  const reason = dialog.getByRole("textbox", { name: /Reason/ });
  await reason.fill("Closed before the rules ran");
  await expect(dialog).toContainText("500");
  await expect(dialog).not.toContainText(/Europe\/London|UTC|@/);
  await dialog.getByRole("button", { name: "Ignore 3 findings" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Ignored 3 findings")).toBeVisible();
  await expect(resultLine(page)).toContainText(`${count(before.total - 3)} open findings`);
  const ignored = await api(request, "?state=ignored");
  expect(ignored.items.map((finding) => finding.finding_id).sort()).toEqual(picked.map((finding) => finding.finding_id).sort());

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(resultLine(page)).toContainText(`${count(before.total)} open findings`);
  expect((await api(request, "?state=ignored")).total).toBe(0);
  expect(problems).toEqual([]);
});

test("a page selected offers every matching finding, and one ignore takes them all", async ({ page, request }) => {
  const before = await api(request, "?ticket=finished");
  expect(before.total).toBeGreaterThan(25);
  await page.goto("/findings?ticket=finished");
  await listReady(page);

  await table(page).locator("thead").getByRole("checkbox").check();
  await expect(selected(page, 25)).toBeVisible();
  await page.getByRole("button", { name: `Select all ${count(before.total)} matching` }).click();
  await page.getByRole("button", { name: "Ignore", exact: true }).click();
  const dialog = ignoreDialog(page, before.total);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: `Ignore ${findings(before.total)}` }).click();

  await expect(page.getByText(`Ignored ${findings(before.total)}`)).toBeVisible();
  expect((await api(request, "?ticket=finished")).total).toBe(0);
  expect((await api(request, "?state=ignored")).total).toBe(before.total);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await api(request, "?ticket=finished")).total).toBe(before.total);
});

test("Ignore findings on finished tickets… lists every rule there and leaves the list alone; Escape changes nothing", async ({ page, request }) => {
  const rules = (await (await request.get("/api/oversight/rules")).json()) as { rules: { rule_id: string; enabled: boolean }[] };
  await page.goto("/findings");
  await listReady(page);
  const url = page.url();
  const action = page.getByRole("button", { name: "Ignore findings on finished tickets…" });

  await action.click();

  const dialog = finishedDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-finished-rule]")).toHaveCount(rules.rules.filter((rule) => rule.enabled).length);
  await expect(dialog.locator("[data-finished-rule]:not([data-idle])").first()).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(dialog.locator("[data-finished-save]")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(action).toBeFocused();
  expect((await api(request, "?state=ignored")).total).toBe(0);
});

test("ticking a rule ignores its findings on every finished ticket, and unticking it counts them again", async ({ page, request }) => {
  await page.goto("/findings");
  await listReady(page);
  const action = page.getByRole("button", { name: "Ignore findings on finished tickets…" });
  await action.click();
  const dialog = finishedDialog(page);
  const live = dialog.locator("[data-finished-rule]:not([data-idle])").first();
  await expect(live).toBeVisible();
  const ruleId = (await live.getAttribute("data-finished-rule"))!;
  const open = (await api(request, `?ticket=finished&rule=${ruleId}`)).total;
  expect(open).toBeGreaterThan(0);

  await live.getByRole("checkbox").click();
  await expect(dialog.locator("[data-finished-save]")).toHaveText(`Ignore ${findings(open)}`);
  await dialog.locator("[data-finished-save]").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${findings(open)} ignored.`)).toBeVisible();
  await expect.poll(async () => (await api(request, `?ticket=finished&rule=${ruleId}`)).total).toBe(0);

  await action.click();
  const row = dialog.locator(`[data-finished-rule='${ruleId}']`);
  await expect(row.getByRole("checkbox")).toHaveAttribute("data-state", "checked");
  await row.getByRole("checkbox").click();
  await expect(dialog.locator("[data-finished-save]")).toHaveText(`Restore ${findings(open)}`);
  await dialog.locator("[data-finished-save]").click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await api(request, `?ticket=finished&rule=${ruleId}`)).total).toBe(open);
  expect((await api(request, "?state=ignored")).total).toBe(0);
});

test("a row's Ignore offers the scope, one rule or every rule on the ticket; Ignored rows say who, when and why; Restore brings them back", async ({
  page,
  request,
}) => {
  const { key, open } = await ticketWithRules(request);
  await page.goto(`/findings?q=${key}`);
  await listReady(page);
  await selectable(page).first().getByRole("button", { name: /^Actions for/ }).click();
  await expect(page.getByRole("menuitem", { name: "Ignore every rule on this ticket" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Ignore", exact: true }).click();

  const one = ignoreDialog(page, 1);
  await expect(one).toBeVisible();
  await expect(one.getByRole("radio", { name: /^Only this rule/ })).toBeChecked();
  await one.getByRole("radio", { name: /^Every rule on this ticket/ }).click();
  const dialog = ignoreDialog(page, open);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /^Every rule on this ticket/ })).toBeChecked();
  await dialog.getByRole("textbox", { name: /Reason/ }).fill("Duplicate of another ticket");
  await dialog.getByRole("button", { name: `Ignore ${findings(open)}` }).click();
  await expect(page.getByText(`Ignored ${findings(open)}`)).toBeVisible();

  await page.getByRole("radio", { name: /^Ignored\b/ }).click();
  await expect(page).toHaveURL(/[?&]state=ignored\b/);
  await expect(bodyRows(page)).toHaveCount(open);
  const sentence = `Ignored by ${LOCAL} on ${ON_THE_DAY}: Duplicate of another ticket`;
  for (const ignoredRow of await bodyRows(page).all()) {
    await expect(ignoredRow.getByText("Ignored", { exact: true })).toBeVisible();
    await expect(ignoredRow.getByText(sentence)).toBeAttached();
  }
  await bodyRows(page).first().getByText("Ignored", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(sentence);
  expect(await axeBlocking(page)).toEqual([]);

  await rowAction(page, bodyRows(page).first(), "Restore");
  await restoreConfirmed(page, request);
  await expect.poll(async () => (await api(request, `?q=${key}`)).total).toBe(open);
});

test("Ignore every rule on this ticket asks first for all of the ticket's open findings; Escape changes nothing", async ({ page, request }) => {
  const { key, open } = await ticketWithRules(request);
  await page.goto(`/findings?q=${key}`);
  await listReady(page);
  const actions = selectable(page).first().getByRole("button", { name: /^Actions for/ });
  await actions.click();
  await page.getByRole("menuitem", { name: "Ignore every rule on this ticket" }).click();

  const dialog = ignoreDialog(page, open);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: `Ignore ${findings(open)}` })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await api(request, "?state=ignored")).total).toBe(0);
});

test("rows ignored are restored together from the Ignored state", async ({ page, request }) => {
  const picked = (await api(request, "?ticket=finished")).items.filter((finding) => finding.scope === "issue").slice(0, 3);
  await ignoreThrough(request, { target: { finding_ids: picked.map((finding) => finding.finding_id) }, scope: "finding", reason: null });
  await page.goto("/findings?state=ignored");
  await listReady(page);
  await expect(bodyRows(page)).toHaveCount(3);

  await table(page).locator("thead").getByRole("checkbox").check();
  await expect(selected(page, 3)).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await restoreConfirmed(page, request);
  for (const finding of picked) expect((await api(request, `?q=${finding.issue_key}&rule=${finding.rule_id}`)).total).toBe(1);
});

test("the evidence drawer ignores and restores its finding, with a banner saying who, when and why", async ({ page, request }) => {
  const [finding] = (await api(request, "?ticket=finished")).items.filter((candidate) => candidate.scope === "issue");
  await page.goto(`/findings?finding=${finding.finding_id}`);
  const drawer = page.getByRole("dialog", { name: finding.rule_title });
  await expect(drawer).toBeVisible();

  await drawer.getByRole("button", { name: "Ignore", exact: true }).click();
  const dialog = ignoreDialog(page, 1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /^Only this rule/ })).toBeChecked();
  await dialog.getByRole("textbox", { name: /Reason/ }).fill("Agreed with the team");
  await dialog.getByRole("button", { name: "Ignore 1 finding" }).click();

  await expect(drawer).toContainText(`Ignored by ${LOCAL} on ${ON_THE_DAY}`);
  await expect(drawer).toContainText("Agreed with the team");
  await expect(drawer).not.toContainText(/Europe\/London|UTC|@/);
  expect(await axeBlocking(page)).toEqual([]);
  await drawer.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(drawer).not.toContainText(`Ignored by ${LOCAL}`);
  await expect.poll(async () => (await api(request, "?state=ignored")).total).toBe(0);
});

test("the ticket page ignores all on its ticket, and its findings then carry Ignored chips", async ({ page, request }) => {
  const { key, open } = await ticketWithRules(request);
  await page.goto(`/issues/${key}`);
  await page.getByRole("button", { name: "Ignore all on this ticket" }).click();
  const dialog = ignoreDialog(page, open);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: `Ignore ${findings(open)}` }).click();

  await expect(page.getByText(`Ignored ${findings(open)}`)).toBeVisible();
  await expect(page.locator("main").getByText("Ignored", { exact: true })).toHaveCount(open);
  expect((await api(request, `?q=${key}`)).total).toBe(0);
  expect(await axeBlocking(page)).toEqual([]);
});

test("keyboard: Space selects, Enter opens the dialog, Escape closes it and the focus comes back", async ({ page }) => {
  await page.goto("/findings");
  await listReady(page);
  const box = selectable(page).first().getByRole("checkbox");
  await box.focus();
  await page.keyboard.press("Space");
  await expect(selected(page, 1)).toBeVisible();

  const bulk = page.getByRole("button", { name: "Ignore", exact: true });
  await bulk.focus();
  await page.keyboard.press("Enter");
  const dialog = ignoreDialog(page, 1);
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[role='dialog']") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(bulk).toBeFocused();

  await page.getByRole("button", { name: "Clear", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(selected(page, 1)).toBeHidden();
});

test("counts elsewhere just change: the Overview's open breaches drop by the breaches ignored", async ({ page, request }) => {
  const overview = async () =>
    ((await (await request.get("/api/oversight/overview")).json()) as { totals: { open_breaches: { current: number } } }).totals.open_breaches.current;
  const before = await overview();
  const breaches = (await api(request, "?ticket=finished&severity=breach")).items.slice(0, 3);
  await ignoreThrough(request, { target: { finding_ids: breaches.map((finding) => finding.finding_id) }, scope: "finding", reason: null });
  expect(await overview()).toBe(before - 3);

  await page.goto("/");
  const tiles = page.getByRole("region", { name: "Headline figures" }).getByRole("link");
  await expect(tiles.first()).toContainText("Open breaches");
  await expect(tiles.first()).toContainText(count(before - 3));
});

test("on a phone the finished tickets dialog fits the screen and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/findings");
  await listReady(page);
  await page.getByRole("button", { name: "Ignore findings on finished tickets…" }).click();
  const dialog = finishedDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-finished-rule]").first()).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 390).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await axeBlocking(page)).toEqual([]);
});
