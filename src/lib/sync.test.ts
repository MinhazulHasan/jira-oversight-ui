import { describe, expect, it } from "vitest";

import { STALE_AFTER_MS, failedSinceLastSync, isStale, syncAge } from "./sync";

const now = Date.parse("2026-11-04T14:32:00Z");

describe("sync staleness", () => {
  it("measures the age of the last sync", () => {
    expect(syncAge("2026-11-04T14:28:00Z", now)).toBe(4 * 60_000);
    expect(syncAge(null, now)).toBeNull();
    expect(syncAge("garbage", now)).toBeNull();
  });

  it("calls data stale only after two hours", () => {
    expect(isStale(new Date(now - STALE_AFTER_MS), now)).toBe(false);
    expect(isStale(new Date(now - STALE_AFTER_MS - 1), now)).toBe(true);
    expect(isStale(undefined, now)).toBe(false);
  });

  it("treats a sync stamped slightly in the future as fresh", () => {
    expect(syncAge("2026-11-04T14:33:00Z", now)).toBe(0);
  });
});

describe("a board's failed sync (JO-18)", () => {
  const failed = (finished: string | null) => ({ state: "failed", finished_at: finished });

  it("is said until a sync succeeds after it", () => {
    expect(failedSinceLastSync(failed("2026-11-04T14:31:00Z"), "2026-11-04T14:28:00Z")).toBe(true);
    // The scheduled sync has run since: the figures on screen are newer than the failure.
    expect(failedSinceLastSync(failed("2026-11-04T14:31:00Z"), "2026-11-04T14:40:00Z")).toBe(false);
  });

  it("is said for a board that has never synced, and never for a sync that did not fail", () => {
    expect(failedSinceLastSync(failed("2026-11-04T14:31:00Z"), null)).toBe(true);
    expect(failedSinceLastSync(failed(null), "2026-11-04T14:28:00Z")).toBe(true);
    for (const state of ["idle", "queued", "running", "succeeded"]) {
      expect(failedSinceLastSync({ state, finished_at: "2026-11-04T14:31:00Z" }, "2026-11-04T14:28:00Z"), state).toBe(false);
    }
    expect(failedSinceLastSync(undefined, "2026-11-04T14:28:00Z")).toBe(false);
  });
});
