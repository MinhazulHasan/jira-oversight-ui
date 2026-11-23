import { describe, expect, it } from "vitest";

import { formatHours, formatRatio } from "@/lib/format";

import { axisHours, axisRatio, niceScale, weekTicks } from "../scale";
import { sparklinePoints, sparklineSummary } from "../sparkline";
import { clearLabelSpot, thresholdLabelBox, thresholdLabelWidth, thresholdPlacement, trendTable, type TrendRow } from "../trend-line";

describe("niceScale", () => {
  it("ticks on round steps around the data, never on its extremes", () => {
    expect(niceScale(1.12, 1.51)).toEqual({ min: 1.1, max: 1.6, step: 0.1, ticks: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6] });
    expect(niceScale(37.9, 47.5)).toEqual({ min: 35, max: 50, step: 5, ticks: [35, 40, 45, 50] });
  });

  it("keeps zero on a count axis", () => {
    const scale = niceScale(2, 12, { zero: true });
    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(12);
    expect(scale.ticks.length).toBeLessThanOrEqual(6);
  });

  it("copes with a flat series and with nothing at all", () => {
    const flat = niceScale(4, 4);
    expect(flat.min).toBeLessThan(4);
    expect(flat.max).toBeGreaterThan(4);
    expect(niceScale(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY).ticks).toEqual([0, 1]);
  });
});

describe("weekTicks", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ week: `w${index + 1}` }));

  it("always names the latest week, counting back in even steps", () => {
    expect(weekTicks(rows, 4)).toEqual(["w3", "w6", "w9", "w12"]);
    expect(weekTicks(rows, 12)).toHaveLength(12);
    expect(weekTicks([], 4)).toEqual([]);
  });
});

describe("axis formats", () => {
  it("carry the precision of their step", () => {
    expect(axisHours(35, { locale: "en-GB", step: 5 })).toBe("35 h");
    expect(axisHours(2.5, { locale: "en-GB", step: 0.5 })).toBe("2.5 h");
    expect(axisRatio(1.2, { locale: "en-GB", step: 0.1 })).toBe("1.2×");
    expect(axisRatio(1.25, { locale: "en-GB" })).toBe("1.25×");
  });
});

describe("sparkline", () => {
  it("places points across the width and leaves a gap where nothing was measured", () => {
    const points = sparklinePoints([1, null, 3], 32);
    expect(points[0]).toEqual({ x: 0, y: 28 });
    expect(points[1]).toBeNull();
    expect(points[2]).toEqual({ x: 100, y: 4 });
  });

  it("sits a flat series in the middle", () => {
    expect(sparklinePoints([5, 5], 32).map((point) => point?.y)).toEqual([16, 16]);
  });

  it("summarises the line in words", () => {
    const read = (value: number) => formatHours(value, { locale: "en-GB" });
    expect(sparklineSummary("Median cycle time", [46.2, null, 38.2], read, "last 12 weeks")).toBe(
      "Median cycle time, last 12 weeks: from 46.2 h to 38.2 h, between 38.2 h and 46.2 h",
    );
    expect(sparklineSummary("Open breaches", [null], read)).toBe("Open breaches: no values");
  });
});

describe("trend helpers", () => {
  const rising: TrendRow[] = [
    { week: "2026-10-12", ratio: 1.12 },
    { week: "2026-10-19", ratio: 1.2 },
    { week: "2026-10-26", ratio: null },
    { week: "2026-11-02", ratio: 1.51 },
  ];

  it("names a threshold where the data runs furthest from it, on the other side", () => {
    expect(thresholdPlacement(rising, [{ key: "ratio", label: "Ratio" }], 1.5)).toEqual({ end: "start", above: true });
    const falling = [...rising].reverse();
    expect(thresholdPlacement(falling, [{ key: "ratio", label: "Ratio" }], 1.5)).toEqual({ end: "end", above: true });
  });

  describe("the threshold's name, placed as drawn (JO-14)", () => {
    // The Overview's effort ratio at 390 px: a plot 236 px wide, the rule at y 60, the name about 150 px long.
    const plot = { x: 40, y: 12, width: 236, height: 180 };
    const label = "Breach at 1.50× (R-EFF-01)";
    const width = thresholdLabelWidth(label);

    it("keeps the suggested spot when its line stays clear of the name", () => {
      const low = [[{ x: 40, y: 150 }, { x: 158, y: 140 }, { x: 276, y: 120 }]];
      expect(clearLabelSpot({ end: "start", above: true }, low, plot, 60, width)).toEqual({ end: "start", above: true });
    });

    it("moves the name off a line that runs through it: the peak under a narrow plot's long label", () => {
      // Regression: the peak ran through the end of the name, its closing parenthesis, at 390 px.
      const peak = [[{ x: 40, y: 150 }, { x: 50, y: 150 }, { x: 70, y: 45 }, { x: 90, y: 150 }, { x: 276, y: 150 }]];
      const suggested = { end: "start" as const, above: true };
      expect(thresholdLabelBox(suggested, plot, 60, width).left).toBeLessThan(70);
      // Through the start's spots, above and below the rule: the name goes to the other end, the side suggested.
      const spot = clearLabelSpot(suggested, peak, plot, 60, width);
      expect(spot).toEqual({ end: "end", above: true });
      // Wherever it goes, no segment of the line passes through its box.
      const moved = thresholdLabelBox(spot!, plot, 60, width);
      const line = peak[0];
      for (let i = 1; i < line.length; i += 1) {
        for (let t = 0; t <= 1; t += 0.01) {
          const x = line[i - 1].x + (line[i].x - line[i - 1].x) * t;
          const y = line[i - 1].y + (line[i].y - line[i - 1].y) * t;
          expect(x >= moved.left && x <= moved.right && y >= moved.top && y <= moved.bottom, `${x}, ${y}`).toBe(false);
        }
      }
    });

    it("passes over a spot whose name would leave the plot, and keeps the suggestion when nothing is clear", () => {
      // The rule near the plot's top: no room above it, so under it, at the same end.
      const flat = [[{ x: 40, y: 90 }, { x: 276, y: 90 }]];
      expect(clearLabelSpot({ end: "end", above: true }, flat, plot, 20, width)).toEqual({ end: "end", above: false });
      // A line through every spot: none is clear, and the caller says what stands.
      const everywhere = [[{ x: 40, y: 50 }, { x: 276, y: 50 }], [{ x: 40, y: 72 }, { x: 276, y: 72 }]];
      expect(clearLabelSpot({ end: "start", above: true }, everywhere, plot, 60, width)).toBeNull();
    });

    it("finds room for the name in two lines where one has none: the Overview's effort ratio on a phone", () => {
      // As drawn at 390 px: a plot 185 px wide, the rule at 48.6, the line low but for a peak through it near the end.
      const phone = { x: 37, y: 12, width: 185, height: 180 };
      const line = [[
        { x: 43, y: 105.8 }, { x: 74.5, y: 104.5 }, { x: 105.9, y: 113.4 }, { x: 137.4, y: 91.3 }, { x: 153.1, y: 107.7 },
        { x: 168.8, y: 91.8 }, { x: 184.5, y: 34 }, { x: 200.3, y: 63.1 }, { x: 216, y: 76.2 },
      ]];
      expect(clearLabelSpot({ end: "start", above: true }, line, phone, 48.6, width)).toBeNull();
      const lines = ["Breach at 1.50×", "(R-EFF-01)"];
      const twoWide = Math.max(...lines.map(thresholdLabelWidth));
      expect(clearLabelSpot({ end: "start", above: true }, line, phone, 48.6, twoWide, 2)).toEqual({ end: "start", above: true });
      // Two lines above the rule end where one would: the last 7 px over it.
      expect(thresholdLabelBox({ end: "start", above: true }, phone, 48.6, twoWide, 2).bottom).toBe(thresholdLabelBox({ end: "start", above: true }, phone, 48.6, twoWide).bottom);
    });
  });

  it("writes the figures behind a trend as a table, with a dash where a week has none", () => {
    const table = trendTable(rising, [{ key: "ratio", label: "Median effort ratio" }], { format: formatRatio, locale: "en-GB" });
    expect(table.columns).toEqual([{ header: "Week of" }, { header: "Median effort ratio", numeric: true }]);
    expect(table.rows[0]).toEqual(["12 Oct 2026", "1.12×"]);
    expect(table.rows[2]).toEqual(["26 Oct 2026", "—"]);
  });
});
