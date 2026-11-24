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
