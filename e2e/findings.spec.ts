import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { readableClipboard } from "./clipboard";
import { cutText } from "./cut-text";

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/** DEMO-1098, R-EST-01, foreshadowed by W-EST-01 (docs/sample-responses/finding.json). */
const BREACH_ID = "0b7b3b0f61c477e61699982f24892735";
/** Sprint 26 at risk, W-SPR-01 (docs/sample-responses/finding-sprint.json). */
const SPRINT_ID = "4f4dea9b42b76d4882fbb2db662287c3";

const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);

interface FindingsBody {
  total: number;
  items: { finding_id: string; rule_title: string; message: string; issue_key: string | null }[];
  facets: { severity: { value: string; count: number }[] };
}

async function api(page: Page, search = ""): Promise<FindingsBody> {
  const response = await page.request.get(`/api/oversight/findings${search}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as FindingsBody;
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

/** The list has loaded once the result line carries its figures. */
async function listReady(page: Page) {
  await expect(resultLine(page)).toContainText(/\d/);
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

test("every row says why its rule fired, in the finding's own words", async ({ page }) => {
  const body = await api(page);
  await page.goto("/findings");
  await listReady(page);
  const reasons = bodyRows(page).locator("[data-finding-reason]");
  await expect(reasons).toHaveCount(body.items.length);
  await expect(reasons.first()).toHaveText(body.items[0].message);
  await expect(table(page).getByRole("columnheader", { name: /^Rule\b/ })).toBeVisible();
});

for (const width of [1280, 1440]) {
  test(`at ${width} px the table never scrolls sideways, and each rule's title and issue key read whole (SQA)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/findings");
    await listReady(page);
    await expect(bodyRows(page).first()).toBeVisible();
    const frame = page.locator(".jo-scroller").filter({ has: table(page) });
    expect(await frame.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await expect(table(page).getByRole("columnheader", { name: "State" })).toBeInViewport({ ratio: 1 });
    const cut = await table(page)
      .locator("[data-rule-title], tbody td:nth-child(3) .mono")
      .evaluateAll((cells) =>
        cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1).map((cell) => cell.textContent),
      );
    expect(cut).toEqual([]);
  });
}

test("on a phone the findings are a list: each rule's title and issue read whole, nothing scrolls sideways, a press opens it (SQA)", async ({ page }) => {
  // Regression: at 390 px the table's rule column read "Work s…" and the issue column sat off-screen in its frame.
  await page.setViewportSize({ width: 390, height: 844 });
  const body = await api(page);
  await page.goto("/findings");
  await listReady(page);
  const list = page.getByRole("list", { name: "Findings" });
  await expect(list.getByRole("listitem")).toHaveCount(body.items.length);
  await expect(table(page)).toHaveCount(0);
  const first = list.getByRole("listitem").first();
  await expect(first).toContainText(body.items[0].rule_title);
  await expect(first).toContainText(body.items[0].issue_key ?? "Sprint");
  const cut = await list.locator("[data-rule-title]").evaluateAll((titles) => titles.filter((title) => title.scrollWidth > title.clientWidth + 1).length);
  expect(cut).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await axeBlocking(page)).toEqual([]);
  await first.getByRole("button").click();
  await expect(page.getByRole("dialog", { name: body.items[0].rule_title })).toBeVisible();
  // The one open is marked as the table marks its row (the open drawer hides the page from the accessibility tree).
  await expect(page.locator("[data-findings-list] > li").first().locator("button")).toHaveAttribute("aria-current", "true");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`lists the open findings with the API's figures, and passes axe (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const problems = watchConsole(page);
    const expected = await api(page);
    const breaches = expected.facets.severity.find((entry) => entry.value === "breach")?.count ?? 0;

    await page.goto("/findings");
    await expect(page.getByRole("heading", { level: 1, name: "Findings" })).toBeVisible();
    await listReady(page);
    await expect(resultLine(page)).toHaveText(
      new RegExp(`^${count(expected.total)} open findings\\s*·\\s*,\\s*${count(breaches)} breaches$`),
    );
    await expect(bodyRows(page)).toHaveCount(expected.items.length);
    await expect(bodyRows(page).first()).toContainText("Sprint 26");
    await expect(page.getByRole("radio", { name: `Breach, ${count(breaches)}` })).toBeVisible();

    expect(await axeBlocking(page)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test("filters write the URL, the counts follow, and Clear empties them", async ({ page }) => {
  const breaches = await api(page, "?severity=breach");
  await page.goto("/findings");
  await listReady(page);

  await page.getByRole("radio", { name: /^Breach/ }).click();
  await expect(page).toHaveURL(/\/findings\?severity=breach$/);
  await expect(resultLine(page)).toHaveText(`${count(breaches.total)} open breaches`);
  await expect(bodyRows(page).filter({ hasText: "Warning" })).toHaveCount(0);
  await expect(page.getByText("Filter applied")).toBeVisible();

  await page.getByRole("button", { name: "Rule Any" }).click();
  await page.getByRole("listbox", { name: "Rule" }).getByRole("option", { name: /R-EST-01/ }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/rule=R-EST-01/);
  await expect(page.getByRole("button", { name: /^Rule R-EST-01/ })).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/findings$/);
  await expect(page.getByText("Filters cleared")).toBeVisible();
});

test("an Overview hot spot link lists the same findings", async ({ page }) => {
  const expected = await api(page, "?epic=DEMO-704");
  await page.goto("/findings?state=open&epic=DEMO-704");
  await listReady(page);
  await expect(resultLine(page)).toContainText(`${count(expected.total)} open findings`);
  await expect(page.getByRole("button", { name: /^Epic Data import pipeline/ })).toBeVisible();
});

test("/ focuses the search, which finds an issue by its key", async ({ page }) => {
  await page.goto("/findings");
  await listReady(page);
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "Search findings" });
  await expect(search).toBeFocused();
  await page.keyboard.type("demo-1098");
  await expect(page).toHaveURL(/q=demo-1098/);
  await expect(bodyRows(page).first()).toContainText("DEMO-1098");
  await expect(bodyRows(page).filter({ hasNotText: "DEMO-1098" })).toHaveCount(0);
});

test("a row opens its evidence; Next replaces it, so Back closes the drawer", async ({ page }) => {
  const problems = watchConsole(page);
  const first = await api(page);
  await page.goto("/findings");
  await listReady(page);

  await bodyRows(page).filter({ hasText: "DEMO-1098" }).click();
  await expect(page).toHaveURL(new RegExp(`finding=${BREACH_ID}`));
  const drawer = page.getByRole("dialog", { name: "Work started without an estimate" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("table", { name: /Changelog entries/ })).toContainText("318706");
  await expect(drawer.getByText("Warned before")).toBeVisible();
  await expect(drawer.getByText("12 days later")).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Status timeline" })).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);

  await drawer.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(new RegExp(`finding=${first.items[2].finding_id}`));
  await expect(page.getByRole("dialog", { name: first.items[2].rule_title })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(/\/findings$/);
  expect(problems).toEqual([]);
});

test("the warning that came before a breach is one click away, and Back returns to the breach", async ({ page }) => {
  await page.goto(`/findings?finding=${BREACH_ID}`);
  const breach = page.getByRole("dialog", { name: "Work started without an estimate" });
  await breach.getByRole("button", { name: "Open the warning W-EST-01" }).click();
  await expect(page).toHaveURL(/finding=a59f6d27db353a9c64e3667e6e1e4e86/);
  await expect(page.getByRole("dialog", { name: "Unestimated work in the active sprint" })).toBeVisible();
  await page.goBack();
  await expect(breach).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`finding=${BREACH_ID}`));
});

test("keyboard: j and k move, Enter opens, j steps the drawer, Esc closes and focus returns", async ({ page }) => {
  const first = await api(page);
  await page.goto("/findings");
  await listReady(page);

  await page.keyboard.press("j");
  await expect(bodyRows(page).nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(bodyRows(page).nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`finding=${first.items[1].finding_id}`));
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`finding=${first.items[2].finding_id}`));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).not.toHaveURL(/finding=/);
  await expect(bodyRows(page).nth(1)).toBeFocused();
});

test("a sprint finding shows its sprint, with no issue to open and no timeline", async ({ page }) => {
  await page.goto(`/findings?finding=${SPRINT_ID}`);
  const drawer = page.getByRole("dialog", { name: "Sprint at risk" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Jira sprint 4426");
  await expect(drawer.getByRole("heading", { name: "Status timeline" })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: /Open issue/ })).toHaveCount(0);
  expect(await axeBlocking(page)).toEqual([]);
});

test("Open in Jira stays in sample mode, disabled, and says why", async ({ page }) => {
  await page.goto(`/findings?finding=${BREACH_ID}`);
  const drawer = page.getByRole("dialog", { name: "Work started without an estimate" });
  await expect(drawer.getByRole("link", { name: /Open issue/ })).toHaveAttribute("href", "/issues/DEMO-1098");
  const jira = drawer.getByRole("button", { name: "Open in Jira" });
  await expect(jira).toHaveAttribute("aria-disabled", "true");
  await jira.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Sample data: no Jira link");
});

test("a header sorts through the API and pages follow in the URL", async ({ page }) => {
  const expected = await api(page);
  await page.goto("/findings");
  await listReady(page);

  await table(page).getByRole("button", { name: "Severity" }).click();
  await expect(page).toHaveURL(/\/findings\?sort=severity$/);
  await expect(table(page).getByRole("columnheader", { name: "Severity" })).toHaveAttribute("aria-sort", "descending");
  await expect(bodyRows(page).first()).toContainText("Breach");

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/sort=severity&page=2|page=2&sort=severity/);
  await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText(`26–50 of ${count(expected.total)}`);
});

test.describe("acknowledgement", () => {
  test.beforeEach(readableClipboard);

  test("Export CSV saves the rows as shown, and Copy link copies the view", async ({ page }) => {
    await page.goto("/findings?severity=warning");
    await listReady(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    expect((await download).suggestedFilename()).toBe("findings-2026-11-04.csv");
    await expect(page.getByText("Export ready")).toBeVisible();

    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/findings\?severity=warning$/);
  });
});

test("an empty result says what was looked at", async ({ page }) => {
  await page.goto("/findings?q=zzzz-no-such-thing");
  await expect(page.getByText("No findings match these filters")).toBeVisible();
  await expect(page.getByText("Open findings in DEMO, matching “zzzz-no-such-thing”.", { exact: true })).toBeVisible();
  await expect(table(page).getByRole("button", { name: "Clear filters" })).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
});

test("a failed load stays inline, and Try again recovers", async ({ page }) => {
  await page.route("**/api/oversight/findings*", (route) =>
    route.fulfill({ status: 503, json: { error: "upstream_unavailable", message: "The service is down." } }),
  );
  await page.goto("/findings");
  // The client retries a 5xx twice before it says so.
  const alert = table(page).getByRole("alert");
  await expect(alert).toContainText("Couldn't load the findings", { timeout: 15_000 });
  await expect(alert).toContainText("HTTP 503 · upstream_unavailable");

  await page.unroute("**/api/oversight/findings*");
  await alert.getByRole("button", { name: "Try again" }).click();
  await listReady(page);
  await expect(bodyRows(page)).toHaveCount(25);
});

/** Each row's First seen, as it reads ("6 h ago"), and Open for, under their headers, spaces made plain. */
async function ages(page: Page) {
  const table = page.getByRole("table", { name: "Findings" });
  await expect(table.locator("tbody tr").first()).toContainText(/ago/);
  return table.evaluate((element) => {
    const headers = [...element.querySelectorAll("thead th")].map((header) => (header as HTMLElement).innerText.replace(/\s+/g, " ").trim().toLowerCase());
    const first = headers.findIndex((header) => header === "first seen");
    const open = headers.findIndex((header) => header.startsWith("open for"));
    return {
      header: headers[open],
      rows: [...element.querySelectorAll("tbody tr")].map((row) => {
        const cells = row.querySelectorAll("td");
        const plain = (text: string) => text.replace(/\s+/g, " ").trim();
        return { first: plain(cells[first].querySelector("time")?.firstChild?.textContent ?? ""), open: plain((cells[open] as HTMLElement).innerText) };
      }),
    };
  });
}

test("First seen and Open for read one clock: on fresh data an open finding's age is the span First seen gives", async ({ page }) => {
  await page.goto("/findings");
  const { header, rows } = await ages(page);
  expect(header).toBe("open for");
  expect(rows.length).toBeGreaterThan(10);
  const figure = (text: string) => Number(text.replace(/,/g, "").split(" ")[0]);
  for (const { first: seen, open } of rows) {
    if (open === "<1 h") expect(seen).toMatch(/^(just now|\d+ min ago)$/);
    else if (/ mo ago$/.test(seen)) expect(Math.round(figure(open) / 30.4375)).toBe(figure(seen));
    else if (/ d ago$/.test(seen) && / h$/.test(open)) expect(Math.max(1, Math.round(figure(open) / 24))).toBe(figure(seen));
    else expect(`${open} ago`).toBe(seen);
  }
  expect(rows[2]).toEqual({ first: "6 h ago", open: "6 h" });
});

test("on stale data Open for says it is as at the last sync, where First seen reads the reader's clock", async ({ page }) => {
  // Regression: "First seen 9 d ago" beside "Open for 2 h" on any day after the sample's sync, with nothing to say why.
  await page.clock.setFixedTime(new Date("2026-11-13T09:00:00Z"));
  await page.goto("/findings");
  const { header, rows } = await ages(page);
  expect(header).toBe("open for at last sync");
  expect(rows[0]).toEqual({ first: "9 d ago", open: "2 h" });
  const label = page.getByRole("columnheader", { name: /^Open for at last sync/ });
  await expect(label.locator("[title]")).toHaveAttribute("title", /^As at the last sync, 4 Nov 2026, 2:28\sPM$/);
  // The drawer says the same of the finding it opens.
  await page.goto(`/findings?finding=${BREACH_ID}`);
  const drawer = page.getByRole("dialog", { name: "Work started without an estimate" });
  await expect(drawer.locator("dt", { hasText: /^Open for$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText(/^4\sh at last sync$/);
});

test("on a phone the drawer's changelog and facts read whole: when and what changed wrap rather than being cut", async ({ page }) => {
  // Regression: at 390 px the changelog read "4 Nov 2026, 10:…" and "To Do …", with no way to read either on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/findings?finding=${BREACH_ID}`);
  const drawer = page.getByRole("dialog", { name: "Work started without an estimate" });
  const changelog = drawer.getByRole("table", { name: "Changelog entries the rule read on DEMO-1098" });
  await expect(changelog.locator("tbody tr")).toHaveCount(1);
  await expect(changelog.locator("tbody tr")).toContainText("To Do → In Progress");
  // Its header too, which the rounded frame round the table clipped ("CHANGELO"): cutText reads that frame.
  await expect(changelog.getByRole("columnheader", { name: "Changelog" })).toBeVisible();
  expect(await cutText(changelog)).toEqual([]);
  expect(await cutText(drawer.locator("dl").first())).toEqual([]);

  // Scrolled under: the drawer's body moves, the changelog's head (which scrolls with it) does not lift.
  await drawer.locator(".jo-scroller").first().evaluate((scroller) => (scroller.scrollTop = scroller.scrollHeight));
  await expect(drawer.locator(".jo-scroll-frame[data-scrolled='true']").first()).toBeAttached();
  const head = await changelog.locator("th").first().evaluate((th) => ({
    shadow: getComputedStyle(th).boxShadow,
    lift: getComputedStyle(th, "::after").content,
  }));
  expect(head.shadow).not.toContain("6px 10px");
  expect(["none", "normal", ""]).toContain(head.lift);
});

test("only a sticky head lifts, and only when its own frame is scrolled under it (JO-14)", async ({ page }) => {
  // Regression: every table inside any scrolled frame got the lift, a shadow broken at each column.
  await page.goto("/findings");
  await expect(page.getByRole("table").first()).toBeVisible();
  const lifted = await page.evaluate(() => {
    const table = (sticky: boolean) =>
      `<table class="jo-table" data-sticky="${sticky}"><thead><tr><th>One</th><th>Two</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`;
    const frame = (scrolled: boolean, inner: string) =>
      `<div class="jo-scroll-frame" data-axis="y" data-scrolled="${scrolled}"><div class="jo-scroller">${inner}</div></div>`;
    const cases = {
      stickyScrolled: frame(true, table(true)),
      stickyNotScrolled: frame(false, table(true)),
      staticScrolled: frame(true, table(false)),
      stickyInAScrolledDrawer: frame(true, `<section>${frame(false, table(true))}</section>`),
    };
    const out: Record<string, string> = {};
    for (const [name, html] of Object.entries(cases)) {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.append(host);
      const th = host.querySelector("th")!;
      out[name] = getComputedStyle(th, "::after").content;
      host.remove();
    }
    return out;
  });
  expect(lifted.stickyScrolled).toBe('""');
  for (const name of ["stickyNotScrolled", "staticScrolled", "stickyInAScrolledDrawer"] as const) expect(["none", "normal"], name).toContain(lifted[name]);
});

test("a link to a finding that does not exist says so", async ({ page }) => {
  await page.goto(`/findings?finding=${"f".repeat(32)}`);
  const drawer = page.getByRole("dialog", { name: "Finding not found" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("No finding has that id")).toBeVisible();
  await drawer.getByRole("button", { name: "Back to the list" }).click();
  await expect(page).not.toHaveURL(/finding=/);
});
