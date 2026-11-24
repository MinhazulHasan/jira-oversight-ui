import type { Locator } from "@playwright/test";

export function cutText(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const cut: string[] = [];
    const words = (text: string | null) => (text ?? "").trim().replace(/\s+/g, " ");
    const hides = (style: CSSStyleDeclaration) => style.overflowX === "hidden" || style.overflowX === "clip";
    const scrolls = (style: CSSStyleDeclaration) => style.overflowX === "auto" || style.overflowX === "scroll";
    const counted = new Set<Element>();

    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (!(element instanceof HTMLElement)) continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      // Not drawn, or drawn for screen readers only (a 1 px box).
      if (style.display === "none" || style.visibility === "hidden" || box.width <= 1 || box.height <= 1) continue;
      if (!words(element.textContent)) continue;
      const clamped = style.webkitLineClamp !== "" && style.webkitLineClamp !== "none" && element.scrollHeight > element.clientHeight + 1;
      if ((style.textOverflow === "ellipsis" || hides(style)) && element.scrollWidth > element.clientWidth + 1) {
        cut.push(`${words(element.textContent)} (${element.clientWidth} of ${element.scrollWidth} px)`);
        counted.add(element);
      } else if (clamped) {
        cut.push(`${words(element.textContent)} (${element.clientHeight} of ${element.scrollHeight} px high)`);
        counted.add(element);
      }
    }

    // Text past the edge of a frame that hides it, up to the nearest frame that scrolls.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = words(node.textContent);
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const ink = range.getBoundingClientRect();
      if (ink.width <= 1) continue;
      for (let frame = node.parentElement; frame; frame = frame.parentElement) {
        const style = getComputedStyle(frame);
        if (style.display === "none" || style.visibility === "hidden" || scrolls(style)) break;
        if (!hides(style)) continue;
        const box = frame.getBoundingClientRect();
        // Drawn for screen readers only, or already counted as cut by its own element.
        if (box.width <= 1 || box.height <= 1 || counted.has(frame)) break;
        if (ink.right > box.right + 1 || ink.left < box.left - 1) {
          const shown = Math.max(0, Math.min(ink.right, box.right) - Math.max(ink.left, box.left));
          cut.push(`${text} (${Math.round(shown)} of ${Math.round(ink.width)} px, cut by its frame)`);
          break;
        }
      }
    }
    return cut;
  });
}
