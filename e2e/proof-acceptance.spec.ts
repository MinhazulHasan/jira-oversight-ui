import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from "@playwright/test";

import { readableClipboard } from "./clipboard";

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PROOF_API = "**/api/oversight/people/scorecard/tickets**";
/** A Jira site for the links, put on the sample's tickets where the live interface would put its own. */
const SITE = "https://example.atlassian.net";
const KEYS_MAX = 100;

interface Person {
  id: string;
  name: string;
  avatar: string | null;
}
interface Value {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  enough: boolean;
  vs_board: string | null;
}
interface Measure {
  key: string;
  label: string;
  kind: "count" | "rate" | "ratio";
  measurable: boolean;
}
interface Card {
  comparison: "on" | "off";
  period: { days: number; from: string; to: string };
  measures: Measure[];
  board: { tickets: number; values: Record<string, Value> };
  people: { person: Person; tickets: number; values: Record<string, Value> }[];
}
interface Ticket {
  key: string;
  summary: string | null;
  status: string | null;
  counted: boolean;
  credit: { person: Person | null; basis: string | null; field: string | null };
  at: string | null;
  detail: Record<string, unknown> | null;
  ignore: { scope: string; rule_id: string | null; reason: string | null; by: string | null; at: string } | null;
  url: string | null;
}
interface Proof {
  period: { days: number; from: string; to: string };
  value: Value;
  total: number;
  counted: number;
  tickets: Ticket[];
  left_out: Ticket[];
}

async function scorecard(request: APIRequestContext, query = ""): Promise<Card> {
  const response = await request.get(`/api/oversight/people/scorecard${query}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Card;
}

async function proofOf(request: APIRequestContext, measure: string, person: string | null, days = 90): Promise<Proof> {
  const search = new URLSearchParams({ days: String(days), measure, ...(person ? { person } : {}) });
  const response = await request.get(`/api/oversight/people/scorecard/tickets?${search.toString()}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as Proof;
}

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`Uncaught: ${error.message}`));
  return problems;
}

const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const table = (page: Page) => page.getByRole("table", { name: /Everyone with tickets/ });
const sheet = (page: Page) => page.getByRole("dialog");

/** The figure as the cell shows it: "78%", "12", "13.3". */
function figure(measure: Pick<Measure, "kind">, value: Value): string {
  if (measure.kind === "rate") return `${count(value.value!)}%`;
  if (measure.kind === "ratio") return new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value.value!);
  return count(value.value!);
}

/** A figure's button, by the name the brief gives it: "Nasif Ishtiaque Islam, Open tickets stuck in a status, 78%, 7 of 9: show tickets". */
function cellName(who: string, measure: Measure, value: Value): RegExp {
  const head = `^${escape(who)}, ${escape(measure.label)}, ${escape(figure(measure, value))}`;
  if (measure.kind === "rate") return new RegExp(`${head}, ${count(value.numerator!)} of ${count(value.denominator!)}: show tickets$`);
  if (measure.kind === "ratio") return new RegExp(`${head}, .+: show tickets$`);
  return new RegExp(`${head}: show tickets$`);
}

const ticketsName = (who: string, tickets: number) => new RegExp(`^${escape(who)}, Tickets, ${escape(count(tickets))}: show tickets$`);

/** Something behind the figure: a count of some tickets, or a rate or ratio over some. */
const somethingBehind = (measure: Measure, value: Value) =>
  value.value !== null && (measure.kind === "count" ? value.value > 0 : (value.denominator ?? 0) > 0);

/** The tickets the sheet lists, in order: each row links to its ticket's page here. */
function listedKeys(dialog: Locator): Promise<string[]> {
  return dialog.evaluate((root) => {
    const keys: string[] = [];
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="/issues/"]')) {
      const key = /^\/issues\/([A-Z][A-Z0-9_]*-\d+)$/.exec(link.getAttribute("href") ?? "")?.[1];
      if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
  });
}

/** Whether anything in the control is drawn underlined. */
const underlined = (control: Locator) =>
  control.evaluate((root) => [root, ...root.querySelectorAll("*")].some((element) => getComputedStyle(element).textDecorationLine.includes("underline")));

/** A rate's tickets in one person's row, one counted and one not: the figure the brief's example is. */
async function aRateToProve(request: APIRequestContext) {
  const card = await scorecard(request);
  for (const key of ["stuck_now", "estimated_before_start", "time_logged", "reopened", "skipped_stage", "within_estimate"]) {
    const measure = card.measures.find((candidate) => candidate.key === key && candidate.measurable);
    const row = measure && card.people.find((candidate) => {
      const value = candidate.values[key];
      return value.value !== null && value.numerator! > 0 && value.numerator! < value.denominator! && value.denominator! <= 60;
    });
    if (measure && row) return { card, measure, row, value: row.values[key] };
  }
  throw new Error("the sample should hold a rate with tickets on both sides");
}

/** Where the proof's response is changed in the browser: links to a Jira site, an ignore. Never the server's state. */
async function changeProof(page: Page, change: (body: Proof, url: URL) => void) {
  await page.route(PROOF_API, async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Proof;
    change(body, new URL(route.request().url()));
    await route.fulfill({ response, json: body });
  });
}

const linkToJira = (body: Proof) => {
  for (const ticket of [...body.tickets, ...body.left_out]) ticket.url = `${SITE}/browse/${ticket.key}`;
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
});

test.describe("the tickets behind every figure on the People page", () => {
  test.beforeEach(async ({ request }) => {
    test.skip((await scorecard(request)).comparison !== "on", "this server has comparison turned off");
  });

  test("every figure in the everyone table, the whole board's too, is a button named for what it shows; an empty cell is not", async ({ page, request }) => {
    const card = await scorecard(request);
    await page.goto("/people");
    await expect(table(page)).toBeVisible();
    const shown = card.measures.filter((measure) => measure.measurable);
    const rows = [...card.people.map((row) => ({ who: row.person.name, tickets: row.tickets, values: row.values })), { who: "Whole board", tickets: card.board.tickets, values: card.board.values }];
    for (const { who, tickets, values } of rows) {
      await expect(table(page).getByRole("button", { name: ticketsName(who, tickets) }), who).toHaveCount(1);
      for (const measure of shown) {
        const value = values[measure.key];
        const cell = table(page).getByRole("button", { name: new RegExp(`^${escape(who)}, ${escape(measure.label)}, `) });
        if (somethingBehind(measure, value)) await expect(table(page).getByRole("button", { name: cellName(who, measure, value) }), `${who} ${measure.key}`).toHaveCount(1);
        else if (value.value === null || measure.kind !== "count") await expect(cell, `${who} ${measure.key}`).toHaveCount(0);
      }
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`the People page with every figure a button passes axe, each button's name holding the words it shows (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/people");
      await expect(table(page).getByRole("button", { name: /^Whole board, Tickets, / })).toBeVisible();
      expect(await axeBlocking(page)).toEqual([]);
    });
  }

  test("a cell with nothing behind it, a dash or 0 of 0, is no button", async ({ page, request }) => {
    const card = await scorecard(request);
    const [first, second] = card.people;
    // Two of the sample's figures made empty in the browser: a rate over no tickets, and one with no figure at all.
    await page.route(
      (url) => url.pathname === "/api/oversight/people/scorecard",
      async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as Card;
        for (const row of body.people) {
          if (row.person.id === first.person.id) row.values.reopened = { value: null, numerator: 0, denominator: 0, enough: false, vs_board: null };
          if (row.person.id === second.person.id) row.values.time_logged = { value: null, numerator: 0, denominator: 0, enough: false, vs_board: null };
        }
        await route.fulfill({ response, json: body });
      },
    );
    await page.goto("/people");
    await expect(table(page).getByRole("button", { name: /: show tickets$/ }).first()).toBeVisible();
    const label = (key: string) => card.measures.find((measure) => measure.key === key)!.label;
    for (const [who, key] of [[first.person.name, "reopened"], [second.person.name, "time_logged"]] as const) {
      await expect(table(page).getByRole("button", { name: new RegExp(`^${escape(who)}, ${escape(label(key))}, `) }), `${who} ${key}`).toHaveCount(0);
    }
    // Their other figures still open their tickets.
    await expect(table(page).getByRole("button", { name: new RegExp(`^${escape(first.person.name)}, ${escape(label("time_logged"))}, `) })).toHaveCount(1);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`a figure opens its tickets in a side sheet: heading focused, the address keeps it, Esc gives focus back (${colorScheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme });
      const problems = watchConsole(page);
      const { measure, row, value } = await aRateToProve(request);
      const proof = await proofOf(request, measure.key, row.person.id);
      await page.goto("/people");
      const button = table(page).getByRole("button", { name: cellName(row.person.name, measure, value) });
      await expect(button).toHaveCSS("cursor", "pointer");
      // At rest the figure is plain; on hover it is underlined over a fill.
      await page.mouse.move(0, 0);
      const fill = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(await underlined(button)).toBe(false);
      await button.hover();
      await expect.poll(() => underlined(button)).toBe(true);
      await expect.poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(fill);
      await button.click();

      await expect(page).toHaveURL(new RegExp(`[?&]proof=${measure.key}(&|$)`));
      await expect(page).toHaveURL(new RegExp(`[?&]proof_person=${row.person.id}(&|$)`));
      const dialog = sheet(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(row.person.name);
      await expect(dialog).toContainText(measure.label);
      await expect(dialog).toContainText(`${value.value}%`);
      await expect(dialog).toContainText(`${count(value.numerator!)} of ${count(value.denominator!)}`);
      if (measure.key === "stuck_now") {
        // The brief's own sentence: "7 of 9 open tickets are stuck in a status".
        const are = value.numerator === 1 ? "is" : "are";
        await expect(dialog).toContainText(`${count(value.numerator!)} of ${count(value.denominator!)} open tickets ${are} stuck in a status`);
      }
      // Focus is on the sheet's heading, read out first.
      await expect.poll(() => dialog.evaluate((root) => /^H[1-6]$/.test(document.activeElement?.tagName ?? "") && root.contains(document.activeElement))).toBe(true);
      await expect.poll(() => listedKeys(dialog)).toEqual(proof.tickets.map((ticket) => ticket.key));
      const box = await dialog.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(760);
      expect(box?.width ?? 0).toBeLessThanOrEqual(880);
      expect(await axeBlocking(page)).toEqual([]);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page).not.toHaveURL(/[?&]proof=/);
      await expect(button).toBeFocused();
      expect(problems).toEqual([]);
    });
  }

  test("a rate splits its tickets the plain way, counted first, with the full set a click away", async ({ page, request }) => {
    const { measure, row, value } = await aRateToProve(request);
    const proof = await proofOf(request, measure.key, row.person.id);
    const words: Record<string, [string, string]> = {
      stuck_now: ["Stuck", "Not stuck"],
      time_logged: ["Time logged", "No time logged"],
      estimated_before_start: ["Estimated first", "Estimated late or never"],
      within_estimate: ["Within the limit", "Over the limit"],
      reopened: ["Reopened", "Not reopened"],
      skipped_stage: ["Skipped a stage", "No skips"],
    };
    const [yes, no] = words[measure.key];
    await page.goto(`/people?proof=${measure.key}&proof_person=${row.person.id}`);
    const dialog = sheet(page);
    const counted = proof.tickets.filter((ticket) => ticket.counted).map((ticket) => ticket.key);
    const others = proof.tickets.filter((ticket) => !ticket.counted).map((ticket) => ticket.key);
    for (const [words, many, keys] of [
      [yes, value.numerator!, counted],
      [no, value.denominator! - value.numerator!, others],
      ["All", value.denominator!, [...counted, ...others]],
    ] as const) {
      const choice = dialog.getByRole("radio", { name: new RegExp(`^${escape(words)}\\W*${escape(count(many))}$`) });
      await choice.click();
      await expect(choice).toBeChecked();
      await expect.poll(() => listedKeys(dialog), words).toEqual(keys);
    }
  });

  test("a count lists every ticket with no control, and the ratio each open ticket with its open findings", async ({ page, request }) => {
    const card = await scorecard(request);
    const row = card.people.find((candidate) => (candidate.values.open_tickets.value ?? 0) > 0 && candidate.values.open_tickets.value! <= 60)!;
    const opened = await proofOf(request, "open_tickets", row.person.id);
    await page.goto(`/people?proof=open_tickets&proof_person=${row.person.id}`);
    const dialog = sheet(page);
    await expect.poll(() => listedKeys(dialog)).toEqual(opened.tickets.map((ticket) => ticket.key));
    await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
    await expect(dialog).toContainText(count(opened.total));

    const ratio = await proofOf(request, "open_findings_per_10", row.person.id);
    await page.goto(`/people?proof=open_findings_per_10&proof_person=${row.person.id}`);
    await expect.poll(async () => (await listedKeys(sheet(page))).sort()).toEqual(ratio.tickets.map((ticket) => ticket.key).sort());
    const withFindings = ratio.tickets.find((ticket) => Number(ticket.detail?.findings) > 1) ?? ratio.tickets.find((ticket) => ticket.counted)!;
    const many = Number(withFindings.detail?.findings);
    await expect(sheet(page)).toContainText(new RegExp(`(^|[^\\d,])${escape(count(many))} (open )?finding`));
    await expect(sheet(page)).toContainText(count(ratio.value.numerator!));
  });

  test("the header says whose figure, which, over which dates, and the figure in a plain sentence", async ({ page, request }) => {
    const card = await scorecard(request, "?days=180");
    const row = card.people.find((candidate) => (candidate.values.reopened.numerator ?? 0) > 0)!;
    const value = row.values.reopened;
    await page.goto(`/people?days=180&proof=reopened&proof_person=${row.person.id}`);
    const dialog = sheet(page);
    await expect(dialog.getByRole("heading").first()).toBeVisible();
    const dates = await page.evaluate(
      ([from, to]) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).formatRange(new Date(from), new Date(to)),
      [card.period.from, card.period.to],
    );
    await expect(dialog).toContainText("Last 180 days");
    await expect(dialog).toContainText(dates);
    await expect(dialog).toContainText(row.person.name);
    await expect(dialog).toContainText("Reopened after Done");
    await expect(dialog).toContainText(new RegExp(`${escape(count(value.numerator!))} of ${escape(count(value.denominator!))} [^.]*reopened`));
    // Never a zone's name, an address or an account id.
    await expect(dialog).not.toContainText(/Europe\/|GMT|UTC|@|acc-\d/);

    await page.goto("/people?proof=done_in_period&proof_person=board");
    await expect(sheet(page)).toContainText("Whole board");
    await expect(sheet(page)).toContainText("Done in the period");
    await expect(sheet(page)).toContainText(count((await scorecard(request)).board.values.done_in_period.value!));
  });

  test("every list says whom each ticket counts for and why: the whole board's finished work, and a person's open tickets", async ({ page, request }) => {
    const board = await proofOf(request, "done_in_period", null);
    const named = board.tickets.find((ticket) => ticket.credit.person !== null)!;
    await page.goto("/people?proof=done_in_period&proof_person=board");
    const dialog = sheet(page);
    await expect(dialog).toContainText("Counts for");
    await expect(dialog).toContainText(named.credit.person!.name);
    await expect(dialog.getByText("Assignee", { exact: true }).first()).toBeVisible();

    const card = await scorecard(request);
    const row = card.people.find((candidate) => (candidate.values.open_tickets.value ?? 0) > 0)!;
    await page.goto(`/people?proof=open_tickets&proof_person=${row.person.id}`);
    await expect.poll(() => listedKeys(sheet(page))).not.toEqual([]);
    await expect(sheet(page)).toContainText("Counts for");
    await expect(sheet(page)).toContainText(row.person.name);
  });

  test("whom a ticket counts for carries its basis: the Jira field's name, or Assignee", async ({ page, request }) => {
    const card = await scorecard(request);
    const [ada, ben] = card.people.map((row) => row.person);
    await changeProof(page, (body) => {
      const credits = [
        { person: ada, basis: "field", field: "Programmer" },
        { person: ada, basis: "field", field: "Testers" },
        { person: ben, basis: "assignee_now", field: null },
      ];
      credits.forEach((credit, index) => {
        if (body.tickets[index]) body.tickets[index].credit = credit;
      });
    });
    await page.goto("/people?proof=done_in_period&proof_person=board");
    const dialog = sheet(page);
    await expect.poll(() => listedKeys(dialog)).not.toEqual([]);
    for (const tag of ["Programmer", "Testers", "Assignee"]) {
      await expect(dialog.getByText(tag, { exact: true }).first(), tag).toBeVisible();
    }
    await expect(dialog).not.toContainText(/assignee_now/);
  });

  test("each key opens Jira in a new tab, and each row its ticket's page here", async ({ page, request }) => {
    const { measure, row } = await aRateToProve(request);
    await changeProof(page, linkToJira);
    await page.goto(`/people?proof=${measure.key}&proof_person=${row.person.id}`);
    const dialog = sheet(page);
    const [first] = await (async () => {
      await expect.poll(() => listedKeys(dialog)).not.toEqual([]);
      return listedKeys(dialog);
    })();
    const summary = (await proofOf(request, measure.key, row.person.id)).tickets.find((ticket) => ticket.key === first)?.summary;
    if (summary) await expect(dialog.getByText(summary, { exact: true }).first()).toHaveAttribute("title", summary);
    const jira = dialog.locator(`a[href="${SITE}/browse/${first}"]`).first();
    await expect(jira).toBeVisible();
    await expect(jira).toHaveAttribute("target", "_blank");
    await expect(jira).toHaveAttribute("rel", /noopener/);
    await expect(jira).toContainText(first);
    await expect(jira.locator("svg")).not.toHaveCount(0);
    await dialog.locator(`a[href="/issues/${first}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/issues/${first}$`));
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${first}`) })).toBeVisible();
  });

  test("Open in Jira searches for the keys shown; past 100 keys, Copy keys and Copy JQL instead, each with a toast", async ({ page, context, browserName, request }) => {
    await readableClipboard({ page, context, browserName });
    const { measure, row } = await aRateToProve(request);
    const few = await proofOf(request, measure.key, row.person.id);
    await changeProof(page, linkToJira);
    await page.goto(`/people?proof=${measure.key}&proof_person=${row.person.id}`);
    const dialog = sheet(page);
    await dialog.getByRole("radio", { name: /^All\W*\d+$/ }).click();
    const open = dialog.getByRole("link", { name: /Open in Jira/ });
    await expect(open).toBeVisible();
    const search = new URL((await open.getAttribute("href"))!);
    expect(`${search.origin}${search.pathname}`).toBe(`${SITE}/issues/`);
    const asked = /^key in \((.*)\)$/.exec(search.searchParams.get("jql") ?? "")?.[1].split(/\s*,\s*/);
    expect(asked).toEqual(few.tickets.map((ticket) => ticket.key));
    await expect(open).toHaveAttribute("target", "_blank");

    const everything = await proofOf(request, "tickets", null);
    expect(everything.total).toBeGreaterThan(KEYS_MAX);
    await page.goto("/people?proof=tickets&proof_person=board");
    await expect(sheet(page)).toContainText(count(everything.total));
    await expect(sheet(page).getByRole("link", { name: /Open in Jira/ })).toHaveCount(0);
    await sheet(page).getByRole("button", { name: /Copy keys/ }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    const keys = (await page.evaluate(() => navigator.clipboard.readText())).split(/[\s,]+/).filter(Boolean);
    expect(keys).toEqual(everything.tickets.map((ticket) => ticket.key));
    await sheet(page).getByRole("button", { name: /Copy JQL/ }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(/^key in \((.*)\)$/.exec(copied)?.[1].split(/\s*,\s*/)).toEqual(everything.tickets.map((ticket) => ticket.key));
  });

  test("a muted Left out group says who left them out and why", async ({ page, request }) => {
    const { measure, row } = await aRateToProve(request);
    const theirs = await proofOf(request, "tickets", row.person.id);
    const proof = await proofOf(request, measure.key, row.person.id);
    const outside = theirs.tickets.find((ticket) => !proof.tickets.some((listed) => listed.key === ticket.key))!;
    const like = proof.tickets[proof.tickets.length - 1];
    await changeProof(page, (body) => {
      const ignore = { scope: "ticket", rule_id: null, reason: "Agreed with the team", by: "Morgan Reyes", at: "2026-11-03T09:15:00.000Z" };
      body.left_out = [{ ...outside, counted: false, at: like.at, detail: like.detail, credit: like.credit, ignore }];
    });
    await page.goto(`/people?proof=${measure.key}&proof_person=${row.person.id}`);
    const dialog = sheet(page);
    await dialog.getByRole("radio", { name: /^All\W*\d+$/ }).click();
    await expect(dialog.getByText(/Left out\s*\(1\)/)).toBeVisible();
    await expect(dialog).toContainText("Agreed with the team");
    await expect(dialog).toContainText("Morgan Reyes");
    await expect.poll(() => listedKeys(dialog)).toContain(outside.key);
    // The figure stays the cell's: the left-out ticket is beside the arithmetic, never in it.
    await expect(dialog).toContainText(`${count(proof.value.numerator!)} of ${count(proof.value.denominator!)}`);
  });

  test("while the tickets load a skeleton holds the list's place; a failure says so and Try again works", async ({ page, request }) => {
    const { measure, row, value } = await aRateToProve(request);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let fail = false;
    await page.route(PROOF_API, async (route) => {
      if (fail) return route.fulfill({ status: 503, json: { error: "upstream_unavailable", message: "The oversight service could not be reached." } });
      await held;
      await route.continue();
    });
    await page.goto("/people");
    await table(page).getByRole("button", { name: cellName(row.person.name, measure, value) }).click();
    const dialog = sheet(page);
    await expect(dialog.getByRole("status").filter({ hasText: /Loading/ })).toBeAttached();
    const heading = dialog.getByRole("heading").first();
    const before = await heading.boundingBox();
    release();
    await expect(dialog.getByRole("status").filter({ hasText: /Loading/ })).toHaveCount(0);
    await expect.poll(() => listedKeys(dialog)).not.toEqual([]);
    expect(Math.abs(((await heading.boundingBox())?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);

    fail = true;
    await page.goto(`/people?proof=${measure.key}&proof_person=${row.person.id}`);
    const alert = sheet(page).getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("503");
    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => listedKeys(sheet(page))).not.toEqual([]);
    expect(await axeBlocking(page)).toEqual([]);
  });

  test("the whole board's every ticket opens at once, and the list scrolls to its last", async ({ page, request }) => {
    const card = await scorecard(request);
    const everything = await proofOf(request, "tickets", null);
    await page.goto("/people");
    await table(page).getByRole("button", { name: ticketsName("Whole board", card.board.tickets) }).click();
    // Timed from the press itself: the runner's own wait for a clickable button is not the app's time.
    const started = Date.now();
    const dialog = sheet(page);
    await expect.poll(() => listedKeys(dialog)).toContain(everything.tickets[0].key);
    expect(Date.now() - started).toBeLessThan(5_000);
    const last = everything.tickets[everything.tickets.length - 1].key;
    const box = (await dialog.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 4_000);
        return listedKeys(dialog);
      }, { timeout: 30_000 })
      .toContain(last);
  });

  test("the scorecard's figures, the person's and the board's on every row, open their tickets too", async ({ page, request }) => {
    const { measure, row, value } = await aRateToProve(request);
    const card = await scorecard(request, `?person=${row.person.id}`);
    await page.goto(`/people?person=${row.person.id}`);
    const section = page.locator("[data-scorecard]");
    await expect(section.getByRole("heading", { name: row.person.name })).toBeVisible();
    await expect(section.getByRole("button", { name: ticketsName(row.person.name, card.people[0].tickets) })).toHaveCount(1);
    for (const shown of card.measures.filter((candidate) => candidate.measurable)) {
      for (const [who, figureOf] of [[row.person.name, card.people[0].values[shown.key]], ["Whole board", card.board.values[shown.key]]] as const) {
        const named = section.getByRole("button", { name: somethingBehind(shown, figureOf) ? cellName(who, shown, figureOf) : new RegExp(`^${escape(who)}, ${escape(shown.label)}, `) });
        await expect(named, `${who} ${shown.key}`).toHaveCount(somethingBehind(shown, figureOf) ? 1 : 0);
      }
    }
    await section.getByRole("button", { name: cellName(row.person.name, measure, value) }).click();
    await expect(sheet(page)).toContainText(row.person.name);
    await expect(page).toHaveURL(new RegExp(`proof_person=${row.person.id}`));
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await section.getByRole("button", { name: cellName("Whole board", measure, card.board.values[measure.key]) }).click();
    await expect(sheet(page)).toContainText("Whole board");
    await expect(page).toHaveURL(/proof_person=board/);
  });

  test("the keyboard alone: to a figure, Enter, around the sheet without leaving it, Esc back to the figure", async ({ page, request }) => {
    const { measure, row, value } = await aRateToProve(request);
    await page.goto("/people");
    const button = table(page).getByRole("button", { name: cellName(row.person.name, measure, value) });
    await expect(button).toBeVisible();
    const focusIn = (selector: string) => page.evaluate((query) => document.activeElement?.closest(query) !== null && document.activeElement !== null, selector);
    for (let step = 0; step < 80 && !(await focusIn("table tbody")); step += 1) await page.keyboard.press("Tab");
    expect(await focusIn("table tbody"), "Tab reaches the everyone table").toBe(true);
    const onRow = () => page.evaluate((id) => document.activeElement?.closest("tr")?.getAttribute("data-person") === id, row.person.id);
    for (let step = 0; step < 20 && !(await onRow()); step += 1) await page.keyboard.press("ArrowDown");
    expect(await onRow(), "the arrows reach the person's row").toBe(true);
    for (let step = 0; step < 20 && !(await button.evaluate((element) => element === document.activeElement)); step += 1) await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    // The kit's focus ring, and the figure underlined as on hover.
    await expect(button).toHaveCSS("outline-style", "solid");
    expect(await underlined(button)).toBe(true);
    await page.keyboard.press("Enter");
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();
    await expect.poll(() => listedKeys(dialog)).not.toEqual([]);
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((root) => root.contains(document.activeElement))).toBe(true);
    }
    // A tooltip the focus opened is the innermost layer: Esc shuts it first, then the sheet.
    const openTip = page.locator('[role="tooltip"]:not([data-state="closed"])');
    if (await openTip.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toBeHidden();
      await expect(dialog).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole("button", { name: /^Close/ }).first().click();
    await expect(sheet(page)).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("a link opens the same proof as a click, the page behind it hidden from assistive technology the same way", async ({ page, request }) => {
    const { measure, row, value } = await aRateToProve(request);
    const behind = (from: Page) =>
      from
        .getByRole("table", { name: /Everyone with tickets/, includeHidden: true })
        .getByRole("button", { name: /^Whole board, Tickets, /, includeHidden: true })
        .evaluate((element) => element.closest("[aria-hidden='true'], [inert]") !== null);
    await page.goto("/people");
    await table(page).getByRole("button", { name: cellName(row.person.name, measure, value) }).click();
    await expect.poll(() => listedKeys(sheet(page))).not.toEqual([]);
    expect(await behind(page), "opened by a click").toBe(true);

    await page.goto(`/people?proof=${measure.key}&proof_person=${row.person.id}`);
    await expect.poll(() => listedKeys(sheet(page))).not.toEqual([]);
    await expect.poll(() => behind(page), { message: "opened from a link" }).toBe(true);
  });

  test("the People page's own address never carries anything but the measure and whose figure it is", async ({ page, request }) => {
    const { measure, row } = await aRateToProve(request);
    await page.goto(`/people?proof=${measure.key}&proof_person=${row.person.id}`);
    await expect(sheet(page)).toBeVisible();
    const query = new URL(page.url()).searchParams;
    expect(query.get("proof")).toBe(measure.key);
    expect(query.get("proof_person")).toBe(row.person.id);
    await page.goto("/people?proof=nope&proof_person=board");
    await expect(table(page)).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
  });

  test("a link to a figure the board cannot show, or to someone not on it, says so plainly rather than failing", async ({ page, request }) => {
    const card = await scorecard(request);
    const unmeasurable = card.measures.find((measure) => !measure.measurable);
    if (!unmeasurable) throw new Error("the sample's board should have a measure it cannot show");
    await page.goto(`/people?proof=${unmeasurable.key}&proof_person=board`);
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole("alert")).toHaveCount(0);
    await expect(sheet(page)).toContainText(/not measurable|can't show|cannot show/i);
    await page.goto("/people?proof=open_tickets&proof_person=p000000000000");
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText(/not on this board/i);
    expect(await axeBlocking(page)).toEqual([]);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`the scorecard's figures open the sheet full screen, nothing scrolls sideways, axe clean (${colorScheme})`, async ({ page, request }) => {
        await page.emulateMedia({ colorScheme });
        const { measure, row, value } = await aRateToProve(request);
        await page.goto(`/people?person=${row.person.id}`);
        const section = page.locator("[data-scorecard]");
        await section.getByRole("button", { name: cellName(row.person.name, measure, value) }).click();
        const dialog = sheet(page);
        await expect(dialog).toBeVisible();
        await expect.poll(() => listedKeys(dialog)).not.toEqual([]);
        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeLessThanOrEqual(1);
        expect(box.width).toBeGreaterThanOrEqual(389);
        expect(box.height).toBeGreaterThanOrEqual(800);
        expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
        expect(await axeBlocking(page)).toEqual([]);
      });
    }
  });
});
