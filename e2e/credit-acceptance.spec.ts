import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// Each test may change the board's one credit setting, and puts Automatic back after it.
test.describe.configure({ mode: "serial" });

const NOW = new Date("2026-11-04T14:30:00Z");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LABELS = { auto: "Automatic", assignee: "Assignee" } as const;

interface Field {
  key: string;
  name: string;
}
interface Option {
  source: "auto" | "assignee" | "field";
  field: Field | null;
  source_filled: number;
  credited: number;
}
interface CreditBody {
  period: { days: number };
  setting: { source: string; field: Field | null; revision: number; changed_by: string | null };
  effective_field: Field | null;
  finished: number;
  options: Option[];
}

const count = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const labelOf = (option: Option) => (option.source === "field" ? (option.field?.name ?? "") : LABELS[option.source]);
/** This project's own server: a change must carry its origin, as the page's own requests do. */
const origin = () => new URL(String(test.info().project.use.baseURL)).origin;

async function credit(request: APIRequestContext, days = 90): Promise<CreditBody> {
  const response = await request.get(`/api/oversight/people/credit?days=${days}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as CreditBody;
}

async function choose(request: APIRequestContext, source: Option["source"], field: string | null = null) {
  const now = await credit(request);
  const response = await request.put("/api/oversight/people/credit", {
    data: { source, field, revision: now.setting.revision },
    headers: { origin: origin() },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function restoreAutomatic(request: APIRequestContext) {
  if ((await credit(request)).setting.source !== "auto") await choose(request, "auto");
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

const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Pressed from the keyboard, so every browser starts from the same focus (Safari's mouse focuses no button). */
async function pressKey(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Enter");
}

/** Tab, from wherever focus is, until the control has it; a failure if it never does. */
async function tabTo(page: Page, control: Locator, most = 25) {
  for (let presses = 0; presses < most; presses += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
}

const table = (page: Page) => page.getByRole("table", { name: /Everyone with tickets/ });
const control = (page: Page) => page.getByRole("button", { name: /Counts for: / });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Whom tickets count for" });
const radios = (page: Page) => dialog(page).getByRole("radio");
const choice = (page: Page, label: string) => dialog(page).getByRole("radio", { name: new RegExp(`^${label}\\b`) });
/** A choice's whole card: the radio itself when it holds its words, or the nearest box around it that does. */
const card = (page: Page, label: string) => choice(page, label).locator("xpath=ancestor-or-self::*[contains(normalize-space(.), 'for someone')][1]");
const note = (page: Page) => page.locator("[data-credit-note]");
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]:not([data-removed='true'])").filter({ hasText: text });

async function openPeople(page: Page, days = 90) {
  await page.goto(days === 90 ? "/people" : `/people?days=${days}`);
  await expect(table(page)).toBeVisible();
  await expect(control(page)).toBeVisible();
}

/** A modal over the page has to go before the page's own controls can be used again. */
async function closeIfOpen(page: Page) {
  if (await dialog(page).isVisible()) await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
}

test.beforeAll(async ({ request }) => {
  await restoreAutomatic(request);
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ request }) => {
  await restoreAutomatic(request);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`beside the period a quiet control says whom tickets count for and opens the choices; axe clean (${colorScheme})`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ colorScheme });
    const problems = watchConsole(page);
    const body = await credit(request);
    await openPeople(page);
    await expect(control(page)).toHaveAccessibleName(/Counts for: Automatic/);
    await expect(control(page)).toContainText("Counts for: Automatic");
    // Beside the period: the two share the toolbar's row.
    const period = await page.getByRole("radiogroup", { name: "Period" }).boundingBox();
    const box = await control(page).boundingBox();
    expect(period && box && box.y < period.y + period.height && period.y < box.y + box.height).toBe(true);

    await pressKey(page, control(page));
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("heading", { name: "Whom tickets count for" })).toBeVisible();
    await expect(radios(page)).toHaveCount(body.options.length);
    for (const option of body.options) await expect(choice(page, labelOf(option))).toBeVisible();
    await expect(choice(page, "Automatic")).toBeChecked();
    await expect(choice(page, "Assignee")).not.toBeChecked();
    expect(await axeBlocking(page)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(control(page)).toBeFocused();
    expect(problems).toEqual([]);
  });
}

test("each choice says its coverage of the work finished in the period on screen, in words and numbers", async ({ page, request }) => {
  for (const days of [30, 180]) {
    const body = await credit(request, days);
    expect(body.period.days).toBe(days);
    await openPeople(page, days);
    await pressKey(page, control(page));
    await expect(dialog(page)).toBeVisible();
    for (const option of body.options) {
      const words = card(page, labelOf(option));
      await expect(words, `${labelOf(option)}, ${days} days`).toContainText(`${count(option.credited)} of ${count(body.finished)} finished ticket`);
      await expect(words, `${labelOf(option)}, ${days} days`).toContainText(/counts? for someone/);
    }
    await page.keyboard.press("Escape");
  }
});

test("saving a choice applies it at once: the figures refetch, a toast, the control and the note follow; saving Automatic puts it back", async ({
  page,
  request,
}) => {
  const problems = watchConsole(page);
  const body = await credit(request);
  await openPeople(page);
  await expect(note(page)).toBeVisible();
  if (body.effective_field) await expect(note(page)).toContainText(`Tickets count for their ${body.effective_field.name} in Jira`);
  await expect(page.locator("#everyone")).not.toContainText("by each ticket's current assignee");

  await pressKey(page, control(page));
  await choice(page, "Assignee").click();
  await expect(choice(page, "Assignee")).toBeChecked();
  const refetched = page.waitForRequest((sent) => sent.method() === "GET" && sent.url().includes("/api/oversight/people/scorecard"));
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await refetched;
  const saved = toast(page, "Tickets now count for the assignee");
  await expect(saved).toBeVisible();
  await expect(saved.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(control(page)).toHaveAccessibleName(/Counts for: Assignee/);
  await expect(note(page)).toContainText("Tickets count for their assignee; tickets without one count for no one.");
  expect((await credit(request)).setting.source).toBe("assignee");

  await closeIfOpen(page);
  await pressKey(page, control(page));
  await choice(page, "Automatic").click();
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(control(page)).toHaveAccessibleName(/Counts for: Automatic/);
  await expect.poll(async () => (await credit(request)).setting.source).toBe("auto");
  if (body.effective_field) await expect(note(page)).toContainText(`Tickets count for their ${body.effective_field.name} in Jira`);
  expect(problems).toEqual([]);
});

test("the dialog keeps no list of past changes, and never shows an email, an account id or a time zone", async ({ page, request }) => {
  await choose(request, "assignee");
  await openPeople(page);
  await expect(control(page)).toHaveAccessibleName(/Counts for: Assignee/);
  await pressKey(page, control(page));
  await expect(choice(page, "Assignee")).toBeChecked();
  await expect(dialog(page).getByRole("list")).toHaveCount(0);
  await expect(dialog(page).getByRole("button", { name: /Undo/ })).toHaveCount(0);
  const words = (await dialog(page).innerText()).replace(/\s+/g, " ");
  expect(words).not.toMatch(/@|acc-\d|\bUTC\b|\bGMT\b|Europe\/|America\/|Asia\//);
  await closeIfOpen(page);
});

test("the keyboard alone opens the choices, picks one with the arrows, saves it, and gets back to the control", async ({ page, request }) => {
  await openPeople(page);
  await pressKey(page, control(page));
  await expect(dialog(page)).toBeVisible();
  await expect.poll(() => dialog(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await tabTo(page, choice(page, "Automatic"));
  await page.keyboard.press("ArrowDown");
  await expect(choice(page, "Assignee")).toBeChecked();
  await expect(choice(page, "Assignee")).toBeFocused();
  await tabTo(page, dialog(page).getByRole("button", { name: "Save" }));
  await page.keyboard.press("Enter");
  await expect(toast(page, "Tickets now count for the assignee")).toBeVisible();
  expect((await credit(request)).setting.source).toBe("assignee");
  await closeIfOpen(page);
  await expect(control(page)).toBeFocused();
  await expect(control(page)).toHaveAccessibleName(/Counts for: Assignee/);
});

test("each column's header says what it counts and whom every ticket counts for, by the setting", async ({ page }) => {
  await openPeople(page);
  const header = (name: string) => table(page).getByRole("button", { name, exact: true });
  await header("Done in the period").hover();
  await expect(page.getByRole("tooltip")).toContainText("Their tickets done in the period");
  await expect(page.getByRole("tooltip")).toContainText(/Tickets count for their (Programmer|assignee)/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await header("Open tickets").focus();
  await expect(page.getByRole("tooltip")).toContainText(/Tickets count for their (Programmer|assignee)/);
});

test("Automatic is marked recommended where the board fills the people field it reads, and not on DEMO, which fills none", async ({ page, baseURL }) => {
  await openPeople(page);
  await pressKey(page, control(page));
  await expect(card(page, "Automatic")).toBeVisible();
  await expect(card(page, "Automatic")).not.toContainText(/recommended/i);
  await page.keyboard.press("Escape");
  // MOB is only read here: the credit spec of its own changes MOB's setting.
  await page.context().addCookies([{ name: "jo-board", value: "MOB", url: baseURL! }]);
  await openPeople(page);
  await pressKey(page, control(page));
  await expect(card(page, "Automatic")).toContainText(/recommended/i);
  await expect(choice(page, "Programmer")).toBeVisible();
  await expect(choice(page, "Testers")).toBeVisible();
});

test("a person's ticket count under their name is their tickets by the credit rule, never called assigned now", async ({ page, request }) => {
  const response = await request.get("/api/oversight/people/scorecard");
  const card = (await response.json()) as { people: { person: { id: string; name: string }; tickets: number }[] };
  const row = card.people.find((candidate) => candidate.person.name === "Carmen Ruiz")!;
  await page.goto(`/people?person=${row.person.id}`);
  const line = page.locator("[data-scorecard]").getByText(new RegExp(`^${count(row.tickets)} tickets?\\b`)).first();
  await expect(line).toBeVisible();
  await expect(line).not.toContainText("assigned now");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`the control and its dialog fit the screen, nothing scrolls sideways, axe clean (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/people");
      await expect(control(page)).toBeVisible();
      await pressKey(page, control(page));
      await expect(dialog(page)).toBeVisible();
      const box = await dialog(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});
