import { pageForChord } from "./nav";

/**
 * The global keyboard map, as pure functions so it can be tested without a
 * browser. The rule that matters most: a single-key shortcut never fires while
 * the reader is typing, or inside something that has keys of its own (a menu,
 * a listbox, a dialog). Only Cmd/Ctrl+K reaches through, because it is how a
 * reader gets out of a field to the palette.
 */

/** How long `g` waits for its second key. */
export const CHORD_TIMEOUT_MS = 1200;

export type ShortcutAction =
  | { type: "palette" }
  | { type: "shortcuts" }
  | { type: "focus-search" }
  | { type: "toggle-rail" }
  | { type: "arm-chord" }
  | { type: "navigate"; href: string };

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

// Widgets that interpret letter keys themselves: typeahead, menus, grids.
const KEY_HUNGRY_ROLES = new Set([
  "combobox",
  "grid",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "textbox",
  "tree",
  "treegrid",
]);

/** True when a keystroke at this target is the reader typing, not commanding. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  const role = target.getAttribute("role");
  if (role && KEY_HUNGRY_ROLES.has(role)) return true;
  // Inside a dialog or an open menu, the keys belong to it.
  return target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
}

/**
 * What a keystroke asks for, given whether `g` was pressed recently.
 * `chordArmedAt` is when `g` was pressed (ms), or null.
 */
export function resolveShortcut(
  event: KeyInput,
  options: { typing: boolean; chordArmedAt: number | null; now: number; peopleLevel?: boolean },
): ShortcutAction | null {
  const key = event.key;
  const mod = event.metaKey || event.ctrlKey;

  if (mod && !event.altKey && key.toLowerCase() === "k") return { type: "palette" };
  if (mod || event.altKey || options.typing) return null;

  const armed =
    options.chordArmedAt !== null && options.now - options.chordArmedAt <= CHORD_TIMEOUT_MS;
  if (armed && key.length === 1 && key.toLowerCase() !== "g") {
    // The pages this reader is offered: People only at people level.
    const page = pageForChord(key, options.peopleLevel ?? false);
    return page ? { type: "navigate", href: page.href } : null;
  }

  switch (key) {
    case "g":
    case "G":
      return { type: "arm-chord" };
    case "?":
      return { type: "shortcuts" };
    case "/":
      return { type: "focus-search" };
    case "[":
      return { type: "toggle-rail" };
    default:
      return null;
  }
}
