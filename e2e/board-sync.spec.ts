import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Sync in the top bar syncs the board on screen: Syncing while it runs, then every figure reloads and it says so", async ({ page }) => {
  await page.goto("/findings");
  const banner = page.getByRole("banner");
  const sync = banner.getByRole("button", { name: "Sync Demo project", exact: true });
  await expect(sync).toHaveAttribute("data-sync-state", "synced");
  const reloaded = page.waitForRequest((request) => request.url().includes("/api/oversight/findings") && request.method() === "GET", { timeout: 15_000 });
  await sync.click();
  // The same name while it runs; its description says it is syncing.
  const running = banner.getByRole("button", { name: "Sync Demo project", exact: true });
  await expect(running).toHaveAttribute("data-sync-state", "running");
  await expect(running).toHaveAccessibleDescription("Syncing");
  await expect(running).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Demo project synced")).toBeVisible({ timeout: 15_000 });
  await reloaded;
  await expect(banner.getByRole("button", { name: "Sync Demo project", exact: true })).toHaveAttribute("data-sync-state", "synced");
});

test("a board's first sync waits its turn behind another board's, shows its progress, and then the page fills in", async ({
  page,
  request,
  baseURL,
}) => {
  await page.context().addCookies([{ name: "jo-board", value: "HELP", url: baseURL! }]);
  await page.goto("/findings");
  const state = page.getByRole("region", { name: "Help desk hasn’t been synced yet." });
  const button = state.getByRole("button", { name: "Sync Help desk" });
  await expect(button).toBeVisible();

  // Another board's sync starts first (someone else, another tab): HELP's waits for it.
  const other = await request.post("/api/oversight/refresh", { headers: { origin: baseURL!, cookie: "jo-board=MOB" } });
  expect(await other.json()).toMatchObject({ project: "MOB", state: "running" });
  await button.click();
  await expect(state.getByRole("progressbar", { name: "Help desk is queued" })).toBeVisible();
  await expect(state.getByRole("button", { name: "Queued" })).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Help desk is queued", { exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Sync Help desk", exact: true })).toHaveAccessibleDescription("Queued");

  // Then it runs, and the page fills in with HELP's own findings once it has ended.
  await expect(state.getByRole("progressbar", { name: "Syncing Help desk" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Help desk synced")).toBeVisible({ timeout: 20_000 });
  await expect(state).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Findings" })).toBeVisible();
  await expect(page.getByRole("main").getByText(/^HELP-\d+$/).first()).toBeVisible();

  // The board picker now lists it with the synced boards, and the top bar says when it synced.
  await page.getByRole("banner").getByRole("button", { name: /^Board: Help desk/ }).click();
  await expect(page.getByRole("group", { name: "Synced", exact: true }).getByRole("option", { name: /Help desk/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "Not synced yet", exact: true })).toHaveCount(0);
});
