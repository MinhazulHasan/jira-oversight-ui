"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useNow } from "@/lib/use-now";

import { findingClock, RULES_CLOCK, type FindingClock } from "./model";

/** The clock the Findings page reads an open finding's age on; outside the page, ages are by the rules runs alone. */
const FindingClockContext = createContext<FindingClock>(RULES_CLOCK);

/**
 * The page's clock for findings: the board's last sync against the reader's
 * clock (unknown until hydrated, when ages are by the rules runs alone). One
 * object while what it says holds, so a stale page's ages stand still.
 */
export function useFindingClock(lastSyncedAt: string | null | undefined): FindingClock {
  const { now, stale, syncedAt } = findingClock(lastSyncedAt, useNow());
  return useMemo(() => ({ now, stale, syncedAt }), [now, stale, syncedAt]);
}

/** Gives the findings table its clock; only the ages and their header redraw as it moves on. */
export function FindingClockProvider({ lastSyncedAt, children }: { lastSyncedAt: string | null | undefined; children: ReactNode }) {
  const clock = useFindingClock(lastSyncedAt);
  return <FindingClockContext.Provider value={clock}>{children}</FindingClockContext.Provider>;
}

/** The clock the table around a cell reads ages on. */
export function usePageFindingClock(): FindingClock {
  return useContext(FindingClockContext);
}
