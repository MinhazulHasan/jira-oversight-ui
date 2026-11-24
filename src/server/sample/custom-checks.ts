import { limitWords, unitWords } from "@/lib/api/custom-rules";
import { MISSING_FIELD_LABELS, type EvidenceItem, type MissingField } from "@/lib/api/schemas";

import type { BoardRule } from "./board-rules";
import { HOURS_PER_POINT, isWork, STATUS, type StatusName } from "./catalogue";
import { duration, enteredEvidence, fixed1, fixed2, hours, intervalAt, metric, statusEvidence, stuckThresholds, workStarted, type Threshold } from "./evidence";
import { DAY, HOUR, iso, spelledDay } from "./time";
import { loggedHoursAt, type Issue, type Sprint, type World } from "./world";

/** A condition a custom rule found on a ticket (or the active sprint), and what it says about it. */
export interface CustomHit {
  issue: Issue | null;
  sprint: Sprint | null;
  evidenceKey: string;
  describe: () => { message: string; threshold: string | null; evidence: EvidenceItem[] };
}

/** Finished work leaves the rules' scope this long after it was finished (rules.yaml `defaults.lookback_days`). */
const LOOKBACK_DAYS = 90;

/** A rule's params as its definition holds them: numbers, names and statuses. */
type Params = Readonly<Record<string, number | string | readonly string[]>>;

const numberParam = (params: Params, name: string) => Number(params[name]);

function namesParam(params: Params, name: string): string[] {
  const value = params[name];
  return Array.isArray(value) ? [...(value as readonly string[])] : typeof value === "string" ? [value] : [];
}

/** A status as an evidence key reads it: "in-progress". */
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function inScope(world: World, rule: BoardRule): Issue[] {
  const { statusCategory, issueType } = rule.def.appliesTo;
  const types = issueType === null ? null : new Set(issueType.map((type) => type.toLowerCase()));
  const lookback = world.syncAt - LOOKBACK_DAYS * DAY;
  return world.issues.filter((issue) => {
    if (types === null ? !isWork(issue) : !types.has(issue.type.toLowerCase())) return false;
    const category = STATUS[issue.status].category;
    if (!statusCategory.includes(category)) return false;
    return category !== "done" || issue.doneAt === null || issue.doneAt >= lookback;
  });
}

/** When anything last changed on the ticket in Jira, as `updated` says: a status, a field or a worklog, or its creation. */
function updatedAt(issue: Issue, at: number): number {
  const times = [
    issue.createdAt,
    ...issue.statusChanges.map((change) => change.at),
    ...issue.fieldChanges.map((change) => change.at),
    ...issue.worklogs.map((log) => log.at),
  ].filter((time) => time <= at);
  return Math.max(...times);
}

/** Whether the ticket has an estimate on the board's basis (story points) at a moment. */
const estimatedAt = (issue: Issue, at: number) => issue.storyPoints !== null && issue.estimateSetAt !== null && issue.estimateSetAt <= at;

function epicOf(world: World, issue: Issue): string | null {
  if (issue.epicKey) return issue.epicKey;
  const parent = issue.parentKey ? world.byKey.get(issue.parentKey) : undefined;
  return parent?.epicKey ?? null;
}

const MISSING_WORDS: Record<MissingField, string> = { assignee: "No assignee", estimate: "No estimate", epic: "No epic", sprint: "Not in a sprint" };

function missingField(world: World, issue: Issue, field: MissingField, at: number): boolean {
  switch (field) {
    case "assignee":
      return issue.assigneeAccountId === null;
    case "estimate":
      return !estimatedAt(issue, at);
    case "epic":
      return epicOf(world, issue) === null;
    case "sprint":
      return issue.sprintIds.length === 0;
  }
}

/** The status a stage maps on the board (DEMO: development is In Progress), or none. */
const statusesOfStage = (stage: string): StatusName[] =>
  (Object.values(STATUS) as { name: StatusName; stage: string }[]).filter((status) => status.stage === stage).map((status) => status.name);

/** A custom rule's hits on the board as of its last sync. A sprint's check looks at the active sprint only. */
export function customHits(world: World, rule: BoardRule): CustomHit[] {
  const at = world.syncAt;
  const { params, check } = rule.def;
  const threshold = rule.def.threshold;
  const hits: CustomHit[] = [];
  const hit = (issue: Issue, evidenceKey: string, message: string, evidence: EvidenceItem[]) =>
    hits.push({ issue, sprint: null, evidenceKey, describe: () => ({ message, threshold, evidence }) });

  if (check === "sprint_at_risk") return sprintAtRisk(world, rule);
  const percentiles = new Map<number, Map<StatusName, Threshold>>();
  const thresholdsAt = (pct: number) => {
    let known = percentiles.get(pct);
    if (!known) percentiles.set(pct, (known = stuckThresholds(world, pct)));
    return known;
  };

  for (const issue of inScope(world, rule)) {
    const interval = intervalAt(issue, at);
    const age = hours(interval.enteredAt, at);
    switch (check) {
      case "time_in_status_over": {
        const limit = numberParam(params, "hours");
        const named = namesParam(params, "statuses").find((status) => status.toLowerCase() === issue.status.toLowerCase());
        if (named && age > limit) {
          hit(issue, `in-status-${slug(issue.status)}`, `In '${issue.status}' for ${duration(age)}; the limit is ${limitWords(limit)}`, [
            enteredEvidence(issue, interval),
            metric("Time in status", age, "hours"),
            metric("Limit", limit, "hours"),
          ]);
        }
        break;
      }
      case "open_longer_than": {
        const limit = numberParam(params, "days");
        const open = (at - issue.createdAt) / DAY;
        if (open > limit) {
          hit(issue, "open-too-long", `Open for ${Math.floor(open)} days; the limit is ${unitWords("days", limit)}`, [
            { kind: "metric", label: "Created", value: spelledDay(issue.createdAt), unit: null, from: null, to: null, at: iso(issue.createdAt), changelog_id: null },
            metric("Open for", open, "days"),
            metric("Limit", limit, "days"),
          ]);
        }
        break;
      }
      case "no_update_for": {
        const limit = numberParam(params, "days");
        const last = updatedAt(issue, at);
        const quiet = (at - last) / DAY;
        if (quiet > limit) {
          hit(issue, "no-update", `No change in Jira for ${Math.floor(quiet)} days; the limit is ${unitWords("days", limit)}`, [
            { kind: "metric", label: "Last updated", value: spelledDay(last), unit: null, from: null, to: null, at: iso(last), changelog_id: null },
            metric("No change for", quiet, "days"),
            metric("Limit", limit, "days"),
          ]);
        }
        break;
      }
      case "missing_field": {
        const field = String(params.field) as MissingField;
        if (missingField(world, issue, field, at)) hit(issue, `missing-${field}`, MISSING_WORDS[field], [metric(MISSING_FIELD_LABELS[field], null, null)]);
        break;
      }
      case "missing_estimate": {
        const started = issue.startedAt;
        if (started !== null && started <= at && !estimatedAt(issue, at)) {
          hit(issue, "no-estimate", `Started on ${spelledDay(started)} with no estimate (story points)`, [workStarted(issue), metric("Story points", null, "points")]);
        }
        break;
      }
      case "estimate_after_start": {
        const started = issue.startedAt;
        const setAt = issue.estimateSetAt;
        const grace = numberParam(params, "grace_hours");
        if (started !== null && setAt !== null && setAt <= at && setAt > started + grace * HOUR) {
          const after = hours(started, setAt);
          hit(issue, "estimate-after-start", `Story points first set on ${spelledDay(setAt)}, ${fixed1(after)} h after work started`, [
            workStarted(issue),
            metric("Set after work started", after, "hours"),
          ]);
        }
        break;
      }
      case "effort_ratio_at_least": {
        if (!estimatedAt(issue, at)) break;
        const estimate = issue.storyPoints! * HOURS_PER_POINT;
        const logged = loggedHoursAt(issue, at);
        const limit = numberParam(params, "threshold");
        if (logged / estimate >= limit) {
          hit(
            issue,
            "effort-ratio",
            `Logged ${fixed1(logged)} h against an estimate of ${fixed1(estimate)} h (${fixed2(logged / estimate)}×, threshold ${limit}×)`,
            [metric("Logged time", logged, "hours"), metric("Estimate", estimate, "hours"), metric("Effort ratio", logged / estimate, "ratio")],
          );
        }
        break;
      }
      case "entered_stage_without_evidence": {
        const stage = String(params.stage);
        const entered = issue.intervals.find((candidate) => statusesOfStage(stage).includes(candidate.status) && candidate.enteredAt <= at);
        if (entered) hit(issue, `stage-${slug(stage)}`, `Reached ${stage.replace(/_/g, " ")} with no ${String(params.evidence).replace(/_/g, " ")} recorded before it`, [enteredEvidence(issue, entered)]);
        break;
      }
      case "skipped_stage":
        for (const { change, skipped } of issue.skips) {
          if (change.at > at) continue;
          hit(issue, `skip-${change.id}`, `${change.from} → ${change.to} skipped ${skipped.join(", ")}`, [
            statusEvidence("Skipped", change),
            metric("Stages skipped", skipped.join(", "), null),
          ]);
        }
        break;
      case "reopened":
        for (const change of issue.statusChanges) {
          if (change.at > at || change.from !== "Done" || change.to === "Done") continue;
          hit(issue, `reopen-${change.id}`, `Reopened on ${spelledDay(change.at)}: ${change.from} → ${change.to}`, [statusEvidence("Reopened", change)]);
        }
        break;
      case "in_progress_unassigned":
        if (STATUS[issue.status].category === "indeterminate" && issue.assigneeAccountId === null) {
          hit(issue, "unassigned", `In '${issue.status}' with nobody assigned`, [enteredEvidence(issue, interval)]);
        }
        break;
      case "stuck_in_status": {
        const pct = numberParam(params, "pct");
        const usual = thresholdsAt(pct).get(issue.status);
        if (usual && age > usual.hours) {
          hit(issue, `stuck-${issue.status}`, `In '${issue.status}' for ${duration(age)}; the project's p${pct} for '${issue.status}' is ${duration(usual.hours)}`, [
            enteredEvidence(issue, interval),
            metric("Time in status", age, "hours"),
            metric(`Project p${pct}`, usual.hours, "hours"),
          ]);
        }
        break;
      }
      case "no_evidence_after_percentile": {
        // As entered_stage_without_evidence: never measurable on the sample's boards, which record no evidence.
        const stage = String(params.stage);
        const usual = thresholdsAt(numberParam(params, "pct")).get(issue.status);
        if (statusesOfStage(stage).includes(issue.status) && usual && age > usual.hours) {
          hit(issue, `no-evidence-${slug(stage)}`, `In ${stage.replace(/_/g, " ")} for ${duration(age)} with no ${String(params.evidence).replace(/_/g, " ")} recorded`, [
            enteredEvidence(issue, interval),
            metric("Time in stage", age, "hours"),
          ]);
        }
        break;
      }
      case "unestimated_in_active_sprint": {
        const sprint = world.activeSprint;
        if (sprint.memberKeys.includes(issue.key) && !estimatedAt(issue, at)) {
          hit(issue, `unestimated-sprint-${sprint.id}`, `In ${sprint.name} with no estimate (story points)`, [
            { kind: "sprint", label: "In the active sprint", value: sprint.name, unit: null, from: null, to: null, at: iso(sprint.start), changelog_id: null },
            metric("Story points", null, "points"),
          ]);
        }
        break;
      }
    }
  }
  return hits;
}

/** The active sprint, when it has at most `days_left` days left and more than `not_started_share` of it not started. */
function sprintAtRisk(world: World, rule: BoardRule): CustomHit[] {
  const at = world.syncAt;
  const sprint = world.activeSprint;
  const members = sprint.memberKeys.flatMap((key) => {
    const issue = world.byKey.get(key);
    return issue ? [issue] : [];
  });
  if (members.length === 0) return [];
  const left = (sprint.end - at) / DAY;
  const notStarted = members.filter((issue) => {
    const started = issue.startedAt ?? issue.doneAt;
    return started === null || started > at;
  }).length;
  const share = notStarted / members.length;
  if (left > numberParam(rule.def.params, "days_left") || share <= numberParam(rule.def.params, "not_started_share")) return [];
  return [
    {
      issue: null,
      sprint,
      evidenceKey: `sprint-${sprint.id}-at-risk`,
      describe: () => ({
        message: `${sprint.name} ends in ${fixed1(left)} days with ${notStarted} of ${members.length} issues (${Math.round(share * 100)}%) not started`,
        threshold: rule.def.threshold,
        evidence: [
          { kind: "sprint", label: "Sprint ends", value: sprint.name, unit: null, from: null, to: null, at: iso(sprint.end), changelog_id: null },
          metric("Days left", left, "days"),
          metric("Issues in the sprint", members.length, "count"),
          metric("Not started", notStarted, "count"),
          metric("Share not started", share, "share"),
        ],
      }),
    },
  ];
}
