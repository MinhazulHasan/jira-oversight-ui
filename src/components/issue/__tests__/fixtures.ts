import { issueTimelineSchema, rulesSchema, type IssueTimeline, type Rules } from "@/lib/api/schemas";

import demo1 from "../../../../docs/sample-responses/issue-DEMO-1.json";
import rules from "../../../../docs/sample-responses/rules.json";

/*
 * The contract's own sample responses (docs/sample-responses), parsed with
 * the contract's schemas, so a fixture that drifts from the contract fails
 * here first. DEMO-1 is the showcase: an estimate set late, a reopen and an
 * overrun.
 */

export const DEMO_1: IssueTimeline = issueTimelineSchema.parse(demo1);
export const RULES: Rules = rulesSchema.parse(rules);
export const PROCESS = RULES.process;
export const SYNCED_AT = DEMO_1.meta.last_synced_at;

/** A copy of DEMO-1 to change for one test. */
export function demo1With(change: (data: IssueTimeline) => void): IssueTimeline {
  const copy = structuredClone(DEMO_1);
  change(copy);
  return issueTimelineSchema.parse(copy);
}

/** An issue that went straight from To Do to Done, skipping development, and logged nothing. */
export const SKIPPER: IssueTimeline = demo1With((data) => {
  data.issue.key = "DEMO-3";
  data.issue.summary = "Tidy the release notes template";
  data.issue.started_at = null;
  data.issue.cycle_time_h = null;
  data.issue.time_spent_h = null;
  data.issue.effort_ratio = 0;
  data.issue.reopen_count = 0;
  data.issue.estimate_set_at = "2025-11-10T09:12:00.000Z";
  data.intervals = [
    { status: "To Do", stage: "backlog", status_category: "new", entered_at: "2025-11-10T09:12:00.000Z", left_at: "2025-11-13T10:00:00.000Z", hours: 72.8 },
    { status: "Done", stage: "done", status_category: "done", entered_at: "2025-11-13T10:00:00.000Z", left_at: null, hours: null },
  ];
  data.skipped = [
    { changelog_id: "300101", changed_at: "2025-11-13T10:00:00.000Z", from: "To Do", to: "Done", skipped: ["development"] },
  ];
  data.changes = [
    { changelog_id: "300101", changed_at: "2025-11-13T10:00:00.000Z", kind: "status", field: "status", from: "To Do", to: "Done" },
  ];
  data.worklogs = [];
  data.findings = [];
});

/** Work in progress: still in development now, with time logged in three weeks out of five. */
export const IN_FLIGHT: IssueTimeline = demo1With((data) => {
  data.issue.key = "DEMO-1016";
  data.issue.status = "In Progress";
  data.issue.status_category = "indeterminate";
  data.issue.stage = "development";
  data.issue.resolved_at = null;
  data.issue.cycle_time_h = null;
  data.issue.reopen_count = 0;
  data.issue.estimate_set_at = "2026-09-28T09:00:00.000Z";
  data.issue.started_at = "2026-10-01T09:00:00.000Z";
  data.issue.created_at = "2026-09-28T09:00:00.000Z";
  data.intervals = [
    { status: "To Do", stage: "backlog", status_category: "new", entered_at: "2026-09-28T09:00:00.000Z", left_at: "2026-10-01T09:00:00.000Z", hours: 72 },
    { status: "In Progress", stage: "development", status_category: "indeterminate", entered_at: "2026-10-01T09:00:00.000Z", left_at: null, hours: null },
  ];
  data.skipped = [];
  data.changes = [
    { changelog_id: "500001", changed_at: "2026-10-01T09:00:00.000Z", kind: "status", field: "status", from: "To Do", to: "In Progress" },
  ];
  data.worklogs = [
    { week: "2026-09-28", hours: 6 },
    { week: "2026-10-12", hours: 12.5 },
    { week: "2026-10-26", hours: 4 },
  ];
  data.findings = [];
});
