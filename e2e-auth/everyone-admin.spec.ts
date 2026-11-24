import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, EVERYONE_APP_URL } from "./settings";

test.use({ baseURL: EVERYONE_APP_URL });

/** From the dashboard's sign-in page, through the mock's consent screen, as one of its test accounts. */
async function chooseAccount(page: Page, account: string) {
  await page.getByRole("link", { name: /^Sign in with Atlassian/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mock Atlassian" })).toBeVisible();
  await page.getByRole("link", { name: account, exact: true }).click();
}

test.describe("everyone-admin, the default", () => {
  test("a reader not on ADMIN_EMAILS lands on the Portfolio, reads every board, and the top bar shows no Admin badge", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await chooseAccount(page, ACCOUNTS.allowed);
    // An admin's landing page, going nowhere in particular.
    await expect(page).toHaveURL(`${EVERYONE_APP_URL}/portfolio`);
    await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("button", { name: /Sample data/ })).toBeVisible();
    await expect(banner.locator("[data-role=admin]")).toHaveCount(0);
    await expect(banner.getByText("Admin", { exact: true })).toHaveCount(0);

    // Every board the dashboard covers, though their Jira opens DEMO alone.
    const list = (await (await page.request.get("/api/oversight/projects")).json()) as { projects: { key: string }[] };
    expect(list.projects.map((board) => board.key)).toEqual(["DEMO", "MOB", "HELP"]);
    await context.addCookies([{ name: "jo-board", value: "MOB", url: EVERYONE_APP_URL }]);
    expect((await page.request.get("/api/oversight/overview")).status()).toBe(200);
  });

  test("reads at people level: the People page, Governance, and the @ list", async ({ page }) => {
    await page.goto("/people");
    await chooseAccount(page, ACCOUNTS.allowed);
    await expect(page).toHaveURL(`${EVERYONE_APP_URL}/people`);
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    const rail = page.getByRole("navigation", { name: "Primary" });
    for (const name of ["People", "Access log", "Usage", "Rule settings"]) await expect(rail.getByRole("link", { name }), name).toBeVisible();
    for (const path of ["/api/oversight/people/directory", "/api/oversight/access-log", "/api/oversight/usage", "/api/oversight/rules/settings"]) {
      expect((await page.request.get(path)).status(), path).toBe(200);
    }
    await page.goto("/governance/access-log");
    await expect(page.getByRole("heading", { level: 1, name: "Access log" })).toBeVisible();
  });

  test("lets in someone whose Jira opens none of the boards, as an admin", async ({ page }) => {
    await page.goto("/");
    await chooseAccount(page, ACCOUNTS.noBoards);
    await expect(page).toHaveURL(`${EVERYONE_APP_URL}/portfolio`);
    await expect(page.getByRole("banner").getByRole("button", { name: /Sample data/ })).toBeVisible();
  });

  test("still turns away an address that is not on an allowed domain", async ({ page, context }) => {
    await page.goto("/");
    await chooseAccount(page, ACCOUNTS.outsider);
    await expect(page).toHaveURL(`${EVERYONE_APP_URL}/no-access?reason=domain`);
    expect((await context.cookies()).some((cookie) => cookie.name === "jo-session")).toBe(false);
  });
});
