import { MINUTE, floorToMinute } from "./time";

/**
 * "Now" for the sample project. Pinned by SAMPLE_NOW (screenshots, tests,
 * demos that must match a script), otherwise the server's own clock: the
 * minute the server started, moved forward every 30 minutes as the real
 * service syncs, so a demo left running never reads as stale and the figures
 * do not shift under a reader between syncs.
 */

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
