import { expect, type Locator, type Page } from "@playwright/test";

/** Ask's question box: a multi-line textbox (an editor, so a picked person stands in it as a chip), by its label. */
export const questionBox = (page: Page): Locator => page.getByRole("textbox", { name: "Your question" });

/**
 * The question in the box as it would be sent: its text, each chip written
 * "@Name" (the chip itself shows the picture and the name), without the
 * editor's zero-width caret holders.
 */
export function questionText(box: Locator): Promise<string> {
  return box.evaluate((root) => {
    let text = "";
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += (node as Text).data.replaceAll("​", "");
      } else if (node instanceof Element && node.hasAttribute("data-chip")) {
        text += `@${node.textContent ?? ""}`;
      } else {
        node.childNodes.forEach(walk);
      }
    };
    walk(root);
    return text;
  });
}

/** Waits for the box to hold this question. */
export async function expectQuestion(box: Locator, question: string | RegExp): Promise<void> {
  if (typeof question === "string") await expect.poll(() => questionText(box)).toBe(question);
  else await expect.poll(() => questionText(box)).toMatch(question);
}
