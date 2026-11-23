import type { BrowserContext, Page } from "@playwright/test";

/**
 * Lets a test read back what Copy link put on the clipboard, in both browsers.
 * Chromium is granted the clipboard permissions and the test reads the real
 * clipboard. WebKit knows no clipboard permissions (Playwright refuses
 * "clipboard-write" there), so before the page loads its clipboard is swapped
 * for a recorder: the app's writeText keeps the text and readText returns it,
 * which still proves that the app copied, and what.
 *
 * Use it as `test.beforeEach(readableClipboard)` and read with
 * `page.evaluate(() => navigator.clipboard.readText())`.
 */
export async function readableClipboard({
  page,
  context,
  browserName,
}: {
  page: Page;
  context: BrowserContext;
  browserName: string;
}): Promise<void> {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    return;
  }
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = String(text);
        },
        readText: async () => copied,
      },
    });
  });
}
