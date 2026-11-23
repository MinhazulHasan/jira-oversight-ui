import { isStage, STAGE_LABELS } from "@/components/charts/palette";
import { axisHours, axisRatio, axisShare, type AxisFormat } from "@/components/charts/scale";
import type { FigureFormat } from "@/components/charts/sparkline";
import type { TrendRow } from "@/components/charts/trend-line";
import { signed } from "@/components/ui/stat-tile";
import type { CoverageEntry, Overview, TrendCard, ValueUnit } from "@/lib/api/schemas";
import { formatByKind, formatCount, formatDelta, formatNumber } from "@/lib/format";

/*
 * The Overview's words and the small pieces of arithmetic behind them, kept
 * apart from the markup so they can be tested and read in one place.
 */

/** "1 rule", "12 rules", with the count formatted for the reader. */
export function counted(count: number, singular: string, plural: string, locale?: string): string {
  return `${formatCount(count, { locale })} ${count === 1 ? singular : plural}`;
}

/** "a", "a and b", "a, b and c" (UK style, no serial comma). */
export function listWords(words: readonly string[], conjunction: "and" | "or" = "and"): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words[words.length - 1]}`;
}

/** An evidence source or workflow stage as a reader says it mid-sentence: "code review", "testing". */
export function evidenceName(value: string): string {
  const label = isStage(value) ? STAGE_LABELS[value] : value.replaceAll("_", " ");
  return label.toLowerCase();
}

/**
 * What a rule cannot see: "No code review or testing in Jira". Where Jira is
 * already the subject (the "Rules not measurable" tile), `inJira: false`
 * keeps it to one line: "No code review or testing".
 */
export function missingEvidenceText(missing: readonly string[], { inJira = true }: { inJira?: boolean } = {}): string {
  const names = [...new Set(missing.map(evidenceName))];
  if (names.length === 0) return "Jira holds no evidence for it";
  return `No ${listWords(names, "or")}${inJira ? " in Jira" : ""}`;
}

/** The rules Jira cannot evaluate, in catalogue order, and everything they lack between them. */
export function notMeasurable(byRule: Overview["by_rule"]): { ids: string[]; missing: string[] } {
  const rules = byRule.filter((rule) => !rule.measurable);
  return { ids: rules.map((rule) => rule.rule_id), missing: [...new Set(rules.flatMap((rule) => rule.missing_evidence))] };
}

/* -------------------------------------------------------------- coverage -- */

export type CoverageKey = keyof Overview["coverage"];

/** Process order: what the work should carry, then the evidence of the steps it went through. */
export const COVERAGE_KEYS: readonly CoverageKey[] = ["estimate", "story_points", "time_logged", "code_review", "test_evidence"];

export const COVERAGE_LABEL: Record<CoverageKey, string> = {
  estimate: "Estimates",
  story_points: "Story points",
  time_logged: "Time logged",
  code_review: "Code review",
  test_evidence: "Test evidence",
};

/** Countable only when the service says so and gives a count. */
export function isCountable(entry: CoverageEntry): entry is CoverageEntry & { covered: number } {
  return entry.measurable && entry.covered !== null;
}

/** Why a coverage entry cannot be counted: the note's first clause, "Jira records no code review for DEMO, so it cannot be counted." */
export function coverageReason(entry: CoverageEntry): string {
  const first = entry.note.split(";")[0]?.trim() ?? "";
  if (!first) return "Jira holds no evidence for this step.";
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/* ---------------------------------------------------------------- trends -- */

export type TrendKey = keyof Overview["trend_cards"];

export const TREND_KEYS: readonly TrendKey[] = [
  "median_cycle_time_h",
  "median_effort_ratio",
  "skipped_stage_share",
  "reopen_rate",
];

/** What each weekly figure is, in one line (docs/API_CONTRACT.md 4.8). */
export const TREND_DESCRIPTION: Record<TrendKey, string> = {
  median_cycle_time_h: "Development start to Done, weekly median",
  median_effort_ratio: "Logged over estimated hours, weekly median",
  skipped_stage_share: "Share of the work finished each week that skipped a stage",
  reopen_rate: "Share of the work finished each week that had been reopened",
};

/** R-EFF-01 breaches when logged time reaches this multiple of the estimate (rules.yaml). */
export const EFFORT_RATIO_BREACH = 1.5;

/** A change in a share, in percentage points: "5 pts", never a bare "5%" that reads as relative. */
export const formatPoints: FigureFormat = (value, { locale }) => {
  const points = value * 100;
  const unit = Math.abs(Math.round(points)) === 1 ? "pt" : "pts";
  return `${formatNumber(points, { locale, decimals: 0 })} ${unit}`;
};

/** How a value in this unit reads: "113.4 h", "1.27×", "16%". */
export function unitFormat(unit: ValueUnit): FigureFormat {
  return (value, { locale }) => formatByKind(value, unit, { locale });
}

/** How a week-on-week change in this unit reads: "−30.2 h", "+0.05×", "−5 pts", "+3". */
export function unitDeltaFormat(unit: ValueUnit): FigureFormat {
  if (unit === "count") return formatDelta;
  if (unit === "share") return signed(formatPoints);
  return signed(unitFormat(unit));
}

/** Axis ticks to the step's precision. */
export function unitAxis(unit: ValueUnit): AxisFormat | undefined {
  if (unit === "hours") return axisHours;
  if (unit === "ratio") return axisRatio;
  if (unit === "share") return axisShare;
  return undefined;
}

/** The change since the week before, or null when either week has nothing to measure. */
export function weekOnWeek(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

/** A trend card's points as TrendLine rows: one series, keyed "value". */
export function trendRows(card: TrendCard): TrendRow[] {
  return card.points.map((point) => ({ week: point.t, value: point.value }));
}
