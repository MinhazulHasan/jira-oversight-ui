import type { ChartTableData } from "@/components/charts/chart-table";
import { STAGE_LABELS, STAGES, type Stage } from "@/components/charts/palette";
import { formatDate, formatDateTime, formatHours, MISSING } from "@/lib/format";

import { fieldLabel, ms, type IssueData, type ProcessMap } from "./model";

export const UNMAPPED_LANE = "unmapped";
const HOUR = 3_600_000;

export interface IssueLane {
  id: string;
  label: string;
  /** The stage, which colours the bars; null for statuses the process does not map. */
  stage: Stage | null;
  /** A second line: the statuses or the field that record the stage. */
  detail?: string;
  /** False when Jira records nothing for the stage: the lane is hatched. */
  measurable?: boolean;
}

export interface IssueSpell {
  id: string;
  lane: string;
  status: string;
  start: string;
  /** null while the issue is still in this status. */
  end: string | null;
  /** The status change that began the spell. */
  changelogId?: string;
}

export interface IssueSkip {
  id: string;
  at: string;
  from: string;
  to: string;
  skipped: string[];
  fromStatus: string;
  toStatus: string;
  changelogId: string;
}

/** A field change drawn as a point on its lane: the estimate set, changed or cleared. */
export interface IssueEvent {
  id: string;
  lane: string;
  at: string;
  label: string;
  value: string;
  changelogId: string;
}

export interface TimelineModel {
  lanes: IssueLane[];
  spells: IssueSpell[];
  skips: IssueSkip[];
  events: IssueEvent[];
}

const ESTIMATE_FIELDS = new Set(["story_points", "original_estimate"]);

function buildLanes(data: IssueData, process: ProcessMap | null): IssueLane[] {
  const seen = new Map<Stage, Set<string>>();
  for (const interval of data.intervals) {
    if (interval.stage === null) continue;
    seen.set(interval.stage, (seen.get(interval.stage) ?? new Set()).add(interval.status));
  }
  const statusesIn = (stage: Stage) => [...(seen.get(stage) ?? [])].join(", ") || undefined;

  const lanes: IssueLane[] = process
    ? process.stages.map((stage) => ({
        id: stage.stage,
        label: stage.label,
        stage: stage.stage,
        detail:
          stage.evidence === "status"
            ? stage.mapped_statuses.join(", ") || statusesIn(stage.stage)
            : stage.evidence === "field" && stage.stage === "estimate"
              ? fieldLabel(process.estimate.basis === "points" ? "story_points" : "original_estimate")
              : stage.evidence === "field"
                ? "Recorded in a field"
                : undefined,
        measurable: stage.measurable,
      }))
    : STAGES.map((stage) => ({ id: stage, label: STAGE_LABELS[stage], stage, detail: statusesIn(stage) }));

  // A stage the issue sat in but the process map leaves out still gets its lane, in process order.
  for (const stage of seen.keys()) {
    if (lanes.some((lane) => lane.id === stage)) continue;
    const order = STAGES.indexOf(stage);
    const at = lanes.findIndex((lane) => lane.stage !== null && STAGES.indexOf(lane.stage) > order);
    lanes.splice(at < 0 ? lanes.length : at, 0, { id: stage, label: STAGE_LABELS[stage], stage, detail: statusesIn(stage) });
  }

  const unmapped = [...new Set(data.intervals.filter((interval) => interval.stage === null).map((i) => i.status))];
  if (unmapped.length > 0) {
    lanes.push({ id: UNMAPPED_LANE, label: "Not mapped", stage: null, detail: unmapped.join(", ") });
  }
  return lanes;
}

/** Lanes, spells, skips and estimate events for the swimlane chart. */
export function buildTimeline(data: IssueData, process: ProcessMap | null): TimelineModel {
  const lanes = buildLanes(data, process);
  const laneIds = new Set(lanes.map((lane) => lane.id));
  const statusChanges = data.changes.filter((change) => change.kind === "status");

  const spells: IssueSpell[] = data.intervals.map((interval, index) => ({
    id: `spell-${index}`,
    lane: interval.stage ?? UNMAPPED_LANE,
    status: interval.status,
    start: interval.entered_at,
    end: interval.left_at,
    changelogId: statusChanges.find(
      (change) => change.to === interval.status && ms(change.changed_at) === ms(interval.entered_at),
    )?.changelog_id,
  }));

  const laneOfStatus = new Map<string, string>();
  for (const stage of process?.stages ?? []) {
    for (const status of stage.mapped_statuses) laneOfStatus.set(status, stage.stage);
  }
  for (const interval of data.intervals) laneOfStatus.set(interval.status, interval.stage ?? UNMAPPED_LANE);

  const skips: IssueSkip[] = [];
  for (const skip of data.skipped) {
    const from = laneOfStatus.get(skip.from);
    const to = laneOfStatus.get(skip.to);
    const skipped = skip.skipped.filter((stage) => laneIds.has(stage));
    if (!from || !to || skipped.length === 0) continue;
    skips.push({
      id: `skip-${skip.changelog_id}`,
      at: skip.changed_at,
      from,
      to,
      skipped,
      fromStatus: skip.from,
      toStatus: skip.to,
      changelogId: skip.changelog_id,
    });
  }

  const estimateLane = lanes.find((lane) => lane.id === "estimate" && lane.measurable !== false);
  const events: IssueEvent[] = estimateLane
    ? data.changes
        .filter((change) => change.kind === "field" && ESTIMATE_FIELDS.has(change.field))
        .map((change) => {
          const name = fieldLabel(change.field);
          const set = change.from === null || change.from === "";
          const cleared = change.to === null || change.to === "";
          return {
            id: `event-${change.changelog_id}`,
            lane: estimateLane.id,
            at: change.changed_at,
            label: set ? `${name} set` : cleared ? `${name} cleared` : `${name} changed`,
            value: set ? (change.to ?? "") : cleared ? (change.from ?? "") : `${change.from} → ${change.to}`,
            changelogId: change.changelog_id,
          };
        })
    : [];

  return { lanes, spells, skips, events };
}

/** The instants the axis is built from: the first spell, the last thing that happened, the latest closed end. */
export function timelineSpan(
  model: { spells: readonly IssueSpell[]; skips: readonly IssueSkip[]; events: readonly IssueEvent[] },
  clock: number,
) {
  const starts = model.spells.map((spell) => ms(spell.start));
  const ends = model.spells.flatMap((spell) => (spell.end ? [ms(spell.end)] : []));
  const start = Math.min(clock, ...starts);
  const moments = [...model.skips.map((skip) => ms(skip.at)), ...model.events.map((event) => ms(event.at))];
  return {
    start,
    lastEvent: Math.max(start, ...starts, ...ends, ...moments),
    latest: Math.max(start, ...ends),
  };
}

/** Hours in a spell, measured to `clock` while it is still open. */
export function spellHours(spell: Pick<IssueSpell, "start" | "end">, clock: number): number {
  return Math.max(0, ((spell.end === null ? clock : ms(spell.end)) - ms(spell.start)) / HOUR);
}

export function laneName(lanes: readonly IssueLane[], laneId: string): string {
  return lanes.find((lane) => lane.id === laneId)?.label ?? laneId;
}

/** The chart's table view: one row per spell, with the changelog entry that began it. */
export function timelineTable(model: TimelineModel, clock: number, locale?: string): ChartTableData {
  return {
    columns: [
      { header: "Status" },
      { header: "Stage" },
      { header: "Entered" },
      { header: "Left" },
      { header: "Hours", numeric: true },
      { header: "Changelog", numeric: true },
    ],
    rows: [...model.spells]
      .sort((a, b) => ms(a.start) - ms(b.start))
      .map((spell) => [
        spell.status,
        laneName(model.lanes, spell.lane),
        formatDateTime(spell.start, { locale }),
        spell.end ? formatDateTime(spell.end, { locale }) : "Still here",
        formatHours(spellHours(spell, clock), { locale }),
        spell.changelogId ?? MISSING,
      ]),
  };
}

/** One or two sentences that say what the chart shows, for screen readers. */
export function timelineSummary(key: string, model: TimelineModel, clock: number, locale?: string): string {
  const spells = [...model.spells].sort((a, b) => ms(a.start) - ms(b.start));
  if (spells.length === 0) return `${key} has no recorded statuses.`;
  const closed = spells.filter((spell) => spell.end !== null);
  const open = spells.find((spell) => spell.end === null);
  const parts = closed.map((spell) => `${spell.status} for ${formatHours(spellHours(spell, clock), { locale })}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const now = open ? `has been in ${open.status} since ${formatDate(open.start, { locale })}` : "";
  let text = list ? `${key} sat in ${list}${now ? `, and ${now}` : ""}.` : `${key} ${now}.`;
  for (const skip of model.skips) {
    const names = skip.skipped.map((id) => laneName(model.lanes, id)).join(", ");
    text += ` It went straight past ${names} on ${formatDate(skip.at, { locale })} (${skip.fromStatus} to ${skip.toStatus}).`;
  }
  const firstEstimate = model.events[0];
  if (firstEstimate) text += ` ${firstEstimate.label} on ${formatDate(firstEstimate.at, { locale })}.`;
  return text;
}
