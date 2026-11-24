import { scorecardHref } from "@/components/people/links";
import {
  ASK_DECLINES,
  FINDING_ID_PATTERN,
  ISSUE_KEY_PATTERN,
  PERSON_ID_PATTERN,
  RULE_ID_PATTERN,
  UNASSIGNED,
  type AskOutcome,
  type AskResponse,
  type Citation,
  type FactCell,
  type FactSet,
} from "@/lib/api/schemas";

/* ------------------------------------------------------------- the calls -- */

const TOOL_LABELS: Record<string, string> = {
  oversight_coverage: "Coverage",
  oversight_effort_vs_estimate: "Effort against estimate",
  oversight_hot_spots: "Hot spots",
  oversight_query: "Lookup",
  oversight_issue_timeline: "Issue timeline",
  oversight_list_findings: "Findings",
  oversight_rule_status: "Rule status",
  oversight_time_in_status: "Time in status",
  oversight_top_issues: "Top issues",
  oversight_trend: "Trend",
  oversight_people: "People",
  oversight_board_people: "People on the board",
  oversight_person_tickets: "Person's tickets",
  oversight_person_findings: "Person's findings",
  oversight_person_scorecard: "Scorecard",
  oversight_people_compare: "People compared",
};

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "median_cycle_time_h" reads "median cycle time (hours)"; "code_review" reads "code review". */
export function humanize(value: string): string {
  return value
    .replace(/_h$/, " (hours)")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "oversight_hot_spots" reads "Hot spots". */
export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? sentenceCase(humanize(tool.replace(/^oversight_/, "")));
}

/** One parameter in words: an optional lead ("rule") and the value, set in mono when it is an id. */
export interface ParamPhrase {
  key: string;
  text: string;
  lead?: string;
  mono?: boolean;
}

// Ranked calls read "top 5"; lists read "up to 20".
const RANKED = new Set(["oversight_hot_spots", "oversight_top_issues"]);
const STATES: Record<string, string> = { all: "open and resolved", open: "open", resolved: "resolved" };
const ORDER_WORDS: Record<string, string> = { most: "highest first", fewest: "lowest first", closer: "closer to the process first" };
const COUNT_ORDER_WORDS: Record<string, string> = { most: "most first", fewest: "fewest first", closer: "most first" };
const COUNTS = new Set(["open_tickets", "in_progress", "done_in_period"]);

/** The order a call was asked for, in the words its answer uses: a rate or the ratio by its figure, a count by how many. */
function orderPhrase(tool: string, value: string, measure: string | undefined): string {
  if (tool === "oversight_people" || (measure !== undefined && COUNTS.has(measure))) return COUNT_ORDER_WORDS[value] ?? humanize(value);
  // Overall, closer is the default order itself; the fewest measures closer first is "fewest first", as the answer says.
  if (measure === "overall" && value !== "closer") return COUNT_ORDER_WORDS[value] ?? humanize(value);
  return ORDER_WORDS[value] ?? humanize(value);
}
const CATEGORIES: Record<string, string> = { new: "to do", indeterminate: "in progress", done: "done" };
const SEVERITIES: Record<string, string> = { breach: "breaches", warning: "warnings" };
/** Parameters never put into words: the analyst's own query is code, and a reader is told what was looked at instead. */
const HIDDEN_PARAMS: ReadonlySet<string> = new Set(["sql"]);
// The order a sentence would name them in: what, then which, then when, then how many.
const ORDER = [
  "metric",
  "measure",
  "person",
  "person_ids",
  "rule_id",
  "issue_key",
  "field",
  "group_by",
  "rank_by",
  "order",
  "holding",
  "severity",
  "state",
  "status_category",
  "period",
  "days",
  "last_n",
  "n",
];

function periodPhrase(value: string): string {
  if (value === "all") return "all time";
  const days = /^(\d+)d$/.exec(value);
  if (days) return `last ${days[1]} days`;
  const weeks = /^(\d+)w$/.exec(value);
  return weeks ? `last ${weeks[1]} weeks` : humanize(value);
}

function phrase(tool: string, key: string, value: string, measure?: string): ParamPhrase {
  switch (key) {
    case "n":
      return { key, text: RANKED.has(tool) ? `top ${value}` : `up to ${value}` };
    case "last_n":
      return { key, text: `last ${value} weeks` };
    case "period":
      return { key, text: periodPhrase(value) };
    case "metric":
    case "field":
      return { key, text: humanize(value) };
    case "group_by":
      return { key, text: `by ${humanize(value)}` };
    case "state":
      return { key, text: STATES[value] ?? humanize(value) };
    case "severity":
      return { key, text: SEVERITIES[value] ?? humanize(value) };
    case "status_category":
      return { key, text: CATEGORIES[value] ?? humanize(value) };
    case "rule_id":
      return { key, lead: "rule", text: value, mono: true };
    case "issue_key":
      return { key, text: value, mono: true };
    case "person":
    case "person_ids":
      // Person ids: the page shows each as the person, by name and picture (people-in-facts.tsx).
      return { key, text: value };
    case "days":
      return { key, text: `last ${value} days` };
    case "measure":
      return { key, text: value === "overall" ? "every measure" : humanize(value) };
    case "rank_by":
      return { key, text: `by ${humanize(value)}` };
    case "order":
      return { key, text: orderPhrase(tool, value, measure) };
    case "holding":
      // Everyone on the board, or its members who hold no ticket.
      return { key, text: value === "none" ? "members with no tickets" : "everyone on it" };
    default:
      return { key, lead: humanize(key), text: value };
  }
}

/** A call's parameters in plain words, in reading order: "median effort ratio · last 12 weeks". */
export function describeParams(tool: string, params: FactSet["params"]): ParamPhrase[] {
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  return Object.entries(params)
    // The analyst's own query (sql) is never shown: a reader sees what was looked at in words, not code (SQA).
    .filter(([key, value]) => !HIDDEN_PARAMS.has(key) && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, value]) => phrase(tool, key, Array.isArray(value) ? value.join(", ") : String(value), typeof params.measure === "string" ? params.measure : undefined));
}

/** The same phrases as one line, for a tooltip, a summary or a copy. */
export function paramsText(tool: string, params: FactSet["params"]): string {
  return describeParams(tool, params)
    .map((item) => (item.lead ? `${item.lead} ${item.text}` : item.text))
    .join(" · ");
}

/* -------------------------------------------------------- where rows lead -- */

export interface RowLink {
  href: string;
  /** What opening it does, for the row's accessible name. */
  label: string;
}

const isEpicColumn = (column: FactSet["columns"][number]) => /epic/i.test(column.key) || /epic/i.test(column.label);

export function rowLink(fact: FactSet, row: Record<string, FactCell>): RowLink | null {
  const findingId = row.finding_id;
  if (typeof findingId === "string" && FINDING_ID_PATTERN.test(findingId)) {
    return { href: `/findings?finding=${findingId}`, label: "Open this finding's evidence" };
  }
  const keyColumns = fact.columns.filter((column) => column.kind === "issue_key");
  for (const column of keyColumns.filter((candidate) => !isEpicColumn(candidate))) {
    const key = row[column.key];
    if (typeof key === "string" && ISSUE_KEY_PATTERN.test(key)) return { href: `/issues/${key}`, label: `Open issue ${key}` };
  }
  for (const column of keyColumns.filter(isEpicColumn)) {
    const key = row[column.key];
    if (typeof key === "string" && ISSUE_KEY_PATTERN.test(key)) {
      return { href: `/findings?epic=${key}`, label: `Open the findings in epic ${key}` };
    }
    if (key === "(no epic)") return { href: "/findings?epic=none", label: "Open the findings outside every epic" };
  }
  // A scorecard row, or a person in a comparison: that person's scorecard on the People page.
  if ((fact.tool === "oversight_person_scorecard" || fact.tool === "oversight_people_compare") && typeof row.person_id === "string" && PERSON_ID_PATTERN.test(row.person_id)) {
    const name = typeof row.name === "string" ? row.name : "this person";
    // Over the answer's own period, so the page shows the figures the row holds.
    const days = typeof fact.params.days === "number" ? fact.params.days : undefined;
    return { href: scorecardHref(row.person_id, { days }), label: `Open the scorecard of ${name}` };
  }
  const ruleId = row.rule_id;
  if (typeof ruleId === "string" && RULE_ID_PATTERN.test(ruleId)) {
    return { href: `/findings?rule=${ruleId}`, label: `Open the findings of rule ${ruleId}` };
  }
  // A row of the people view: someone's open findings, or (no one) those on the unassigned tickets.
  if ("person_id" in row && fact.columns.some((column) => column.key === "person_id")) {
    const personId = row.person_id;
    if (typeof personId === "string" && PERSON_ID_PATTERN.test(personId)) {
      const name = typeof row.name === "string" ? row.name : "this person";
      return { href: `/findings?state=open&person=${personId}`, label: `Open the findings of ${name}` };
    }
    if (personId === null) return { href: `/findings?state=open&person=${UNASSIGNED}`, label: "Open the findings on unassigned tickets" };
  }
  const issueKey = fact.params.issue_key;
  if (fact.tool === "oversight_issue_timeline" && typeof issueKey === "string" && ISSUE_KEY_PATTERN.test(issueKey)) {
    return { href: `/issues/${issueKey}`, label: `Open issue ${issueKey}` };
  }
  return null;
}

/* ------------------------------------------------------------- citations -- */

/** The ledger node a citation ties to: a row, or a part of the fact set (params, row count, note, as of). */
export function targetKey(citation: Pick<Citation, "fact_ref" | "row_index" | "column">): string {
  return citation.row_index >= 0
    ? `row:${citation.fact_ref}:${citation.row_index}`
    : `fact:${citation.fact_ref}:${citation.column}`;
}

export const valueKey = (marker: number) => `value:${marker}`;
export const cellId = (ref: string, row: number, column: string) => `${ref}:${row}:${column}`;

/** Citations grouped by the cell they bind and by the ledger node they tie to, markers ascending. */
export function indexCitations(citations: readonly Citation[]) {
  const byCell = new Map<string, Citation[]>();
  const byTarget = new Map<string, Citation[]>();
  for (const citation of [...citations].sort((a, b) => a.marker - b.marker)) {
    const cell = cellId(citation.fact_ref, citation.row_index, citation.column);
    byCell.set(cell, [...(byCell.get(cell) ?? []), citation]);
    const target = targetKey(citation);
    byTarget.set(target, [...(byTarget.get(target) ?? []), citation]);
  }
  return { byCell, byTarget };
}

/* -------------------------------------------------------------- outcomes -- */

/** How each outcome is named above the question. */
export const OUTCOME_LABEL: Record<AskOutcome, string> = {
  answered: "Answer",
  not_understood: "Not understood",
  no_data: "No data",
  not_measurable: "Not measurable",
  not_verified: "Facts only",
};

export type Decline = "team_level" | "judgement" | "unknown_mention" | "comparison_off";

export function declineOf(response: Pick<AskResponse, "outcome" | "message">): Decline | null {
  if (response.outcome !== "not_understood") return null;
  switch (response.message?.trim()) {
    case ASK_DECLINES.teamLevel:
      return "team_level";
    case ASK_DECLINES.judgement:
      return "judgement";
    case ASK_DECLINES.unknownMention:
      return "unknown_mention";
    case ASK_DECLINES.comparisonOff:
      return "comparison_off";
    default:
      return null;
  }
}

/** How each decline is named above the question, and in the session's list. */
export const DECLINE_LABEL: Record<Decline, string> = {
  team_level: "Team level",
  judgement: "Facts, not judgements",
  unknown_mention: "Not on this board",
  comparison_off: "Comparison turned off",
};

export const DECLINE_FOOTER: Record<Decline, string> = {
  team_level: "Turned down at team level",
  judgement: "Turned down",
  unknown_mention: "Turned down: someone mentioned is not on this board",
  comparison_off: "Turned down: comparing people is off here",
};

/** What the facts ledger says when a decline read nothing: why, in the decline's own terms. */
export const DECLINE_LEDGER: Record<Decline, string> = {
  team_level: "Nothing was read. Ask answers at team level here.",
  judgement: "Nothing was read.",
  unknown_mention: "Nothing was read. That person is not on this board.",
  comparison_off: "Nothing was read. Comparing people is off.",
};

/** ["code_review", "test_sign_off"] reads "code review and test sign off". */
export function missingEvidenceText(missing: readonly string[]): string {
  const words = missing.map(humanize);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** What the "Answer ready" toast adds, by outcome: nothing for an answer, which is on the page. */
export function readyDescription(response: AskResponse): string | undefined {
  switch (response.outcome) {
    case "answered":
      // The answer is on the page: the toast says it is ready, and no more.
      return undefined;
    case "not_understood":
      switch (declineOf(response)) {
        case "team_level":
          return "Ask answers at team level.";
        case "judgement":
          return "Ask shows facts about people, not judgements.";
        case "unknown_mention":
          return "That person has no tickets on this board.";
        case "comparison_off":
          return "Comparing people is off. Ask about one person.";
        default:
          return "Jira data cannot answer that.";
      }
    case "no_data":
      // People mentioned who hold no tickets on the board: the answer is one sentence, and says it all.
      return response.answer?.trim() || "Nothing matched.";
    case "not_measurable":
      return "Jira holds no evidence for this.";
    case "not_verified":
      return "Only the facts are shown.";
  }
}

/** Questions are compared the way a reader would: case and spacing aside. */
export function sameQuestion(a: string, b: string): boolean {
  const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}
