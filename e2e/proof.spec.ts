import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const sheet = (page: Page) => page.getByRole("dialog");

async function axeBlocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T14:30:00Z"));
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the whole board's tickets open in the sheet on a wide screen, axe clean, with the page behind it (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/people");
    const everyone = page.getByRole("table", { name: /Everyone with tickets/ });
    await everyone.getByRole("button", { name: /^Whole board, Tickets, .*: show tickets$/ }).click();
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading").first()).toBeFocused();
    await expect(dialog).toContainText("Whole board");
    await expect(dialog.locator('a[href^="/issues/"]').first()).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(700);
    expect(box.width).toBeLessThanOrEqual(900);
    expect(await axeBlocking(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
}
