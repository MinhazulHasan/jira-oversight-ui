import type { EvidenceItem } from "@/lib/api/schemas";

import { HISTORY_DAYS, MIN_HISTORY, type StatusName } from "./catalogue";
import { percentile, round1, round2, round4 } from "./stats";
import { DAY, HOUR } from "./time";
import { workItems, type Issue, type IssueInterval, type StatusChange, type World } from "./world";

/** A status's percentile of time, measured on closed work: what "slower than usual" is judged against. */
export interface Threshold {
  hours: number;
  n: number;
}

/**
 * The `pct` percentile of the time finished work spent in each open status over the last 180 days, measured on
 * closed intervals; a status with too little history has none, and its warning stays silent, as the live engine's.
 */
export function stuckThresholds(world: World, pct: number): Map<StatusName, Threshold> {
  const thresholds = new Map<StatusName, Threshold>();
  const since = world.syncAt - HISTORY_DAYS * DAY;
  for (const status of ["To Do", "In Progress"] as const) {
    const closed = workItems(world)
      .flatMap((issue) => issue.intervals)
      .filter((interval) => interval.status === status && interval.leftAt !== null && interval.leftAt > since)
      .map((interval) => hours(interval.enteredAt, interval.leftAt!));
    const value = percentile(closed, pct);
    if (value !== null && closed.length >= MIN_HISTORY) thresholds.set(status, { hours: value, n: closed.length });
  }
  return thresholds;
}

/*
 * What a finding shows as its evidence, the way rules/checks.py writes it:
 * a metric, a status change, the status an issue was created in, and the
 * moment work started. Shared by the catalogue's rules (engine.ts) and a
 * board's own (custom-checks.ts, JO-20), so a finding reads alike whichever
 * kind of rule raised it.
 */

export const hours = (from: number, to: number) => (to - from) / HOUR;
export const fixed1 = (value: number) => round1(value).toFixed(1);
export const fixed2 = (value: number) => round2(value).toFixed(2);

/**
 * A length of time in a finding's message, as the service says it (rules/checks.py `_duration`): in days with one
 * decimal from 48 hours, else in hours with one decimal ("15.0 days", "26.4 h").
 */
export const duration = (value: number) => (value >= 48 ? `${(value / 24).toFixed(1)} days` : `${value.toFixed(1)} h`);

export function metric(label: string, value: number | string | null, unit: EvidenceItem["unit"]): EvidenceItem {
  return {
    kind: "metric",
    label,
    value: typeof value === "number" ? round4(value) : value,
    unit,
    from: null,
    to: null,
    at: null,
    changelog_id: null,
  };
}

export function statusEvidence(label: string, change: StatusChange): EvidenceItem {
  return {
    kind: "status_change",
    label,
    value: `${change.from} → ${change.to}`,
    unit: null,
    from: change.from,
    to: change.to,
    at: new Date(change.at).toISOString(),
    changelog_id: change.id,
  };
}

export function enteredEvidence(issue: Issue, interval: IssueInterval): EvidenceItem {
  if (interval.enteredBy) return statusEvidence(`Moved to ${interval.status}`, interval.enteredBy);
  return {
    kind: "status_change",
    label: `Created in ${interval.status}`,
    value: interval.status,
    unit: null,
    from: null,
    to: interval.status,
    at: new Date(issue.createdAt).toISOString(),
    changelog_id: null,
  };
}

/** The status interval an issue was in at a moment. */
export function intervalAt(issue: Issue, at: number): IssueInterval {
  let found = issue.intervals[0];
  for (const interval of issue.intervals) if (interval.enteredAt <= at) found = interval;
  return found;
}

/** The change that started work (the first move to In Progress), or a metric saying none is known. */
export function workStarted(issue: Issue): EvidenceItem {
  const change = issue.statusChanges.find((candidate) => candidate.to === "In Progress");
  return change ? statusEvidence("Work started", change) : metric("Work started", null, null);
}
