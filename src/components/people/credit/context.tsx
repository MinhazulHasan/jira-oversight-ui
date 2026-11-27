"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { CreditInForce } from "./model";

/** The board's credit setting, where the People page has read it: the columns and the note say which way each figure counts. */
const CreditContext = createContext<CreditInForce | null>(null);

export function CreditProvider({ credit, children }: { credit: CreditInForce | null; children: ReactNode }) {
  return <CreditContext.Provider value={credit}>{children}</CreditContext.Provider>;
}

/** The setting the figures follow, or null while it loads (or outside the People page). */
export function useCredit(): CreditInForce | null {
  return useContext(CreditContext);
}
