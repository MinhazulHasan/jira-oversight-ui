import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true after. Use it to hold back
 * anything that depends on the viewer (their zone, their locale, their
 * storage) until the first client render, so the server's HTML and the
 * browser's agree and nothing flickers through a hydration error.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
