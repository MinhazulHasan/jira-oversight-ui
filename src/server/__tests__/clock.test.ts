// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { RESYNC_EVERY, resetSampleClock, sampleNow } from "../sample/clock";
import { MINUTE } from "../sample/time";

const START = Date.parse("2026-11-04T09:17:42Z");

afterEach(() => {
  resetSampleClock();
});

describe("the sample clock", () => {
  it("uses SAMPLE_NOW when it is set, to the minute", () => {
    expect(sampleNow(Date.parse("2026-11-04T14:30:59Z"), START)).toBe(Date.parse("2026-11-04T14:30:00Z"));
  });

  it("otherwise starts at the minute the server started, and holds still between syncs", () => {
    expect(sampleNow(null, START)).toBe(Date.parse("2026-11-04T09:17:00Z"));
    expect(sampleNow(null, START + 29 * MINUTE)).toBe(Date.parse("2026-11-04T09:17:00Z"));
  });

  it("moves on every 30 minutes, as the real service syncs, so a long-running demo never goes stale", () => {
    sampleNow(null, START);
    expect(sampleNow(null, START + RESYNC_EVERY)).toBe(Date.parse("2026-11-04T09:47:00Z"));
    expect(sampleNow(null, START + 3 * 24 * 60 * MINUTE)).toBe(Date.parse("2026-11-07T09:17:00Z"));
  });

  it("follows the clock if it is set back", () => {
    sampleNow(null, START);
    expect(sampleNow(null, START - 5 * MINUTE)).toBe(Date.parse("2026-11-04T09:12:00Z"));
  });
});
