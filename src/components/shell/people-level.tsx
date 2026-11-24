"use client";

import { createContext, useContext, type ReactNode } from "react";

const PeopleLevelContext = createContext(false);

export function PeopleLevelProvider({ peopleLevel, children }: { peopleLevel: boolean; children: ReactNode }) {
  return <PeopleLevelContext.Provider value={peopleLevel}>{children}</PeopleLevelContext.Provider>;
}

export function usePeopleLevel(): boolean {
  return useContext(PeopleLevelContext);
}
