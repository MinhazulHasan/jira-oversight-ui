import { describe, expect, it } from "vitest";

import { ms } from "../model";
import { buildTimeline, spellHours, timelineSummary, timelineTable, UNMAPPED_LANE } from "../timeline-model";
import { CUT_GAP, PAD_X, shouldCut, STUB_W, timelineScale } from "../timeline-scale";
import { DEMO_1, demo1With, IN_FLIGHT, PROCESS, SKIPPER, SYNCED_AT } from "./fixtures";

const DAY = 86_400_000;
const CLOCK = ms(SYNCED_AT);

describe("the issue's swimlanes", () => {
  it("draws a lane for every stage of the process, hatching the ones Jira cannot see", () => {
    const { lanes } = buildTimeline(DEMO_1, PROCESS);
    expect(lanes.map((lane) => lane.id)).toEqual([
      "backlog",
      "estimate",
      "development",
      "code_review",
      "dev_signoff",
      "testing",
      "test_review",
      "test_signoff",
      "done",
    ]);
    expect(lanes.filter((lane) => lane.measurable === false).map((lane) => lane.label)).toEqual([
      "Code review",
      "Dev sign-off",
      "Testing",
      "Test review",
      "Test sign-off",
    ]);
    expect(lanes.find((lane) => lane.id === "development")?.detail).toBe("In Progress");
    expect(lanes.find((lane) => lane.id === "estimate")?.detail).toBe("Story points");
  });

  it("ties each spell to the status change that began it, and marks the estimate being set", () => {
    const { spells, events } = buildTimeline(DEMO_1, PROCESS);
    expect(spells.map((spell) => [spell.lane, spell.status, spell.changelogId])).toEqual([
      ["backlog", "To Do", undefined],
      ["development", "In Progress", "310004"],
      ["done", "Done", "310040"],
      ["development", "In Progress", "310131"],
      ["done", "Done", "310135"],
    ]);
    expect(events).toEqual([
      {
        id: "event-310037",
        lane: "estimate",
        at: "2025-11-17T11:34:00.000Z",
        label: "Story points set",
        value: "3",
        changelogId: "310037",
      },
    ]);
  });

  it("falls back to the statuses it saw when the process map is not to hand", () => {
    const { lanes, events } = buildTimeline(DEMO_1, null);
    expect(lanes).toHaveLength(9);
    expect(lanes.every((lane) => lane.measurable === undefined)).toBe(true);
    expect(lanes.find((lane) => lane.id === "done")?.detail).toBe("Done");
    expect(events).toHaveLength(1);
  });

  it("marks a skipped stage on the lanes it jumped between", () => {
    const { skips } = buildTimeline(SKIPPER, PROCESS);
    expect(skips).toEqual([
      {
        id: "skip-300101",
        at: "2025-11-13T10:00:00.000Z",
        from: "backlog",
        to: "done",
        skipped: ["development"],
        fromStatus: "To Do",
        toStatus: "Done",
        changelogId: "300101",
      },
    ]);
  });

  it("gives a status outside the process its own lane rather than dropping it", () => {
    const parked = demo1With((data) => {
      data.intervals[1] = { ...data.intervals[1], status: "Parked", stage: null };
    });
    const { lanes, spells } = buildTimeline(parked, PROCESS);
    expect(lanes.at(-1)).toEqual({ id: UNMAPPED_LANE, label: "Not mapped", stage: null, detail: "Parked" });
    expect(spells[1].lane).toBe(UNMAPPED_LANE);
  });

  it("tables every spell with its hours and changelog entry, the open one to now", () => {
    const model = buildTimeline(DEMO_1, PROCESS);
    const table = timelineTable(model, CLOCK, "en-GB");
    expect(table.columns.map((column) => column.header)).toEqual(["Status", "Stage", "Entered", "Left", "Hours", "Changelog"]);
    expect(table.rows[1]).toEqual(expect.arrayContaining(["In Progress", "Development", "120.6 h", "310004"]));
    expect(table.rows[4][3]).toBe("Still here");
    expect(spellHours(model.spells[4], CLOCK)).toBeGreaterThan(8000);
  });

  it("says what the chart shows in a sentence", () => {
    const summary = timelineSummary("DEMO-1", buildTimeline(DEMO_1, PROCESS), CLOCK, "en-GB");
    expect(summary).toContain("DEMO-1 sat in To Do for 50.0 h, In Progress for 120.6 h");
    expect(summary).toContain("and has been in Done since 25 Nov 2025.");
    expect(summary).toContain("Story points set on 17 Nov 2025.");
    const skipped = timelineSummary("DEMO-3", buildTimeline(SKIPPER, PROCESS), CLOCK, "en-GB");
    expect(skipped).toContain("It went straight past Development on 13 Nov 2025 (To Do to Done).");
  });
});

describe("the swimlane's time axis", () => {
  it("calls a stretch quiet when it is over three days and more than twice the life before it", () => {
    const created = ms(DEMO_1.issue.created_at);
    expect(shouldCut(created, ms("2025-11-25T08:25:00Z"), CLOCK)).toBe(true);
    expect(shouldCut(CLOCK - 30 * DAY, CLOCK - 10 * DAY, CLOCK)).toBe(false);
    expect(shouldCut(CLOCK - 3 * DAY, CLOCK - 2.5 * DAY, CLOCK)).toBe(false);
    expect(shouldCut(created, created, CLOCK)).toBe(false);
  });

  it("keeps the story to scale before the cut and ends the stub at now", () => {
    const width = 900;
    const lastEvent = ms("2025-11-25T08:25:00Z");
    const scale = timelineScale({
      start: ms(DEMO_1.issue.created_at),
      lastEvent,
      latest: lastEvent,
      clock: CLOCK,
      width,
      allowCut: true,
    });
    expect(scale.cutAt).not.toBeNull();
    expect(scale.x(scale.t0)).toBe(PAD_X);
    expect(scale.x(scale.cutAt ?? 0)).toBeCloseTo(scale.mainEnd);
    expect(scale.mainEnd).toBe(width - PAD_X - STUB_W - CUT_GAP);
    const nowX = scale.x(CLOCK);
    expect(nowX).toBeGreaterThan(scale.mainEnd + CUT_GAP);
    expect(nowX).toBeLessThan(width - PAD_X);
    // The fifteen days of work take most of the width, not four per cent of it.
    expect(scale.x(lastEvent) - PAD_X).toBeGreaterThan(0.8 * (width - 2 * PAD_X));
  });

  it("never shortens open work: a month in development is the evidence", () => {
    const start = ms(IN_FLIGHT.issue.created_at);
    const lastEvent = ms("2026-10-01T09:00:00Z");
    expect(shouldCut(start, lastEvent, CLOCK)).toBe(true);
    const scale = timelineScale({ start, lastEvent, latest: start, clock: CLOCK, width: 600 });
    expect(scale.cutAt).toBeNull();
    expect(scale.t1).toBeCloseTo(CLOCK + (CLOCK - start) * 0.02);
    expect(scale.x(start + DAY)).toBeGreaterThan(scale.x(start));
  });
});
