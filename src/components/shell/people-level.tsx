"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether this reader is at people level (an admin, or anyone with sign-in
 * off), as the server decided for the page it rendered: what decides whether
 * the People page and its ways in are offered. A hint for the page only: the
 * oversight route decides again on every request. Outside a provider (a
 * component on its own, in a test), the answer is team level, the least.
 */
const PeopleLevelContext = createContext(false);

export function PeopleLevelProvider({ peopleLevel, children }: { peopleLevel: boolean; children: ReactNode }) {
  return <PeopleLevelContext.Provider value={peopleLevel}>{children}</PeopleLevelContext.Provider>;
}

export function usePeopleLevel(): boolean {
  return useContext(PeopleLevelContext);
}
