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

export function failedSinceLastSync(
  latest: { state: string; finished_at: string | null } | undefined,
  lastSyncedAt: string | null | undefined,
): boolean {
  if (latest?.state !== "failed") return false;
  if (!lastSyncedAt || !latest.finished_at) return true;
  return Date.parse(latest.finished_at) > Date.parse(lastSyncedAt);
}
