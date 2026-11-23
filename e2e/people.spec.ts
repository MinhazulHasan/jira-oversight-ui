import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/*
 * The person view (JO-07): who carries the open findings on the Overview, the
 * Person filter and the Assignee column on Findings, and the assignee on the
 * ticket page. Sample mode, pinned to SAMPLE_NOW (playwright.config.ts), with
 * the browser's clock frozen at the same moment. The sample's people are the
 * eight fictional names of the backend's DEMO project; expected figures are
 * read from the API, so each screen is checked against the numbers it is
 * meant to show rather than against copies of them.
 */

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PEOPLE_API = "**/api/oversight/people";
/** The sample's accounts in order (src/server/sample/team.ts): fictional names, as the backend's demo has them. */
const SAMPLE_PEOPLE = [
  ["acc-01", "Ada Brooks"],
  ["acc-02", "Ben Okafor"],
  ["acc-03", "Carmen Ruiz"],
  ["acc-04", "Dev Malhotra"],
  ["acc-05", "Elif Aydin"],
  ["acc-06", "Finn Gallagher"],
  ["acc-07", "Grace Lindqvist"],
  ["acc-08", "Hana Mori"],
] as const;
/** DEMO-1098, R-EST-01 (docs/sample-responses/finding.json). */
const BREACH_ID = "0b7b3b0f61c477e61699982f24892735";
/** Sprint 26 at risk, W-SPR-01 (docs/sample-responses/finding-sprint.json). */
const SPRINT_ID = "4f4dea9b42b76d4882fbb2db662287c3";
/** An issue nobody is assigned to in the sample. */
const UNASSIGNED_ISSUE = "DEMO-1133";
/** The board's members who hold none of its tickets (JO-10): fictional, with no picture. */
const SAMPLE_MEMBERS = [
  ["acc-09", "Noor Haddad"],
  ["acc-10", "Tomás Ferreira"],
  ["acc-11", "Yuki Tanabe"],
] as const;
/** A person id of the right form that nobody on the board has (a link from another board, say). */
const NOBODY_HERE = "p000000000000";

const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);
/** The contract's person id: "p" and the first 12 hex digits of SHA-256 of the Jira account id. */
const personId = (accountId: string) => `p${createHash("sha256").update(accountId, "utf8").digest("hex").slice(0, 12)}`;

interface Person {
  id: string;
  name: string;
  avatar: string | null;
}

interface PersonRow {
  person: Person | null;
  tickets: number;
  open_tickets: number;
  open_breaches: number;
  open_warnings: number;
  tickets_with_findings: number;
}

interface FindingsBody {
  total: number;
  items: { finding_id: string; scope: "issue" | "sprint"; issue_key: string | null; assignee: Person | null }[];
  facets: { severity: { value: string; count: number }[]; people: { value: string; label: string; count: number }[] };
}

async function people(request: APIRequestContext): Promise<PersonRow[]> {
  const response = await request.get("/api/oversight/people");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { people: PersonRow[] }).people;
}

async function findings(request: APIRequestContext, search = ""): Promise<FindingsBody> {
  const response = await request.get(`/api/oversight/findings${search}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as FindingsBody;
}

const breachesIn = (body: FindingsBody) => body.facets.severity.find((entry) => entry.value === "breach")?.count ?? 0;

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

async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/* The Overview's panel. */
const peoplePanel = (page: Page) => page.getByRole("region", { name: "People" });
/** Each row's link (to the person's open findings); a person's name in the row is a control of its own (their card). */
const personRows = (page: Page) => page.getByRole("list", { name: "Open findings by person" }).getByRole("link");
/** Each row as a whole: the name (with its card), the bar and the figures. */
const personItems = (page: Page) => page.getByRole("list", { name: "Open findings by person" }).getByRole("listitem");

/* The Findings page. */
/** "124 open findings · 88 breaches": the one live region that starts with a figure. */
const resultLine = (page: Page) => page.getByRole("status").filter({ hasText: /^\s*[\d,]+ / });
const table = (page: Page) => page.getByRole("table", { name: "Findings" });
const bodyRows = (page: Page) => table(page).locator("tbody tr");
const personMenu = (page: Page) => page.getByRole("listbox", { name: "Person" });

/** The whole result line for a filtered list, as findings.spec.ts reads it. */
const resultText = (total: number, breaches: number) =>
  new RegExp(`^${count(total)} open findings\\s*·\\s*,\\s*${count(breaches)} breaches$`);

/** The list has loaded once the result line carries its figures; the page is live once the sync time is drawn. */
async function listReady(page: Page) {
  await expect(resultLine(page)).toContainText(/\d/);
  await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
  await expect(page.getByRole("banner").locator("[data-sync-now]").filter({ hasText: / ago/ })).toBeVisible();
}

/** The Assignee cell of every row on the page, found by its header so a new column cannot shift it. */
async function assigneeCells(page: Page) {
  const headers = await table(page).locator("thead th").allTextContents();
  const at = headers.findIndex((text) => text.trim() === "Assignee");
  expect(at, "the Findings table has an Assignee column").toBeGreaterThanOrEqual(0);
  return bodyRows(page).locator(`> :nth-child(${at + 1})`);
}

/** What the Assignee column says for a finding: its name, Unassigned, or (a sprint finding) no one. */
const assigneeText = (item: FindingsBody["items"][number]) =>
  item.scope === "sprint" ? /^—\s*No one: a sprint finding$/ : (item.assignee?.name ?? "Unassigned");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

test.describe("the Overview's open findings by person", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`ranks everyone by open breaches, Unassigned in its own muted row, logs nothing and passes axe (${colorScheme})`, async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const rows = await people(request);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

      const panel = peoplePanel(page);
      await expect(panel.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Open findings by person" })).toBeVisible();
      await expect(panel.getByText("Most breaches first")).toBeVisible();
      // Eight people and the unassigned tickets: nobody is left out, so every row is shown.
      await expect(personRows(page)).toHaveCount(rows.length);
      for (const [index, row] of rows.entries()) {
        const item = personItems(page).nth(index);
        await expect(item).toContainText(row.person?.name ?? "Unassigned");
        await expect(item).toContainText(count(row.open_breaches));
        await expect(item).toContainText(count(row.open_warnings));
        // At people level a person's name opens their card (JO-13); the link stands behind the row, named for them.
        if (row.person) await expect(personRows(page).nth(index)).toHaveAccessibleName(new RegExp(`^${row.person.name}: `));
      }
      const unassigned = personItems(page).last();
      await expect(unassigned).toContainText("Unassigned");
      await expect(unassigned.getByText("Unassigned", { exact: true })).toHaveClass(/text-ink-low/);
      await expect(panel.getByText("Issue findings only.")).toBeVisible();

      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  // A failure here is a disagreement between GET /people and the findings each row opens.
  test("every row is the count of the open findings it opens", async ({ page, request }) => {
    const rows = await people(request);
    await page.goto("/");
    await expect(personRows(page)).toHaveCount(rows.length);
    for (const [index, row] of rows.entries()) {
      const value = row.person?.id ?? "unassigned";
      await expect(personRows(page).nth(index)).toHaveAttribute("href", `/findings?state=open&person=${value}`);
      const listed = await findings(request, `?state=open&person=${value}`);
      expect(listed.total, row.person?.name ?? "Unassigned").toBe(row.open_breaches + row.open_warnings);
      expect(breachesIn(listed), row.person?.name ?? "Unassigned").toBe(row.open_breaches);
    }
  });

  test("a row opens that person's open findings, keyboard first, and Unassigned opens the unassigned tickets'", async ({
    page,
    request,
  }) => {
    const [lead] = await people(request);
    if (!lead.person) throw new Error("the sample's lead row should be a person");
    const theirs = await findings(request, `?state=open&person=${lead.person.id}`);
    const nobodys = await findings(request, "?state=open&person=unassigned");

    await page.goto("/");
    await personRows(page).first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/findings\\?state=open&person=${lead.person.id}$`));
    await listReady(page);
    await expect(resultLine(page)).toHaveText(resultText(theirs.total, breachesIn(theirs)));
    await expect(page.getByRole("button", { name: `Person ${lead.person.name}` })).toBeVisible();

    await page.goBack();
    await personRows(page).filter({ hasText: "Unassigned" }).click();
    await expect(page).toHaveURL(/\/findings\?state=open&person=unassigned$/);
    await listReady(page);
    await expect(resultLine(page)).toHaveText(resultText(nobodys.total, breachesIn(nobodys)));
    await expect(page.getByRole("button", { name: "Person Unassigned" })).toBeVisible();
  });

  test("All people opens Findings with the Person menu open: everyone by name, searchable, Unassigned last", async ({
    page,
    request,
  }) => {
    const { facets } = await findings(request, "?state=open");
    await page.goto("/");
    // The rows come after hydration. WebKit sometimes loses a click on the server-rendered link made
    // before then, so wait for them, as overview.spec.ts waits for its figures.
    await expect(personRows(page).first()).toBeVisible();
    await peoplePanel(page).getByRole("link", { name: /^All people/ }).click();
    await expect(page).toHaveURL(/\/findings\?state=open&menu=person$/);

    const menu = personMenu(page);
    await expect(menu).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Search person" })).toBeFocused();
    const options = menu.getByRole("option");
    await expect(options).toHaveCount(facets.people.length);
    for (const [index, entry] of facets.people.entries()) {
      await expect(options.nth(index)).toHaveText(new RegExp(`^${entry.label}\\s*${count(entry.count)}$`));
    }
    await expect(options.last()).toHaveText(/^Unassigned/);
    expect(await axeBlocking(page)).toEqual([]);

    await page.keyboard.type("gallag");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText(/^Finn Gallagher/);
    await page.keyboard.type("zzz");
    await expect(menu).toContainText("No one by that name has work on this board.");

    // The first Escape clears the search, the second closes the menu, and the address stops asking for it.
    await page.keyboard.press("Escape");
    await expect(options).toHaveCount(facets.people.length);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/\/findings\?state=open$/);
  });

  test("across the whole sheet, each name sits beside its bar", async ({ page }) => {
    await page.goto("/");
    await expect(personRows(page).first()).toBeVisible();
    // From the label's start to the bar's: the name column stops at 16rem (and a 12 px gap) on a wide list.
    const offsets = await personItems(page).evaluateAll((items) =>
      items.map((item) => {
        const label = item.querySelector('[class~="[grid-area:label]"]')?.getBoundingClientRect();
        const bar = item.querySelector('[class~="[grid-area:bar]"]')?.getBoundingClientRect();
        return label && bar ? bar.left - label.left : Number.NaN;
      }),
    );
    expect(offsets).toHaveLength(9);
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(16 * 16 + 12 + 1);
  });

  test("the panel switches to the same figures as a table", async ({ page, request }) => {
    const rows = await people(request);
    await page.goto("/");
    await expect(personRows(page)).toHaveCount(rows.length);
    await peoplePanel(page).getByRole("radio", { name: "Table" }).click();
    const figures = peoplePanel(page).getByRole("table", { name: "Open findings by person" });
    await expect(figures).toBeVisible();
    for (const header of ["Person", "Tickets not done", "Tickets with open findings"]) {
      await expect(figures.getByRole("columnheader", { name: header })).toBeVisible();
    }
    await expect(figures.locator("tbody tr")).toHaveCount(rows.length);
    const lead = rows[0];
    await expect(figures.locator("tbody tr").first()).toContainText(lead.person?.name ?? "Unassigned");
    await expect(figures.locator("tbody tr").first()).toContainText(count(lead.open_tickets));
    await expect(figures.locator("tbody tr").last()).toContainText("Unassigned");
    expect(await axeBlocking(page)).toEqual([]);
  });

  test("when the people cannot be loaded, the panel says so inline and Try again works", async ({ page }) => {
    let fail = true;
    await page.route(PEOPLE_API, async (route) => {
      if (!fail) return route.continue();
      return route.fulfill({
        status: 503,
        json: { error: "upstream_unavailable", message: "The oversight service could not be reached." },
      });
    });
    await page.goto("/");

    // The query retries a 5xx twice, with backoff, before it says so; the rest of the Overview is unaffected.
    const alert = peoplePanel(page).getByRole("alert");
    await expect(alert).toContainText("Couldn't load the people", { timeout: 15_000 });
    await expect(alert).toContainText("HTTP 503 · upstream_unavailable");
    await expect(page.getByRole("list", { name: "Open findings by epic" }).getByRole("link").first()).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);

    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(personRows(page).first()).toBeVisible();
    await expect(alert).toHaveCount(0);
  });
});

test.describe("the Person filter on Findings", () => {
  test("choosing a person writes the address, the count follows, the toast names them, and Clear empties it", async ({
    page,
    request,
  }) => {
    const { facets } = await findings(request);
    const carmen = facets.people.find((entry) => entry.label === "Carmen Ruiz");
    if (!carmen) throw new Error("the sample should list Carmen Ruiz");
    const hers = await findings(request, `?person=${carmen.value}`);
    const hersAndNobodys = await findings(request, `?person=${carmen.value}&person=unassigned`);

    await page.goto("/findings");
    await listReady(page);
    await page.getByRole("button", { name: "Person Any" }).click();
    await personMenu(page).getByRole("option", { name: /^Carmen Ruiz/ }).click();
    await expect(page).toHaveURL(new RegExp(`/findings\\?person=${carmen.value}$`));
    await expect(page.getByText("Person: Carmen Ruiz")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(personMenu(page)).toBeHidden();

    await expect(resultLine(page)).toHaveText(resultText(hers.total, breachesIn(hers)));
    expect(hers.total).toBe(carmen.count);
    await expect(page.getByRole("button", { name: "Person Carmen Ruiz" })).toBeVisible();
    await expect(await assigneeCells(page)).toHaveText(hers.items.map(assigneeText));

    // A second choice widens the list: anyone of them. The first acknowledgement is let go first: the filters share
    // one toast, and an update that lands in the last moment of a closing toast closes with it (sonner), which made
    // this step depend on how fast the browser ran it.
    await expect(page.getByText("Person: Carmen Ruiz", { exact: true })).toBeHidden({ timeout: 10_000 });
    await page.getByRole("button", { name: "Person Carmen Ruiz" }).click();
    await personMenu(page).getByRole("option", { name: /^Unassigned/ }).click();
    // The toast first, as for the first choice: it is brief, and the result line can take longer under load.
    await expect(page.getByText("Person: Carmen Ruiz, Unassigned")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/findings\\?person=${carmen.value}&person=unassigned$`));
    await expect(resultLine(page)).toHaveText(resultText(hersAndNobodys.total, breachesIn(hersAndNobodys)));

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/findings$/);
    await expect(page.getByText("Filters cleared")).toBeVisible();
    await expect(page.getByRole("button", { name: "Person Any" })).toBeVisible();
  });

  test("a second choice made just as the first one's toast leaves is still acknowledged (the JO-12 check)", async ({ page }) => {
    // Regression: the filters' toast was updated in place by its id, and an update that landed while the toast was
    // leaving (sonner keeps it 200 ms for its exit) left with it: the second choice was never acknowledged.
    await page.goto("/findings");
    await listReady(page);
    await page.getByRole("button", { name: "Person Any" }).click();
    await personMenu(page).getByRole("option", { name: /^Carmen Ruiz/ }).click();
    await expect(page.getByText("Person: Carmen Ruiz", { exact: true })).toBeVisible();
    // Its time up, the toast starts to leave: choose again right then, the menu still open. (Polled every 16 ms rather
    // than every frame: a busy WebKit can hold its frames back.)
    await page.waitForFunction(() => document.querySelector("[data-sonner-toast][data-removed='true']") !== null, undefined, {
      polling: 16,
      timeout: 15_000,
    });
    await personMenu(page).getByRole("option", { name: /^Unassigned/ }).click();
    const second = page.locator("[data-sonner-toast]:not([data-removed='true'])").filter({ hasText: "Person: Carmen Ruiz, Unassigned" });
    await expect(second).toBeVisible();
    // Still there once the first has gone: a toast of its own, for its own time.
    await page.waitForTimeout(600);
    await expect(second).toBeVisible();
  });

  test("Unassigned lists the findings on tickets nobody holds, never a sprint finding, and passes axe", async ({
    page,
    request,
  }) => {
    const nobodys = await findings(request, "?person=unassigned");
    expect(nobodys.items.every((item) => item.scope === "issue" && item.assignee === null)).toBe(true);
    await page.goto("/findings?person=unassigned");
    await listReady(page);
    await expect(resultLine(page)).toHaveText(resultText(nobodys.total, breachesIn(nobodys)));
    const cells = await assigneeCells(page);
    await expect(cells).toHaveCount(nobodys.items.length);
    await expect(cells).toHaveText(nobodys.items.map(() => "Unassigned"));
    await expect(table(page).getByText("No one: a sprint finding")).toHaveCount(0);
    expect(await axeBlocking(page)).toEqual([]);
  });

  test("an empty result says whose work was looked at, by name", async ({ page, request }) => {
    const { facets } = await findings(request);
    const ada = facets.people.find((entry) => entry.label === "Ada Brooks");
    if (!ada) throw new Error("the sample should list Ada Brooks");

    await page.goto(`/findings?person=${ada.value}&q=zzzz-no-such-thing`);
    await expect(page.getByText("No findings match these filters")).toBeVisible();
    await expect(
      page.getByText("open findings in DEMO, assigned to Ada Brooks, matching “zzzz-no-such-thing”.", { exact: true }),
    ).toBeVisible();

    await page.goto("/findings?person=unassigned&q=zzzz-no-such-thing");
    await expect(
      page.getByText("open findings in DEMO, on unassigned tickets, matching “zzzz-no-such-thing”.", { exact: true }),
    ).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);
  });

  test("a person nobody on the board has matches nothing, and is never named by their id", async ({ page, request }) => {
    expect((await findings(request, `?person=${NOBODY_HERE}`)).total).toBe(0);
    await page.goto(`/findings?person=${NOBODY_HERE}`);
    await expect(page.getByText("No findings match these filters")).toBeVisible();
    await expect(page.getByText("open findings in DEMO, assigned to someone not on this board.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Person Not on this board" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(NOBODY_HERE);
    expect(await axeBlocking(page)).toEqual([]);
  });
});

test.describe("the Assignee column and the evidence drawer", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`each row names its issue's assignee, Unassigned in the muted ink, a dash for a sprint finding (${colorScheme})`, async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const first = await findings(request);
      await page.goto("/findings");
      await listReady(page);

      const header = table(page).getByRole("columnheader", { name: "Assignee" });
      await expect(header).toBeVisible();
      // The API cannot sort by assignee, so its header is a plain label, unlike Severity's.
      await expect(header.getByRole("button")).toHaveCount(0);
      await expect(header).not.toHaveAttribute("aria-sort", /.+/);
      await expect(table(page).getByRole("columnheader", { name: "Severity" }).getByRole("button")).toHaveCount(1);

      await expect(await assigneeCells(page)).toHaveText(first.items.map(assigneeText));
      expect(first.items[0].scope).toBe("sprint");

      // Unassigned is said in the secondary ink wherever it appears.
      const nobodys = await findings(request, "?person=unassigned&page_size=1");
      await page.goto(`/findings?q=${nobodys.items[0].issue_key}`);
      await listReady(page);
      await expect((await assigneeCells(page)).first()).toHaveText("Unassigned");
      await expect((await assigneeCells(page)).first().getByText("Unassigned")).toHaveClass(/text-ink-low/);

      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("beside the Assignee column, each issue's summary has a line of its own under its key", async ({ page }) => {
    await page.goto("/findings");
    await listReady(page);
    const headers = await table(page).locator("thead th").allTextContents();
    const at = headers.findIndex((text) => text.trim() === "Issue");
    // Row 0 is a sprint finding; the next is an issue's.
    const cell = bodyRows(page).nth(1).locator(`> :nth-child(${at + 1})`);
    const box = await cell.boundingBox();
    const key = await cell.locator(".mono").first().boundingBox();
    const summary = await cell.locator(".mono + span, .mono ~ span").last().boundingBox();
    if (!box || !key || !summary) throw new Error("the Issue cell should show a key and a summary");
    expect(summary.y).toBeGreaterThanOrEqual(key.y + key.height - 1);
    expect(Math.abs(summary.x - key.x)).toBeLessThanOrEqual(1);
    // The summary has the column's whole width (less its 12 px padding each side), not what the key leaves of it.
    expect(summary.width).toBeGreaterThanOrEqual(box.width - 24 - 2);
    // Beside the key it had the column less the key's text; under it, that and the key's width again.
    const keyText = await cell
      .locator(".mono")
      .first()
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().width;
      });
    expect(summary.width).toBeGreaterThan(keyText + 40);
  });

  test("the drawer names the issue's assignee, and a sprint finding's says no one", async ({ page, request }) => {
    const breach = (await (await request.get(`/api/oversight/findings/${BREACH_ID}`)).json()) as {
      finding: { assignee: Person | null };
    };
    if (!breach.finding.assignee) throw new Error("the showcase breach's issue should have an assignee");

    await page.goto(`/findings?finding=${BREACH_ID}`);
    const drawer = page.getByRole("dialog", { name: "Work started without an estimate" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Assignee", { exact: true })).toBeVisible();
    await expect(drawer.getByText(breach.finding.assignee.name, { exact: true })).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);

    await page.goto(`/findings?finding=${SPRINT_ID}`);
    const sprint = page.getByRole("dialog", { name: "Sprint at risk" });
    await expect(sprint).toBeVisible();
    await expect(sprint.getByText("No one: a sprint finding")).toBeVisible();
  });
});

test.describe("the ticket page's assignee", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`DEMO-1 names its assignee, who leads to their open findings, and passes axe (${colorScheme})`, async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const timeline = (await (await request.get("/api/oversight/issues/DEMO-1/timeline")).json()) as {
        issue: { assignee: Person | null };
      };
      const assignee = timeline.issue.assignee;
      if (!assignee) throw new Error("DEMO-1 should have an assignee in the sample");
      const theirs = await findings(request, `?person=${assignee.id}`);

      await page.goto("/issues/DEMO-1");
      await expect(page.getByRole("heading", { level: 1, name: "DEMO-1 Document help tooltips" })).toBeVisible();
      await expect(page.locator("[data-assignee]")).toHaveText(new RegExp(`^Assignee\\s*${assignee.name}$`));
      const link = page.getByRole("link", { name: `${assignee.name}: show their open findings` });
      await expect(link).toHaveAttribute("href", `/findings?person=${assignee.id}`);
      expect(await axeBlocking(page)).toEqual([]);
      expect(problems).toEqual([]);

      await link.click();
      await expect(page).toHaveURL(new RegExp(`/findings\\?person=${assignee.id}$`));
      await listReady(page);
      await expect(resultLine(page)).toHaveText(resultText(theirs.total, breachesIn(theirs)));
      await expect(page.getByRole("button", { name: `Person ${assignee.name}` })).toBeVisible();
    });
  }

  test("an issue nobody is assigned to says Unassigned, with nowhere to go", async ({ page }) => {
    await page.goto(`/issues/${UNASSIGNED_ISSUE}`);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${UNASSIGNED_ISSUE}`) })).toBeVisible();
    const assignee = page.locator("[data-assignee]");
    await expect(assignee).toHaveText("Unassigned");
    await expect(assignee).toHaveClass(/text-ink-low/);
    await expect(assignee.getByRole("link")).toHaveCount(0);
    expect(await axeBlocking(page)).toEqual([]);
  });
});

test.describe("names, and nothing else about a person", () => {
  test("the sample's people are the eight fictional names, each id the contract's hash of the account id", async ({ request }) => {
    const { facets } = await findings(request);
    // Each facet entry carries the person's picture version as well (contract 4.3): two of the eight have an
    // abstract picture drawn in code, and nobody (Unassigned) has none.
    const pictured = new Set<string>(["Carmen Ruiz", "Grace Lindqvist"]);
    expect(facets.people).toEqual([
      ...SAMPLE_PEOPLE.map(([accountId, name]) => ({
        value: personId(accountId),
        label: name,
        count: expect.any(Number),
        avatar: pictured.has(name) ? expect.stringMatching(/^[0-9a-f]{12}$/) : null,
      })),
      { value: "unassigned", label: "Unassigned", count: expect.any(Number), avatar: null },
    ]);
    for (const entry of facets.people) expect(entry.value).toMatch(/^(p[0-9a-f]{12}|unassigned)$/);
  });

  test("the directory is everyone on the board: the eight with their tickets as GET /people counts them, and three members with none", async ({ request }) => {
    const response = await request.get("/api/oversight/people/directory");
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const { people: entries } = (await response.json()) as { people: { person: Person; tickets: number }[] };
    const rows = await people(request);
    const tickets = new Map(rows.flatMap((row) => (row.person ? [[row.person.id, row.tickets] as const] : [])));
    const expected = [
      ...SAMPLE_PEOPLE.map(([accountId, name]) => ({ id: personId(accountId), name, tickets: tickets.get(personId(accountId)) })),
      ...SAMPLE_MEMBERS.map(([accountId, name]) => ({ id: personId(accountId), name, tickets: 0 })),
    ].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    expect(entries.map((entry) => ({ id: entry.person.id, name: entry.person.name, tickets: entry.tickets }))).toEqual(expected);
    for (const [accountId] of SAMPLE_MEMBERS) {
      // On the board, with nothing of theirs to find, and no picture: the browser shows their initials.
      expect(entries.find((entry) => entry.person.id === personId(accountId))?.person.avatar).toBeNull();
      expect((await findings(request, `?person=${personId(accountId)}&state=all`)).total).toBe(0);
      expect((await request.get(`/api/oversight/people/${personId(accountId)}/avatar`)).status()).toBe(404);
    }
    expect((await request.get("/api/oversight/people/directory?project=DEMO")).status()).toBe(400);
  });

  test("no response or page carries an account id, an email address, a picture's address or a time zone from Jira", async ({
    page,
    request,
  }) => {
    // A picture's version ("avatar": "55ea1804e5bd") is the contract's; Jira's or Gravatar's address never is.
    const forbidden = [/acc-\d\d/, /accountId/i, /avatarUrls/i, /atl-paas\.net/, /gravatar/i, /useravatar/i, /"timeZone"/, /[\w.+-]+@[\w-]+\.[\w.-]+/];
    for (const path of [
      "people",
      "people/directory",
      "findings?page_size=100",
      "findings?state=all&page_size=100&person=unassigned",
      `findings/${BREACH_ID}`,
      "issues/DEMO-1/timeline",
    ]) {
      const body = await (await request.get(`/api/oversight/${path}`)).text();
      for (const pattern of forbidden) expect(body, `${path} ${pattern}`).not.toMatch(pattern);
    }

    for (const path of ["/", "/findings?state=open&menu=person", `/findings?finding=${BREACH_ID}`, "/issues/DEMO-1"]) {
      await page.goto(path);
      // Loaded: a name is on screen (the drawer, being modal, hides the top bar from the accessibility tree).
      await expect(page.getByText(/Ada Brooks|Carmen Ruiz|Grace Lindqvist/).filter({ visible: true }).first()).toBeVisible();
      const text = await page.locator("body").innerText();
      for (const pattern of forbidden) expect(text, `${path} ${pattern}`).not.toMatch(pattern);
      // Names are text; every picture beside one comes from this dashboard's own route, by person id and version.
      const sources = await page.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")));
      for (const src of sources) expect(src, path).toMatch(/^\/api\/oversight\/people\/p[0-9a-f]{12}\/avatar\?v=[0-9a-f]{12}$/);
    }
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the people panel stacks, the Person menu fits, the assignee wraps: no sideways scrolling, axe clean", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(personRows(page).first()).toBeVisible();
    await peoplePanel(page).scrollIntoViewIfNeeded();
    const panel = await peoplePanel(page).boundingBox();
    expect(panel?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(390);
    // Every row, name, bar and figures, keeps within the screen's width.
    const edges = await personRows(page).evaluateAll((links) =>
      links.map((link) => [link.getBoundingClientRect().left, link.getBoundingClientRect().right]),
    );
    expect(edges).toHaveLength(9);
    for (const [left, right] of edges) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(390);
    }
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);

    await page.goto("/findings?state=open&menu=person");
    const menu = personMenu(page);
    await expect(menu.getByRole("option").first()).toBeVisible();
    const box = await menu.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await menu.getByRole("option", { name: /^Ada Brooks/ }).click();
    await expect(page).toHaveURL(/person=pbc7fe62842ca/);
    await page.keyboard.press("Escape");
    await listReady(page);
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);

    await page.goto("/issues/DEMO-1");
    await expect(page.locator("[data-assignee]")).toBeVisible();
    const assignee = await page.locator("[data-assignee]").boundingBox();
    expect((assignee?.x ?? 0) + (assignee?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    // The facts wrap here, so no dot parts them: a line never starts or ends on one.
    await expect(page.locator("[data-separator]")).toHaveCount(2);
    for (const dot of await page.locator("[data-separator]").all()) await expect(dot).toBeHidden();
    expect(await axeBlocking(page)).toEqual([]);

    await page.goto(`/issues/${UNASSIGNED_ISSUE}`);
    await expect(page.locator("[data-assignee]")).toHaveText("Unassigned");
    for (const dot of await page.locator("[data-separator]").all()) await expect(dot).toBeHidden();
  });

  test("a long chosen name is cut short in the Person filter, and the page never scrolls sideways", async ({ page }) => {
    // The contract's longest name, 128 characters, given to Ada Brooks in the facet the filter is named from.
    const long = "Alexandra Papadopoulou-Richardson (Contractor) ".repeat(3).slice(0, 128).trim();
    await page.route(
      (url) => url.pathname === "/api/oversight/findings",
      async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as FindingsBody;
        for (const entry of body.facets.people) if (entry.label === "Ada Brooks") entry.label = long;
        await route.fulfill({ response, json: body });
      },
    );
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/findings?person=${personId("acc-01")}`);
      await listReady(page);
      const trigger = page.getByRole("button", { name: `Person ${long}` });
      await expect(trigger).toBeVisible();
      const box = await trigger.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0), `${width}`).toBeLessThanOrEqual(width);
      expect(await sidewaysScroll(page), `${width}`).toBeLessThanOrEqual(0);
    }
  });

  test("an empty result is said on screen, not centred out of sight in the wide table", async ({ page }) => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/findings?state=open&person=${NOBODY_HERE}`);
      const title = page.getByText("No findings match these filters");
      await expect(title).toBeVisible();
      // The empty state's own button (the filter bar's reads "Clear"): in the table, or in the phone's list (SQA).
      const clear = page.getByRole("main").getByRole("button", { name: "Clear filters" }).filter({ hasText: "Clear filters" });
      for (const target of [title, clear]) {
        const box = await target.boundingBox();
        expect(box?.x ?? -1, `${width}`).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), `${width}`).toBeLessThanOrEqual(width);
      }
      expect(await sidewaysScroll(page), `${width}`).toBeLessThanOrEqual(0);
    }
    expect(await axeBlocking(page)).toEqual([]);
  });
});

test.describe("the ways to a person's scorecard (JO-11, people level)", () => {
  /**
   * The page is live: the top bar's sync time reads the viewer's clock, so it is drawn only once the page has
   * hydrated. A click before that can be lost in WebKit (1 run in 16 in the JO-11 integration).
   */
  const live = (page: Page) => expect(page.getByRole("banner").locator("[data-sync-now]").filter({ hasText: / ago/ })).toBeVisible();

  test("the Overview's open findings by person lead to everyone's scorecards", async ({ page }) => {
    await page.goto("/");
    const panel = page.getByRole("region", { name: "People" });
    await expect(panel.getByRole("link", { name: "All people" })).toBeVisible();
    await live(page);
    await panel.getByRole("link", { name: "View scorecards" }).click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  });

  test("one person chosen in the Findings Person filter is a step from their scorecard; the unassigned tickets are not", async ({ page }) => {
    const ada = personId("acc-01");
    await page.goto(`/findings?state=open&person=${ada}`);
    const link = page.getByRole("link", { name: "View scorecard of Ada Brooks" });
    await expect(link).toHaveAttribute("href", `/people?person=${ada}`);
    await live(page);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/people[?]person=${ada}$`));
    await expect(page.locator("[data-scorecard]").getByRole("heading", { name: "Ada Brooks" })).toBeVisible();
    await page.goto("/findings?state=open&person=unassigned");
    await expect(page.getByRole("button", { name: /^Person/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /View scorecard/ })).toHaveCount(0);
  });
});
