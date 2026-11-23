"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Person } from "@/lib/api/schemas";

/**
 * A person card's "Ask about", done where the reader already is: on the Ask
 * page the person goes into the question being written as a chip, and the
 * answer on screen and the draft stay as they are (JO-13). Anywhere else
 * there is no handler here, and "Ask about" is a link to Ask with their chip
 * in the question box.
 */
const AskAboutContext = createContext<((person: Person) => void) | null>(null);

export function AskAboutProvider({ onAskAbout, children }: { onAskAbout: (person: Person) => void; children: ReactNode }) {
  return <AskAboutContext.Provider value={onAskAbout}>{children}</AskAboutContext.Provider>;
}

/** The page's own "Ask about", where it has one (the Ask page); null elsewhere. */
export function useAskAboutHere(): ((person: Person) => void) | null {
  return useContext(AskAboutContext);
}
