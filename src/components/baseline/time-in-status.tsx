"use client";

import { ChartFrame } from "@/components/charts/chart-frame";
import type { ChartTableData } from "@/components/charts/chart-table";
import { Legend } from "@/components/charts/legend";
import { MEASURE_COLOURS } from "@/components/charts/palette";
import { RangeBars, type RangeRow } from "@/components/charts/range-bars";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount, formatHours } from "@/lib/format";

import { stageName } from "./labels";

const ROW = 44;

const LEGEND = [
  { id: "median", label: "Median", colour: MEASURE_COLOURS.median },
  { id: "p75", label: "75th percentile", colour: MEASURE_COLOURS.p75 },
  { id: "p90", label: "90th percentile", colour: MEASURE_COLOURS.p90 },
];

/** Statuses with a full spread become rows; the rest are named in a footnote rather than drawn as zero. */
export function timeInStatusRows(timeInStatus: Baseline["figures"]["time_in_status"]): {
  rows: RangeRow[];
  thin: string[];
} {
  const rows: RangeRow[] = [];
  const thin: string[] = [];
  for (const [status, spread] of Object.entries(timeInStatus)) {
    if (spread.median === null || spread.p75 === null || spread.p90 === null) {
      thin.push(status);
      continue;
    }
    rows.push({
      id: status,
      label: status,
      detail: spread.stage ? stageName(spread.stage) : "Not mapped to a stage",
      count: spread.n,
      median: spread.median,
      p75: spread.p75,
      p90: spread.p90,
    });
  }
  return { rows, thin };
}

function tableOf(rows: readonly RangeRow[], locale?: string): ChartTableData {
  return {
    columns: [
      { header: "Status" },
      { header: "Stage" },
      { header: "Intervals", numeric: true },
      { header: "Median", numeric: true },
      { header: "75th percentile", numeric: true },
      { header: "90th percentile", numeric: true },
    ],
    rows: rows.map((row) => [
      row.label,
      row.detail ?? "",
      formatCount(row.count, { locale }),
      formatHours(row.median, { locale }),
      formatHours(row.p75, { locale }),
      formatHours(row.p90, { locale }),
    ]),
  };
}

/** How long work sits in each status, on one shared scale, in the order of the agreed process. */
export function TimeInStatusBlock({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  const { rows, thin } = data ? timeInStatusRows(data.figures.time_in_status) : { rows: [], thin: [] };
  const longest = [...rows].sort((a, b) => b.median - a.median)[0];
  const state = !data ? "loading" : rows.length === 0 ? "empty" : "ready";

  return (
    <Section
      id="time-in-status"
      title="Time in status"
      description="Calendar hours per stay in each status, on resolved work."
    >
      <ChartFrame
        title="Hours in each status"
        description="Median, 75th and 90th percentile per interval"
        summary={
          longest
            ? `Work sits longest in ${longest.label}: median ${formatHours(longest.median, { locale })}.`
            : "No time in status to show."
        }
        legend={<Legend items={LEGEND} />}
        table={rows.length > 0 ? tableOf(rows, locale) : undefined}
        state={state}
        loadingShape="bars"
        emptyTitle="No time in status to show"
        emptyDescription="Not enough status history to measure."
        height={state === "loading" ? 3 * ROW + 28 : Math.max(1, rows.length) * ROW + 28}
        footnote={
          thin.length > 0
            ? `Too few intervals to measure: ${thin.join(", ")}.`
            : "An interval is one stay in a status."
        }
      >
        <RangeBars rows={rows} title="Hours in each status" />
      </ChartFrame>
    </Section>
  );
}
