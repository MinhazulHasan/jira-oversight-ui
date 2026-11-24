import { z } from "zod";

import {
  ACCESS_ACTIONS,
  ACCESS_CURSOR_PATTERN,
  ACCESS_LOG_DEFAULT_LIMIT,
  ACCESS_LOG_EXPORT_MAX,
  ACCESS_LOG_MAX_LIMIT,
  accessActionSchema,
  isoDate,
  ISSUE_KEY_PATTERN,
  PERSON_ID_PATTERN,
  PROJECT_KEY_PATTERN,
  RULE_ID_PATTERN,
  SCORECARD_DAYS,
  SCORECARD_DEFAULT_DAYS,
  SCORECARD_MAX_PEOPLE,
  UNASSIGNED,
  VIEWER_HASH_PATTERN,
  severitySchema,
  trendMetricSchema,
  type AccessAction,
  type ScorecardDays,
} from "./schemas";

/* -------------------------------------------------------------- findings -- */

export const FINDINGS_SORTS = [
  "first_seen_at",
  "last_seen_at",
  "resolved_at",
  "severity",
  "rule_id",
  "issue_key",
  "epic_key",
] as const;

export const FIRST_SEEN_WINDOWS = ["7d", "30d", "90d", "all"] as const;
export const FINDING_STATES = ["open", "resolved", "all"] as const;
/** Filters findings whose issue belongs to no epic (and sprint findings). */
export const NO_EPIC = "none";
export const FINDINGS_PAGE_SIZES = { default: 25, max: 100 } as const;

const listOf = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).default([]);

export const findingsQuerySchema = z.object({
  /** Any of these rules (repeatable). */
  rule: listOf(z.string().regex(RULE_ID_PATTERN), 24),
  severity: severitySchema.optional(),
  state: z.enum(FINDING_STATES).default("open"),
  /** Any of these epics (repeatable); "none" for issues without one. */
  epic: listOf(z.union([z.string().regex(ISSUE_KEY_PATTERN), z.literal(NO_EPIC)]), 50),
  person: listOf(z.union([z.string().regex(PERSON_ID_PATTERN), z.literal(UNASSIGNED)]), 50),
  /** Part of an issue key or summary, any case. */
  q: z.string().trim().max(100).optional(),
  /** Findings first seen in the last 7, 30 or 90 days. */
  first_seen: z.enum(FIRST_SEEN_WINDOWS).default("all"),
  sort: z.enum(FINDINGS_SORTS).default("first_seen_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(FINDINGS_PAGE_SIZES.max).default(FINDINGS_PAGE_SIZES.default),
});

/** Parsed and defaulted: what the API acts on. */
export type FindingsQuery = z.output<typeof findingsQuerySchema>;
/** What a caller may pass: anything left out takes its default. */
export type FindingsQueryInput = z.input<typeof findingsQuerySchema>;

const FINDINGS_LISTS = ["rule", "epic", "person"] as const;

/* ---------------------------------------------------------------- trends -- */

export const TREND_WEEKS = { default: 12, max: 12 } as const;

export const trendQuerySchema = z.object({
  metric: trendMetricSchema,
  period: z.literal("week").default("week"),
  last_n: z.coerce.number().int().min(1).max(TREND_WEEKS.max).default(TREND_WEEKS.default),
});

export type TrendQuery = z.output<typeof trendQuerySchema>;
export type TrendQueryInput = z.input<typeof trendQuerySchema>;

/* ------------------------------------------------------------- scorecard -- */

export const scorecardQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((days): days is ScorecardDays => (SCORECARD_DAYS as readonly number[]).includes(days), {
      message: `is ${SCORECARD_DAYS.join(", ").replace(/, (\d+)$/, " or $1")} days`,
    })
    .default(SCORECARD_DEFAULT_DAYS),
  person: z
    .array(z.string().regex(PERSON_ID_PATTERN, { message: "is a person id: p and 12 lower-case hexadecimal characters" }))
    .max(SCORECARD_MAX_PEOPLE, { message: `names ${SCORECARD_MAX_PEOPLE} people at most` })
    .refine((ids) => new Set(ids).size === ids.length, { message: "names each person once" })
    .default([]),
});

export type ScorecardQuery = { days: ScorecardDays; person: string[] };
export type ScorecardQueryInput = { days?: ScorecardDays; person?: readonly string[] };

const SCORECARD_LISTS = ["person"] as const;

/* ----------------------------------------------------------- person card -- */

export const personCardQuerySchema = z.object({
  days: scorecardQuerySchema.shape.days,
  board: z.string().regex(PROJECT_KEY_PATTERN, { message: "is a board's project key" }).optional(),
});

export type PersonCardQuery = { days: ScorecardDays; board?: string };
export type PersonCardQueryInput = { days?: ScorecardDays; board?: string | null };

/* ------------------------------------------------------------ access log -- */

export const ACCESS_LOG_FIRST_DAY = "2000-01-01";
export const ACCESS_LOG_LAST_DAY = "2100-12-31";
const accessLogDay = isoDate.refine((day) => day >= ACCESS_LOG_FIRST_DAY && day <= ACCESS_LOG_LAST_DAY, {
  message: `is a day from ${ACCESS_LOG_FIRST_DAY} to ${ACCESS_LOG_LAST_DAY}`,
});

export const accessLogQuerySchema = z.object({
  from: accessLogDay.optional(),
  to: accessLogDay.optional(),
  action: z.array(accessActionSchema).max(ACCESS_ACTIONS.length * 2).default([]),
  person: z.string().regex(PERSON_ID_PATTERN, { message: "is a person id: p and 12 lower-case hexadecimal characters" }).optional(),
  viewer: z.string().regex(VIEWER_HASH_PATTERN, { message: 'is a viewer: 32 lower-case hexadecimal characters, or "local"' }).optional(),
  cursor: z.string().regex(ACCESS_CURSOR_PATTERN, { message: "is a cursor the access log gave" }).optional(),
  // Checked against the page's limit or the export's once it is known whether this read is an export.
  limit: z.coerce.number().int().min(1).max(ACCESS_LOG_EXPORT_MAX).optional(),
  export: z.literal("true", { message: 'is "true" or left out' }).optional(),
});

export interface AccessLogQuery {
  from?: string;
  to?: string;
  /** Each once, in the catalogue's order. */
  action: AccessAction[];
  person?: string;
  viewer?: string;
  cursor?: string;
  limit: number;
  /** An export's read: the service records it as access_log_export rather than access_log_view. */
  export: boolean;
}

export type AccessLogQueryInput = Partial<Omit<AccessLogQuery, "action">> & { action?: readonly AccessAction[] };

const ACCESS_LOG_LISTS = ["action"] as const;

/* --------------------------------------------------------------- parsing -- */

export interface ParamProblem {
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problems: ParamProblem[] };

function parseSearch<S extends z.ZodObject>(
  schema: S,
  search: URLSearchParams,
  lists: readonly string[],
): ParseResult<z.output<S>> {
  const known = new Set(Object.keys(schema.shape));
  const raw: Record<string, string | string[]> = {};
  const problems: ParamProblem[] = [];

  for (const name of new Set(search.keys())) {
    const values = search.getAll(name);
    if (!known.has(name)) {
      problems.push({ path: name, message: "is not a parameter of this endpoint" });
    } else if (lists.includes(name)) {
      raw[name] = values.filter((value) => value !== "");
    } else if (values.length > 1) {
      problems.push({ path: name, message: "may be given only once" });
    } else if (values[0] !== "") {
      raw[name] = values[0];
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join(".") || "(query)",
        message: issue.message,
      })),
    };
  }
  return { ok: true, value: parsed.data };
}

export function parseFindingsQuery(search: URLSearchParams): ParseResult<FindingsQuery> {
  return parseSearch(findingsQuerySchema, search, FINDINGS_LISTS);
}

export function parseTrendQuery(search: URLSearchParams): ParseResult<TrendQuery> {
  return parseSearch(trendQuerySchema, search, []);
}

export function parseScorecardQuery(search: URLSearchParams): ParseResult<ScorecardQuery> {
  const parsed = parseSearch(scorecardQuerySchema, search, SCORECARD_LISTS);
  return parsed.ok ? { ok: true, value: normalizeScorecardQuery(parsed.value as ScorecardQuery) } : parsed;
}

export function normalizeScorecardQuery(input: ScorecardQueryInput = {}): ScorecardQuery {
  const query = scorecardQuerySchema.parse({ days: input.days, person: input.person ? [...input.person] : undefined });
  return { days: query.days as ScorecardDays, person: [...query.person].sort() };
}

/** The canonical query string: the period unless it is the default, then each person. */
export function scorecardSearchParams(input: ScorecardQueryInput = {}): URLSearchParams {
  const query = normalizeScorecardQuery(input);
  const search = new URLSearchParams();
  if (query.days !== SCORECARD_DEFAULT_DAYS) search.set("days", String(query.days));
  for (const person of query.person) search.append("person", person);
  return search;
}

/** A person card's period and board, checked: anything else, or a name given twice, is refused. */
export function parsePersonCardQuery(search: URLSearchParams): ParseResult<PersonCardQuery> {
  const parsed = parseSearch(personCardQuerySchema, search, []);
  return parsed.ok ? { ok: true, value: normalizePersonCardQuery(parsed.value as PersonCardQueryInput) } : parsed;
}

/** Defaults filled in (90 days, the top bar's board). Throws on a value no URL could carry (a programming error). */
export function normalizePersonCardQuery(input: PersonCardQueryInput = {}): PersonCardQuery {
  const query = personCardQuerySchema.parse({ days: input.days, board: input.board ?? undefined });
  return { days: query.days as ScorecardDays, ...(query.board === undefined ? {} : { board: query.board }) };
}

/** The browser's query string: the period unless it is the default, then the board when the page names one. */
export function personCardSearchParams(input: PersonCardQueryInput = {}): URLSearchParams {
  const query = normalizePersonCardQuery(input);
  const search = new URLSearchParams();
  if (query.days !== SCORECARD_DEFAULT_DAYS) search.set("days", String(query.days));
  if (query.board) search.set("board", query.board);
  return search;
}

export function parseAccessLogQuery(search: URLSearchParams): ParseResult<AccessLogQuery> {
  const parsed = parseSearch(accessLogQuerySchema, search, ACCESS_LOG_LISTS);
  if (!parsed.ok) return parsed;
  const { from, to, limit } = parsed.value;
  const exporting = parsed.value.export === "true";
  if (from !== undefined && to !== undefined && from > to) {
    return { ok: false, problems: [{ path: "to", message: "is before from: the range ends where it starts or later" }] };
  }
  const ceiling = exporting ? ACCESS_LOG_EXPORT_MAX : ACCESS_LOG_MAX_LIMIT;
  if (limit !== undefined && limit > ceiling) {
    return { ok: false, problems: [{ path: "limit", message: `is at most ${ceiling}${exporting ? " for an export" : " to a page"}` }] };
  }
  return { ok: true, value: normalizeAccessLogQuery({ ...parsed.value, export: exporting }) };
}

/** How many entries a read returns when it does not say: a page's 50, or (an export) as many as the service gives. */
export function accessLogDefaultLimit(exporting: boolean): number {
  return exporting ? ACCESS_LOG_EXPORT_MAX : ACCESS_LOG_DEFAULT_LIMIT;
}

export function normalizeAccessLogQuery(input: AccessLogQueryInput = {}): AccessLogQuery {
  const exporting = input.export === true;
  const query = accessLogQuerySchema.parse({
    from: input.from,
    to: input.to,
    action: input.action ? [...input.action] : undefined,
    person: input.person,
    viewer: input.viewer,
    cursor: input.cursor,
    limit: input.limit,
  });
  const limit = query.limit ?? accessLogDefaultLimit(exporting);
  if (limit > (exporting ? ACCESS_LOG_EXPORT_MAX : ACCESS_LOG_MAX_LIMIT)) throw new RangeError(`An access log read of ${limit} entries is past its limit.`);
  const actions = new Set(query.action);
  return {
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    action: ACCESS_ACTIONS.filter((action) => actions.has(action)),
    ...(query.person === undefined ? {} : { person: query.person }),
    ...(query.viewer === undefined ? {} : { viewer: query.viewer }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    limit,
    export: exporting,
  };
}

export function accessLogSearchParams(input: AccessLogQueryInput = {}): URLSearchParams {
  const query = normalizeAccessLogQuery(input);
  const search = new URLSearchParams();
  if (query.from) search.set("from", query.from);
  if (query.to) search.set("to", query.to);
  for (const action of query.action) search.append("action", action);
  if (query.person) search.set("person", query.person);
  if (query.viewer) search.set("viewer", query.viewer);
  if (query.cursor) search.set("cursor", query.cursor);
  search.set("limit", String(query.limit));
  if (query.export) search.set("export", "true");
  return search;
}

/** Fills in defaults; throws on a value no URL could carry (a programming error). */
export function normalizeFindingsQuery(input: FindingsQueryInput = {}): FindingsQuery {
  const query = findingsQuerySchema.parse(input);
  return {
    ...query,
    rule: [...new Set(query.rule)].sort(),
    epic: [...new Set(query.epic)].sort(),
    person: [...new Set(query.person)].sort(),
    q: query.q === "" ? undefined : query.q,
  };
}

export function normalizeTrendQuery(input: TrendQueryInput): TrendQuery {
  return trendQuerySchema.parse(input);
}

/* ----------------------------------------------------------- serialising -- */

const FINDINGS_DEFAULTS = findingsQuerySchema.parse({});

/** The canonical query string for a findings query: defaults left out, lists sorted. */
export function findingsSearchParams(input: FindingsQueryInput = {}): URLSearchParams {
  const query = normalizeFindingsQuery(input);
  const search = new URLSearchParams();
  for (const rule of query.rule) search.append("rule", rule);
  if (query.severity) search.set("severity", query.severity);
  if (query.state !== FINDINGS_DEFAULTS.state) search.set("state", query.state);
  for (const epic of query.epic) search.append("epic", epic);
  for (const person of query.person) search.append("person", person);
  if (query.q) search.set("q", query.q);
  if (query.first_seen !== FINDINGS_DEFAULTS.first_seen) search.set("first_seen", query.first_seen);
  if (query.sort !== FINDINGS_DEFAULTS.sort) search.set("sort", query.sort);
  if (query.order !== FINDINGS_DEFAULTS.order) search.set("order", query.order);
  if (query.page !== FINDINGS_DEFAULTS.page) search.set("page", String(query.page));
  if (query.page_size !== FINDINGS_DEFAULTS.page_size) search.set("page_size", String(query.page_size));
  return search;
}

export function trendSearchParams(input: TrendQueryInput): URLSearchParams {
  const query = normalizeTrendQuery(input);
  return new URLSearchParams({ metric: query.metric, period: query.period, last_n: String(query.last_n) });
}
