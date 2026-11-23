/**
 * The rule engine over the sample world. Each rule is written as the spans of
 * time its condition held for an issue (or a sprint); the engine then replays
 * the real system's schedule, a sync every 30 minutes and a rules run a
 * minute after it, from the day the oversight rules started. A finding opens
 * at the first run that sees its condition, stays open while runs keep seeing
 * it, and resolves at the first run that does not: the same lifecycle
 * oversight/rules/engine.py gives a live finding.
 *
 * Each rule runs as the board's settings make it (JO-15, board-rules.ts): on or
 * off, its severity, its thresholds. One run here replays the whole history "as
 * if always", the settings read as if they had always been the board's; the
 * dataset (dataset.ts) keeps the past as it was and applies a change of
 * settings from its re-check on (recheck.ts), as the service does. A
 * finding's identity is the condition on the ticket, never the threshold: its
 * evidence key is built from the catalogue's value, so a ticket over both the
 * old and the new threshold is the same finding; only a severity change gives
 * a rule new ids.
 *
 * A board's own rules (JO-20, custom-checks.ts) are read as of the last sync:
 * a rule an admin adds sees the board as it is now, and its findings are first
 * seen when it was added, which is what the live service does at its first
 * re-check. Their evidence keys never hold a limit either.
 */

import { createHash } from "node:crypto";

import type { EvidenceItem } from "@/lib/api/schemas";

import { boardRules, catalogueParam, numberWords, rulesById, type BoardRule } from "./board-rules";
import { HOURS_PER_POINT, missingFor, type RuleDef, type StatusName } from "./catalogue";
import { customHits } from "./custom-checks";
import {
  duration,
  enteredEvidence,
  fixed1,
  fixed2,
  hours,
  intervalAt,
  metric,
  statusEvidence,
  stuckThresholds,
  workStarted,
  type Threshold,
} from "./evidence";
import { DAY, HOUR, MINUTE, spelledDay } from "./time";
import { HALF_HOUR, loggedHoursAt, workItems, type Issue, type Sprint, type World } from "./world";

export type { Threshold } from "./evidence";

/** A rules run starts this long after the sync it reads. */
const RUN_DELAY = MINUTE;

type Span = readonly [from: number, to: number | null];

/** Why a finding was resolved: its condition stopped, a new rule version replaced it, or the board's settings changed. */
export type ResolvedWhy = "cleared" | "superseded" | "settings_changed";

export interface FindingRecord {
  id: string;
  /** The rule as the board ran it when it raised the finding: its severity there among it. */
  rule: RuleDef;
  /** The rule version it fired under: the catalogue's, or "0.1.0+breach" under a board's own severity. */
  ruleVersion: string;
  issue: Issue | null;
  sprint: Sprint | null;
  evidenceKey: string;
  firstSeenAt: number;
  lastSeenAt: number;
  resolvedAt: number | null;
  /** Set exactly when it is resolved. */
  resolvedWhy: ResolvedWhy | null;
  message: string;
  threshold: string | null;
  evidence: EvidenceItem[];
  warnedBefore: { ruleId: string; findingId: string; at: number } | null;
}

export interface Engine {
  findings: FindingRecord[];
  byId: Map<string, FindingRecord>;
  byIssue: Map<string, FindingRecord[]>;
  /** W-AGE-01's thresholds: p90 hours of closed intervals per status. */
  thresholds: Map<StatusName, Threshold>;
}

interface Hit {
  /** The rule as the board runs it. */
  rule: BoardRule;
  issue: Issue | null;
  sprint: Sprint | null;
  evidenceKey: string;
  spans: Span[];
  /** What the rule saw at a sync that observed it. */
  describe(at: number): { message: string; threshold: string | null; evidence: EvidenceItem[] };
}

/** A board's rule by id. */
type RuleOf = (id: string) => BoardRule;

/* --------------------------------------------------------------- helpers -- */

/** sha256(rule id, rule version, issue key, evidence key)[:32], as rules/engine.py writes it. */
export function findingIdFor(ruleId: string, ruleVersion: string, subject: string, evidenceKey: string): string {
  return createHash("sha256")
    .update([ruleId, ruleVersion, subject, evidenceKey].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
}

/* ------------------------------------------------------------ the rules -- */

function estimateRules(issue: Issue, rule: RuleOf): Hit[] {
  const hits: Hit[] = [];
  const started = issue.startedAt;
  if (started === null) return hits;
  const setAt = issue.estimateSetAt;
  const late = rule("R-EST-02");
  const grace = late.params.grace_hours;

  if (setAt === null || setAt > started) {
    hits.push({
      rule: rule("R-EST-01"),
      issue,
      sprint: null,
      evidenceKey: "no-estimate",
      spans: [[started, setAt]],
      describe: () => ({
        message: `Started on ${spelledDay(started)} with no estimate (story points)`,
        threshold: null,
        evidence: [workStarted(issue), metric("Story points", null, "points")],
      }),
    });
  }

  if (setAt !== null && setAt > started + grace * HOUR) {
    const change = issue.fieldChanges.find((candidate) => candidate.field === "story_points");
    const after = hours(started, setAt);
    hits.push({
      rule: late,
      issue,
      sprint: null,
      evidenceKey: "estimate-after-start",
      spans: [[setAt, null]],
      describe: () => ({
        message: `Story points first set on ${spelledDay(setAt)}, ${fixed1(after)} h after work started`,
        threshold: late.def.threshold,
        evidence: [
          workStarted(issue),
          {
            kind: "field_change",
            label: "Story points set",
            value: change?.to ?? String(issue.storyPoints),
            unit: "points",
            from: change?.from ?? null,
            to: change?.to ?? String(issue.storyPoints),
            at: new Date(setAt).toISOString(),
            changelog_id: change?.id ?? null,
          },
          metric("Set after work started", after, "hours"),
        ],
      }),
    });
  }
  return hits;
}

/**
 * The effort key, `ratio-ge-1.5`, from the catalogue's threshold whatever the board's: the finding is the
 * condition on the ticket, so a ticket over both the old and the new threshold stays the same finding.
 */
function effortKey(rule: BoardRule): string {
  return `ratio-ge-${numberWords(catalogueParam(rule.catalogue, "threshold"))}`;
}

function effortRules(issue: Issue, rule: RuleOf): Hit[] {
  if (issue.storyPoints === null || issue.estimateSetAt === null) return [];
  const estimate = issue.storyPoints * HOURS_PER_POINT;
  const knownFrom = issue.estimateSetAt;
  const breach = rule("R-EFF-01");
  const warning = rule("W-EFF-01");
  const breachAt = breach.params.threshold;
  const warnAt = warning.params.threshold;
  const breachSpans: Span[] = [];
  const warningSpans: Span[] = [];

  for (const interval of issue.intervals) {
    const from = Math.max(interval.enteredAt, knownFrom);
    if (interval.leftAt !== null && from >= interval.leftAt) continue;
    if (interval.status === "Done") {
      if (loggedHoursAt(issue, from) / estimate >= breachAt) breachSpans.push([from, interval.leftAt]);
    } else if (interval.status === "In Progress") {
      // The first moment logged time reaches the warning share while still in progress.
      let crossing: number | null = loggedHoursAt(issue, from) / estimate >= warnAt ? from : null;
      if (crossing === null) {
        let seconds = 0;
        for (const log of issue.worklogs) {
          seconds += log.seconds;
          if (log.at > from && (interval.leftAt === null || log.at < interval.leftAt) && seconds / 3600 / estimate >= warnAt) {
            crossing = log.at;
            break;
          }
        }
      }
      if (crossing !== null) warningSpans.push([crossing, interval.leftAt]);
    }
  }

  const describe = (which: BoardRule, label: string) => (at: number) => {
    const logged = loggedHoursAt(issue, at);
    const ratio = logged / estimate;
    const threshold = numberWords(which.params.threshold);
    const evidence = [
      metric(label, logged, "hours"),
      metric("Estimate", estimate, "hours"),
      metric("Effort ratio", ratio, "ratio"),
    ];
    const interval = intervalAt(issue, at);
    if (interval.enteredBy) evidence.push(statusEvidence(`Moved to ${interval.status}`, interval.enteredBy));
    return {
      message:
        which === breach
          ? `Logged ${fixed1(logged)} h against an estimate of ${fixed1(estimate)} h (${fixed2(ratio)}×, threshold ${threshold}×)`
          : `Logged ${fixed1(logged)} h of a ${fixed1(estimate)} h estimate while in progress (${fixed2(ratio)}×, threshold ${threshold}×)`,
      threshold: which.def.threshold,
      evidence,
    };
  };

  const hits: Hit[] = [];
  if (breachSpans.length > 0) {
    hits.push({
      rule: breach,
      issue,
      sprint: null,
      evidenceKey: effortKey(breach),
      spans: breachSpans,
      describe: describe(breach, "Logged time"),
    });
  }
  if (warningSpans.length > 0) {
    hits.push({
      rule: warning,
      issue,
      sprint: null,
      evidenceKey: effortKey(warning),
      spans: warningSpans,
      describe: describe(warning, "Logged so far"),
    });
  }
  return hits;
}

function flowRules(issue: Issue, rule: RuleOf): Hit[] {
  const hits: Hit[] = issue.skips.map(({ change, skipped }) => ({
    rule: rule("R-FLOW-02"),
    issue,
    sprint: null,
    evidenceKey: `skip-${change.id}`,
    spans: [[change.at, null]],
    describe: () => ({
      message: `${change.from} → ${change.to} skipped ${skipped.join(", ")}`,
      threshold: null,
      evidence: [statusEvidence("Skipped", change), metric("Stages skipped", skipped.join(", "), null)],
    }),
  }));

  for (const change of issue.statusChanges) {
    if (change.from !== "Done" || change.to === "Done") continue;
    hits.push({
      rule: rule("R-FLOW-03"),
      issue,
      sprint: null,
      evidenceKey: `reopen-${change.id}`,
      spans: [[change.at, null]],
      describe: () => ({
        message: `Reopened on ${spelledDay(change.at)}: ${change.from} → ${change.to}`,
        threshold: null,
        evidence: [statusEvidence("Reopened", change)],
      }),
    });
  }

  if (issue.unassigned.length > 0) {
    hits.push({
      rule: rule("R-HYG-01"),
      issue,
      sprint: null,
      evidenceKey: "unassigned",
      spans: issue.unassigned.map(({ from, to }) => [from, to] as const),
      describe: (at) => {
        const span = [...issue.unassigned].reverse().find(({ from }) => from <= at) ?? issue.unassigned[0];
        return {
          // The status quoted, as the service quotes it: "In In Progress" would read as a typo.
          message: `In 'In Progress' with nobody assigned for ${duration(hours(span.from, at))}`,
          threshold: null,
          evidence: [enteredEvidence(issue, intervalAt(issue, span.from)), metric("Unassigned for", hours(span.from, at), "hours")],
        };
      },
    });
  }
  return hits;
}

function stuckRule(issue: Issue, thresholds: Map<StatusName, Threshold>, stuck: BoardRule): Hit[] {
  const pct = numberWords(stuck.params.pct);
  const hits: Hit[] = [];
  for (const status of ["To Do", "In Progress"] as const) {
    const threshold = thresholds.get(status);
    if (!threshold) continue;
    const spans: Span[] = [];
    for (const interval of issue.intervals) {
      if (interval.status !== status) continue;
      const from = interval.enteredAt + threshold.hours * HOUR;
      if (interval.leftAt === null || from < interval.leftAt) spans.push([from, interval.leftAt]);
    }
    if (spans.length === 0) continue;
    hits.push({
      rule: stuck,
      issue,
      sprint: null,
      evidenceKey: `stuck-${status}`,
      spans,
      describe: (at) => {
        const interval = intervalAt(issue, at);
        const age = hours(interval.enteredAt, at);
        return {
          message: `In '${status}' for ${duration(age)}; the project's p${pct} for '${status}' is ${duration(threshold.hours)}`,
          threshold: `p${pct} of ${status}: ${fixed1(threshold.hours)} h`,
          evidence: [
            enteredEvidence(issue, interval),
            metric("Time in status", age, "hours"),
            metric(`Project p${pct}`, threshold.hours, "hours"),
            metric("Closed intervals measured", threshold.n, "count"),
          ],
        };
      },
    });
  }
  return hits;
}

function sprintRules(world: World, risk: BoardRule): Hit[] {
  const hits: Hit[] = [];
  const daysLeft = risk.params.days_left;
  const share = risk.params.not_started_share;
  for (const sprint of world.sprints) {
    const members = sprint.memberKeys.map((key) => world.byKey.get(key)!);
    if (members.length === 0) continue;
    const startOf = (issue: Issue) => issue.startedAt ?? issue.doneAt;
    const notStartedAt = (at: number) => members.filter((issue) => startOf(issue) === null || startOf(issue)! > at).length;
    const from = sprint.end - daysLeft * DAY;
    if (notStartedAt(from) / members.length <= share) continue;
    // Work that starts in the days left can bring the sprint back under the line.
    const starts = members
      .map(startOf)
      .filter((at): at is number => at !== null && at > from && at < sprint.end)
      .sort((a, b) => a - b);
    const recovers = starts.find((at) => notStartedAt(at) / members.length <= share) ?? null;
    const to = recovers ?? sprint.end;

    hits.push({
      rule: risk,
      issue: null,
      sprint,
      evidenceKey: `sprint-${sprint.id}-at-risk`,
      spans: [[from, to > world.syncAt ? null : to]],
      describe: (at) => {
        const left = (sprint.end - at) / DAY;
        const notStarted = notStartedAt(at);
        const portion = notStarted / members.length;
        return {
          message: `${sprint.name} ends in ${fixed1(left)} days with ${notStarted} of ${members.length} issues (${Math.round(portion * 100)}%) not started`,
          threshold: risk.def.threshold,
          evidence: [
            {
              kind: "sprint",
              label: "Sprint ends",
              value: sprint.name,
              unit: null,
              from: null,
              to: null,
              at: new Date(sprint.end).toISOString(),
              changelog_id: null,
            },
            metric("Days left", left, "days"),
            metric("Issues in the sprint", members.length, "count"),
            metric("Not started", notStarted, "count"),
            metric("Share not started", portion, "share"),
          ],
        };
      },
    });
  }
  return hits;
}

function unestimatedInSprint(issue: Issue, world: World, unestimated: BoardRule): Hit[] {
  const hits: Hit[] = [];
  for (const sprintId of issue.sprintIds) {
    const sprint = world.sprints.find((candidate) => candidate.id === sprintId)!;
    const from = Math.max(sprint.start, issue.createdAt);
    const doneAt = issue.intervals.find((interval) => interval.status === "Done" && interval.enteredAt >= from)?.enteredAt;
    const until = Math.min(sprint.end, issue.estimateSetAt ?? Number.POSITIVE_INFINITY, doneAt ?? Number.POSITIVE_INFINITY);
    if (issue.estimateSetAt !== null && issue.estimateSetAt <= from) continue;
    if (until <= from) continue;
    hits.push({
      rule: unestimated,
      issue,
      sprint: null,
      evidenceKey: `unestimated-sprint-${sprint.id}`,
      spans: [[from, until > world.syncAt ? null : until]],
      describe: () => ({
        message: `In ${sprint.name} with no estimate (story points)`,
        threshold: null,
        evidence: [
          {
            kind: "sprint",
            label: "In the active sprint",
            value: sprint.name,
            unit: null,
            from: null,
            to: null,
            at: new Date(sprint.start).toISOString(),
            changelog_id: null,
          },
          metric("Story points", null, "points"),
        ],
      }),
    });
  }
  return hits;
}

/* ------------------------------------------------------------- the runs -- */

/** The first sync at or after `time`, on the half-hour grid that ends at the last sync. */
function nextSync(world: World, time: number): number | null {
  if (time > world.syncAt) return null;
  return world.syncAt - Math.floor((world.syncAt - time) / HALF_HOUR) * HALF_HOUR;
}

interface Observation {
  firstSync: number;
  lastSync: number;
  resolvedSync: number | null;
}

function observe(world: World, spans: Span[]): Observation | null {
  let firstSync: number | null = null;
  let lastSync = 0;
  let resolvedSync: number | null = null;
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const seen = nextSync(world, Math.max(from, world.engineStart));
    if (seen === null || (to !== null && seen >= to)) continue;
    firstSync ??= seen;
    if (to === null) {
      lastSync = world.syncAt;
      resolvedSync = null;
    } else {
      const cleared = nextSync(world, to)!;
      lastSync = cleared - HALF_HOUR;
      resolvedSync = cleared;
    }
  }
  return firstSync === null ? null : { firstSync, lastSync, resolvedSync };
}

/**
 * "Warned on X, breached on Y": for each breach rule's finding `link` picks,
 * the earliest warning on the same issue, of a rule that escalates to it,
 * first seen no later than the breach. A warning counts only under its own
 * rule's current version (a board's severity change gives it new findings).
 */
export function linkWarnings(
  findings: readonly FindingRecord[],
  rules: readonly BoardRule[],
  link: (finding: FindingRecord) => boolean = () => true,
): void {
  const versions = new Map(rules.map((rule) => [rule.def.id, rule.version]));
  const byIssue = groupByIssue(findings);
  for (const finding of findings) {
    if (!finding.issue || finding.rule.kind !== "rule" || !link(finding)) continue;
    const warning = (byIssue.get(finding.issue.key) ?? [])
      .filter(
        (candidate) =>
          candidate.rule.escalatesTo === finding.rule.id &&
          candidate.ruleVersion === versions.get(candidate.rule.id) &&
          candidate.firstSeenAt <= finding.firstSeenAt,
      )
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt)[0];
    finding.warnedBefore = warning ? { ruleId: warning.rule.id, findingId: warning.id, at: warning.firstSeenAt } : null;
  }
}

function groupByIssue(findings: readonly FindingRecord[]): Map<string, FindingRecord[]> {
  const byIssue = new Map<string, FindingRecord[]>();
  for (const finding of findings) {
    if (!finding.issue) continue;
    const list = byIssue.get(finding.issue.key) ?? [];
    list.push(finding);
    byIssue.set(finding.issue.key, list);
  }
  return byIssue;
}

/** The findings as every view reads them: newest first, by id and by issue (each issue's newest first too). */
export function assembleEngine(findings: FindingRecord[], thresholds: Map<StatusName, Threshold>): Engine {
  const newestFirst = (a: FindingRecord, b: FindingRecord) => b.firstSeenAt - a.firstSeenAt || a.id.localeCompare(b.id);
  findings.sort(newestFirst);
  const byIssue = groupByIssue(findings);
  for (const list of byIssue.values()) list.sort(newestFirst);
  return { findings, byId: new Map(findings.map((finding) => [finding.id, finding])), byIssue, thresholds };
}

/**
 * The rules engine over the sample's world, every rule as the board runs it
 * (the catalogue's rules when no settings are given). A rule turned off, or
 * one whose evidence Jira does not hold, raises nothing.
 */
export function runEngine(world: World, rules: readonly BoardRule[] = boardRules()): Engine {
  const byId = rulesById(rules);
  const rule: RuleOf = (id) => byId.get(id)!;
  const stuck = rule("W-AGE-01");
  const thresholds = stuckThresholds(world, stuck.params.pct);
  const hits: Hit[] = [];
  for (const issue of workItems(world)) {
    hits.push(...estimateRules(issue, rule), ...effortRules(issue, rule), ...flowRules(issue, rule), ...stuckRule(issue, thresholds, stuck));
    hits.push(...unestimatedInSprint(issue, world, rule("W-EST-01")));
  }
  hits.push(...sprintRules(world, rule("W-SPR-01")));
  // A board's own rules (JO-20), each seen as of the last sync: one span from it, open while the board stands so.
  for (const custom of rules) {
    if (!custom.custom || !custom.enabled) continue;
    for (const hit of customHits(world, custom)) hits.push({ ...hit, rule: custom, spans: [[world.syncAt, null]], describe: () => hit.describe() });
  }

  const runs = new Set(rules.filter((candidate) => candidate.enabled && missingFor(candidate.catalogue).length === 0).map((candidate) => candidate.def.id));
  const findings: FindingRecord[] = [];
  for (const hit of hits) {
    if (!runs.has(hit.rule.def.id)) continue;
    const seen = observe(world, hit.spans);
    if (!seen) continue;
    const subject = hit.issue?.key ?? `sprint:${hit.sprint!.id}`;
    findings.push({
      id: findingIdFor(hit.rule.def.id, hit.rule.version, subject, hit.evidenceKey),
      rule: hit.rule.def,
      ruleVersion: hit.rule.version,
      issue: hit.issue,
      sprint: hit.sprint,
      evidenceKey: hit.evidenceKey,
      firstSeenAt: seen.firstSync + RUN_DELAY,
      lastSeenAt: seen.lastSync + RUN_DELAY,
      resolvedAt: seen.resolvedSync === null ? null : seen.resolvedSync + RUN_DELAY,
      resolvedWhy: seen.resolvedSync === null ? null : "cleared",
      ...hit.describe(seen.lastSync),
      warnedBefore: null,
    });
  }
  linkWarnings(findings, rules);
  return assembleEngine(findings, thresholds);
}

/** When the rules last ran over the world: a minute after its last sync. */
export function lastRun(world: World): number {
  return world.syncAt + RUN_DELAY;
}

/** Open at a moment: first seen by then and not yet resolved. */
export function openAt(finding: FindingRecord, at: number): boolean {
  return finding.firstSeenAt <= at && (finding.resolvedAt === null || finding.resolvedAt > at);
}
