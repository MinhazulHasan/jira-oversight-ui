import type { FactSet, PlanStep } from "@/lib/api/schemas";

import { isWork, STATUS, type StatusName } from "../catalogue";
import type { Dataset } from "../dataset";
import { findingsOfIssue } from "../findings";
import { mean } from "../stats";
import { iso } from "../time";
import { fixed } from "../verify";
import { cite, listed, type Piece } from "./compose";
import type { Matchable } from "./match";
import {
  coverageFacts,
  effortFacts,
  hotSpotsFacts,
  issueTimelineFacts,
  listFindingsFacts,
  listFindingsNeeds,
  ruleStatusFacts,
  timeInStatusFacts,
  topIssuesFacts,
  trendFacts,
} from "./tools";

/**
 * The questions the sample project can answer, each the way the live service
 * would: a plan of catalogue calls, the facts they return, and an answer that
 * quotes only those facts. Between them they reach all five outcomes.
 */

export type ScriptResult =
  | { outcome: "answered"; facts: FactSet[]; pieces: Piece[] }
  | { outcome: "no_data"; facts: FactSet[]; message: string; suggestions: string[] }
  | { outcome: "not_measurable"; plan: PlanStep[]; missing: string[]; message: string; suggestions: string[] }
  | { outcome: "not_verified"; facts: FactSet[]; drafts: string[] }
  | { outcome: "not_understood"; message: string; suggestions: string[] };

export interface Script extends Matchable {
  run(dataset: Dataset, question: string): ScriptResult;
}

export const SUGGESTED_QUESTIONS = [
  "Where do tickets get stuck most?",
  "Which epics have the most open breaches?",
  "How much work was estimated before it started?",
  "Which tickets went straight from To Do to Done this month?",
  "How is effort against estimate trending?",
  "Which rules can't be measured in Jira today?",
  "Which open tickets have burned the most of their estimate?",
  "Which tickets have been reopened after Done?",
  "What is the median cycle time this quarter?",
  "Which tickets reached testing without code review?",
] as const;

/** Fewer finished issues than this, and an epic's median is not worth a sentence. */
const MIN_FOR_A_MEDIAN = 5;

/** Rows with a number in `column`, with their index, so an answer can cite the cell it read. */
function numbered(fact: FactSet, column: string): { index: number; value: number }[] {
  return fact.rows.flatMap((row, index) => {
    const value = row[column];
    return typeof value === "number" ? [{ index, value }] : [];
  });
}

function isDone(status: string): boolean {
  return status in STATUS && STATUS[status as StatusName].category === "done";
}

function text(fact: FactSet, index: number, column: string): string {
  const value = fact.rows[index]?.[column];
  return typeof value === "string" ? value : "";
}

/** An epic as an answer names it: its key and title, or plain words for work with no epic. */
function epicName(fact: FactSet, index: number, keyColumn: string, titleColumn: string, start: boolean): Piece[] {
  const key = fact.rows[index]?.[keyColumn];
  if (typeof key === "string" && /^[A-Z][A-Z0-9_]+-\d+$/.test(key)) {
    return [cite.key(fact, index, keyColumn), ` ${text(fact, index, titleColumn)}`];
  }
  return [start ? "Work with no epic" : "work with no epic"];
}

/* ---------------------------------------------------------------- answers -- */

const stuck: Script = {
  id: "time-in-status",
  question: "Where do tickets get stuck most?",
  phrasings: [
    "Where does work get stuck?",
    "Where do tickets wait the longest?",
    "Which status do tickets spend the most time in?",
    "Where are the bottlenecks?",
    "How long do tickets sit in each status?",
  ],
  concepts: [["stuck"]],
  run(dataset) {
    const facts = timeInStatusFacts(dataset, "F1", "90d");
    // Time in Done is the gap before a reopen, not work waiting; only unfinished statuses can be "stuck".
    const ranked = numbered(facts, "median_h")
      .filter(({ index }) => Number(facts.rows[index].n) >= 5 && !isDone(text(facts, index, "group")))
      .sort((a, b) => b.value - a.value);
    if (ranked.length === 0) {
      return {
        outcome: "no_data",
        facts: [facts],
        message: "No status interval closed in the last 90 days, so there is no time in status to compare.",
        suggestions: [],
      };
    }
    const [top, next] = ranked;
    const pieces: Piece[] = [
      "Over the last ",
      cite.note(facts, "90"),
      ` days, work waited longest in ${text(facts, top.index, "group")}: a median of `,
      cite.hours(facts, top.index, "median_h"),
      " h across ",
      cite.count(facts, top.index, "n"),
      " closed intervals, with a p90 of ",
      cite.hours(facts, top.index, "p90_h"),
      " h.",
    ];
    if (next) {
      pieces.push(
        ` ${text(facts, next.index, "group")} came next, with a median of `,
        cite.hours(facts, next.index, "median_h"),
        " h and a p90 of ",
        cite.hours(facts, next.index, "p90_h"),
        " h.",
      );
    }
    return { outcome: "answered", facts: [facts], pieces };
  },
};

const hotSpots: Script = {
  id: "hot-spots",
  question: "Which epics have the most open breaches?",
  phrasings: [
    "Where are the hot spots?",
    "Which epics are in the worst shape?",
    "Which epics have the most problems?",
    "Show me the epics with the most breaches",
  ],
  concepts: [["epic", "breach"], ["breach"]],
  run(dataset) {
    const facts = hotSpotsFacts(dataset, "F1", 5);
    if (facts.rows.length === 0) {
      return {
        outcome: "no_data",
        facts: [facts],
        message: "No epic has an open finding. Looked at: every open finding, grouped by epic.",
        suggestions: [],
      };
    }
    const pieces: Piece[] = [
      ...epicName(facts, 0, "epic_key", "epic_title", true),
      " has the most open breaches, ",
      cite.count(facts, 0, "open_breaches"),
      ", with ",
      cite.count(facts, 0, "open_warnings"),
      " open warnings across ",
      cite.count(facts, 0, "issues"),
      " issues.",
    ];
    const following = [1, 2].filter((index) => index < facts.rows.length);
    if (following.length > 0) {
      pieces.push(
        " Next come ",
        ...listed(
          following.map((index) => [
            ...epicName(facts, index, "epic_key", "epic_title", false),
            " with ",
            cite.count(facts, index, "open_breaches"),
          ]),
        ),
        ".",
      );
    }
    return { outcome: "answered", facts: [facts], pieces };
  },
};

const estimatedFirst: Script = {
  id: "estimated-before-start",
  question: "How much work was estimated before it started?",
  phrasings: [
    "How much work had an estimate before it started?",
    "Do we estimate before starting work?",
    "How often is work estimated before development starts?",
    "Is work sized before it is picked up?",
  ],
  concepts: [["estimate", "start"]],
  run(dataset) {
    const coverage = coverageFacts(dataset, "F1", "estimate", "90d");
    const rules = ruleStatusFacts(dataset, "F2");
    const missing = rules.rows.findIndex((row) => row.rule_id === "R-EST-01");
    const late = rules.rows.findIndex((row) => row.rule_id === "R-EST-02");
    const pieces: Piece[] = [
      "Of the ",
      cite.count(coverage, 0, "total"),
      " issues created in the last ",
      cite.note(coverage, "90"),
      " days, ",
      cite.count(coverage, 0, "covered"),
      " have an estimate in story points (",
      cite.share(coverage, 0, "share"),
      "). Across all work, ",
      cite.count(rules, missing, "open_findings"),
      " issues started with no estimate and still have none (R-EST-01), and ",
      cite.count(rules, late, "open_findings"),
      " were estimated only after work had begun (R-EST-02).",
    ];
    return { outcome: "answered", facts: [coverage, rules], pieces };
  },
};

const straightToDone: Script = {
  id: "straight-to-done",
  question: "Which tickets went straight from To Do to Done this month?",
  phrasings: [
    "Which tickets skipped In Progress?",
    "What went straight to Done this month?",
    "Which tickets skipped a stage recently?",
    "Show tickets that jumped from To Do to Done",
  ],
  concepts: [["skip", "done"], ["skip"]],
  run(dataset) {
    const facts = listFindingsFacts(dataset, "F1", { rule_id: "R-FLOW-02", state: "all", period: "30d", n: 50 });
    const count = facts.rows.length;
    if (count === 0) {
      return {
        outcome: "no_data",
        facts: [facts],
        message:
          "No ticket went straight from To Do to Done in the last 30 days. Looked at: findings of R-FLOW-02 (Skipped a stage) first seen in that period.",
        suggestions: ["Which rules can't be measured in Jira today?"],
      };
    }
    const keys = (indexes: number[]) => listed(indexes.map((index) => [cite.key(facts, index, "issue_key")]));
    const pieces: Piece[] = [
      cite.rows(facts),
      count === 1 ? " ticket" : " tickets",
      " went straight from To Do to Done in the last ",
      cite.note(facts, "30"),
      " days",
    ];
    if (count <= 4) {
      pieces.push(": ", ...keys(facts.rows.map((_, index) => index)), ".");
    } else {
      pieces.push(". The most recent were ", ...keys([0, 1, 2, 3]), "; the table lists all ", cite.rows(facts), ".");
    }
    return { outcome: "answered", facts: [facts], pieces };
  },
};

const effortTrend: Script = {
  id: "effort-trend",
  question: "How is effort against estimate trending?",
  phrasings: [
    "Is effort running over the estimates?",
    "How has the effort ratio changed?",
    "Are we taking longer than we estimate?",
    "Effort versus estimate over time",
  ],
  concepts: [["effort", "trend"], ["effort", "estimate"]],
  run(dataset) {
    const trend = trendFacts(dataset, "F1", "median_effort_ratio", 12);
    const epics = effortFacts(dataset, "F2", "30d");
    const weeks = numbered(trend, "value");
    const last = trend.rows.length - 1;
    const fullWeeks = weeks.filter(({ index }) => index < last);
    if (fullWeeks.length < 2) {
      return {
        outcome: "no_data",
        facts: [trend, epics],
        message: "Too little estimated work finished in the last 12 weeks to show a trend.",
        suggestions: [],
      };
    }
    const first = fullWeeks[0];
    const latest = fullWeeks[fullWeeks.length - 1];
    const pieces: Piece[] = [
      "The median effort ratio was ",
      cite.ratio(trend, first.index, "value"),
      "× in the week of ",
      cite.day(trend, first.index, "week_of"),
      " and ",
      cite.ratio(trend, latest.index, "value"),
      "× in the week of ",
      cite.day(trend, latest.index, "week_of"),
      ".",
    ];
    if (weeks.some(({ index }) => index === last)) {
      pieces.push(" This week so far it is ", cite.ratio(trend, last, "value"), "×.");
    }
    // A median over a handful of issues is noise; the answer names only epics with enough finished work.
    const named = epics.rows.flatMap((row, index) => (Number(row.n) >= MIN_FOR_A_MEDIAN ? [index] : [])).slice(0, 2);
    if (named.length > 0) {
      const [top, next] = named;
      pieces.push(
        " Over the last ",
        cite.note(epics, "30"),
        " days, ",
        ...epicName(epics, top, "group", "epic_title", false),
        " has the highest median, ",
        cite.ratio(epics, top, "median_ratio"),
        "× across ",
        cite.count(epics, top, "n"),
        " finished issues, with ",
        cite.share(epics, top, "share_over_threshold"),
        " at or above the ",
        cite.ratio(epics, top, "threshold"),
        "× threshold",
      );
      if (next !== undefined) {
        pieces.push(", followed by ", ...epicName(epics, next, "group", "epic_title", false), " at ", cite.ratio(epics, next, "median_ratio"), "×");
      }
      pieces.push(".");
    }
    return { outcome: "answered", facts: [trend, epics], pieces };
  },
};

const notMeasurable: Script = {
  id: "unmeasurable-rules",
  question: "Which rules can't be measured in Jira today?",
  phrasings: [
    "What can't Jira measure?",
    "Which rules are not measurable?",
    "What parts of the process are not tracked in Jira?",
    "Which checks cannot run?",
  ],
  concepts: [["measure", "rule"], ["measure"]],
  run(dataset) {
    const facts = ruleStatusFacts(dataset, "F1");
    const missing = facts.rows.flatMap((row) => (row.measurable === false ? [`${row.rule_id} (${row.title})`] : []));
    const pieces: Piece[] = [
      "Of the ",
      cite.rows(facts),
      " rules in the catalogue, ",
      ...listed(missing.map((name) => [name])),
      ` can't be measured in Jira today. ${dataset.board.key}'s workflow has only To Do, In Progress and Done, and no field or pull-request link records a code review, so a rule that needs one cannot run. Every other rule runs on each sync.`,
    ];
    return { outcome: "answered", facts: [facts], pieces };
  },
};

const burned: Script = {
  id: "burned-estimate",
  question: "Which open tickets have burned the most of their estimate?",
  phrasings: [
    "Which tickets in progress are over their estimate?",
    "Which open tickets have used the most of their estimate?",
    "What is running over its estimate right now?",
  ],
  concepts: [["burn", "estimate"], ["open", "effort", "estimate"]],
  run(dataset) {
    const facts = topIssuesFacts(dataset, "F1", "effort_ratio", 5, "indeterminate");
    if (facts.rows.length === 0) {
      return {
        outcome: "no_data",
        facts: [facts],
        message: "No ticket in progress has an estimate to measure against. Looked at: every issue in progress.",
        suggestions: [],
      };
    }
    const pieces: Piece[] = [
      cite.key(facts, 0, "issue_key"),
      " has used ",
      cite.ratio(facts, 0, "value"),
      "× its estimate and is still in progress",
    ];
    const following = [1, 2].filter((index) => index < facts.rows.length);
    if (following.length > 0) {
      pieces.push(
        ", followed by ",
        ...listed(following.map((index) => [cite.key(facts, index, "issue_key"), " at ", cite.ratio(facts, index, "value"), "×"])),
      );
    }
    pieces.push(".");
    if (facts.rows.length > 1) pieces.push(" All ", cite.rows(facts), " are in the table, highest first.");
    return { outcome: "answered", facts: [facts], pieces };
  },
};

const reopened: Script = {
  id: "reopened",
  question: "Which tickets have been reopened after Done?",
  phrasings: ["Which tickets were reopened?", "What has been reopened?", "Show reopened tickets"],
  concepts: [["reopen"]],
  unless: ["recent"],
  run(dataset) {
    const findings = listFindingsFacts(dataset, "F1", { rule_id: "R-FLOW-03", state: "all", period: "all", n: 20 });
    const rules = ruleStatusFacts(dataset, "F2");
    const rule = rules.rows.findIndex((row) => row.rule_id === "R-FLOW-03");
    if (findings.rows.length === 0) {
      return {
        outcome: "no_data",
        facts: [findings, rules],
        message: "No ticket has been reopened after Done. Looked at: every finding of R-FLOW-03 (Reopened after Done).",
        suggestions: [],
      };
    }
    const recent = [0, 1, 2].filter((index) => index < findings.rows.length);
    const pieces: Piece[] = [
      cite.count(rules, rule, "open_findings"),
      " reopens after Done are on record (R-FLOW-03). The most recent were ",
      ...listed(recent.map((index) => [cite.key(findings, index, "issue_key")])),
      findings.truncated ? "; the table lists the latest " : "; the table lists all ",
      cite.rows(findings),
      ".",
    ];
    return { outcome: "answered", facts: [findings, rules], pieces };
  },
};

const issueStory: Script = {
  id: "issue-timeline",
  question: "What happened to DEMO-1?",
  phrasings: [],
  // Chosen by the key in the question, not by its words.
  concepts: [],
  run(dataset, question) {
    const key = /\b([A-Za-z][A-Za-z0-9_]{1,19})-(\d{1,9})\b/.exec(question);
    const issueKey = key ? `${key[1].toUpperCase()}-${Number(key[2])}` : "";
    const facts = issueTimelineFacts(dataset, "F1", issueKey);
    if (facts.rows.length === 0) {
      return {
        outcome: "no_data",
        facts: [facts],
        message: `${issueKey} is not in the synced data. Looked at: the status history of every issue in ${dataset.board.key}.`,
        suggestions: [],
      };
    }
    const moves = facts.rows.slice(1, 7).map((_, offset) => offset + 1);
    const pieces: Piece[] = [
      "This issue has ",
      cite.rows(facts),
      facts.rows.length === 1 ? " status interval" : " status intervals",
      ". It was created in ",
      text(facts, 0, "status"),
      " on ",
      cite.day(facts, 0, "entered_at"),
    ];
    if (moves.length > 0) {
      pieces.push(
        ", then moved to ",
        ...listed(moves.map((index) => [text(facts, index, "status"), " on ", cite.day(facts, index, "entered_at")])),
      );
    }
    pieces.push(".");
    const longest = numbered(facts, "hours").sort((a, b) => b.value - a.value)[0];
    if (longest) {
      pieces.push(" Its longest finished stay was ", cite.hours(facts, longest.index, "hours"), ` h in ${text(facts, longest.index, "status")}.`);
    }
    const open = [...new Set(findingsOfIssue(dataset, issueKey).filter((f) => f.state === "open").map((f) => f.rule_id))];
    pieces.push(
      open.length > 0 ? ` It has open findings for ${open.slice(0, -1).join(", ")}${open.length > 1 ? " and " : ""}${open[open.length - 1]}.` : " It has no open findings.",
    );
    return { outcome: "answered", facts: [facts], pieces };
  },
};

/* ------------------------------------------------- the other four outcomes -- */

const reopenedThisWeek: Script = {
  id: "reopened-this-week",
  question: "Which tickets were reopened this week?",
  phrasings: ["What was reopened in the last 7 days?", "Has anything been reopened recently?"],
  concepts: [["reopen", "recent"]],
  run(dataset) {
    const facts = listFindingsFacts(dataset, "F1", { rule_id: "R-FLOW-03", state: "all", period: "7d", n: 20 });
    if (facts.rows.length > 0) {
      const pieces: Piece[] = [
        cite.rows(facts),
        facts.rows.length === 1 ? " ticket was" : " tickets were",
        " reopened after Done in the last ",
        cite.note(facts, "7"),
        " days: ",
        ...listed(facts.rows.map((_, index) => [cite.key(facts, index, "issue_key")])),
        ".",
      ];
      return { outcome: "answered", facts: [facts], pieces };
    }
    return {
      outcome: "no_data",
      facts: [facts],
      message:
        "No ticket was reopened after Done in the last 7 days. Looked at: every finding of R-FLOW-03 (Reopened after Done) first seen in that period.",
      suggestions: ["Which tickets have been reopened after Done?"],
    };
  },
};

const reviewBeforeTesting: Script = {
  id: "testing-without-review",
  question: "Which tickets reached testing without code review?",
  phrasings: [
    "Did anything go to QA without a code review?",
    "Which tickets skipped code review?",
    "Is code review happening before testing?",
  ],
  concepts: [["review", "test"], ["review"]],
  run(dataset) {
    const params = { rule_id: "R-FLOW-01", state: "all", period: "all", n: 20 };
    return {
      outcome: "not_measurable",
      plan: [{ tool: "oversight_list_findings", params }],
      missing: listFindingsNeeds("R-FLOW-01"),
      message:
        `Jira holds no code-review evidence for ${dataset.board.key}: no status, field or pull-request link records a review, and the workflow has no testing status. R-FLOW-01, the rule that would answer this, cannot run. That gap is itself a finding: the agreed process puts code review before testing, and Jira cannot show that either happened.`,
      suggestions: ["Which rules can't be measured in Jira today?", "Which tickets went straight from To Do to Done this month?"],
    };
  },
};

const cycleTime: Script = {
  id: "cycle-time-quarter",
  question: "What is the median cycle time this quarter?",
  phrasings: ["How long does work take from start to Done?", "What is our cycle time?", "How long do tickets take?"],
  concepts: [["cycle"]],
  run(dataset) {
    const facts = trendFacts(dataset, "F1", "median_cycle_time_h", 12);
    const weekly = numbered(facts, "value").map(({ value }) => value);
    // A quarter's median is not the average of weekly medians, and the facts hold no quarterly figure:
    // what a model writes here is a number the facts cannot vouch for, so the answer is withheld.
    const average = mean(weekly) ?? 0;
    return {
      outcome: "not_verified",
      facts: [facts],
      drafts: [
        `The median cycle time this quarter is about ${fixed(average / 24, 1)} days.`,
        `Across the quarter, work took a median of ${fixed(average, 1)} hours from the start of development to Done.`,
      ],
    };
  },
};

/** How many sample keys a count lists (the service's SAMPLE_KEYS). */
const COUNT_SAMPLE_KEYS = 5;

/**
 * "How many open tickets are there?" (or in progress): the board's work by
 * status category, Epics left out, as the Overview's where work sits and the
 * Portfolio count it, as the service's oversight_count_issues with `state`
 * answers it: one meaning of open tickets everywhere.
 */
export function countAnswer(dataset: Dataset, state: "open" | "in_progress"): ScriptResult {
  const counted = dataset.world.issues
    .filter((issue) => isWork(issue) && (state === "open" ? STATUS[issue.status].category !== "done" : STATUS[issue.status].category === "indeterminate"))
    .sort((a, b) => b.createdAt - a.createdAt || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const keys = counted.slice(0, COUNT_SAMPLE_KEYS).map((issue) => issue.key);
  const words = state === "open" ? "open (status not done)" : "in progress";
  const notes = [`the board's work ${words}, Epic left out, as the Overview and the Portfolio count it`];
  if (counted.length > COUNT_SAMPLE_KEYS) notes.push(`sample_keys lists the ${COUNT_SAMPLE_KEYS} most recent of ${counted.length.toLocaleString("en-GB")} issues`);
  const fact: FactSet = {
    ref: "F1",
    tool: "oversight_count_issues",
    params: { project: dataset.board.key, period: "all", state },
    columns: [
      { key: "count", label: "Issues", kind: "count" },
      { key: "sample_keys", label: "Most recent keys", kind: "text" },
    ],
    rows: [{ count: counted.length, sample_keys: keys.join(", ") }],
    truncated: false,
    as_of: iso(dataset.world.syncAt),
    note: notes.join("; "),
  };
  const [one, many] = state === "open" ? ["open ticket", "open tickets"] : ["ticket in progress", "tickets in progress"];
  const pieces: Piece[] = [counted.length === 1 ? "There is " : "There are ", cite.count(fact, 0, "count"), ` ${counted.length === 1 ? one : many}.`];
  return { outcome: "answered", facts: [fact], pieces };
}

export const SCRIPTS: readonly Script[] = [
  reviewBeforeTesting,
  reopenedThisWeek,
  reopened,
  straightToDone,
  estimatedFirst,
  effortTrend,
  burned,
  hotSpots,
  stuck,
  notMeasurable,
  cycleTime,
];

export const ISSUE_SCRIPT: Script = issueStory;
