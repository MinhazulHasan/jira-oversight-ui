import type { BrowserContext, Page } from "@playwright/test";

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
