"use client";

import { useRecheckFollower } from "@/lib/api/hooks";

import { usePeopleLevel } from "./people-level";

/**
 * Follows the re-check after a rule settings save to its end, whichever page
 * the reader has gone to meanwhile (JO-15), so every figure the rules decide
 * is read afresh once the service has moved the findings (useRecheckFollower).
 * In the shell, beside the palette: only a reader at people level (an admin,
 * or anyone with sign-in off) can save rule settings, so nobody else has a
 * re-check to follow.
 */
export function RecheckFollower() {
  return usePeopleLevel() ? <Follow /> : null;
}

function Follow() {
  useRecheckFollower();
  return null;
}
