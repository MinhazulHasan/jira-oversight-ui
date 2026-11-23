/*
 * Leaving a page that holds unsaved work (JO-15: rule settings being edited).
 * The page registers a guard while it has something to lose; the app's own
 * ways to go elsewhere without a link (the `g` shortcuts, the command palette)
 * ask it first, and so does a press on any link (the page listens for those
 * itself). Leaving the browser's way (a reload, closing the tab, a typed
 * address, a board picked in the top bar, which loads the page afresh) is the
 * browser's own question, asked through beforeunload.
 *
 * A guard takes the navigation it would hold and answers whether it held it:
 * if it did, it goes on with it only once the reader says so.
 */

export type LeaveGuard = (go: () => void) => boolean;

let guard: LeaveGuard | null = null;

/** Holds in-app navigation behind `next` until the returned function is called (or another guard replaces it). */
export function holdNavigation(next: LeaveGuard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

/** Goes on with an in-app navigation, unless a page with unsaved work holds it to ask first. */
export function navigateGuarded(go: () => void): void {
  if (guard?.(go)) return;
  go();
}
