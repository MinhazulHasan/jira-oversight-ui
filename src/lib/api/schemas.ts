import { z } from "zod";

/* ------------------------------------------------------------ primitives -- */

export const isoDateTime = z.iso.datetime({ offset: true });
/** A calendar day, `YYYY-MM-DD`. Weekly series use the Monday the week starts on. */
export const isoDate = z.iso.date();

/** Jira keys as the backend's catalogue accepts them: a 2 to 20 character project key. */
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,8}$/;
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,19}$/;
export const RULE_ID_PATTERN = /^[RW]-[A-Z]+-\d{2,3}$/;
/** A rule id inside running text (an insight, an answer), as the pattern above reads it. */
export const RULE_ID_IN_TEXT = /\b[RW]-[A-Z]+-\d{2,3}\b/g;
/** sha256(rule_id, rule_version, issue_key, evidence_key)[:32], as the rule engine writes it. */
export const FINDING_ID_PATTERN = /^[0-9a-f]{32}$/;

export const issueKey = z.string().regex(ISSUE_KEY_PATTERN);
export const projectKey = z.string().regex(PROJECT_KEY_PATTERN);
export const ruleId = z.string().regex(RULE_ID_PATTERN);
export const findingId = z.string().regex(FINDING_ID_PATTERN);

const count = z.number().int().nonnegative();
const fraction = z.number().min(0).max(1);
const nonNegative = z.number().nonnegative();

export const dataModeSchema = z.enum(["sample", "live"]);
export const severitySchema = z.enum(["breach", "warning"]);
/** `rule` is one of James's hard and fast rules; `warning` an early warning. */
export const ruleKindSchema = z.enum(["rule", "warning"]);
export const findingStateSchema = z.enum(["open", "resolved"]);
export const statusCategorySchema = z.enum(["new", "indeterminate", "done"]);
/** James's process, in order (config/process.yaml). */
export const STAGES = [
  "backlog",
  "estimate",
  "development",
  "code_review",
  "dev_signoff",
  "testing",
  "test_review",
  "test_signoff",
  "done",
] as const;
export const stageSchema = z.enum(STAGES);

/** How a bare number should be read: it decides the formatter (src/lib/format.ts). */
export const valueUnitSchema = z.enum(["count", "hours", "ratio", "share", "points", "days"]);

export const TREND_METRICS = [
  "median_cycle_time_h",
  "median_effort_ratio",
  "skipped_stage_share",
  "reopen_rate",
  "open_breaches",
  "open_warnings",
] as const;
export const trendMetricSchema = z.enum(TREND_METRICS);
/** Which way is better, so a delta can be called good or bad without guessing. */
export const directionSchema = z.enum(["up", "down"]);

/* ------------------------------------------------------------------ meta -- */

/** Provenance carried by every response, so any figure can be dated and sourced. */
export const metaSchema = z.object({
  data_mode: dataModeSchema,
  /** The start of the last successful sync of Jira. Every figure is as of this moment. */
  last_synced_at: isoDateTime,
  projects: z.array(projectKey).min(1),
  rules_version: z.string().min(1),
  process_version: z.string().min(1),
  /** When this response was computed. */
  generated_at: isoDateTime,
  /** The Jira account's IANA zone; report days (the baseline window) are cut in it. */
  report_timezone: z.string().min(1),
});

export const serviceMetaSchema = metaSchema.extend({
  last_synced_at: isoDateTime.nullable(),
});

/* ---------------------------------------------------------------- health -- */

export const healthSchema = z.object({
  meta: serviceMetaSchema.optional(),
  status: z.enum(["ok", "degraded"]),
  /** Why the service is degraded, in plain words; null when ok. */
  message: z.string().nullable().default(null),
  data_mode: dataModeSchema,
  /** Nothing reachable through this interface can change Jira. */
  read_only: z.literal(true),
  api_version: z.string().min(1),
  /** The start of the board's last successful sync; null before its first. */
  last_synced_at: isoDateTime.nullable(),
  projects: z.array(projectKey).min(1),
  report_timezone: z.string().min(1),
});

/* -------------------------------------------------------------- projects -- */

export const projectSummarySchema = z
  .object({
    key: projectKey,
    /** The board's name as people know it; the key when the service has none. */
    name: z.string().min(1),
    issues: count,
    last_synced_at: isoDateTime.nullable(),
    /** Whether the board has synced at least once: exactly when it has a sync time. */
    synced: z.boolean(),
    /** Jira's project type ("software", "business", "service_desk", ...); null when the service does not know it. */
    type: z.string().min(1).max(64).nullable(),
  })
  .refine((board) => board.synced === (board.last_synced_at !== null), {
    message: "synced must be true exactly when there is a sync time",
    path: ["synced"],
  });

export const projectsSchema = z
  .object({
    default: projectKey,
    projects: z.array(projectSummarySchema).min(1),
  })
  .refine((body) => body.projects.some((p) => p.key === body.default), {
    message: "the default board is not in the list",
    path: ["default"],
  });

/* ---------------------------------------------------------------- people -- */

/** "p" and the first 12 hex characters of sha256 of the Jira account id: stable, and never the account id itself. */
export const PERSON_ID_PATTERN = /^p[0-9a-f]{12}$/;
export const AVATAR_VERSION_PATTERN = /^[0-9a-f]{12}$/;
/** The filter and facet value for tickets nobody is assigned to (null wherever a person goes). */
export const UNASSIGNED = "unassigned";
export const UNASSIGNED_LABEL = "Unassigned";
/** A display name's limit, in characters (code points, as the service's Python counts them, not UTF-16 units). */
export const PERSON_NAME_MAX = 128;

export const personId = z.string().regex(PERSON_ID_PATTERN);
/** A picture's version, or null when the service holds no picture of the person. */
export const avatarVersion = z.string().regex(AVATAR_VERSION_PATTERN).nullable();

/** What a person reads as when Jira gave no usable name. */
export const UNNAMED_ACCOUNT = "Unnamed account";
/** An email address anywhere in a name: "someone@example.com", "Jo Bloggs (jo@corp.example)". */
const EMAIL_IN_NAME = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

const personName = z
  .string()
  .min(1)
  .refine((name) => [...name].length <= PERSON_NAME_MAX, { message: `at most ${PERSON_NAME_MAX} characters` })
  .transform((name) => (EMAIL_IN_NAME.test(name) ? UNNAMED_ACCOUNT : name));

export const personSchema = z.object({
  id: personId,
  name: personName,
  avatar: avatarVersion,
});

export const personSummarySchema = z
  .object({
    person: personSchema.nullable(),
    /** Their tickets on the board: its work, of every status (Epics left out, as the scorecard counts them). */
    tickets: z.number().int().min(1),
    /** Those whose status category is not done. */
    open_tickets: count,
    /** Open findings on those tickets, by severity. */
    open_breaches: count,
    open_warnings: count,
    /** Distinct tickets with at least one open finding. */
    tickets_with_findings: count,
  })
  .superRefine((row, ctx) => {
    if (row.open_tickets > row.tickets) {
      ctx.addIssue({ code: "custom", path: ["open_tickets"], message: "more open tickets than tickets" });
    }
    const open = row.open_breaches + row.open_warnings;
    if (row.tickets_with_findings > Math.min(row.tickets, open) || (open > 0 && row.tickets_with_findings === 0)) {
      ctx.addIssue({ code: "custom", path: ["tickets_with_findings"], message: "does not fit the tickets and open findings" });
    }
  });

export const peopleSchema = z
  .object({
    meta: metaSchema,
    people: z.array(personSummarySchema),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.people.forEach((row, index) => {
      const id = row.person?.id ?? UNASSIGNED;
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["people", index, "person"], message: "listed twice" });
      seen.add(id);
    });
  });

export const directoryEntrySchema = z.object({
  person: personSchema,
  tickets: count,
});

export const peopleDirectorySchema = z
  .object({
    meta: metaSchema,
    people: z.array(directoryEntrySchema),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.people.forEach((entry, index) => {
      if (seen.has(entry.person.id)) ctx.addIssue({ code: "custom", path: ["people", index, "person"], message: "listed twice" });
      seen.add(entry.person.id);
    });
  });

/* ------------------------------------------------------------- scorecard -- */

/** The periods a scorecard reads (GET /people/scorecard `days`): the last 30, 90 or 180 days to the snapshot. */
export const SCORECARD_DAYS = [30, 90, 180] as const;
export type ScorecardDays = (typeof SCORECARD_DAYS)[number];
export const SCORECARD_DEFAULT_DAYS: ScorecardDays = 90;
/** The most people one scorecard request may name (`person`, repeatable): an eleventh is refused. */
export const SCORECARD_MAX_PEOPLE = 10;

export const SCORECARD_MEASURES = [
  { key: "open_tickets", label: "Open tickets", kind: "count", direction: "neutral" },
  { key: "in_progress", label: "In progress now", kind: "count", direction: "neutral" },
  { key: "done_in_period", label: "Done in the period", kind: "count", direction: "neutral" },
  { key: "estimated_before_start", label: "Estimated before work started", kind: "rate", direction: "higher_is_closer" },
  { key: "time_logged", label: "Time logged on done work", kind: "rate", direction: "higher_is_closer" },
  { key: "within_estimate", label: "Done within the effort limit", kind: "rate", direction: "higher_is_closer" },
  { key: "stuck_now", label: "Open tickets stuck in a status", kind: "rate", direction: "lower_is_closer" },
  { key: "reopened", label: "Reopened after Done", kind: "rate", direction: "lower_is_closer" },
  { key: "skipped_stage", label: "Skipped a stage", kind: "rate", direction: "lower_is_closer" },
  { key: "code_review", label: "Code review recorded", kind: "rate", direction: "higher_is_closer" },
  { key: "open_findings_per_10", label: "Open findings per 10 open tickets", kind: "ratio", direction: "lower_is_closer" },
] as const;

export type ScorecardMeasureKey = (typeof SCORECARD_MEASURES)[number]["key"];
export const SCORECARD_MEASURE_KEYS = SCORECARD_MEASURES.map((measure) => measure.key) as unknown as readonly [
  ScorecardMeasureKey,
  ...ScorecardMeasureKey[],
];
export const scorecardMeasureKeySchema = z.enum(SCORECARD_MEASURE_KEYS);
export const scorecardKindSchema = z.enum(["count", "rate", "ratio"]);
export const scorecardDirectionSchema = z.enum(["neutral", "higher_is_closer", "lower_is_closer"]);
/** Where one value stands next to the board's: only for rates and ratios, and only when both have enough tickets. */
export const vsBoardSchema = z.enum(["closer", "further", "level"]);

/** A measure as the service describes it for this board: what it is, which way is closer, and whether the board can show it. */
export const scorecardMeasureSchema = z.object({
  key: scorecardMeasureKeySchema,
  label: z.string().min(1),
  kind: scorecardKindSchema,
  direction: scorecardDirectionSchema,
  /** The rules whose findings are the tickets behind it ([] for none). */
  rule_ids: z.array(ruleId),
  measurable: z.boolean(),
  /** Why the board cannot show it, in plain words; null when it can. */
  reason: z.string().min(1).nullable(),
});

export const scorecardValueSchema = z.object({
  value: z.number().nonnegative().nullable(),
  numerator: count.nullable(),
  denominator: count.nullable(),
  enough: z.boolean(),
  vs_board: vsBoardSchema.nullable(),
});

const scorecardValuesSchema = z.object(
  Object.fromEntries(SCORECARD_MEASURE_KEYS.map((key) => [key, scorecardValueSchema])) as Record<
    ScorecardMeasureKey,
    typeof scorecardValueSchema
  >,
);

/** One person's scorecard: their tickets on the board now (every type), and a value for every measure. */
export const scorecardPersonSchema = z.object({
  person: personSchema,
  tickets: count,
  values: scorecardValuesSchema,
});

export const peopleScorecardSchema = z
  .object({
    meta: metaSchema,
    period: z.object({
      days: z.literal(SCORECARD_DAYS),
      from: isoDateTime,
      /** The snapshot's as-of: the figures are as of the last sync. */
      to: isoDateTime,
    }),
    /** Whose a ticket is: the person it is assigned to now, as findings are. */
    basis: z.literal("current_assignee"),
    comparison: z.enum(["on", "off"]),
    /** Always all eleven, in the contract's order. */
    measures: z.array(scorecardMeasureSchema),
    /** Every ticket on the board, assigned or not. */
    board: z.object({ tickets: count, values: scorecardValuesSchema }),
    /** By name folded for case and accents, then id (the directory's order). */
    people: z.array(scorecardPersonSchema),
  })
  .superRefine((body, ctx) => {
    const keys = body.measures.map((measure) => measure.key);
    if (keys.length !== SCORECARD_MEASURES.length || keys.some((key, index) => key !== SCORECARD_MEASURES[index].key)) {
      ctx.addIssue({ code: "custom", path: ["measures"], message: "not the eleven measures in the contract's order" });
      return;
    }
    if (Date.parse(body.period.from) >= Date.parse(body.period.to)) {
      ctx.addIssue({ code: "custom", path: ["period", "from"], message: "the period starts after it ends" });
    }
    if (body.comparison === "off" && body.people.length > 1) {
      ctx.addIssue({ code: "custom", path: ["people"], message: "more than one person while comparison is off" });
    }
    const seen = new Set<string>();
    body.people.forEach((row, index) => {
      if (seen.has(row.person.id)) ctx.addIssue({ code: "custom", path: ["people", index, "person"], message: "listed twice" });
      seen.add(row.person.id);
    });
    body.measures.forEach((measure, position) => {
      const contract = SCORECARD_MEASURES[position];
      if (measure.kind !== contract.kind || measure.direction !== contract.direction) {
        ctx.addIssue({ code: "custom", path: ["measures", position], message: "kind or direction is not the contract's" });
      }
      if (measure.measurable === (measure.reason !== null)) {
        ctx.addIssue({ code: "custom", path: ["measures", position, "reason"], message: "a reason is given exactly when it is not measurable" });
      }
      const check = (value: ScorecardValue, board: ScorecardValue | null, path: (string | number)[]) =>
        scorecardValueProblems(measure, value, board).forEach((message) => ctx.addIssue({ code: "custom", path, message }));
      check(body.board.values[measure.key], null, ["board", "values", measure.key]);
      body.people.forEach((row, index) => check(row.values[measure.key], body.board.values[measure.key], ["people", index, "values", measure.key]));
    });
  });

export function scorecardValueProblems(
  measure: Pick<ScorecardMeasure, "kind" | "measurable">,
  value: ScorecardValue,
  board: ScorecardValue | null,
): string[] {
  const problems: string[] = [];
  if (!measure.measurable) {
    const empty = value.value === null && value.numerator === null && value.denominator === null && !value.enough && value.vs_board === null;
    return empty ? [] : ["a measure the board cannot show holds a value"];
  }
  // Nothing to work out (no tickets, or a denominator of 0): never enough, never compared, whatever counts come with it.
  if (value.value === null) return value.enough || value.vs_board !== null ? ["no value, yet enough or compared"] : [];
  if (measure.kind === "count") {
    if (!Number.isInteger(value.value) || value.numerator !== null || value.denominator !== null) problems.push("a count is a whole number on its own");
    if (!value.enough || value.vs_board !== null) problems.push("a count is always enough and never compared");
    return problems;
  }
  const { numerator, denominator } = value;
  if (numerator === null || denominator === null || denominator === 0 || (measure.kind === "rate" && numerator > denominator)) {
    return ["a rate or ratio needs a numerator and a denominator that fit it"];
  }
  const exact = (measure.kind === "rate" ? 100 : 10) * (numerator / denominator);
  const step = measure.kind === "rate" ? 1 : 0.1;
  if (Math.abs(value.value - exact) > step / 2 + 1e-9 || Math.abs(value.value / step - Math.round(value.value / step)) > 1e-6) {
    problems.push(measure.kind === "rate" ? "not its numerator over its denominator as a whole percentage" : "not ten times its numerator over its denominator, to one decimal");
  }
  if (value.vs_board !== null && (board === null || !value.enough || !board.enough)) problems.push("compared, with too few tickets on one side");
  if (board !== null && value.enough && board.enough && board.value !== null && value.vs_board === null) problems.push("not compared, with enough tickets on both sides");
  return problems;
}

export const SCORECARD_SENTENCES = {
  /** People level, only where an organisation has turned comparison off: a question comparing people. */
  comparisonOff: "Comparing people side by side is turned off. Ask about one person at a time instead.",
  /** After the figures, for a personnel question (fire, promote, blame, trust, ...): never declined. */
  decision: "The figures are above; the decision is yours.",
} as const;

/** The board's own caveat sentence for code review: said when the board cannot show it. */
export const CODE_REVIEW_CAVEAT = " Code review isn't recorded on this board, so reviewers' work doesn't show.";

/** Why the code review measure is not measurable on a board that records no code review in Jira (the contract's words). */
export const CODE_REVIEW_NOT_RECORDED = "This board doesn't record code review in Jira.";

export function recordsCodeReview(measures: readonly Pick<ScorecardMeasure, "key" | "measurable" | "reason">[]): boolean {
  const codeReview = measures.find((measure) => measure.key === "code_review");
  return codeReview !== undefined && (codeReview.measurable || codeReview.reason !== CODE_REVIEW_NOT_RECORDED);
}

export function scorecardCaveat(days: number, codeReviewRecorded: boolean): string {
  return `Figures from Jira over the last ${days} days, next to the whole board, by each ticket's current assignee.${codeReviewRecorded ? "" : CODE_REVIEW_CAVEAT}`;
}

/* ----------------------------------------------------------- person card -- */

/** The tickets in progress a person card lists by name: the rest are counted (`in_progress_more`). */
export const PERSON_CARD_TICKETS = 3;

/** Whether someone holds any of the board's tickets now (any status), or is one of its members who holds none. */
export const personCardMembershipSchema = z.enum(["holds_tickets", "member_no_tickets"]);

/** One of their tickets in progress now: its key, its summary, its status, and when it last went into progress. */
export const personCardTicketSchema = z.object({
  key: issueKey,
  /** As Jira has it; empty when Jira gave none. */
  summary: z.string(),
  /** The status's name as Jira shows it ("In Progress", "In Review"). */
  status: z.string().min(1),
  since: isoDateTime.nullable(),
});

/** Another board they hold open tickets on, with how many: a board the reader may open (this interface's server keeps no other). */
export const personCardBoardSchema = z.object({
  key: projectKey,
  name: z.string().min(1),
  open_tickets: z.number().int().min(1),
});

export const personCardProcessSchema = z
  .object({
    closer: count,
    level: count,
    further: count,
    too_few: count,
    measurable: count,
  })
  .superRefine((process, ctx) => {
    if (process.closer + process.level + process.further + process.too_few !== process.measurable) {
      ctx.addIssue({ code: "custom", path: ["measurable"], message: "not closer, level, further and too few together" });
    }
    if (process.closer + process.level + process.further === 0) {
      ctx.addIssue({ code: "custom", path: ["closer"], message: "compared on no measure, yet not null" });
    }
  });

export const personCardSchema = z
  .object({
    meta: metaSchema,
    person: personSchema,
    /** The board read: the top bar's pick, or the one the page named (an access log entry's). */
    board: z.object({ key: projectKey, name: z.string().min(1) }),
    membership: personCardMembershipSchema,
    work: z.object({
      open_tickets: count,
      in_progress: count,
      done_in_period: count,
      days: z.literal(SCORECARD_DAYS),
    }),
    /** Open findings on every ticket they hold, finished ones too: what Findings filtered to them lists. */
    findings: z.object({ open_breaches: count, open_warnings: count }),
    process: personCardProcessSchema.nullable(),
    /** At most three, longest in progress first. */
    in_progress_now: z.array(personCardTicketSchema).max(PERSON_CARD_TICKETS),
    /** How many more of their tickets are in progress than are listed. */
    in_progress_more: count,
    /** Every other board they hold open tickets on, that the reader may open. */
    other_boards: z.array(personCardBoardSchema),
    /** The latest status change or logged work on the tickets they hold here; null when there is none. */
    last_activity_at: isoDateTime.nullable(),
  })
  // Only what no reading of the figures allows: a card that contradicts itself is never shown as if it were true.
  .superRefine((card, ctx) => {
    const { work } = card;
    if (work.in_progress > work.open_tickets) ctx.addIssue({ code: "custom", path: ["work", "in_progress"], message: "more in progress than open" });
    if (card.in_progress_now.length + card.in_progress_more !== work.in_progress) {
      ctx.addIssue({ code: "custom", path: ["in_progress_more"], message: "the tickets listed and counted are not the ones in progress" });
    }
    if (card.in_progress_now.length < Math.min(work.in_progress, PERSON_CARD_TICKETS)) {
      ctx.addIssue({ code: "custom", path: ["in_progress_now"], message: "fewer tickets listed than there are to list" });
    }
    const keys = new Set<string>();
    card.in_progress_now.forEach((ticket, index) => {
      if (keys.has(ticket.key)) ctx.addIssue({ code: "custom", path: ["in_progress_now", index, "key"], message: "listed twice" });
      keys.add(ticket.key);
      const before = card.in_progress_now[index - 1];
      // Longest first; one whose start is not known (null) only after every one whose start is.
      const outOfOrder = before && (before.since === null ? ticket.since !== null : ticket.since !== null && Date.parse(ticket.since) < Date.parse(before.since));
      if (outOfOrder) {
        ctx.addIssue({ code: "custom", path: ["in_progress_now", index, "since"], message: "not the longest in progress first" });
      }
    });
    const boards = new Set<string>([card.board.key]);
    card.other_boards.forEach((board, index) => {
      if (boards.has(board.key)) ctx.addIssue({ code: "custom", path: ["other_boards", index, "key"], message: "the board read, or listed twice" });
      boards.add(board.key);
    });
    if (card.membership === "member_no_tickets") {
      const anything =
        work.open_tickets + work.in_progress + work.done_in_period + card.findings.open_breaches + card.findings.open_warnings + card.in_progress_more > 0 ||
        card.in_progress_now.length > 0 ||
        card.process !== null;
      if (anything) ctx.addIssue({ code: "custom", path: ["membership"], message: "a member who holds no tickets, with figures" });
    }
  });

/* --------------------------------------------------------------- refresh -- */

/** A board's sync, as GET and POST /refresh report it. */
export const REFRESH_STATES = ["idle", "queued", "running", "succeeded", "failed"] as const;
/** The states a sync is still under way in: waiting its turn behind another board's, or running. */
export const REFRESH_UNDER_WAY: readonly (typeof REFRESH_STATES)[number][] = ["queued", "running"];

export const refreshSchema = z.object({
  project: projectKey,
  state: z.enum(REFRESH_STATES),
  started_at: isoDateTime.nullable(),
  finished_at: isoDateTime.nullable(),
  /** Why the last refresh failed, in plain words; null otherwise. */
  message: z.string().min(1).nullable(),
});

/* ------------------------------------------------------- shared pieces -- */

export const trendPointSchema = z.object({
  t: isoDate,
  value: z.number().nullable(),
});

/** A status interval: the time an issue spent in one status. */
export const intervalSchema = z.object({
  status: z.string().min(1),
  stage: stageSchema.nullable(),
  status_category: statusCategorySchema,
  entered_at: isoDateTime,
  /** null while the issue is still in this status. */
  left_at: isoDateTime.nullable(),
  /** Calendar hours; null while still in this status (measure to meta.last_synced_at). */
  hours: nonNegative.nullable(),
});

/** One line of a finding's evidence: what the rule saw, and where in Jira. */
export const evidenceItemSchema = z.object({
  kind: z.enum(["status_change", "field_change", "metric", "sprint"]),
  label: z.string().min(1),
  /** A number to format by `unit`, a text value, or null for "none". */
  value: z.union([z.string(), z.number()]).nullable(),
  unit: valueUnitSchema.nullable(),
  /** For changes: the value before and after. */
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** When it happened in Jira, if it is an event. */
  at: isoDateTime.nullable(),
  /** The Jira changelog entry, for changes. */
  changelog_id: z.string().nullable(),
});

/** "Warned on X, breached on Y": the warning that foreshadowed this breach. */
export const warnedBeforeSchema = z.object({
  warning_rule_id: ruleId,
  warning_finding_id: findingId,
  warned_at: isoDateTime,
});

export const findingSchema = z
  .object({
    finding_id: findingId,
    rule_id: ruleId,
    rule_title: z.string().min(1),
    rule_version: z.string().min(1),
    kind: ruleKindSchema,
    severity: severitySchema,
    state: findingStateSchema,
    /** Short, team level, names nobody. */
    message: z.string().min(1),
    /** Most rules look at one issue; W-SPR-01 looks at a sprint. */
    scope: z.enum(["issue", "sprint"]),
    issue_key: issueKey.nullable(),
    issue_summary: z.string().nullable(),
    issue_type: z.string().nullable(),
    epic_key: issueKey.nullable(),
    epic_title: z.string().nullable(),
    /** Who the issue is assigned to now; null when nobody is, and for every sprint finding. */
    assignee: personSchema.nullable(),
    sprint: z.object({ sprint_id: z.number().int(), name: z.string().min(1) }).nullable(),
    first_seen_at: isoDateTime,
    last_seen_at: isoDateTime,
    resolved_at: isoDateTime.nullable(),
    resolved_why: z.enum(["cleared", "superseded", "settings_changed"]).nullable(),
    /** The rule's threshold as text ("1.5×"), or null for rules without one. */
    threshold: z.string().nullable(),
    evidence: z.array(evidenceItemSchema),
    warned_before: warnedBeforeSchema.nullable(),
  })
  .superRefine((finding, ctx) => {
    if (finding.scope === "issue" && finding.issue_key === null) {
      ctx.addIssue({ code: "custom", path: ["issue_key"], message: "an issue finding needs its issue key" });
    }
    if (finding.scope === "sprint" && finding.sprint === null) {
      ctx.addIssue({ code: "custom", path: ["sprint"], message: "a sprint finding needs its sprint" });
    }
    if (finding.scope === "sprint" && finding.assignee !== null) {
      ctx.addIssue({ code: "custom", path: ["assignee"], message: "a sprint finding belongs to no one" });
    }
    if ((finding.state === "resolved") !== (finding.resolved_at !== null)) {
      ctx.addIssue({ code: "custom", path: ["resolved_at"], message: "resolved_at is set exactly when the finding is resolved" });
    }
  });

/* -------------------------------------------------------------- overview -- */

/** One 7-day window, ending at `end_at`. */
export const windowPointSchema = z.object({ end_at: isoDateTime, value: count });

export const windowTotalSchema = z.object({
  current: count,
  previous: count,
  series: z.array(windowPointSchema).min(2).max(12),
});

export const hotSpotSchema = z.object({
  /** null groups the issues that belong to no epic. */
  epic_key: issueKey.nullable(),
  epic_title: z.string().min(1),
  open_breaches: count,
  open_warnings: count,
  /** Distinct issues with at least one open finding. */
  issues: count,
  /** Open findings (breaches and warnings) at the end of each week. */
  series: z.array(trendPointSchema),
});

export const ruleSummarySchema = z.object({
  rule_id: ruleId,
  title: z.string().min(1),
  severity: severitySchema,
  kind: ruleKindSchema,
  open: count,
  measurable: z.boolean(),
  /** Evidence sources or stages the project lacks; empty when measurable. */
  missing_evidence: z.array(z.string()),
});

export const coverageEntrySchema = z.object({
  /** null when Jira holds no evidence to count. */
  covered: count.nullable(),
  total: count,
  share: fraction.nullable(),
  measurable: z.boolean(),
  /** What was counted, over which issues. */
  note: z.string().min(1),
});

export const trendCardSchema = z.object({
  metric: trendMetricSchema,
  label: z.string().min(1),
  unit: valueUnitSchema,
  /** The current week to date (the last point). */
  current: z.number().nullable(),
  /** The week before (the second-to-last point). */
  previous: z.number().nullable(),
  direction_good: directionSchema,
  points: z.array(trendPointSchema),
});

export const insightSentenceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** James's framing: blatantly bad, or on its way to being bad. */
  tone: z.enum(["blatantly_bad", "trending_bad", "neutral"]),
  candidate_ids: z.array(z.string()),
  issue_keys: z.array(issueKey),
  finding_ids: z.array(findingId),
});

export const overviewSchema = z.object({
  meta: metaSchema,
  totals: z.object({
    open_breaches: windowTotalSchema,
    open_warnings: windowTotalSchema,
    /** Findings first seen in each 7-day window. */
    new_7d: windowTotalSchema,
    /** Findings resolved in each 7-day window. */
    resolved_7d: windowTotalSchema,
    /** Issues the rules look at (every type but Epic), created by each window's end. */
    issues_in_scope: windowTotalSchema,
    rules_not_measurable: windowTotalSchema,
  }),
  /** The top five by open breaches, then open warnings. */
  hot_spots: z.array(hotSpotSchema).max(5),
  by_rule: z.array(ruleSummarySchema),
  /** Over issues created in the last 90 days (Epics left out). */
  coverage: z.object({
    estimate: coverageEntrySchema,
    story_points: coverageEntrySchema,
    time_logged: coverageEntrySchema,
    code_review: coverageEntrySchema,
    test_evidence: coverageEntrySchema,
  }),
  trend_cards: z.object({
    median_cycle_time_h: trendCardSchema,
    median_effort_ratio: trendCardSchema,
    skipped_stage_share: trendCardSchema,
    reopen_rate: trendCardSchema,
  }),
  tracking_since: isoDateTime.nullable().optional(),
  /** Where work sits now: issues by current status (Epics left out). */
  status_mix: z.array(
    z.object({
      status: z.string().min(1),
      stage: stageSchema.nullable(),
      status_category: statusCategorySchema,
      count,
    }),
  ),
  /** The first two sentences of the latest weekly insight, or null before the first. */
  latest_insight: z
    .object({
      week_of: isoDate,
      generated_at: isoDateTime,
      verified: z.boolean(),
      sentences: z.array(insightSentenceSchema).max(2),
    })
    .nullable(),
});

/* -------------------------------------------------------------- findings -- */

export const facetEntrySchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  count,
});

export const personFacetEntrySchema = facetEntrySchema
  .extend({
    value: z.union([personId, z.literal(UNASSIGNED)]),
    label: personName,
    avatar: avatarVersion,
  })
  .refine((entry) => entry.value !== UNASSIGNED || entry.avatar === null, {
    message: "the unassigned tickets have no picture",
    path: ["avatar"],
  });

export const findingsPageSchema = z.object({
  meta: metaSchema,
  items: z.array(findingSchema),
  total: count,
  page: z.number().int().min(1),
  page_size: z.number().int().min(1).max(100),
  facets: z.object({
    rules: z.array(facetEntrySchema),
    epics: z.array(facetEntrySchema),
    /** Everyone assigned a ticket on the board now, by name, then "unassigned"; sprint findings count for no one. */
    people: z.array(personFacetEntrySchema),
    severity: z.array(facetEntrySchema),
    state: z.array(facetEntrySchema),
  }),
});

export const findingDetailSchema = z.object({
  meta: metaSchema,
  finding: findingSchema,
  /** The issue's status intervals, oldest first; empty for a sprint finding. */
  timeline: z.array(intervalSchema),
});

/* ---------------------------------------------------------------- issues -- */

export const issueTimelineSchema = z.object({
  meta: metaSchema,
  issue: z.object({
    key: issueKey,
    summary: z.string(),
    type: z.string().min(1),
    status: z.string().min(1),
    status_category: statusCategorySchema,
    stage: stageSchema.nullable(),
    epic: z.object({ key: issueKey, title: z.string() }).nullable(),
    /** Who it is assigned to now; null when nobody is. */
    assignee: personSchema.nullable(),
    created_at: isoDateTime,
    resolved_at: isoDateTime.nullable(),
    story_points: nonNegative.nullable(),
    /** Logged time in hours; null when nothing has been logged. */
    time_spent_h: nonNegative.nullable(),
    estimate_basis: z.enum(["points", "hours", "none"]),
    estimate_set_at: isoDateTime.nullable(),
    started_at: isoDateTime.nullable(),
    /** Logged time over the estimate; null without an estimate. */
    effort_ratio: nonNegative.nullable(),
    /** R-EFF-01's threshold, to draw the ratio against. */
    effort_threshold: z.number().positive(),
    cycle_time_h: nonNegative.nullable(),
    reopen_count: count,
    /** "Open in Jira". Null in sample mode, or when the Jira site is not configured. */
    url: z.url({ protocol: /^https$/ }).nullable(),
  }),
  intervals: z.array(intervalSchema),
  /** Forward jumps over stages the workflow maps (To Do straight to Done skips development). */
  skipped: z.array(
    z.object({
      changelog_id: z.string().min(1),
      changed_at: isoDateTime,
      from: z.string().min(1),
      to: z.string().min(1),
      skipped: z.array(stageSchema).min(1),
    }),
  ),
  changes: z.array(
    z.object({
      changelog_id: z.string().min(1),
      changed_at: isoDateTime,
      kind: z.enum(["status", "field"]),
      field: z.string().min(1),
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
  ),
  /** Logged hours per week (Monday, UTC). Totals only: never who logged them. */
  worklogs: z.array(z.object({ week: isoDate, hours: nonNegative })),
  findings: z.array(findingSchema),
});

/* ------------------------------------------------------------------- ask -- */

export const ASK_MAX_LENGTH = 500;
const ASK_BODY_MAX_LENGTH = 2_000;
/** The most people one question may mention (the service's limit too). */
export const ASK_MAX_MENTIONS = 10;

export const askLevelSchema = z.enum(["team", "people"]);

export const askRequestSchema = z.strictObject({
  question: z.string().max(ASK_BODY_MAX_LENGTH),
  mentions: z
    .array(personId)
    .max(ASK_MAX_MENTIONS)
    .refine((ids) => new Set(ids).size === ids.length, { message: "names each person once" })
    .optional(),
});

export const ASK_DECLINES = {
  /** Team level: any question about a person. */
  teamLevel: "Ask answers at team level. To see one person's findings, use the Person filter on Findings.",
  judgement: "I can show facts about someone's tickets and findings, but not judge their performance.",
  /** People level, only where an organisation has turned comparison off: a question comparing people. */
  comparisonOff: SCORECARD_SENTENCES.comparisonOff,
  unknownMention: "Someone you mentioned has no tickets on this board.",
} as const;

export function noTicketsSentence(names: readonly string[]): string {
  const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  return `${listed} ${names.length > 1 ? "have" : "has"} no tickets on this board.`;
}

export const askOutcomeSchema = z.enum([
  "answered",
  "not_understood",
  "no_data",
  "not_measurable",
  "not_verified",
]);

export const factCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const factColumnKindSchema = z.enum([
  "text",
  "number",
  "count",
  "hours",
  "share",
  "ratio",
  "date",
  "issue_key",
]);

const paramValue = z.union([factCellSchema, z.array(z.union([z.string(), z.number()]))]);

export const factSetSchema = z.object({
  /** F1, F2, ... in plan order. */
  ref: z.string().regex(/^F\d+$/),
  /** The catalogue query that produced it (oversight_*). */
  tool: z.string().regex(/^oversight_[a-z_]+$/),
  params: z.record(z.string(), paramValue),
  columns: z.array(z.object({ key: z.string().min(1), label: z.string().min(1), kind: factColumnKindSchema })),
  rows: z.array(z.record(z.string(), factCellSchema)),
  /** More rows existed than were returned. */
  truncated: z.boolean(),
  as_of: isoDateTime.nullable(),
  note: z.string().nullable(),
});

export const citationSchema = z.object({
  marker: z.number().int().min(1),
  text: z.string().min(1),
  fact_ref: z.string().regex(/^F\d+$/),
  row_index: z.number().int().min(-1),
  column: z.string().min(1),
});

export const planStepSchema = z.object({
  tool: z.string().regex(/^oversight_[a-z_]+$/),
  params: z.record(z.string(), paramValue),
});

export const askResponseSchema = z.object({
  meta: metaSchema,
  qa_id: z.string().regex(/^[0-9a-f]{32}$/),
  question: z.string(),
  outcome: askOutcomeSchema,
  answer: z.string().nullable(),
  citations: z.array(citationSchema),
  facts: z.array(factSetSchema),
  plan: z.array(planStepSchema),
  missing_evidence: z.array(z.string()),
  /** What happened, for every outcome but "answered". */
  message: z.string().nullable(),
  suggestions: z.array(z.string()),
  latency_ms: count,
  /** The model that wrote the answer; null when none was asked. */
  model: z.string().nullable(),
  asked_at: isoDateTime,
  people: z.array(personSchema),
  note: z.string().min(1).max(500).nullable().default(null),
});

export const ASK_BUDGET_NOTE = "Today's AI budget is used up, so this answer was built without the AI model.";

export function askRateLimitMessage(retryAfterSeconds: number): string {
  const seconds = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `You've asked a lot of questions in a short time. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/* -------------------------------------------------------------- insights -- */

export const candidateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["wow_change", "breach_hot_spot", "rising_rule", "outlier", "coverage"]),
  title: z.string().min(1),
  /** affected × severity weight (breach 3, warning 2, info 1) × trend. */
  score: nonNegative,
  affected: count,
  severity: z.enum(["breach", "warning", "info"]),
  /** This week over last week (1.0 = steady). */
  trend: nonNegative,
  /** The figures the narrative may quote. */
  detail: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      value: z.union([z.number(), z.string()]).nullable(),
      unit: valueUnitSchema.nullable(),
    }),
  ),
  issue_keys: z.array(issueKey),
  finding_ids: z.array(findingId),
});

export const insightsSchema = z.object({
  meta: metaSchema,
  /** Monday of the week, in the report zone. */
  week_of: isoDate,
  generated_at: isoDateTime,
  /** Every number and key in the sentences was checked against the candidates. */
  verified: z.boolean(),
  sentences: z.array(insightSentenceSchema),
  /** The ranked candidates the narrative was written from, highest score first. */
  candidates: z.array(candidateSchema),
  /** How it was written, for the reader. */
  method: z.string().min(1),
  model: z.string().nullable(),
});

/* ---------------------------------------------------------------- trends -- */

export const trendSchema = z.object({
  meta: metaSchema,
  metric: trendMetricSchema,
  period: z.literal("week"),
  last_n: z.number().int().min(1).max(12),
  label: z.string().min(1),
  unit: valueUnitSchema,
  direction_good: directionSchema,
  /** What each point measures. */
  note: z.string().min(1),
  series: z.array(trendPointSchema).min(1).max(12),
});

/* ----------------------------------------------------------------- rules -- */

export const ruleSchema = z.object({
  rule_id: ruleId,
  title: z.string().min(1),
  description: z.string(),
  kind: ruleKindSchema,
  severity: severitySchema,
  version: z.string().min(1),
  threshold: z.string().nullable(),
  /** What the rule reads from Jira, in plain words. */
  needs: z.array(z.string()),
  measurable: z.boolean(),
  missing_evidence: z.array(z.string()),
  open: count,
  /** For a warning: the breach rule it foreshadows. */
  escalates_to: ruleId.nullable(),
  /** Whether the rule runs on this board (an admin may turn it off there). */
  enabled: z.boolean(),
  /** Whether the board's settings differ from the catalogue's for it (on or off, severity, a threshold). */
  customised: z.boolean(),
  /** Whether an admin added it to this board: listed after the catalogue, with its check's label. */
  custom: z.boolean().default(false),
  /** The check it runs, in plain words ("Time in a status"); null where the service names none. */
  check_label: z.string().min(1).nullable().default(null),
});

export const processStageSchema = z.object({
  stage: stageSchema,
  label: z.string().min(1),
  /** The project's statuses that map to this stage. */
  mapped_statuses: z.array(z.string()),
  /** Where Jira records that the stage happened, if anywhere. */
  evidence: z.enum(["status", "field", "none"]),
  measurable: z.boolean(),
  note: z.string(),
});

export const rulesSchema = z.object({
  meta: serviceMetaSchema,
  rules: z.array(ruleSchema),
  process: z.object({
    version: z.string().min(1),
    project: projectKey,
    stages: z.array(processStageSchema),
    estimate: z.object({
      basis: z.enum(["points", "hours"]),
      field: z.string().min(1),
      hours_per_point: z.number().positive().nullable(),
    }),
  }),
});

/* -------------------------------------------------------------- baseline -- */

const countShare = z.object({ count, share: fraction.nullable() });
const spread = z.object({
  n: count,
  median: z.number().nullable(),
  p75: z.number().nullable(),
  p90: z.number().nullable(),
});
const countsBy = z.record(z.string(), count);
const authorShare = z.object({ seconds: fraction.nullable(), count: fraction.nullable() });

export const baselineSchema = z.object({
  meta: metaSchema,
  metadata: z.object({
    project: projectKey,
    as_of: isoDate,
    window_days: z.number().int().min(1),
    zone: z.string().min(1),
    window: z.object({
      start: isoDateTime,
      end: isoDateTime,
      start_local: isoDateTime,
      end_local: isoDateTime,
    }),
    generated_at: isoDateTime,
    process_version: z.string().min(1),
    last_synced_at: isoDateTime.nullable(),
    metrics_computed_at: isoDateTime.nullable(),
    metrics_stale: z.boolean(),
    issues_without_metrics: count,
    comparison_status: z.enum(["compared", "skipped", "not requested"]),
    comparison_note: z.string(),
    run_id: z.string().min(1),
  }),
  figures: z.object({
    snapshot: z.object({
      last_synced_at: isoDateTime.nullable(),
      total_issues: count,
      created_before_window_end: count,
      by_type: countsBy,
      by_status: countsBy,
      by_status_category: countsBy,
    }),
    resolved: z.object({
      in_window: count,
      with_original_estimate: countShare,
      with_story_points: countShare,
      with_logged_time: z.object({
        timespent: countShare,
        aggregate: countShare,
        worklog_rows: countShare,
      }),
      straight_todo_to_done: countShare.extend({
        from_statuses: z.array(z.string()),
        to_statuses: z.array(z.string()),
      }),
      created_in_done: countShare,
      done_entered_in_window: count,
    }),
    estimates: z.object({
      hours_per_point: z.object({
        n: count,
        median: z.number().nullable(),
        p25: z.number().nullable(),
        p75: z.number().nullable(),
      }),
      within_25pct: z
        .object({ hours_per_point: z.number().positive(), count, share: fraction.nullable() })
        .nullable(),
      estimate_set_after_start: z.object({ count, of: count, share: fraction.nullable() }),
    }),
    /** Keyed by status, in James's stage order. */
    time_in_status: z.record(z.string(), spread.extend({ stage: stageSchema.nullable() })),
    cycle_time: spread,
    reopens: countShare,
    worklogs: z.object({
      count,
      total_hours: nonNegative,
      /** How many accounts wrote worklogs: a count, never who. */
      authors: count,
      top_author_share: authorShare,
      /** The share written by the time-tracking app's account, when one is configured. */
      tempo_share: authorShare.optional(),
    }),
    evidence: z.object({
      not_measurable: z.array(z.string()),
      configured: z.array(z.string()),
    }),
    issue_links: z.object({
      issues_with_issue_links: count,
      issue_links: count,
      issue_links_by_title: countsBy,
      remote_links: count,
      remote_links_by_host: countsBy,
    }),
  }),
  comparison: z.array(
    z.object({
      metric: z.string().min(1),
      expected: z.number(),
      actual: z.number().nullable(),
      match: z.boolean(),
      note: z.string(),
    }),
  ),
});

/* ------------------------------------------------------------ governance -- */

export const VIEWER_HASH_PATTERN = /^(?:[0-9a-f]{32}|local)$/;
export const LOCAL_VIEWER = "local";
export const LOCAL_VIEWER_NAME = "Local (sign-in off)";
/** A session from before sessions kept the display name: it still works, and reads as this. */
export const SIGNED_IN_USER = "Signed-in user";
/** A subject of the access log who is on no board any more: named so, with no picture. */
export const FORMER_MEMBER = "Former member";

export const ACCESS_ACTIONS = [
  "scorecard_view",
  "people_compare_view",
  "person_findings_view",
  "person_ask",
  "access_log_view",
  "access_log_export",
  "person_card_view",
] as const;
export const accessActionSchema = z.enum(ACCESS_ACTIONS);
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

/** Each action in plain words, as the page says it. */
export const ACCESS_ACTION_LABELS: Readonly<Record<AccessAction, string>> = {
  scorecard_view: "Viewed a scorecard",
  people_compare_view: "Compared people",
  person_findings_view: "Viewed findings for a person",
  person_ask: "Asked about people",
  access_log_view: "Viewed the access log",
  access_log_export: "Exported the access log",
  person_card_view: "Viewed a person card",
};

/** An entry's id: the service's own key for the row (a uuid, as hex with or without dashes). */
export const ACCESS_ENTRY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Where the next page starts: opaque, printable ASCII, given back exactly as it came. */
export const ACCESS_CURSOR_PATTERN = /^[\x21-\x7e]{1,512}$/;
/** The most entries one page of the access log holds (the service's limit). */
export const ACCESS_LOG_MAX_LIMIT = 200;
export const ACCESS_LOG_DEFAULT_LIMIT = 50;
/** The most entries one export holds (the service's limit): the newest, when the filters keep more. */
export const ACCESS_LOG_EXPORT_MAX = 10_000;

/** A viewer's name as a session keeps it: a display name, never an address (one that holds one reads as a signed-in user). */
const viewerName = z
  .string()
  .min(1)
  .refine((name) => [...name].length <= PERSON_NAME_MAX, { message: `at most ${PERSON_NAME_MAX} characters` })
  .transform((name) => (EMAIL_IN_NAME.test(name) ? SIGNED_IN_USER : name));

/** The details the page reads off an entry: a scorecard's period, the answer's reference, how many entries a read returned. */
export interface AccessDetail {
  days: number | null;
  qa_id: string | null;
  entries: number | null;
}

export function accessDetail(raw: unknown): AccessDetail {
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const whole = (value: unknown, min: number) => (typeof value === "number" && Number.isInteger(value) && value >= min ? value : null);
  const qa = record.qa_id;
  return {
    days: whole(record.days, 1),
    qa_id: typeof qa === "string" && /^[0-9a-f]{32}$/.test(qa) ? qa : null,
    entries: whole(record.entries, 0),
  };
}

export const accessLogEntrySchema = z.object({
  id: z.string().regex(ACCESS_ENTRY_ID_PATTERN),
  /** When the read happened. */
  at: isoDateTime,
  viewer: z.object({ hash: z.string().regex(VIEWER_HASH_PATTERN), name: viewerName }),
  /** The level the viewer read at: people (an admin, or sign-in off) or team. */
  level: askLevelSchema,
  /** The board read; null for the access log's own reads, which belong to no board. */
  project: projectKey.nullable(),
  action: accessActionSchema,
  /** Whose figures were read, as person objects (a former member by FORMER_MEMBER, with no picture). */
  subjects: z.array(personSchema).max(500),
  detail: z.unknown().transform(accessDetail),
});

/** A viewer the access log holds, as its filter offers them: by the name of their latest read. */
export const accessViewerSchema = z.object({ hash: z.string().regex(VIEWER_HASH_PATTERN), name: viewerName });

export const accessLogFacetsSchema = z.object({
  viewers: z.array(accessViewerSchema).max(10_000),
  subjects: z.array(personSchema).max(10_000),
});

export const accessLogSchema = z
  .object({
    meta: serviceMetaSchema,
    entries: z.array(accessLogEntrySchema).max(ACCESS_LOG_EXPORT_MAX),
    next_cursor: z.string().regex(ACCESS_CURSOR_PATTERN).nullable(),
    facets: accessLogFacetsSchema.nullable(),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.entries.forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", path: ["entries", index, "id"], message: "listed twice" });
      seen.add(entry.id);
      const before = body.entries[index - 1];
      if (before && Date.parse(entry.at) > Date.parse(before.at)) {
        ctx.addIssue({ code: "custom", path: ["entries", index, "at"], message: "not newest first" });
      }
    });
  });

/** One UTC day of Ask's use: the questions asked, the model calls made and the tokens they used (input and output). */
export const usageDaySchema = z.object({
  date: isoDate,
  questions: count,
  model_calls: count,
  tokens: count,
});

export const usageSchema = z
  .object({
    meta: serviceMetaSchema,
    today: z.object({
      questions: count,
      model_calls: count,
      input_tokens: count,
      output_tokens: count,
      /** The day's budget in tokens (input and output); null when none is set. */
      budget_tokens: z.number().int().positive().nullable(),
      /** How much of it is used, as a percentage (it may pass 100 by the last call's size); null with no budget. */
      budget_used_pct: nonNegative.nullable(),
    }),
    last_7_days: z.array(usageDaySchema).max(31),
    /** Whether an AI model is set up on the service (LLM_MODE=live); "off" when every answer is built in code. */
    ai_model: z.enum(["on", "off"]),
  })
  .superRefine((body, ctx) => {
    if ((body.today.budget_tokens === null) !== (body.today.budget_used_pct === null)) {
      ctx.addIssue({ code: "custom", path: ["today", "budget_used_pct"], message: "set exactly when there is a budget" });
    }
    body.last_7_days.forEach((day, index) => {
      const before = body.last_7_days[index - 1];
      if (before && day.date <= before.date) ctx.addIssue({ code: "custom", path: ["last_7_days", index, "date"], message: "not oldest first" });
    });
  });

/* ------------------------------------------------------------- portfolio -- */

/** The weeks of open findings a board's row draws (its sparkline): 8, oldest first, the last one now. */
export const PORTFOLIO_TREND_POINTS = 8;
/** The most open breaches "Needs attention" lists across the boards. */
export const PORTFOLIO_ATTENTION_MAX = 10;

/** One board as the Portfolio lists it: the Overview's own figures for it, so the two always agree. */
export const portfolioBoardSchema = z
  .object({
    project: z.object({ key: projectKey, name: z.string().min(1) }),
    /** The start of the board's last successful sync; null before the first. */
    last_sync_at: isoDateTime.nullable(),
    /** Work (Epics left out) not in a done category now. */
    open_tickets: count,
    /** Work in an in-progress category now. */
    in_progress: count,
    open_breaches: count,
    open_warnings: count,
    /** Findings first seen, and resolved, in the 7 days to now (the Overview's tiles). */
    new_findings_7d: count,
    resolved_findings_7d: count,
    open_findings_trend: z.array(count).length(PORTFOLIO_TREND_POINTS),
    tracking_since: isoDateTime.nullable(),
    /** The board has an active sprint now (false before its first sync). */
    active_sprint: z.boolean(),
    unestimated_in_active_sprint: count.nullable(),
    sprint_at_risk: z.boolean().nullable(),
    /** The rule with the most open findings on the board (catalogue order breaks a tie); null with none open. */
    top_rule: z.object({ id: ruleId, title: z.string().min(1), open: z.number().int().min(1) }).nullable(),
    stale: z.boolean(),
  })
  .superRefine((board, ctx) => {
    if (board.in_progress > board.open_tickets) {
      ctx.addIssue({ code: "custom", path: ["in_progress"], message: "more in progress than open" });
    }
  });

export const attentionItemSchema = z.object({
  project: projectKey,
  issue_key: issueKey,
  rule_id: ruleId,
  /** The rule's title. */
  title: z.string().min(1),
  severity: severitySchema,
  /** When the rules first saw the oldest of its open findings. */
  opened_at: isoDateTime,
  /** The last rules run that saw it: where its age stops once its board's last sync is stale. */
  last_seen_at: isoDateTime,
  /** Whole days from first seen to the service's now, or to last_seen_at once the board's last sync is stale. */
  age_days: count,
  /** How many open findings of this rule the ticket holds: 1, or more (the page says "2 findings"). */
  findings: z.number().int().min(1),
});

/** A "Needs attention" row's identity, its board, ticket and rule: one row each, so it is the list's React key too. */
export function attentionKey(item: { project: string; issue_key: string; rule_id: string }): string {
  return `${item.project}:${item.issue_key}:${item.rule_id}`;
}

/** GET /portfolio's body under the contract's names: see portfolioSchema. */
const portfolioBodySchema = z
  .object({
    meta: serviceMetaSchema,
    boards: z.array(portfolioBoardSchema),
    attention: z.array(attentionItemSchema).max(PORTFOLIO_ATTENTION_MAX),
    /** Boards the service serves that have not synced yet, so have no row: the board picker offers their first sync. */
    boards_not_synced: count,
  })
  .superRefine((body, ctx) => {
    const keys = new Set<string>();
    body.boards.forEach((board, index) => {
      if (keys.has(board.project.key)) ctx.addIssue({ code: "custom", path: ["boards", index, "project"], message: "listed twice" });
      keys.add(board.project.key);
    });
    // One row for each ticket and rule: the same ticket and rule twice reads as a duplicate.
    const pairs = new Set<string>();
    body.attention.forEach((item, index) => {
      const pair = attentionKey(item);
      if (pairs.has(pair)) ctx.addIssue({ code: "custom", path: ["attention", index, "rule_id"], message: "this ticket and rule listed twice" });
      pairs.add(pair);
      if (!keys.has(item.project)) ctx.addIssue({ code: "custom", path: ["attention", index, "project"], message: "not one of the boards" });
      if (!item.issue_key.startsWith(`${item.project}-`)) {
        ctx.addIssue({ code: "custom", path: ["attention", index, "issue_key"], message: "not on its board" });
      }
      if (Date.parse(item.last_seen_at) < Date.parse(item.opened_at)) {
        ctx.addIssue({ code: "custom", path: ["attention", index, "last_seen_at"], message: "seen last before it was first seen" });
      }
      const before = body.attention[index - 1];
      if (before && Date.parse(item.opened_at) < Date.parse(before.opened_at)) {
        ctx.addIssue({ code: "custom", path: ["attention", index, "opened_at"], message: "not oldest first" });
      }
    });
  });

function notSyncedUnderContractName(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if ("boards_not_synced" in record || !("not_synced" in record)) return body;
  const { not_synced: notSynced, ...rest } = record;
  return { ...rest, boards_not_synced: notSynced };
}

export const portfolioSchema = z.preprocess(notSyncedUnderContractName, portfolioBodySchema);

/* --------------------------------------------------------- rule settings -- */

/** How a threshold reads beside its field. A share travels as a fraction (0.3) and is shown as a whole percentage. */
export const RULE_PARAM_UNITS = ["ratio", "hours", "percentile", "days", "share"] as const;
export const ruleParamUnitSchema = z.enum(RULE_PARAM_UNITS);

/** One threshold an admin may change: its name in the rule's params, its words, and the service's bounds. */
export interface RuleParamSpec {
  name: string;
  label: string;
  unit: (typeof RULE_PARAM_UNITS)[number];
  min: number;
  max: number;
  step: number;
  /** The check's own default where rules.yaml does not set it; null where the catalogue always does (a ratio). */
  fallback: number | null;
}

export const RULE_PARAM_REGISTRY: Readonly<Record<string, readonly RuleParamSpec[]>> = {
  // The service names it "Grace after work started"; the sample says it so that no word of it reads as a first name.
  estimate_after_start: [{ name: "grace_hours", label: "Hours of grace", unit: "hours", min: 0, max: 168, step: 0.5, fallback: 1 }],
  effort_ratio_at_least: [{ name: "threshold", label: "Effort ratio", unit: "ratio", min: 0.1, max: 10, step: 0.05, fallback: null }],
  stuck_in_status: [
    { name: "pct", label: "Percentile of time in the status", unit: "percentile", min: 50, max: 99, step: 1, fallback: 90 },
  ],
  no_evidence_after_percentile: [
    { name: "pct", label: "Percentile of time in the stage", unit: "percentile", min: 50, max: 99, step: 1, fallback: 75 },
  ],
  sprint_at_risk: [
    { name: "days_left", label: "Days left in the sprint", unit: "days", min: 0, max: 14, step: 0.5, fallback: 2 },
    { name: "not_started_share", label: "Share of issues not started", unit: "share", min: 0.05, max: 0.95, step: 0.05, fallback: 0.3 },
  ],
};

/* ------------------------------------------------- custom rules -- */

/** The most custom rules (not deleted) one board holds. */
export const CUSTOM_RULE_LIMIT = 50;
export const CUSTOM_TITLE_MIN = 3;
export const CUSTOM_TITLE_MAX = 80;
export const CUSTOM_DESCRIPTION_MAX = 300;
/** What an admin may write for the AI to draft from, in characters, after trimming. */
export const RULE_DRAFT_TEXT_MIN = 3;
export const RULE_DRAFT_TEXT_MAX = 500;

/** How a check's param is set: a number with its bounds, or a choice from the board's own names. */
export const PARAM_KINDS = ["number", "statuses", "stage", "evidence", "field"] as const;
export const paramKindSchema = z.enum(PARAM_KINDS);
export type ParamKind = (typeof PARAM_KINDS)[number];

/** The fields `missing_field` can look for. */
export const MISSING_FIELDS = ["assignee", "estimate", "epic", "sprint"] as const;
export type MissingField = (typeof MISSING_FIELDS)[number];
/** process.yaml's evidence names: where Jira may record that a stage happened. */
export const EVIDENCE_NAMES = ["code_review", "dev_signoff", "testing", "test_review", "test_signoff"] as const;

/** Each status category in the form's words ("To do", "In progress", "Done"). */
export const CATEGORY_LABELS: Readonly<Record<StatusCategory, string>> = { new: "To do", indeterminate: "In progress", done: "Done" };
/** Each field `missing_field` can look for, in words. */
export const MISSING_FIELD_LABELS: Readonly<Record<MissingField, string>> = {
  assignee: "Assignee",
  estimate: "Estimate",
  epic: "Epic",
  sprint: "Sprint",
};

/** One param of a check: a number (its unit, bounds, step and default) or a choice (its default, where it has one). */
export interface CheckParamSpec {
  name: string;
  label: string;
  kind: ParamKind;
  unit: RuleParamUnit | null;
  min: number | null;
  max: number | null;
  step: number | null;
  /** A number's default; a choice's (a stage, an evidence name, a field), or [] for statuses the admin picks. */
  default: number | string | readonly string[];
}

/** A check a custom rule may use, with what it reads and the status categories it may look at. */
export interface CheckSpec {
  name: string;
  /** Two to five plain words. */
  label: string;
  /** One line, at most 90 characters. */
  summary: string;
  scope: "issue" | "sprint";
  params: readonly CheckParamSpec[];
  /** The categories a rule of it may look at; none for a sprint's check, which looks at sprints. */
  categories: readonly StatusCategory[];
  defaultCategories: readonly StatusCategory[];
}

/** One of the thresholds as a custom rule's param: its name, words and bounds, with a default for a new rule. */
function thresholdParam(check: string, name: string, fallback?: number): CheckParamSpec {
  const spec = RULE_PARAM_REGISTRY[check]?.find((candidate) => candidate.name === name);
  const value = fallback ?? spec?.fallback;
  if (!spec || typeof value !== "number") throw new Error(`no threshold ${name} for ${check}`);
  return { name, label: spec.label, kind: "number", unit: spec.unit, min: spec.min, max: spec.max, step: spec.step, default: value };
}

function numberParam(name: string, label: string, unit: RuleParamUnit, min: number, max: number, value: number): CheckParamSpec {
  return { name, label, kind: "number", unit, min, max, step: 1, default: value };
}

function choiceParam(name: string, label: string, kind: Exclude<ParamKind, "number">, value: string | readonly string[]): CheckParamSpec {
  return { name, label, kind, unit: null, min: null, max: null, step: null, default: value };
}

const ALL_CATEGORIES: readonly StatusCategory[] = ["new", "indeterminate", "done"];
const OPEN_CATEGORIES: readonly StatusCategory[] = ["new", "indeterminate"];
const STARTED_CATEGORIES: readonly StatusCategory[] = ["indeterminate", "done"];

/** The checks a custom rule may use, in the order the form offers them: the four general ones first. */
export const CHECK_REGISTRY: readonly CheckSpec[] = [
  {
    name: "time_in_status_over",
    label: "Time in a status",
    summary: "Flags work that has sat in one of these statuses past the limit.",
    scope: "issue",
    params: [choiceParam("statuses", "Statuses", "statuses", []), numberParam("hours", "Time in the status", "hours", 1, 8760, 72)],
    categories: OPEN_CATEGORIES,
    defaultCategories: ["indeterminate"],
  },
  {
    name: "open_longer_than",
    label: "Open too long",
    summary: "Flags work still open this many days after it was created.",
    scope: "issue",
    params: [numberParam("days", "Days open", "days", 1, 3650, 30)],
    categories: OPEN_CATEGORIES,
    defaultCategories: OPEN_CATEGORIES,
  },
  {
    name: "no_update_for",
    label: "No updates",
    summary: "Flags open work with no change in Jira for this many days.",
    scope: "issue",
    params: [numberParam("days", "Days without a change", "days", 1, 365, 7)],
    categories: OPEN_CATEGORIES,
    defaultCategories: ["indeterminate"],
  },
  {
    name: "missing_field",
    label: "Missing field",
    summary: "Flags work with no assignee, estimate, epic or sprint.",
    scope: "issue",
    params: [choiceParam("field", "Field", "field", "assignee")],
    categories: ALL_CATEGORIES,
    defaultCategories: ["indeterminate"],
  },
  {
    name: "missing_estimate",
    label: "Started without an estimate",
    summary: "Flags work that started with no estimate.",
    scope: "issue",
    params: [],
    categories: STARTED_CATEGORIES,
    defaultCategories: STARTED_CATEGORIES,
  },
  {
    name: "estimate_after_start",
    label: "Estimate set late",
    summary: "Flags work whose estimate was first set after work started.",
    scope: "issue",
    params: [thresholdParam("estimate_after_start", "grace_hours")],
    categories: STARTED_CATEGORIES,
    defaultCategories: STARTED_CATEGORIES,
  },
  {
    name: "effort_ratio_at_least",
    label: "Effort over estimate",
    summary: "Flags work whose logged time is at least this many times its estimate.",
    scope: "issue",
    params: [thresholdParam("effort_ratio_at_least", "threshold", 1.5)],
    categories: STARTED_CATEGORIES,
    defaultCategories: ["done"],
  },
  {
    name: "entered_stage_without_evidence",
    label: "Reached a stage without evidence",
    summary: "Flags work that reached a stage with no evidence recorded before it.",
    scope: "issue",
    params: [choiceParam("stage", "Stage", "stage", "testing"), choiceParam("evidence", "Evidence", "evidence", "code_review")],
    categories: ALL_CATEGORIES,
    defaultCategories: ALL_CATEGORIES,
  },
  {
    name: "skipped_stage",
    label: "Skipped a stage",
    summary: "Flags a status change that jumped over a stage the workflow maps.",
    scope: "issue",
    params: [],
    categories: ALL_CATEGORIES,
    defaultCategories: ALL_CATEGORIES,
  },
  {
    name: "reopened",
    label: "Reopened after Done",
    summary: "Flags work moved out of Done to a status that is not Done.",
    scope: "issue",
    params: [],
    categories: ALL_CATEGORIES,
    defaultCategories: ALL_CATEGORIES,
  },
  {
    name: "in_progress_unassigned",
    label: "In progress, no assignee",
    summary: "Flags work in progress that nobody is assigned to.",
    scope: "issue",
    params: [],
    categories: ["indeterminate"],
    defaultCategories: ["indeterminate"],
  },
  {
    name: "stuck_in_status",
    label: "Unusually long in a status",
    summary: "Flags work in its status longer than this board usually takes there.",
    scope: "issue",
    params: [thresholdParam("stuck_in_status", "pct")],
    categories: OPEN_CATEGORIES,
    defaultCategories: OPEN_CATEGORIES,
  },
  {
    name: "no_evidence_after_percentile",
    label: "No evidence after usual time",
    summary: "Flags work in a stage longer than usual with no evidence yet.",
    scope: "issue",
    params: [
      choiceParam("stage", "Stage", "stage", "development"),
      choiceParam("evidence", "Evidence", "evidence", "code_review"),
      thresholdParam("no_evidence_after_percentile", "pct"),
    ],
    categories: ["indeterminate"],
    defaultCategories: ["indeterminate"],
  },
  {
    name: "unestimated_in_active_sprint",
    label: "Unestimated in the sprint",
    summary: "Flags work in the active sprint that has no estimate.",
    scope: "issue",
    params: [],
    categories: OPEN_CATEGORIES,
    defaultCategories: OPEN_CATEGORIES,
  },
  {
    name: "sprint_at_risk",
    label: "Sprint at risk",
    summary: "Flags an active sprint near its end with much of its work not started.",
    scope: "sprint",
    params: [thresholdParam("sprint_at_risk", "days_left"), thresholdParam("sprint_at_risk", "not_started_share")],
    categories: [],
    defaultCategories: [],
  },
];

/** The registry by check name. */
export const CHECKS_BY_NAME: ReadonlyMap<string, CheckSpec> = new Map(CHECK_REGISTRY.map((check) => [check.name, check]));

/** Every param name the registry knows, with its kind: a name means the same wherever a check uses it. */
export const PARAM_KIND_BY_NAME: ReadonlyMap<string, ParamKind> = new Map(
  CHECK_REGISTRY.flatMap((check) => check.params.map((param) => [param.name, param.kind] as const)),
);

export const RULE_PARAM_BOUNDS: ReadonlyMap<string, { min: number; max: number }> = (() => {
  const bounds = new Map<string, { min: number; max: number }>();
  const specs = [
    ...Object.values(RULE_PARAM_REGISTRY).flat(),
    ...CHECK_REGISTRY.flatMap((check) => check.params.filter((param) => param.kind === "number")),
  ];
  for (const spec of specs) {
    if (spec.min === null || spec.max === null) continue;
    const known = bounds.get(spec.name);
    bounds.set(spec.name, known ? { min: Math.min(known.min, spec.min), max: Math.max(known.max, spec.max) } : { min: spec.min, max: spec.max });
  }
  return bounds;
})();

/** Control characters (C0, DEL and C1): each reads as a space, as a line break does. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const UNSEEN = /[\p{Cf}\p{Default_Ignorable_Code_Point}⠀\p{Cs}\p{Co}\p{Cn}]/gu;

export function plainText(text: string): string {
  return text.replace(CONTROLS, " ").replace(UNSEEN, "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function boardText(text: string): string {
  return text.replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
}

export function nameKey(text: string): string {
  return plainText(text).toUpperCase().toLowerCase();
}

/** Whether text has something in it to read: a letter or a figure, not marks and symbols alone. */
export const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** A title's or a description's length as the service's Python counts it: by character, not UTF-16 unit. */
export const characterCount = (text: string) => [...text].length;
/** A threshold's most decimal places. */
export const RULE_PARAM_DECIMALS = 4;
/** The longest reason a change may carry, in characters (as the service's Python counts them). */
export const RULE_SETTINGS_REASON_MAX = 500;
/** The history the service sends: the newest changes, at most this many. */
export const RULE_SETTINGS_HISTORY_MAX = 50;
/** The issue keys a preview names for each way a rule's findings would go. */
export const RULE_SETTINGS_EXAMPLES_MAX = 5;
/** The most changes one request carries: one per rule, far more than the catalogue holds. */
export const RULE_SETTINGS_MAX_CHANGES = 64;
/** A change's id: a uuid4 as 32 hexadecimal characters. */
export const CHANGE_ID_PATTERN = /^[0-9a-f]{32}$/;
const PARAM_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const SETTING_FIELD_PATTERN = /^(?:enabled|severity|rule|title|description|applies_to|params\.[a-z][a-z0-9_]{0,39})$/;
/** Where a preview's examples point: an issue key, or a sprint as the engine keys it ("sprint:26"). */
const EXAMPLE_KEY_PATTERN = /^(?:[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,8}|sprint:\d{1,12})$/;

export const RULE_SETTINGS_CONFLICT =
  "Someone else changed this board's rule settings while you were editing. Reload them to see what changed: nothing was saved.";

export const CROSS_RULE_WORDS = {
  onWarning: (breachId: string, threshold: string) => `Must stay below ${breachId}'s ${threshold} while both are on: the warning comes first.`,
  onBreach: (warningId: string, threshold: string) => `Must stay above ${warningId}'s ${threshold} while both are on.`,
} as const;

/** At most four decimal places: 0.35 and 1.5 are, 1.23456 is not (with room for how binary holds 0.35). */
export function withinDecimals(value: number, decimals = RULE_PARAM_DECIMALS): boolean {
  const scaled = value * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** "1.5", "0.05", "10": a bound in the words a message uses. */
function boundWords(value: number): string {
  return String(Number(value.toPrecision(6)));
}

/** A change's reason, kept to what may be shown: a reason with an email address in it is refused. */
const changeReason = z
  .string()
  .refine((text) => [...text].length <= RULE_SETTINGS_REASON_MAX, { message: `is at most ${RULE_SETTINGS_REASON_MAX} characters` })
  .refine((text) => !EMAIL_IN_NAME.test(text), { message: "leaves out email addresses: every admin reads it" });

/** What is wrong with a number a change sets, by its name's bounds; null when nothing is. */
function numberProblem(name: string, value: number): string | null {
  const bounds = PARAM_NAME_PATTERN.test(name) ? RULE_PARAM_BOUNDS.get(name) : undefined;
  if (!bounds) return "Is not a threshold that can be changed.";
  if (value < bounds.min || value > bounds.max) return `Must be from ${boundWords(bounds.min)} to ${boundWords(bounds.max)}.`;
  if (!withinDecimals(value)) return `Has more than ${RULE_PARAM_DECIMALS} decimal places.`;
  return null;
}

export const ruleSettingChangeSchema = z
  .strictObject({
    rule_id: ruleId,
    enabled: z.boolean().optional(),
    severity: severitySchema.optional(),
    params: z.record(z.string(), z.number()).optional(),
    reset: z.boolean().optional(),
  })
  .superRefine((change, ctx) => {
    const named = change.enabled !== undefined || change.severity !== undefined || change.params !== undefined;
    if (change.reset === true && named) {
      ctx.addIssue({ code: "custom", path: ["reset"], message: "Reset to the catalogue's settings goes alone, with nothing else in the change." });
    }
    if (change.reset !== true && !named) ctx.addIssue({ code: "custom", path: [], message: "This change names nothing to change." });
    if (change.params === undefined) return;
    const entries = Object.entries(change.params);
    if (entries.length === 0) ctx.addIssue({ code: "custom", path: ["params"], message: "Names no threshold to change." });
    for (const [name, value] of entries) {
      const problem = numberProblem(name, value);
      if (problem) ctx.addIssue({ code: "custom", path: ["params", name], message: problem });
    }
  });

/** The words a custom rule's definition is refused in, wherever it is caught: the page, the sample, this interface. */
export const CUSTOM_RULE_WORDS = {
  title: `Give it a name of ${CUSTOM_TITLE_MIN} to ${CUSTOM_TITLE_MAX} characters.`,
  titleLetters: "Use letters or numbers in the name.",
  description: `Keep the description to ${CUSTOM_DESCRIPTION_MAX} characters.`,
  titleTaken: "Another rule on this board has this name.",
  check: "Pick what to check.",
  statuses: "Pick at least one status.",
  stage: "Pick a stage of the process.",
  evidence: "Pick where Jira records the evidence.",
  field: "Pick assignee, estimate, epic or sprint.",
  categories: "Pick at least one of To do, In progress and Done.",
  sprintScope: "A sprint's rule looks at the active sprint: it takes no statuses or issue types.",
  limit: `A board holds at most ${CUSTOM_RULE_LIMIT} custom rules. Delete one first.`,
} as const;

export function titleTextProblem(title: string): string | null {
  const length = characterCount(title);
  if (length < CUSTOM_TITLE_MIN || length > CUSTOM_TITLE_MAX) return CUSTOM_RULE_WORDS.title;
  return hasWords(title) ? null : CUSTOM_RULE_WORDS.titleLetters;
}

/** A title as a rule keeps it: plain text, 3 to 80 characters, with a letter or a figure in it. */
const customTitle = z
  .string()
  .transform(plainText)
  .superRefine((text, ctx) => {
    const problem = titleTextProblem(text);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** A description as a rule keeps it: plain text, at most 300 characters; blank is none. */
const customDescription = z
  .string()
  .nullable()
  .transform((text) => (text === null ? null : plainText(text) || null))
  .refine((text) => text === null || characterCount(text) <= CUSTOM_DESCRIPTION_MAX, { message: CUSTOM_RULE_WORDS.description });

/** A status, issue type or other name the board gives: trimmed, one line, at most 255 characters. */
const boardName = z
  .string()
  .transform(boardText)
  .refine((text) => characterCount(text) >= 1 && characterCount(text) <= 255, { message: "Is not a name the board gives." });

/** Names as a list a rule keeps: each once, whatever its case. */
function namedOnce(names: readonly string[]): boolean {
  return new Set(names.map((name) => name.toLowerCase())).size === names.length;
}

/** What a rule looks at: its status categories, and its issue types (null: every type but Epic). */
const appliesToRequestSchema = z
  .strictObject({
    status_category: z.array(statusCategorySchema).max(3),
    issue_type: z.array(boardName).min(1).max(50).nullable(),
  })
  .superRefine((applies, ctx) => {
    if (new Set(applies.status_category).size !== applies.status_category.length) {
      ctx.addIssue({ code: "custom", path: ["status_category"], message: "Names a category twice." });
    }
    if (applies.issue_type !== null && !namedOnce(applies.issue_type)) {
      ctx.addIssue({ code: "custom", path: ["issue_type"], message: "Names an issue type twice." });
    }
  });

/** A param's value: a number, a name (a stage, an evidence name, a field), or statuses. */
export const paramValueSchema = z.union([z.number(), z.string(), z.array(z.string())]);
export type ParamValue = z.infer<typeof paramValueSchema>;

function paramValueProblem(name: string, kind: ParamKind, value: unknown, spec?: CheckParamSpec): string | null {
  switch (kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
      if (spec && spec.min !== null && spec.max !== null && (value < spec.min || value > spec.max)) {
        return `Must be from ${boundWords(spec.min)} to ${boundWords(spec.max)}.`;
      }
      return numberProblem(name, value);
    }
    case "statuses": {
      if (!Array.isArray(value) || value.length === 0) return CUSTOM_RULE_WORDS.statuses;
      const names = value.map((status) => (typeof status === "string" ? boardText(status) : ""));
      if (names.length > 50 || names.some((status) => status === "" || characterCount(status) > 255)) return "Is not a list of the board's statuses.";
      return namedOnce(names) ? null : "Names a status twice.";
    }
    case "stage":
      return typeof value === "string" && (STAGES as readonly string[]).includes(value) ? null : CUSTOM_RULE_WORDS.stage;
    case "evidence":
      return typeof value === "string" && (EVIDENCE_NAMES as readonly string[]).includes(value) ? null : CUSTOM_RULE_WORDS.evidence;
    case "field":
      return typeof value === "string" && (MISSING_FIELDS as readonly string[]).includes(value) ? null : CUSTOM_RULE_WORDS.field;
  }
}

/** A param's value as it is forwarded: statuses as the board names they were checked as. */
function canonicalValue(value: ParamValue): ParamValue {
  return Array.isArray(value) ? value.map((status) => boardText(status)) : value;
}

const canonicalParams = (params: Readonly<Record<string, ParamValue>>): Record<string, ParamValue> =>
  Object.fromEntries(Object.entries(params).map(([name, value]) => [name, canonicalValue(value)]));

const canonicalAppliesTo = (applies: { status_category: readonly StatusCategory[]; issue_type: readonly string[] | null }) => ({
  status_category: [...applies.status_category],
  issue_type: applies.issue_type ? [...applies.issue_type] : null,
});

/** A new rule's definition: its name, what it checks and with what, what it looks at and how serious it is. */
export const customRuleSpecSchema = z
  .strictObject({
    title: customTitle,
    description: customDescription.optional(),
    check: z.string(),
    params: z.record(z.string(), paramValueSchema),
    applies_to: appliesToRequestSchema,
    severity: severitySchema,
  })
  .superRefine((rule, ctx) => {
    const check = CHECKS_BY_NAME.get(rule.check);
    if (!check) {
      ctx.addIssue({ code: "custom", path: ["check"], message: CUSTOM_RULE_WORDS.check });
      return;
    }
    for (const spec of check.params) {
      const value = rule.params[spec.name];
      const problem = value === undefined ? "Set a value." : paramValueProblem(spec.name, spec.kind, value, spec);
      if (problem) ctx.addIssue({ code: "custom", path: ["params", spec.name], message: problem });
    }
    for (const name of Object.keys(rule.params)) {
      if (!check.params.some((spec) => spec.name === name)) ctx.addIssue({ code: "custom", path: ["params", name], message: "Is not a setting of this check." });
    }
    const { status_category: categories, issue_type: types } = rule.applies_to;
    if (check.scope === "sprint") {
      if (categories.length > 0 || types !== null) ctx.addIssue({ code: "custom", path: ["applies_to"], message: CUSTOM_RULE_WORDS.sprintScope });
    } else if (categories.length === 0) {
      ctx.addIssue({ code: "custom", path: ["applies_to", "status_category"], message: CUSTOM_RULE_WORDS.categories });
    } else if (categories.some((category) => !check.categories.includes(category))) {
      const allowed = check.categories.map((category) => CATEGORY_LABELS[category]).join(", ");
      ctx.addIssue({ code: "custom", path: ["applies_to", "status_category"], message: `This check looks only at ${allowed} work.` });
    }
  })
  .transform((rule) => ({
    title: rule.title,
    ...(rule.description ? { description: rule.description } : {}),
    check: rule.check,
    params: canonicalParams(rule.params),
    applies_to: canonicalAppliesTo(rule.applies_to),
    severity: rule.severity,
  }));

/** A new custom rule: the service gives it its id. */
export const customRuleCreateSchema = z.strictObject({ op: z.literal("create"), rule: customRuleSpecSchema });

export const customRuleEditSchema = z
  .strictObject({
    op: z.literal("edit"),
    rule_id: ruleId,
    title: customTitle.optional(),
    description: customDescription.optional(),
    params: z.record(z.string(), paramValueSchema).optional(),
    applies_to: appliesToRequestSchema.optional(),
  })
  .superRefine((edit, ctx) => {
    const named = [edit.title, edit.description, edit.params, edit.applies_to].some((value) => value !== undefined);
    if (!named) ctx.addIssue({ code: "custom", path: [], message: "This change names nothing to change." });
    if (edit.params === undefined) return;
    const entries = Object.entries(edit.params);
    if (entries.length === 0) ctx.addIssue({ code: "custom", path: ["params"], message: "Names no setting to change." });
    for (const [name, value] of entries) {
      const kind = PARAM_NAME_PATTERN.test(name) ? PARAM_KIND_BY_NAME.get(name) : undefined;
      const problem = kind ? paramValueProblem(name, kind, value) : "Is not a setting a rule has.";
      if (problem) ctx.addIssue({ code: "custom", path: ["params", name], message: problem });
    }
  })
  .transform((edit) => ({
    op: edit.op,
    rule_id: edit.rule_id,
    ...(edit.title !== undefined ? { title: edit.title } : {}),
    ...(edit.description !== undefined ? { description: edit.description } : {}),
    ...(edit.params !== undefined ? { params: canonicalParams(edit.params) } : {}),
    ...(edit.applies_to !== undefined ? { applies_to: canonicalAppliesTo(edit.applies_to) } : {}),
  }));

/** A custom rule deleted: it keeps its row, so an undo can bring it back with its id and findings. */
export const customRuleDeleteSchema = z.strictObject({ op: z.literal("delete"), rule_id: ruleId });
/** A deleted custom rule of the board brought back: the undo of a delete. */
export const customRuleRestoreSchema = z.strictObject({ op: z.literal("restore"), rule_id: ruleId });

export type RuleSettingChange = z.infer<typeof ruleSettingChangeSchema>;
export type CustomRuleSpec = z.output<typeof customRuleSpecSchema>;
export type CustomRuleCreate = z.output<typeof customRuleCreateSchema>;
export type CustomRuleEdit = z.output<typeof customRuleEditSchema>;
export type CustomRuleDelete = z.infer<typeof customRuleDeleteSchema>;
export type CustomRuleRestore = z.infer<typeof customRuleRestoreSchema>;
/** One change in a preview or a save: a rule's settings, or a custom rule added, edited, deleted or brought back. */
export type RuleSettingsChange = RuleSettingChange | CustomRuleCreate | CustomRuleEdit | CustomRuleDelete | CustomRuleRestore;

const CHANGE_OPS: Readonly<Record<string, z.ZodType>> = {
  create: customRuleCreateSchema,
  edit: customRuleEditSchema,
  delete: customRuleDeleteSchema,
  restore: customRuleRestoreSchema,
};

export const ruleSettingsChangeSchema = z.unknown().transform((value, ctx): RuleSettingsChange => {
  const op = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as { op?: unknown }).op : undefined;
  const schema = op === undefined ? ruleSettingChangeSchema : typeof op === "string" && Object.hasOwn(CHANGE_OPS, op) ? CHANGE_OPS[op] : undefined;
  if (!schema) {
    ctx.addIssue({ code: "custom", path: ["op"], message: "Is not a change this endpoint takes: create, edit, delete or restore." });
    return z.NEVER;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    return z.NEVER;
  }
  return parsed.data as RuleSettingsChange;
});

/** The rule a change names; null for a new rule, which has no id until it is saved. */
export function changeRuleId(change: RuleSettingsChange): string | null {
  return "rule_id" in change ? change.rule_id : null;
}

/** Whether a change is a rule's settings (the shape, with no `op`). */
export function isSettingChange(change: RuleSettingsChange): change is RuleSettingChange {
  return !("op" in change);
}

const ruleSettingsChanges = z.unknown().transform((value, ctx): RuleSettingsChange[] => {
  if (!Array.isArray(value)) {
    ctx.addIssue({ code: "custom", path: [], message: "Is not a list of changes." });
    return z.NEVER;
  }
  let refused = false;
  const refuse = (path: PropertyKey[], message: string) => {
    refused = true;
    ctx.addIssue({ code: "custom", path, message });
  };
  if (value.length === 0) refuse([], "Names no change.");
  if (value.length > RULE_SETTINGS_MAX_CHANGES) refuse([], `Holds more than ${RULE_SETTINGS_MAX_CHANGES} changes.`);
  const changes: RuleSettingsChange[] = [];
  const seen = new Set<string>();
  const titles = new Set<string>();
  value.forEach((item, index) => {
    const parsed = ruleSettingsChangeSchema.safeParse(item);
    if (parsed.success) changes.push(parsed.data);
    else for (const issue of parsed.error.issues) refuse([index, ...issue.path], issue.message);
    // Read from the item as sent, so a rule named twice is said even beside a change that is wrong in itself.
    const raw = typeof item === "object" && item !== null ? (item as { rule_id?: unknown; op?: unknown; rule?: { title?: unknown } }) : {};
    if (typeof raw.rule_id === "string") {
      if (seen.has(raw.rule_id)) refuse([index, "rule_id"], "Is named twice: one change per rule.");
      seen.add(raw.rule_id);
    } else if (raw.op === "create" && typeof raw.rule?.title === "string") {
      // Compared as the service compares names: "Ｓtuck" with a zero-width space in it is "stuck".
      const title = nameKey(raw.rule.title);
      if (titles.has(title)) refuse([index, "rule", "title"], "Two new rules have this name.");
      titles.add(title);
    }
  });
  return refused ? z.NEVER : changes;
});

/** POST /rules/settings/preview, browser to interface and interface to service: the changes to weigh up. */
export const ruleSettingsPreviewRequestSchema = z.strictObject({ changes: ruleSettingsChanges });

export const ruleSettingsSaveRequestSchema = z.strictObject({
  revision: z.number().int().min(0).max(1_000_000_000),
  changes: ruleSettingsChanges,
  reason: changeReason.nullable().optional(),
  undo_of: z.string().regex(CHANGE_ID_PATTERN).optional(),
});

function numberUnlessSaid(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || "kind" in value) return value;
  return { ...value, kind: "number", options: null };
}

/** One choice a param offers, from the board: a status (with its category), a stage, an evidence name, a field. */
export const paramOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  /** A status's category; null for anything else. */
  category: statusCategorySchema.nullable().default(null),
});

const numberParamSchema = z
  .object({
    name: z.string().regex(PARAM_NAME_PATTERN),
    label: z.string().min(1),
    kind: z.literal("number"),
    unit: ruleParamUnitSchema,
    value: z.number(),
    default: z.number(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    options: z.null().default(null),
  })
  .superRefine((param, ctx) => {
    if (param.min > param.max) ctx.addIssue({ code: "custom", path: ["max"], message: "below the minimum" });
  });

/** A custom rule's choice: statuses, a stage, an evidence name or a field, with the board's options. */
const choiceParamSchema = z.object({
  name: z.string().regex(PARAM_NAME_PATTERN),
  label: z.string().min(1),
  kind: z.enum(["statuses", "stage", "evidence", "field"]),
  unit: z.null().default(null),
  value: z.union([z.string(), z.array(z.string())]),
  default: paramValueSchema.nullable().default(null),
  min: z.null().default(null),
  max: z.null().default(null),
  step: z.null().default(null),
  options: z.array(paramOptionSchema),
});

export const ruleSettingsParamSchema = z.preprocess(numberUnlessSaid, z.discriminatedUnion("kind", [numberParamSchema, choiceParamSchema]));

/** What a rule looks at: its status categories (none for a sprint's rule) and issue types (null: every type but Epic). */
export const appliesToSchema = z.object({
  status_category: z.array(statusCategorySchema),
  issue_type: z.array(z.string().min(1)).nullable(),
});

export const ruleSettingsRuleSchema = z
  .object({
    rule_id: ruleId,
    title: z.string().min(1),
    description: z.string(),
    kind: ruleKindSchema,
    /** The check it runs (rules.yaml, or the custom rule's), which decides how its thresholds read. */
    check: z.string().min(1),
    /** The check in plain words, from the registry ("Time in a status"). */
    check_label: z.string().min(1),
    scope: z.enum(["issue", "sprint"]),
    escalates_to: ruleId.nullable(),
    enabled: z.boolean(),
    default_enabled: z.boolean(),
    severity: severitySchema,
    default_severity: severitySchema,
    /** A catalogue rule's editable thresholds only ([] when it has none); every param of a custom rule's check. */
    params: z.array(ruleSettingsParamSchema),
    /** Any field differs from rules.yaml on this board (a custom rule: false). */
    customised: z.boolean(),
    measurable: z.boolean(),
    missing_evidence: z.array(z.string()),
    /** Its open findings on the board. */
    open: count,
    /** Whether an admin added it to this board. */
    custom: z.boolean(),
    applies_to: appliesToSchema,
    /** When and by whom a custom rule was added (as the access log names them); null for a catalogue rule. */
    created_at: isoDateTime.nullable().default(null),
    created_by: viewerName.nullable().default(null),
  })
  .superRefine((rule, ctx) => {
    const names = new Set<string>();
    rule.params.forEach((param, index) => {
      if (names.has(param.name)) ctx.addIssue({ code: "custom", path: ["params", index, "name"], message: "listed twice" });
      names.add(param.name);
    });
    // A custom rule has no catalogue to differ from: whether it is customised is the catalogue's question alone.
    if (rule.custom) return;
    const differs =
      rule.enabled !== rule.default_enabled ||
      rule.severity !== rule.default_severity ||
      rule.params.some((param) => param.kind === "number" && param.value !== param.default);
    if (differs !== rule.customised) ctx.addIssue({ code: "custom", path: ["customised"], message: "does not say whether it differs from the catalogue" });
  });

/** A param of a check as the board offers it: a number's unit, bounds, step and default; a choice's options. */
export const checkParamSchema = z
  .object({
    name: z.string().regex(PARAM_NAME_PATTERN),
    label: z.string().min(1),
    kind: paramKindSchema,
    unit: ruleParamUnitSchema.nullable().default(null),
    min: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
    step: z.number().positive().nullable().default(null),
    default: paramValueSchema.nullable().default(null),
    options: z.array(paramOptionSchema).nullable().default(null),
  })
  .superRefine((param, ctx) => {
    if (param.kind === "number" && (param.unit === null || param.min === null || param.max === null || param.step === null)) {
      ctx.addIssue({ code: "custom", path: ["unit"], message: "a number needs its unit, bounds and step" });
    }
    if (param.kind === "number" && param.min !== null && param.max !== null && param.min > param.max) {
      ctx.addIssue({ code: "custom", path: ["max"], message: "below the minimum" });
    }
    if (param.kind !== "number" && param.options === null) ctx.addIssue({ code: "custom", path: ["options"], message: "a choice needs its options" });
  });

export const ruleCheckSchema = z.object({
  name: z.string().regex(PARAM_NAME_PATTERN),
  label: z.string().min(1),
  summary: z.string(),
  scope: z.enum(["issue", "sprint"]),
  params: z.array(checkParamSchema),
  categories: z.array(statusCategorySchema),
  default_categories: z.array(statusCategorySchema),
  measurable: z.boolean(),
  missing_evidence: z.array(z.string()),
});

/** A custom rule's definition as the history keeps it, in plain fields: what was added, deleted or brought back. */
export const customRuleDefinitionSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  check: z.string().min(1),
  params: z.record(z.string(), paramValueSchema),
  applies_to: appliesToSchema,
  severity: severitySchema,
});

/** A value a change set, by its field: what each field holds before and after. */
export type SettingValue = boolean | number | string | readonly string[] | AppliesTo | CustomRuleDefinition | null;

/** The value a field holds: on or off, a severity, a param, a title or description, what a rule looks at, a rule. */
function fieldValueSchema(field: string): z.ZodType<SettingValue> {
  switch (field) {
    case "enabled":
      return z.boolean();
    case "severity":
      return severitySchema;
    case "title":
      return z.string().min(1);
    case "description":
      return z.string().nullable();
    case "applies_to":
      return appliesToSchema;
    case "rule":
      return customRuleDefinitionSchema.nullable();
    default:
      return paramValueSchema;
  }
}

/** Whether two values a field held are the same: by value, so lists and objects compare as well as figures. */
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const ruleSettingsFieldChangeSchema = z
  .object({
    rule_id: ruleId,
    field: z.string().regex(SETTING_FIELD_PATTERN),
    from: z.unknown(),
    to: z.unknown(),
  })
  .transform((change, ctx): RuleSettingsFieldChange => {
    const schema = fieldValueSchema(change.field);
    const values: { from?: SettingValue; to?: SettingValue } = {};
    for (const key of ["from", "to"] as const) {
      const parsed = schema.safeParse(change[key]);
      if (parsed.success) values[key] = parsed.data;
      else ctx.addIssue({ code: "custom", path: [key], message: `not a value for ${change.field}` });
    }
    if (values.from === undefined || values.to === undefined) return z.NEVER;
    // A param is one kind of value on both sides: a number, a name, or statuses.
    const kind = (value: unknown) => (Array.isArray(value) ? "list" : typeof value);
    if (change.field.startsWith("params.") && kind(values.from) !== kind(values.to)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `not a value for ${change.field}` });
    }
    if (sameValue(values.from, values.to)) ctx.addIssue({ code: "custom", path: ["to"], message: "changes nothing" });
    if (change.field === "rule" && (values.from === null) === (values.to === null)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "a rule is added, deleted or brought back: one side is none" });
    }
    return { rule_id: change.rule_id, field: change.field, from: values.from, to: values.to };
  });

/** One field a change set, with the values the board ran before and after it. */
export interface RuleSettingsFieldChange {
  rule_id: string;
  field: string;
  from: SettingValue;
  to: SettingValue;
}

/** A viewer as the history names them: a keyed hash and a display name, never an address (one with one reads as a signed-in user). */
const changeAuthorSchema = z.object({ hash: z.string().regex(VIEWER_HASH_PATTERN), name: viewerName });

const EMAIL_ANYWHERE = new RegExp(EMAIL_IN_NAME.source, "gu");
/** Shown in place of an email address a reason holds (this interface refuses one in a reason it sends; another may not). */
export const REASON_EMAIL_REMOVED = "(email address removed)";

/** A reason as the history shows it: never an email address, whoever wrote it. */
const shownReason = z
  .string()
  .min(1)
  .refine((text) => [...text].length <= RULE_SETTINGS_REASON_MAX, { message: `is at most ${RULE_SETTINGS_REASON_MAX} characters` })
  .transform((text) => text.replace(EMAIL_ANYWHERE, REASON_EMAIL_REMOVED));

/** One change to a board's rule settings: when, by whom, why, each field it set, and the change it undid. */
export const ruleSettingsHistoryEntrySchema = z.object({
  change_id: z.string().regex(CHANGE_ID_PATTERN),
  at: isoDateTime,
  /** The board's settings revision this change made: 1, 2, 3 ... */
  revision: z.number().int().min(1),
  by: changeAuthorSchema,
  reason: shownReason.nullable(),
  undo_of: z.string().regex(CHANGE_ID_PATTERN).nullable(),
  changes: z.array(ruleSettingsFieldChangeSchema).min(1),
});

export const APPLY_STATES = ["applied", "pending", "running", "failed"] as const;

export const ruleSettingsApplySchema = z.object({
  state: z.enum(APPLY_STATES),
  /** The highest settings revision among the board's latest succeeded rules runs; 0 when none applied one. */
  applied_revision: count,
  started_at: isoDateTime.nullable(),
  finished_at: isoDateTime.nullable(),
  /** Plain words for the reader (a failed re-check says so, and that the next sync applies the settings). */
  message: z.string().min(1).nullable(),
  /** What the re-check opened and closed, when known. */
  result: z.object({ opened: count, closed: count }).nullable(),
});

export const ruleDraftAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().min(1).nullable().default(null),
});

export const ruleSettingsSchema = z
  .object({
    meta: serviceMetaSchema,
    project: projectKey,
    /** The board's settings revision: 0 until it is first changed. */
    revision: count,
    catalogue_version: z.string().min(1),
    updated_at: isoDateTime.nullable(),
    updated_by: viewerName.nullable(),
    apply: ruleSettingsApplySchema,
    rules: z.array(ruleSettingsRuleSchema),
    /** Newest first. */
    history: z.array(ruleSettingsHistoryEntrySchema).max(RULE_SETTINGS_HISTORY_MAX),
    /** The checks a custom rule may use on the board, each with the board's own options. */
    checks: z.array(ruleCheckSchema),
    /** The issue types the board's issues have, which a rule may be held to (Epic, where offered, last). */
    issue_types: z.array(z.string().min(1)).default([]),
    custom_limit: count,
    /** Its custom rules, deleted ones left out. */
    custom_count: count,
    ai_draft: ruleDraftAvailabilitySchema,
  })
  .superRefine((body, ctx) => {
    if ((body.revision === 0) !== (body.updated_at === null) || (body.updated_at === null) !== (body.updated_by === null)) {
      ctx.addIssue({ code: "custom", path: ["updated_at"], message: "says when and by whom exactly when the settings were changed" });
    }
    const ids = new Set<string>();
    body.rules.forEach((rule, index) => {
      if (ids.has(rule.rule_id)) ctx.addIssue({ code: "custom", path: ["rules", index, "rule_id"], message: "listed twice" });
      ids.add(rule.rule_id);
    });
    if (body.revision === 0 && body.history.length > 0) ctx.addIssue({ code: "custom", path: ["history"], message: "changes at revision 0" });
    if (body.history.length > 0 && body.history[0].revision !== body.revision) {
      ctx.addIssue({ code: "custom", path: ["history", 0, "revision"], message: "the newest change is not the board's revision" });
    }
    body.history.forEach((entry, index) => {
      const before = body.history[index - 1];
      if (before && entry.revision >= before.revision) ctx.addIssue({ code: "custom", path: ["history", index, "revision"], message: "not newest first" });
    });
    const { state, applied_revision: applied } = body.apply;
    if ((state === "applied" && applied < body.revision) || (state === "pending" && applied >= body.revision)) {
      ctx.addIssue({ code: "custom", path: ["apply", "state"], message: "does not fit the revision applied" });
    }
  });

/** What a change would do to one rule's open findings, worked out against the board's data as of its last sync. */
export const ruleSettingsImpactSchema = z
  .object({
    rule_id: ruleId,
    measurable: z.boolean(),
    open_now: count,
    /** Findings that would open: new ones, and closed ones that reopen with the same id. */
    would_open: count,
    /** Open findings that would close (settings changed, or superseded by a severity change). */
    would_close: count,
    /** Open findings that would stay open, the same finding. */
    would_stay: count,
    examples: z.object({
      open: z.array(z.string().regex(EXAMPLE_KEY_PATTERN)).max(RULE_SETTINGS_EXAMPLES_MAX),
      close: z.array(z.string().regex(EXAMPLE_KEY_PATTERN)).max(RULE_SETTINGS_EXAMPLES_MAX),
    }),
    note: z.string().min(1).nullable(),
  })
  .superRefine((impact, ctx) => {
    if (impact.would_close + impact.would_stay !== impact.open_now) {
      ctx.addIssue({ code: "custom", path: ["would_stay"], message: "closing and staying do not add up to what is open now" });
    }
  });

/** POST /rules/settings/preview (contract 4.21): what the changes would do, rule by rule, without writing anything. */
export const ruleSettingsPreviewSchema = z
  .object({
    meta: serviceMetaSchema,
    project: projectKey,
    revision: count,
    impact: z.array(ruleSettingsImpactSchema),
    totals: z.object({ would_open: count, would_close: count }),
  })
  .superRefine((body, ctx) => {
    const ids = new Set<string>();
    body.impact.forEach((impact, index) => {
      if (ids.has(impact.rule_id)) ctx.addIssue({ code: "custom", path: ["impact", index, "rule_id"], message: "listed twice" });
      ids.add(impact.rule_id);
    });
    const sum = (key: "would_open" | "would_close") => body.impact.reduce((total, impact) => total + impact[key], 0);
    if (sum("would_open") !== body.totals.would_open || sum("would_close") !== body.totals.would_close) {
      ctx.addIssue({ code: "custom", path: ["totals"], message: "not the sum of the rules' impact" });
    }
  });

/* ----------------------------------------------------- an AI draft -- */

const ACCOUNT_ID_IN_TEXT = /(?<![0-9A-Za-z])(?:[0-9a-f]{24}|[0-9A-Za-z]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9A-Za-z])/u;

export function namesSomeone(text: string): boolean {
  return EMAIL_IN_NAME.test(text) || ACCOUNT_ID_IN_TEXT.test(text);
}

/** Why words holding an email address or an account id are not drafted from, wherever they are caught. */
export const RULE_DRAFT_PERSONAL = "Leave out email addresses and account IDs.";

export const ruleDraftRequestSchema = z
  .strictObject({ text: z.string().max(RULE_DRAFT_TEXT_MAX * 4).transform(plainText) })
  .refine((body) => characterCount(body.text) >= RULE_DRAFT_TEXT_MIN && characterCount(body.text) <= RULE_DRAFT_TEXT_MAX, {
    message: `Describe the rule in ${RULE_DRAFT_TEXT_MIN} to ${RULE_DRAFT_TEXT_MAX} characters.`,
    path: ["text"],
  })
  .refine((body) => !namesSomeone(body.text), { message: RULE_DRAFT_PERSONAL, path: ["text"] });

/** What a draft came to: a rule to check, one the checks cannot make, a request not understood, or no AI just now. */
export const DRAFT_OUTCOMES = ["drafted", "not_supported", "not_understood", "unavailable"] as const;

export const ruleDraftRuleSchema = z.object({
  title: z
    .string()
    .nullish()
    .transform((title) => title ?? ""),
  description: z.string().nullable().default(null),
  check: z
    .string()
    .nullish()
    .transform((check) => check ?? ""),
  // Only values a param can hold reach the form; anything else the model wrote is the draft's problem to say.
  params: z
    .record(z.string(), z.unknown())
    .transform((params) => Object.fromEntries(Object.entries(params).filter(([, value]) => paramValueSchema.safeParse(value).success)) as Record<string, ParamValue>),
  applies_to: appliesToSchema,
  severity: severitySchema.nullish().transform((severity) => severity ?? "breach"),
});

export const ruleDraftSchema = z
  .object({
    meta: serviceMetaSchema,
    project: projectKey,
    outcome: z.enum(DRAFT_OUTCOMES),
    draft: ruleDraftRuleSchema.nullable(),
    /** What the drafted rule would flag, in a sentence or two; null otherwise. */
    explanation: z.string().min(1).nullable().default(null),
    /** Why it could not be drafted, and the closest check; null for a draft. */
    note: z.string().min(1).nullable().default(null),
    /** What a save would still refuse in the draft, at its field ("title", "params.hours", "applies_to.status_category"). */
    problems: z.array(z.object({ field: z.string().min(1), message: z.string().min(1) })).default([]),
  })
  .superRefine((body, ctx) => {
    if ((body.outcome === "drafted") !== (body.draft !== null)) {
      ctx.addIssue({ code: "custom", path: ["draft"], message: "a draft comes exactly with the drafted outcome" });
    }
    if (body.outcome !== "drafted" && body.problems.length > 0) {
      ctx.addIssue({ code: "custom", path: ["problems"], message: "only a draft has problems" });
    }
  });

/* ---------------------------------------------------------------- errors -- */

export const API_ERROR_CODES = [
  /** The request itself is wrong: a parameter, a body. Not worth retrying. */
  "bad_request",
  /** No such endpoint, finding or issue. */
  "not_found",
  /** The board picked in the top bar is not one the oversight service serves (it was taken off). */
  "unknown_board",
  "board_not_synced",
  /** Sign-in is on, and the person's Jira account cannot open that board (their boards are worked out at sign-in). */
  "board_not_allowed",
  /** A question mentions people, and the person asking it reads Ask at team level (they are not an admin). */
  "people_not_allowed",
  /** People compared side by side (a scorecard of two or more), where the organisation has turned comparison off. */
  "comparison_off",
  /** Too many questions from one reader in a short time (the service's ASK_RATE_LIMIT): 429, with Retry-After. */
  "ask_rate_limited",
  "access_log_unavailable",
  /** A save of rule settings made against a revision the board has moved on from: someone else changed them. */
  "rule_settings_conflict",
  /** Rule settings refused: a value out of bounds, a warning not below its breach, a rule that does not exist. */
  "rule_settings_invalid",
  "forbidden",
  /** Sign-in is on and the request carries no valid session: the browser goes to /login and comes back. */
  "unauthenticated",
  /** The interface's own configuration cannot serve the request. */
  "not_configured",
  /** The oversight service could not be reached. */
  "upstream_unavailable",
  /** The oversight service did not answer in time. */
  "upstream_timeout",
  /** The oversight service refused this interface's credentials. */
  "upstream_refused",
  /** The oversight service answered with an error. */
  "upstream_error",
  /** The oversight service answered with something that is not JSON. */
  "upstream_malformed",
  /** The oversight service answered with JSON that breaks this contract. */
  "upstream_invalid",
  /** A fault in this interface. */
  "internal_error",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Every non-2xx body from /api/oversight. `error` is a stable code; `message` is for people. */
export const apiErrorBodySchema = z.object({
  error: z.string().min(1),
  message: z.string(),
  /** Which parts of a request (or of an upstream body) were wrong: paths only, never values. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

/* ----------------------------------------------------------------- types -- */

export type Meta = z.infer<typeof metaSchema>;
export type ServiceMeta = z.infer<typeof serviceMetaSchema>;
export type DataMode = z.infer<typeof dataModeSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type RuleKind = z.infer<typeof ruleKindSchema>;
export type FindingState = z.infer<typeof findingStateSchema>;
export type StatusCategory = z.infer<typeof statusCategorySchema>;
export type Stage = z.infer<typeof stageSchema>;
export type ValueUnit = z.infer<typeof valueUnitSchema>;
export type TrendMetric = z.infer<typeof trendMetricSchema>;
export type Direction = z.infer<typeof directionSchema>;

export type Health = z.infer<typeof healthSchema>;
export type TrendPoint = z.infer<typeof trendPointSchema>;
export type Interval = z.infer<typeof intervalSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type WarnedBefore = z.infer<typeof warnedBeforeSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type WindowPoint = z.infer<typeof windowPointSchema>;
export type WindowTotal = z.infer<typeof windowTotalSchema>;
export type HotSpot = z.infer<typeof hotSpotSchema>;
export type RuleSummary = z.infer<typeof ruleSummarySchema>;
export type CoverageEntry = z.infer<typeof coverageEntrySchema>;
export type TrendCard = z.infer<typeof trendCardSchema>;
export type InsightSentence = z.infer<typeof insightSentenceSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type FacetEntry = z.infer<typeof facetEntrySchema>;
export type PersonFacetEntry = z.infer<typeof personFacetEntrySchema>;
export type FindingsPage = z.infer<typeof findingsPageSchema>;
export type FindingDetail = z.infer<typeof findingDetailSchema>;
export type IssueTimeline = z.infer<typeof issueTimelineSchema>;
export type AskRequest = z.infer<typeof askRequestSchema>;
export type AskLevel = z.infer<typeof askLevelSchema>;
export type AskOutcome = z.infer<typeof askOutcomeSchema>;
export type FactCell = z.infer<typeof factCellSchema>;
export type FactColumnKind = z.infer<typeof factColumnKindSchema>;
export type FactSet = z.infer<typeof factSetSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type AskResponse = z.infer<typeof askResponseSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Insights = z.infer<typeof insightsSchema>;
export type Trend = z.infer<typeof trendSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type ProcessStage = z.infer<typeof processStageSchema>;
export type Rules = z.infer<typeof rulesSchema>;
export type Baseline = z.infer<typeof baselineSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type Projects = z.infer<typeof projectsSchema>;
export type Person = z.infer<typeof personSchema>;
export type PersonSummary = z.infer<typeof personSummarySchema>;
export type People = z.infer<typeof peopleSchema>;
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;
export type PeopleDirectory = z.infer<typeof peopleDirectorySchema>;
export type ScorecardKind = z.infer<typeof scorecardKindSchema>;
export type ScorecardDirection = z.infer<typeof scorecardDirectionSchema>;
export type VsBoard = z.infer<typeof vsBoardSchema>;
export type ScorecardMeasure = z.infer<typeof scorecardMeasureSchema>;
export type ScorecardValue = z.infer<typeof scorecardValueSchema>;
export type ScorecardValues = Record<ScorecardMeasureKey, ScorecardValue>;
export type ScorecardPerson = z.infer<typeof scorecardPersonSchema>;
export type PeopleScorecard = z.infer<typeof peopleScorecardSchema>;
export type PersonCardMembership = z.infer<typeof personCardMembershipSchema>;
export type PersonCardTicket = z.infer<typeof personCardTicketSchema>;
export type PersonCardBoard = z.infer<typeof personCardBoardSchema>;
export type PersonCardProcess = z.infer<typeof personCardProcessSchema>;
export type PersonCard = z.infer<typeof personCardSchema>;
export type Refresh = z.infer<typeof refreshSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
export type AccessLogEntry = z.infer<typeof accessLogEntrySchema>;
export type AccessLog = z.infer<typeof accessLogSchema>;
export type UsageDay = z.infer<typeof usageDaySchema>;
export type Usage = z.infer<typeof usageSchema>;
export type PortfolioBoard = z.infer<typeof portfolioBoardSchema>;
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type RuleParamUnit = z.infer<typeof ruleParamUnitSchema>;
export type RuleSettingsPreviewRequest = z.output<typeof ruleSettingsPreviewRequestSchema>;
export type RuleSettingsSaveRequest = z.output<typeof ruleSettingsSaveRequestSchema>;
export type RuleSettingsParam = z.infer<typeof ruleSettingsParamSchema>;
/** A rule's number param: a threshold, with its unit and bounds. */
export type RuleSettingsNumberParam = Extract<RuleSettingsParam, { kind: "number" }>;
/** A custom rule's choice: statuses, a stage, an evidence name or a field. */
export type RuleSettingsChoiceParam = Exclude<RuleSettingsParam, { kind: "number" }>;
export type ParamOption = z.infer<typeof paramOptionSchema>;
export type AppliesTo = z.infer<typeof appliesToSchema>;
export type RuleSettingsRule = z.infer<typeof ruleSettingsRuleSchema>;
export type CheckParam = z.infer<typeof checkParamSchema>;
export type RuleCheck = z.infer<typeof ruleCheckSchema>;
export type CustomRuleDefinition = z.infer<typeof customRuleDefinitionSchema>;
export type RuleSettingsHistoryEntry = z.infer<typeof ruleSettingsHistoryEntrySchema>;
export type RuleSettingsApply = z.infer<typeof ruleSettingsApplySchema>;
export type ApplyState = (typeof APPLY_STATES)[number];
export type RuleDraftAvailability = z.infer<typeof ruleDraftAvailabilitySchema>;
export type RuleSettings = z.infer<typeof ruleSettingsSchema>;
export type RuleSettingsImpact = z.infer<typeof ruleSettingsImpactSchema>;
export type RuleSettingsPreview = z.infer<typeof ruleSettingsPreviewSchema>;
export type RuleDraftRequest = z.output<typeof ruleDraftRequestSchema>;
export type DraftOutcome = (typeof DRAFT_OUTCOMES)[number];
export type RuleDraftRule = z.infer<typeof ruleDraftRuleSchema>;
export type RuleDraft = z.infer<typeof ruleDraftSchema>;
