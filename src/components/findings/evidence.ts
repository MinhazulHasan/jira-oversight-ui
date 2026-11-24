import { STAGE_LABELS, STAGES, type Stage } from "@/components/charts/palette";
import type { TimelineInterval, TimelineLane } from "@/components/charts/status-timeline";
import type { EvidenceItem, Finding, Interval, StatusCategory, ValueUnit } from "@/lib/api/schemas";
import { formatByKind } from "@/lib/format";

/* ------------------------------------------------------------- values -- */

export function evidenceText(item: EvidenceItem, locale?: string): { text: string; none: boolean } {
  if (item.value === null || item.value === "") return { text: "None", none: true };
  if (typeof item.value === "number") {
    return { text: formatByKind(item.value, item.unit ?? "number", { locale }), none: false };
  }
  return { text: item.value, none: false };
}

/** How a threshold names the unit it is measured in. */
const THRESHOLD_UNITS: readonly (readonly [ValueUnit, RegExp])[] = [
  ["ratio", /×/],
  ["share", /%/],
  ["days", /\bdays?\b/i],
  ["hours", /\d\s*h\b/],
];

export function turnsOn(finding: Pick<Finding, "threshold" | "evidence">, item: EvidenceItem): boolean {
  if (item.kind !== "metric") return false;
  if (item.value === null) return true;
  if (finding.threshold === null || item.unit === null) return false;
  const pattern = THRESHOLD_UNITS.find(([unit]) => unit === item.unit)?.[1];
  if (!pattern?.test(finding.threshold)) return false;
  return finding.evidence.filter((other) => other.kind === "metric" && other.unit === item.unit).length === 1;
}

/* ---------------------------------------------------------- changelog -- */

export interface ChangelogRow {
  id: string;
  at: string | null;
  /** What the change was, in the rule's words: "Work started". */
  label: string;
  kind: "status_change" | "field_change";
  from: string | null;
  to: string | null;
  /** The value as text when the change carries no before and after. */
  value: string | null;
  changelogId: string;
}

/** The Jira changelog entries the rule read, oldest first. */
export function changelogRows(evidence: readonly EvidenceItem[]): ChangelogRow[] {
  const rows: ChangelogRow[] = [];
  evidence.forEach((item, index) => {
    if (item.changelog_id === null) return;
    if (item.kind !== "status_change" && item.kind !== "field_change") return;
    rows.push({
      id: `${item.changelog_id}-${index}`,
      at: item.at,
      label: item.label,
      kind: item.kind,
      from: item.from,
      to: item.to,
      value: typeof item.value === "string" ? item.value : item.value === null ? null : String(item.value),
      changelogId: item.changelog_id,
    });
  });
  return rows.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/* ----------------------------------------------------------- timeline -- */

/** Where a status the process does not map sits: coloured by its Jira category. */
const CATEGORY_STAGE: Record<StatusCategory, Stage> = {
  new: "backlog",
  indeterminate: "development",
  done: "done",
};

const UNMAPPED = "status:";

export interface TimelineModel {
  lanes: TimelineLane[];
  intervals: TimelineInterval[];
}

export function timelineModel(intervals: readonly Interval[]): TimelineModel {
  const laneId = (interval: Interval) => interval.stage ?? `${UNMAPPED}${interval.status}`;
  const lanes = new Map<string, TimelineLane>();
  for (const interval of intervals) {
    const id = laneId(interval);
    if (lanes.has(id)) continue;
    lanes.set(
      id,
      interval.stage
        ? { id, label: STAGE_LABELS[interval.stage], stage: interval.stage }
        : { id, label: interval.status, stage: CATEGORY_STAGE[interval.status_category], detail: "Not mapped to a stage" },
    );
  }
  const rank = (lane: TimelineLane) => STAGES.indexOf(lane.stage) + (lane.id.startsWith(UNMAPPED) ? 0.5 : 0);
  return {
    lanes: [...lanes.values()].sort((a, b) => rank(a) - rank(b)),
    intervals: intervals.map((interval, index) => ({
      id: `spell-${index}`,
      lane: laneId(interval),
      status: interval.status,
      start: interval.entered_at,
      end: interval.left_at,
    })),
  };
}
