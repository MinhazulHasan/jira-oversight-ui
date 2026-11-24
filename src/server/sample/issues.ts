import type { IssueTimeline } from "@/lib/api/schemas";

import { effortThreshold } from "./board-rules";
import { STATUS } from "./catalogue";
import { meta, type Dataset } from "./dataset";
import { findingsOfIssue, intervalsOf } from "./findings";
import { round4, round4OrNull } from "./stats";
import { personOf } from "./team";
import { iso, isoDay, mondayUtc } from "./time";

type Change = IssueTimeline["changes"][number];

export function issueTimeline(dataset: Dataset, key: string): IssueTimeline | null {
  const issue = dataset.world.byKey.get(key);
  if (!issue) return null;
  const epic = issue.epicKey ? (dataset.world.byKey.get(issue.epicKey) ?? null) : null;

  const changes: (Change & { at: number })[] = [
    ...issue.statusChanges.map((change) => ({
      at: change.at,
      changelog_id: change.id,
      changed_at: iso(change.at),
      kind: "status" as const,
      field: "status",
      from: change.from,
      to: change.to,
    })),
    ...issue.fieldChanges.map((change) => ({
      at: change.at,
      changelog_id: change.id,
      changed_at: iso(change.at),
      kind: "field" as const,
      field: change.field,
      from: change.from,
      to: change.to,
    })),
  ].sort((a, b) => a.at - b.at || Number(a.changelog_id) - Number(b.changelog_id));

  const weekly = new Map<number, number>();
  for (const log of issue.worklogs) {
    const week = mondayUtc(log.at);
    weekly.set(week, (weekly.get(week) ?? 0) + log.seconds);
  }

  return {
    meta: meta(dataset),
    issue: {
      key: issue.key,
      summary: issue.summary,
      type: issue.type,
      status: issue.status,
      status_category: STATUS[issue.status].category,
      stage: STATUS[issue.status].stage,
      epic: epic ? { key: epic.key, title: epic.summary } : null,
      assignee: personOf(issue),
      created_at: iso(issue.createdAt),
      resolved_at: issue.resolvedAt === null ? null : iso(issue.resolvedAt),
      story_points: issue.storyPoints,
      time_spent_h: issue.timeSpentS > 0 ? round4(issue.timeSpentS / 3600) : null,
      estimate_basis: (issue.storyPoints ?? 0) > 0 ? "points" : "none",
      estimate_set_at: issue.estimateSetAt === null ? null : iso(issue.estimateSetAt),
      started_at: issue.startedAt === null ? null : iso(issue.startedAt),
      effort_ratio: round4OrNull(issue.effortRatio),
      // R-EFF-01's threshold on the board, to draw the ratio against.
      effort_threshold: effortThreshold(dataset.rules),
      cycle_time_h: round4OrNull(issue.cycleTimeH),
      reopen_count: issue.reopenCount,
      url: null,
    },
    intervals: intervalsOf(issue),
    skipped: issue.skips.map(({ change, skipped }) => ({
      changelog_id: change.id,
      changed_at: iso(change.at),
      from: change.from,
      to: change.to,
      skipped,
    })),
    changes: changes.map(({ at: _at, ...change }) => change),
    worklogs: [...weekly.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, seconds]) => ({ week: isoDay(week), hours: round4(seconds / 3600) })),
    findings: findingsOfIssue(dataset, issue.key),
  };
}
