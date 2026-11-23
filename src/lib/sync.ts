/**
 * Data older than this is called stale on screen. The sync runs every 30
 * minutes, so two hours means at least three runs have been missed.
 */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** How long ago the last sync was, in milliseconds, or null if unknown. */
export function syncAge(lastSyncedAt: string | Date | null | undefined, now: number): number | null {
  if (!lastSyncedAt) return null;
  const time = (lastSyncedAt instanceof Date ? lastSyncedAt : new Date(lastSyncedAt)).getTime();
  return Number.isNaN(time) ? null : Math.max(0, now - time);
}

export function isStale(lastSyncedAt: string | Date | null | undefined, now: number): boolean {
  const age = syncAge(lastSyncedAt, now);
  return age !== null && age > STALE_AFTER_MS;
}

/**
 * Whether a board's latest sync (JO-18) failed after its last successful one,
 * so Sync says it did until one succeeds: a failure older than the figures on
 * screen (the scheduled sync has run since) is history.
 */
export function failedSinceLastSync(
  latest: { state: string; finished_at: string | null } | undefined,
  lastSyncedAt: string | null | undefined,
): boolean {
  if (latest?.state !== "failed") return false;
  if (!lastSyncedAt || !latest.finished_at) return true;
  return Date.parse(latest.finished_at) > Date.parse(lastSyncedAt);
}
