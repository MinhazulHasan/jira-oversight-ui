import { NO_EPIC, type FindingsQuery } from "@/lib/api/params";
import {
  UNASSIGNED,
  UNASSIGNED_LABEL,
  type FacetEntry,
  type Finding,
  type FindingDetail,
  type FindingsPage,
  type Interval,
} from "@/lib/api/schemas";

import { STATUS } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import type { FindingRecord } from "./engine";
import { boardPeople } from "./people";
import { round4 } from "./stats";
import { personOf } from "./team";
import { DAY, HOUR, iso } from "./time";
import type { Issue } from "./world";

/* ------------------------------------------------------------ conversion -- */

export function intervalsOf(issue: Issue): Interval[] {
  return issue.intervals.map((interval) => ({
    status: interval.status,
    stage: STATUS[interval.status].stage,
    status_category: STATUS[interval.status].category,
    entered_at: iso(interval.enteredAt),
    left_at: interval.leftAt === null ? null : iso(interval.leftAt),
    hours: interval.leftAt === null ? null : round4(Math.max(0, (interval.leftAt - interval.enteredAt) / HOUR)),
  }));
}

/**
 * The rules that hold findings on the board but no longer run there (JO-20: a custom rule since deleted), each by
 * the title its findings carry, by id: its findings keep it a place in the filter, after the board's rules.
 */
function formerRules(dataset: Dataset): [string, string][] {
  const running = new Set(dataset.rules.map((rule) => rule.def.id));
  const former = new Map<string, string>();
  for (const finding of dataset.engine.findings) {
    if (!running.has(finding.rule.id) && !former.has(finding.rule.id)) former.set(finding.rule.id, finding.rule.title);
  }
  return [...former].sort(([a], [b]) => (a < b ? -1 : 1));
}

function toFinding(dataset: Dataset, record: FindingRecord): Finding {
  const { issue, sprint } = record;
  const epic = issue?.epicKey ? (dataset.world.byKey.get(issue.epicKey) ?? null) : null;
  return {
    finding_id: record.id,
    rule_id: record.rule.id,
    rule_title: record.rule.title,
    rule_version: record.ruleVersion,
    kind: record.rule.kind,
    severity: record.rule.severity,
    state: record.resolvedAt === null ? "open" : "resolved",
    message: record.message,
    scope: issue ? "issue" : "sprint",
    issue_key: issue?.key ?? null,
    issue_summary: issue?.summary ?? null,
    issue_type: issue?.type ?? null,
    epic_key: epic?.key ?? null,
    epic_title: epic?.summary ?? null,
    // The issue's assignee now, not when the rule fired; a sprint belongs to no one.
    assignee: issue ? personOf(issue) : null,
    sprint: sprint ? { sprint_id: sprint.id, name: sprint.name } : null,
    first_seen_at: iso(record.firstSeenAt),
    last_seen_at: iso(record.lastSeenAt),
    resolved_at: record.resolvedAt === null ? null : iso(record.resolvedAt),
    resolved_why: record.resolvedAt === null ? null : (record.resolvedWhy ?? "cleared"),
    threshold: record.threshold,
    evidence: record.evidence,
    warned_before: record.warnedBefore
      ? {
          warning_rule_id: record.warnedBefore.ruleId,
          warning_finding_id: record.warnedBefore.findingId,
          warned_at: iso(record.warnedBefore.at),
        }
      : null,
  };
}

interface Entry {
  record: FindingRecord;
  finding: Finding;
}

/** Every finding, open and resolved, newest first: the one list all views count from. */
function entries(dataset: Dataset): Entry[] {
  return memo(dataset, "findings:entries", () =>
    dataset.engine.findings.map((record) => ({ record, finding: toFinding(dataset, record) })),
  );
}

function entryById(dataset: Dataset): Map<string, Entry> {
  return memo(dataset, "findings:by-id", () => new Map(entries(dataset).map((entry) => [entry.record.id, entry])));
}

export function findingsOfIssue(dataset: Dataset, key: string): Finding[] {
  const records = dataset.engine.byIssue.get(key) ?? [];
  const byId = entryById(dataset);
  // Open first, then newest first: what needs attention leads.
  return records
    .map((record) => byId.get(record.id)!.finding)
    .sort(
      (a, b) =>
        Number(a.state === "resolved") - Number(b.state === "resolved") ||
        b.first_seen_at.localeCompare(a.first_seen_at) ||
        a.finding_id.localeCompare(b.finding_id),
    );
}

/* --------------------------------------------------------------- filters -- */

const FIRST_SEEN_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

type Facet = "rule" | "epic" | "person" | "severity" | "state";

/** Whose a finding is for the person filter: its issue's assignee, "unassigned", or no one's (a sprint finding). */
function personKey(finding: Finding): string | null {
  return finding.scope === "issue" ? (finding.assignee?.id ?? UNASSIGNED) : null;
}

const KEY_QUERY = /^[A-Z][A-Z0-9_]+-\d+$/;
const NUMBER_QUERY = /^#?(\d{1,9})$/;

/**
 * Search: an exact key ("DEMO-142", any case), a bare number ("142" or "#142"),
 * or words found in the key, the summary or the sprint's name.
 */
function searchMatcher(q: string | undefined): (finding: Finding) => boolean {
  if (!q) return () => true;
  const text = q.trim().toLowerCase();
  const inText = (finding: Finding) =>
    (finding.issue_summary ?? "").toLowerCase().includes(text) ||
    (finding.issue_key ?? "").toLowerCase().includes(text) ||
    (finding.sprint?.name ?? "").toLowerCase().includes(text);
  const upper = q.trim().toUpperCase();
  if (KEY_QUERY.test(upper)) {
    return (finding) => finding.issue_key === upper || (finding.issue_summary ?? "").toLowerCase().includes(text);
  }
  const number = NUMBER_QUERY.exec(text);
  if (number) {
    const suffix = `-${Number(number[1])}`;
    return (finding) => (finding.issue_key ?? "").endsWith(suffix) || inText(finding);
  }
  return inText;
}

/** First seen in the last 7, 30 or 90 days, counted back from now, as the backend's periods are. */
function firstSeenSince(now: number, window: FindingsQuery["first_seen"]): number | null {
  return window === "all" ? null : now - FIRST_SEEN_DAYS[window] * DAY;
}

function predicate(dataset: Dataset, query: FindingsQuery, except?: Facet): (entry: Entry) => boolean {
  const rules = new Set(query.rule);
  const epics = new Set(query.epic);
  const people = new Set(query.person);
  const search = searchMatcher(query.q);
  const since = firstSeenSince(dataset.now, query.first_seen);
  return ({ record, finding }) => {
    if (except !== "state" && query.state !== "all" && finding.state !== query.state) return false;
    if (except !== "rule" && rules.size > 0 && !rules.has(finding.rule_id)) return false;
    if (except !== "severity" && query.severity && finding.severity !== query.severity) return false;
    if (except !== "epic" && epics.size > 0 && !epics.has(finding.epic_key ?? NO_EPIC)) return false;
    // An id nobody on the board has matches nothing; a sprint finding never matches anyone.
    if (except !== "person" && people.size > 0 && !people.has(personKey(finding) ?? "")) return false;
    if (since !== null && record.firstSeenAt < since) return false;
    return search(finding);
  };
}

/* ----------------------------------------------------------------- facets -- */

function facets(dataset: Dataset, query: FindingsQuery): FindingsPage["facets"] {
  const all = entries(dataset);
  const counted = (except: Facet, key: (finding: Finding) => string | null) => {
    const counts = new Map<string, number>();
    const keep = predicate(dataset, query, except);
    for (const entry of all) {
      if (!keep(entry)) continue;
      const value = key(entry.finding);
      if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  };

  const byRule = counted("rule", (finding) => finding.rule_id);
  const byEpic = counted("epic", (finding) => finding.epic_key ?? NO_EPIC);
  const byPerson = counted("person", personKey);
  const bySeverity = counted("severity", (finding) => finding.severity);
  const byState = counted("state", (finding) => finding.state);

  const entry = (value: string, label: string, counts: Map<string, number>): FacetEntry => ({
    value,
    label,
    count: counts.get(value) ?? 0,
  });

  return {
    // Every rule and every epic, always in the same order, so a filter menu never reshuffles: the board's rules (its own,
    // JO-20, after the catalogue's, by their own titles), then a rule since deleted that still holds findings, by its id.
    rules: [
      ...dataset.rules.map((rule) => entry(rule.def.id, rule.def.title, byRule)),
      ...formerRules(dataset).map(([id, title]) => entry(id, title, byRule)),
    ],
    epics: [
      ...dataset.world.epics.map((epic) => entry(epic.key, epic.summary, byEpic)),
      entry(NO_EPIC, "No epic", byEpic),
    ],
    // Everyone with a ticket on the board, by name, then the unassigned: listed even at 0, like "No epic".
    // Each with their picture's version, for the Person menu; the unassigned tickets have none.
    people: [
      ...boardPeople(dataset).map((person) => ({ ...entry(person.id, person.name, byPerson), avatar: person.avatar })),
      { ...entry(UNASSIGNED, UNASSIGNED_LABEL, byPerson), avatar: null },
    ],
    severity: [entry("breach", "Breach", bySeverity), entry("warning", "Warning", bySeverity)],
    state: [entry("open", "Open", byState), entry("resolved", "Resolved", byState)],
  };
}

/* ---------------------------------------------------------------- sorting -- */

const SEVERITY_RANK = { breach: 2, warning: 1 } as const;

function keyNumber(key: string | null): number | null {
  if (key === null) return null;
  return Number(key.slice(key.lastIndexOf("-") + 1));
}

type SortValue = number | string | null;

function sortValue(finding: Finding, sort: FindingsQuery["sort"]): SortValue {
  switch (sort) {
    case "first_seen_at":
      return finding.first_seen_at;
    case "last_seen_at":
      return finding.last_seen_at;
    case "resolved_at":
      return finding.resolved_at;
    case "severity":
      return SEVERITY_RANK[finding.severity];
    case "rule_id":
      return finding.rule_id;
    case "issue_key":
      return keyNumber(finding.issue_key);
    case "epic_key":
      return keyNumber(finding.epic_key);
  }
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** The chosen column in the chosen order; empty values last either way; then newest first, then id. */
function sorter(query: FindingsQuery): (a: Finding, b: Finding) => number {
  const direction = query.order === "asc" ? 1 : -1;
  return (a, b) => {
    const left = sortValue(a, query.sort);
    const right = sortValue(b, query.sort);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
    } else {
      const order = compare(left, right) * direction;
      if (order !== 0) return order;
    }
    return b.first_seen_at.localeCompare(a.first_seen_at) || a.finding_id.localeCompare(b.finding_id);
  };
}

/* ------------------------------------------------------------------ views -- */

export function matchingFindings(dataset: Dataset, query: FindingsQuery): Finding[] {
  const keep = predicate(dataset, query);
  return entries(dataset)
    .filter(keep)
    .map((entry) => entry.finding)
    .sort(sorter(query));
}

export function findingsPage(dataset: Dataset, query: FindingsQuery): FindingsPage {
  const matching = matchingFindings(dataset, query);
  const start = (query.page - 1) * query.page_size;
  return {
    meta: meta(dataset),
    items: matching.slice(start, start + query.page_size),
    total: matching.length,
    page: query.page,
    page_size: query.page_size,
    facets: facets(dataset, query),
  };
}

export function findingDetail(dataset: Dataset, findingId: string): FindingDetail | null {
  const entry = entryById(dataset).get(findingId);
  if (!entry) return null;
  return {
    meta: meta(dataset),
    finding: entry.finding,
    timeline: entry.record.issue ? intervalsOf(entry.record.issue) : [],
  };
}
