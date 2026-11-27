import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// One server of its own (playwright.config.ts): each test changes MOB's credit setting and puts it back after.
test.describe.configure({ mode: "serial" });

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BOARD = "MOB";
/** One of MOB's two testers (the sample's team): the Testers field moves finished work to them. */
const HANA = "Hana Mori";

interface Credit {
  setting: { source: "auto" | "assignee" | "field"; field: { key: string; name: string } | null; revision: number };
  effective_field: { key: string; name: string } | null;
  options: { source: string; field: { key: string; name: string } | null }[];
}
interface Card {
  people: { person: { id: string; name: string }; tickets: number; values: Record<string, { value: number | null }> }[];
}

const headers = (baseURL: string) => ({ cookie: `jo-board=${BOARD}`, origin: baseURL });

async function credit(request: APIRequestContext, baseURL: string): Promise<Credit> {
  const response = await request.get("/api/oversight/people/credit", { headers: headers(baseURL) });
  expect(response.status()).toBe(200);
  return (await response.json()) as Credit;
}

async function setCredit(request: APIRequestContext, baseURL: string, source: Credit["setting"]["source"], field: string | null = null) {
  const now = await credit(request, baseURL);
  if (now.setting.source === source && (now.setting.field?.key ?? null) === field) return;
  const response = await request.put("/api/oversight/people/credit", { headers: headers(baseURL), data: { source, field, revision: now.setting.revision } });
  expect(response.status(), await response.text()).toBe(200);
}

/** A person's figure for one measure, as the service gives it for MOB over 90 days. */
async function figure(request: APIRequestContext, baseURL: string, name: string, measure: string): Promise<number | null> {
  const response = await request.get("/api/oversight/people/scorecard", { headers: headers(baseURL) });
  const card = (await response.json()) as Card;
  return card.people.find((row) => row.person.name === name)?.values[measure].value ?? null;
}

const table = (page: Page) => page.getByRole("table", { name: /Everyone with tickets/ });
const control = (page: Page) => page.getByRole("button", { name: /^Counts for: / });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Whom tickets count for" });
const note = (page: Page) => page.locator("[data-credit-note]");
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]:not([data-removed='true'])").filter({ hasText: text });

/** The figure in a person's row under a measure's column, as the table shows it. */
async function cell(page: Page, name: string, label: string): Promise<string> {
  const heads = await table(page).locator("thead th").allInnerTexts();
  const column = heads.findIndex((text) => text.replace(/\s+/g, " ").includes(label));
  expect(column, label).toBeGreaterThan(0);
  const row = table(page).locator("tbody tr").filter({ hasText: name });
  return (await row.locator(`td:nth-child(${column + 1})`).innerText()).trim().split(/\s/)[0];
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

async function save(page: Page, label: string) {
  await control(page).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("radio", { name: label }).click();
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toBeHidden();
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.clock.setFixedTime(NOW);
  await page.context().addCookies([{ name: "jo-board", value: BOARD, url: baseURL! }]);
});

test.afterEach(async ({ request, baseURL }) => {
  // MOB's starting choice, as its process.yaml sets it.
  await setCredit(request, baseURL!, "assignee");
});

test("switching MOB between Assignee, a field and Automatic changes its figures and the note at once, and choosing again goes back", async ({
  page,
  request,
  baseURL,
}) => {
  const problems = watchConsole(page);
  const start = await credit(request, baseURL!);
  expect(start.setting.source).toBe("assignee");
  expect(start.options.map((option) => option.field?.name ?? option.source)).toEqual(["auto", "assignee", "Programmer", "Testers"]);
  const byAssignee = await figure(request, baseURL!, HANA, "done_in_period");

  await page.goto("/people");
  await expect(table(page)).toBeVisible();
  await expect(control(page)).toHaveAccessibleName("Counts for: Assignee");
  await expect(note(page)).toContainText("Tickets count for their assignee; tickets without one count for no one.");
  expect(await cell(page, HANA, "Done in the period")).toBe(String(byAssignee));

  // Testers: every ticket counts for whoever tested it, and for no one where no one did.
  await save(page, "Testers");
  await expect(toast(page, "Tickets now count for Testers in Jira")).toBeVisible();
  await expect(toast(page, "Tickets now count for Testers in Jira").getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(control(page)).toHaveAccessibleName("Counts for: Testers");
  await expect(note(page)).toContainText("Tickets count for their Testers in Jira; tickets without one count for no one.");
  const byTesters = await figure(request, baseURL!, HANA, "done_in_period");
  expect(byTesters).not.toBe(byAssignee);
  await expect.poll(() => cell(page, HANA, "Done in the period")).toBe(String(byTesters));

  // Automatic: Programmer where it is filled, which MOB does, else the assignee.
  await save(page, "Automatic");
  await expect(toast(page, "Tickets now count automatically")).toBeVisible();
  await expect(control(page)).toHaveAccessibleName("Counts for: Automatic");
  await expect(note(page)).toContainText("Tickets count for their Programmer in Jira, or their assignee where there is no Programmer.");
  const byProgrammer = await figure(request, baseURL!, HANA, "done_in_period");
  await expect.poll(() => cell(page, HANA, "Done in the period")).toBe(String(byProgrammer));

  // Back to Testers: another save, figures and all.
  await save(page, "Testers");
  await expect(control(page)).toHaveAccessibleName("Counts for: Testers");
  await expect.poll(() => cell(page, HANA, "Done in the period")).toBe(String(byTesters));
  expect((await credit(request, baseURL!)).setting.source).toBe("field");
  expect(problems).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the choices: what each does, its coverage and the one in use, with no list of past changes; axe clean (${colorScheme})`, async ({
    page,
    request,
    baseURL,
  }) => {
    await page.emulateMedia({ colorScheme });
    await setCredit(request, baseURL!, "field", "programmer");
    await page.goto("/people");
    await control(page).click();
    await expect(dialog(page)).toBeVisible();
    const automatic = dialog(page).getByRole("radio", { name: "Automatic" });
    await expect(automatic).toContainText("Recommended");
    await expect(automatic).toContainText("Programmer in Jira where it is filled, otherwise the assignee.");
    await expect(automatic).toContainText(/\d+ of \d+ finished tickets? counts? for someone/);
    const assignee = dialog(page).getByRole("radio", { name: "Assignee" });
    await expect(assignee).toContainText("The assignee in Jira now. Tickets without one count for no one.");
    await expect(assignee).toContainText(/\d+ of \d+ finished tickets? counts? for someone/);
    const programmer = dialog(page).getByRole("radio", { name: "Programmer" });
    await expect(programmer).toBeChecked();
    await expect(programmer).toContainText("In use");
    await expect(dialog(page).getByRole("list", { name: /Changes/ })).toHaveCount(0);
    await expect(dialog(page).getByRole("button", { name: /^Undo/ })).toHaveCount(0);
    expect(await dialog(page).innerText()).not.toMatch(/@|acc-\d|\bUTC\b|\bGMT\b|Europe\//);
    expect(await axeBlocking(page)).toEqual([]);

    await assignee.click();
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator("[data-credit-control]")).toHaveText("Counts for: Assignee");
  });
}

test("the keyboard alone: open the choices, pick with the arrows, save with the shortcut, and land back on the control", async ({ page, request, baseURL }) => {
  await page.goto("/people");
  await expect(table(page)).toBeVisible();
  await control(page).focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  // The choice in use takes the focus as the dialog opens.
  await expect(dialog(page).getByRole("radio", { name: "Assignee" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog(page).getByRole("radio", { name: "Programmer" })).toBeChecked();
  await page.keyboard.press("Control+Enter");
  await expect(toast(page, "Tickets now count for Programmer in Jira")).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expect(control(page)).toBeFocused();
  expect((await credit(request, baseURL!)).setting.field?.key).toBe("programmer");
  // Escape leaves without saving.
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(control(page)).toBeFocused();
  expect((await credit(request, baseURL!)).setting.field?.key).toBe("programmer");
});

test("each column's header says what it counts and whom every ticket counts for, as the board's setting has it", async ({ page, request, baseURL }) => {
  await setCredit(request, baseURL!, "field", "testers");
  await page.goto("/people");
  const header = (name: string) => table(page).getByRole("button", { name, exact: true });
  await header("Done in the period").hover();
  await expect(page.getByRole("tooltip")).toContainText("Their tickets done in the period");
  await expect(page.getByRole("tooltip")).toContainText("Tickets count for their Testers in Jira; tickets without one count for no one.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await header("Open tickets").hover();
  await expect(page.getByRole("tooltip")).toContainText("Tickets count for their Testers in Jira; tickets without one count for no one.");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`the control and its dialog fit, nothing scrolls sideways, and a choice saves; axe clean (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/people");
      await expect(control(page)).toBeVisible();
      await control(page).click();
      await expect(dialog(page)).toBeVisible();
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
      await dialog(page).getByRole("radio", { name: "Testers" }).click();
      await dialog(page).getByRole("button", { name: "Save" }).click();
      await expect(control(page)).toHaveAccessibleName("Counts for: Testers");
    });
  }
});
