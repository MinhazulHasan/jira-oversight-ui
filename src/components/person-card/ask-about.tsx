"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Person } from "@/lib/api/schemas";

const AskAboutContext = createContext<((person: Person) => void) | null>(null);

export function AskAboutProvider({ onAskAbout, children }: { onAskAbout: (person: Person) => void; children: ReactNode }) {
  return <AskAboutContext.Provider value={onAskAbout}>{children}</AskAboutContext.Provider>;
}

/** The page's own "Ask about", where it has one (the Ask page); null elsewhere. */
export function useAskAboutHere(): ((person: Person) => void) | null {
  return useContext(AskAboutContext);
}
