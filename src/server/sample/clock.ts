import { MINUTE, floorToMinute } from "./time";

/** "Now" for the sample project. Pinned by SAMPLE_NOW (screenshots, tests, */

export const RESYNC_EVERY = 30 * MINUTE;

let anchor: number | null = null;

export function sampleNow(pinned: number | null, wallClock: number = Date.now()): number {
  if (pinned !== null) return floorToMinute(pinned);
  const current = floorToMinute(wallClock);
  if (anchor === null || current - anchor >= RESYNC_EVERY || current < anchor) anchor = current;
  return anchor;
}

/** For tests: forget the anchor, as a fresh server would. */
export function resetSampleClock(): void {
  anchor = null;
}
