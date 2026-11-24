
/** Categorical identity, in fixed order. A seventh series is "Other", never a new hue. */
export const SERIES_COLOURS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
] as const;

export const OTHER_COLOUR = "var(--series-other)";

export function seriesColour(slot: number): string {
  return SERIES_COLOURS[slot] ?? OTHER_COLOUR;
}

/** James's process, in order. */
export const STAGES = [
  "backlog",
  "estimate",
  "development",
  "code_review",
  "dev_signoff",
  "testing",
  "test_review",
  "test_signoff",
  "done",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  backlog: "Backlog",
  estimate: "Estimate",
  development: "Development",
  code_review: "Code review",
  dev_signoff: "Dev sign-off",
  testing: "Testing",
  test_review: "Test review",
  test_signoff: "Test sign-off",
  done: "Done",
};

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

/** The ordinal step for a stage: palest at backlog, deepest at done (turned round in dark). */
export function stageColour(stage: Stage): string {
  return `var(--stage-${stage.replaceAll("_", "-")})`;
}

/** Status marks inside charts. Warning is the chart's re-stepped amber. */
export const STATUS_COLOURS = {
  breach: "var(--chart-breach)",
  warning: "var(--chart-warn)",
  resolved: "var(--chart-ok)",
} as const;

/** Median, 75th and 90th percentile: three steps of the stage ramp, the median deepest. */
export const MEASURE_COLOURS = {
  median: "var(--measure-median)",
  p75: "var(--measure-p75)",
  p90: "var(--measure-p90)",
} as const;
