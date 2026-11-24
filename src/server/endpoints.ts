import "server-only";

import type { z } from "zod";

import {
  accessLogSearchParams,
  findingsSearchParams,
  parseAccessLogQuery,
  parseFindingsQuery,
  parsePersonCardQuery,
  parseScorecardQuery,
  parseTrendQuery,
  scorecardSearchParams,
  trendSearchParams,
  type AccessLogQuery,
  type FindingsQuery,
  type ParamProblem,
  type PersonCardQuery,
  type ScorecardQuery,
  type TrendQuery,
} from "@/lib/api/params";
import {
  accessLogSchema,
  askRequestSchema,
  askResponseSchema,
  AVATAR_VERSION_PATTERN,
  baselineSchema,
  FINDING_ID_PATTERN,
  findingDetailSchema,
  findingsPageSchema,
  healthSchema,
  insightsSchema,
  ISSUE_KEY_PATTERN,
  issueTimelineSchema,
  overviewSchema,
  peopleDirectorySchema,
  peopleSchema,
  peopleScorecardSchema,
  PERSON_ID_PATTERN,
  personCardSchema,
  portfolioSchema,
  PROJECT_KEY_PATTERN,
  projectsSchema,
  refreshSchema,
  RULE_DRAFT_PERSONAL,
  RULE_DRAFT_TEXT_MAX,
  RULE_DRAFT_TEXT_MIN,
  RULE_ID_PATTERN,
  ruleDraftRequestSchema,
  ruleDraftSchema,
  ruleSettingsPreviewRequestSchema,
  ruleSettingsPreviewSchema,
  ruleSettingsSaveRequestSchema,
  ruleSettingsSchema,
  rulesSchema,
  SCORECARD_DEFAULT_DAYS,
  trendSchema,
  usageSchema,
  type ApiErrorCode,
  type AskLevel,
  type RuleDraftRequest,
  type RuleSettingsChange,
  type RuleSettingsPreviewRequest,
  type RuleSettingsSaveRequest,
} from "@/lib/api/schemas";

/** The allowlist. Nothing reaches the oversight service (or the sample data) */

export type Route =
  | { name: "health" }
  | { name: "projects" }
  | { name: "refresh" }
  | { name: "refresh_start" }
  | { name: "overview" }
  | { name: "people" }
  /** Everyone on the board, members with no tickets too: what Ask's @ list offers. */
  | { name: "people_directory" }
  | { name: "people_scorecard"; query: ScorecardQuery; level: AskLevel }
  | { name: "person_card"; personId: string; query: PersonCardQuery; level: AskLevel }
  | { name: "findings"; query: FindingsQuery }
  | { name: "finding"; findingId: string }
  | { name: "issue_timeline"; issueKey: string }
  /** A question, the people it mentions (person ids, checked), and the level it */
  | { name: "ask"; question: string; mentions: string[]; level: AskLevel }
  | { name: "insights" }
  | { name: "trend"; query: TrendQuery }
  | { name: "rules" }
  | { name: "baseline" }
  | { name: "portfolio"; boards?: readonly string[] }
  | { name: "access_log"; query: AccessLogQuery; level: AskLevel }
  /** Ask's questions, model calls and tokens today and over the last 7 days, against the budget: people level only. */
  | { name: "usage"; level: AskLevel }
  | { name: "person_avatar"; personId: string; board?: string }
  | { name: "rule_settings"; level: AskLevel }
  /** What changes to them would do, worked out by the service without writing anything: the body checked and rebuilt. */
  | { name: "rule_settings_preview"; body: RuleSettingsPreviewRequest; level: AskLevel }
  /** A save: the changes and the revision they were made against (a reason, an undo), the body checked and rebuilt. */
  | { name: "rule_settings_save"; body: RuleSettingsSaveRequest; level: AskLevel }
  | { name: "rule_settings_draft"; body: RuleDraftRequest; level: AskLevel };

export type RouteName = Route["name"];
/** Every route but the picture answers JSON, which the contract's schemas check. */
export type JsonRoute = Exclude<Route, { name: "person_avatar" }>;
export type JsonRouteName = JsonRoute["name"];

/** What each JSON endpoint must answer with. Live bodies are checked against these before they are passed on. */
export const RESPONSE_SCHEMAS = {
  health: healthSchema,
  projects: projectsSchema,
  refresh: refreshSchema,
  refresh_start: refreshSchema,
  overview: overviewSchema,
  people: peopleSchema,
  people_directory: peopleDirectorySchema,
  people_scorecard: peopleScorecardSchema,
  person_card: personCardSchema,
  findings: findingsPageSchema,
  finding: findingDetailSchema,
  issue_timeline: issueTimelineSchema,
  ask: askResponseSchema,
  insights: insightsSchema,
  trend: trendSchema,
  rules: rulesSchema,
  baseline: baselineSchema,
  portfolio: portfolioSchema,
  access_log: accessLogSchema,
  usage: usageSchema,
  rule_settings: ruleSettingsSchema,
  rule_settings_preview: ruleSettingsPreviewSchema,
  rule_settings_save: ruleSettingsSchema,
  rule_settings_draft: ruleDraftSchema,
} satisfies Record<JsonRouteName, z.ZodType>;

export interface Resolved {
  route: Route;
  /** Path and query under the API's /api/v1/, rebuilt from validated values: "findings?rule=R-EST-01". */
  upstream: string;
}

export interface Refusal {
  status: number;
  error: ApiErrorCode;
  message: string;
  issues?: ParamProblem[];
}

export type Resolution = { ok: true; value: Resolved } | ({ ok: false } & Refusal);

function refuse(status: number, error: ApiErrorCode, message: string, issues?: ParamProblem[]): Resolution {
  return { ok: false, status, error, message, issues };
}

function notFound(segments: readonly string[]): Resolution {
  return refuse(404, "not_found", `There is no endpoint at /api/oversight/${segments.join("/")}.`);
}

function accept(route: Route, upstream: string): Resolution {
  return { ok: true, value: { route, upstream } };
}

/** For endpoints that take no parameters: any query parameter is refused, not ignored. */
function withoutQuery(route: Route, upstream: string, search: URLSearchParams): Resolution {
  const names = [...new Set(search.keys())];
  if (names.length === 0) return accept(route, upstream);
  return refuse(
    400,
    "bad_request",
    `/api/oversight/${upstream} takes no query parameters.`,
    names.map((name) => ({ path: name, message: "is not a parameter of this endpoint" })),
  );
}

function withQuery(path: string, search: URLSearchParams): string {
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** A picture's address may carry its version (`v`), which only keeps the */
function pictureRoute(personId: string, upstream: string, search: URLSearchParams): Resolution {
  const problems: ParamProblem[] = [];
  for (const name of new Set(search.keys())) {
    if (name !== "v" && name !== "board") problems.push({ path: name, message: "is not a parameter of this endpoint" });
  }
  const versions = search.getAll("v");
  if (versions.length > 1) problems.push({ path: "v", message: "may be given only once" });
  else if (versions.length === 1 && !AVATAR_VERSION_PATTERN.test(versions[0])) {
    problems.push({ path: "v", message: "is a picture's version: 12 lower-case hexadecimal characters" });
  }
  const boards = search.getAll("board");
  if (boards.length > 1) problems.push({ path: "board", message: "may be given only once" });
  else if (boards.length === 1 && !PROJECT_KEY_PATTERN.test(boards[0])) {
    problems.push({ path: "board", message: "is a board's project key" });
  }
  if (problems.length > 0) return refuse(400, "bad_request", `/api/oversight/${upstream} takes only the picture's version and its board.`, problems);
  return accept({ name: "person_avatar", personId, ...(boards.length === 1 ? { board: boards[0] } : {}) }, upstream);
}

export function resolveGet(segments: readonly string[], search: URLSearchParams): Resolution {
  const [first, second, third, ...rest] = segments;
  if (rest.length > 0) return notFound(segments);

  if (second === undefined) {
    switch (first) {
      case "health":
        return withoutQuery({ name: "health" }, "health", search);
      case "projects":
        return withoutQuery({ name: "projects" }, "projects", search);
      case "refresh":
        return withoutQuery({ name: "refresh" }, "refresh", search);
      case "overview":
        return withoutQuery({ name: "overview" }, "overview", search);
      case "people":
        // Board-scoped like the overview: the board comes from the top bar's pick, never from the query.
        return withoutQuery({ name: "people" }, "people", search);
      case "rules":
        return withoutQuery({ name: "rules" }, "rules", search);
      case "portfolio":
        // Every board at once: the handler holds the boards to the reader's.
        return withoutQuery({ name: "portfolio" }, "portfolio", search);
      case "usage":
        // Team level until the handler knows who is asking: the least a request can be answered at.
        return withoutQuery({ name: "usage", level: "team" }, "usage", search);
      case "access-log": {
        // The filters, checked and rebuilt; people level only, which the handler decides.
        const parsed = parseAccessLogQuery(search);
        if (!parsed.ok) return refuse(400, "bad_request", "The access log filters are not valid.", parsed.problems);
        return accept(
          { name: "access_log", query: parsed.value, level: "team" },
          withQuery("access-log", accessLogSearchParams(parsed.value)),
        );
      }
      case "findings": {
        const parsed = parseFindingsQuery(search);
        if (!parsed.ok) return refuse(400, "bad_request", "The findings filters are not valid.", parsed.problems);
        return accept({ name: "findings", query: parsed.value }, withQuery("findings", findingsSearchParams(parsed.value)));
      }
      case "trends": {
        const parsed = parseTrendQuery(search);
        if (!parsed.ok) return refuse(400, "bad_request", "The trend parameters are not valid.", parsed.problems);
        return accept({ name: "trend", query: parsed.value }, withQuery("trends", trendSearchParams(parsed.value)));
      }
      default:
        return notFound(segments);
    }
  }

  if (third === undefined) {
    if (first === "insights" && second === "latest") return withoutQuery({ name: "insights" }, "insights/latest", search);
    if (first === "baseline" && second === "latest") return withoutQuery({ name: "baseline" }, "baseline/latest", search);
    // Board-scoped: the board comes from the top bar's pick. Team level until the handler knows who is asking.
    if (first === "rules" && second === "settings") return withoutQuery({ name: "rule_settings", level: "team" }, "rules/settings", search);
    // Board-scoped like the people themselves: the board comes from the top bar's pick, never from the query.
    if (first === "people" && second === "directory") return withoutQuery({ name: "people_directory" }, "people/directory", search);
    if (first === "people" && second === "scorecard") {
      // The period and the people, checked and rebuilt; the board comes from the top bar's pick, never from the query.
      const parsed = parseScorecardQuery(search);
      if (!parsed.ok) return refuse(400, "bad_request", "The scorecard parameters are not valid.", parsed.problems);
      return accept(
        // Team level until the handler knows who is asking: the least a request can be answered at.
        { name: "people_scorecard", query: parsed.value, level: "team" },
        withQuery("people/scorecard", scorecardSearchParams(parsed.value)),
      );
    }
    if (first === "findings") {
      const findingId = second.toLowerCase();
      if (!FINDING_ID_PATTERN.test(findingId)) {
        return refuse(404, "not_found", "A finding id is 32 hexadecimal characters; there is no finding with this one.");
      }
      return withoutQuery({ name: "finding", findingId }, `findings/${findingId}`, search);
    }
    return notFound(segments);
  }

  if (first === "issues" && third === "timeline") {
    // Jira keys are upper case; "demo-12" means DEMO-12, as the backend reads it.
    const issueKey = second.toUpperCase();
    if (!ISSUE_KEY_PATTERN.test(issueKey)) {
      return refuse(404, "not_found", "That is not an issue key, so there is no issue to show.");
    }
    return withoutQuery({ name: "issue_timeline", issueKey }, `issues/${issueKey}/timeline`, search);
  }
  if (first === "people" && third === "card") {
    // Exactly as the contract writes an id: anything else is no one, as the picture route answers it.
    if (!PERSON_ID_PATTERN.test(second)) {
      return refuse(404, "not_found", "A person id is p and 12 hexadecimal characters; there is no one with this one.");
    }
    // The period, and the board when the page names one, checked and rebuilt; the board goes on as the board read.
    const parsed = parsePersonCardQuery(search);
    if (!parsed.ok) return refuse(400, "bad_request", "The person card's parameters are not valid.", parsed.problems);
    const upstream = new URLSearchParams();
    if (parsed.value.days !== SCORECARD_DEFAULT_DAYS) upstream.set("days", String(parsed.value.days));
    return accept(
      // Team level until the handler knows who is asking: the least a request can be answered at.
      { name: "person_card", personId: second, query: parsed.value, level: "team" },
      withQuery(`people/${second}/card`, upstream),
    );
  }
  if (first === "people" && third === "avatar") {
    // Exactly as the contract writes an id, as the person filter takes it: no other case, no account id.
    if (!PERSON_ID_PATTERN.test(second)) {
      return refuse(404, "not_found", "A person id is p and 12 hexadecimal characters; there is no picture for this one.");
    }
    // Board-scoped like the people themselves: the top bar's pick, or the board the page names, held to the reader's.
    return pictureRoute(second, `people/${second}/avatar`, search);
  }
  return notFound(segments);
}

/** The rule settings POSTs: a save and a preview, and an AI draft of a rule. */
export type RuleSettingsPost = "rule_settings_save" | "rule_settings_preview" | "rule_settings_draft";

export function ruleSettingsPost(segments: readonly string[]): RuleSettingsPost | null {
  if (segments[0] !== "rules" || segments[1] !== "settings") return null;
  if (segments.length === 2) return "rule_settings_save";
  if (segments.length !== 3) return null;
  return segments[2] === "preview" ? "rule_settings_preview" : segments[2] === "draft" ? "rule_settings_draft" : null;
}

export const RULE_SETTINGS_REFUSED = "These rule settings cannot be saved as they are. Each problem is said beside its setting.";

/** Where a problem with a rule settings body sits, in the form the page reads */
export function settingsProblemPath(body: unknown, path: readonly PropertyKey[]): string {
  const [first, index, ...rest] = path.map(String);
  if (first === "changes" && index !== undefined && /^\d+$/.test(index)) {
    const changes = (body as { changes?: unknown } | null)?.changes;
    const change = Array.isArray(changes) ? (changes[Number(index)] as { rule_id?: unknown; op?: unknown } | null | undefined) : undefined;
    const ruleId = change?.rule_id;
    if (typeof ruleId === "string" && RULE_ID_PATTERN.test(ruleId)) return [ruleId, ...rest].join(".");
    if (change?.op === "create" && Array.isArray(changes)) {
      const ordinal = changes.slice(0, Number(index)).filter((other) => (other as { op?: unknown } | null)?.op === "create").length;
      return [`new-${ordinal}`, ...(rest[0] === "rule" ? rest.slice(1) : rest)].join(".");
    }
  }
  return path.map(String).join(".") || "(settings)";
}

function canonicalChange(change: RuleSettingsChange): RuleSettingsChange {
  if ("op" in change) return change;
  if (change.reset === true) return { rule_id: change.rule_id, reset: true };
  return {
    rule_id: change.rule_id,
    ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
    ...(change.severity !== undefined ? { severity: change.severity } : {}),
    ...(change.params !== undefined ? { params: { ...change.params } } : {}),
  };
}

function resolveRuleSettings(name: RuleSettingsPost, search: URLSearchParams, body: unknown): Resolution {
  const upstream = name === "rule_settings_save" ? "rules/settings" : name === "rule_settings_preview" ? "rules/settings/preview" : "rules/settings/draft";
  if ([...search.keys()].length > 0) return refuse(400, "bad_request", `/api/oversight/${upstream} takes no query parameters.`);
  if (name === "rule_settings_draft") {
    // What the admin wrote, as plain text: the service is sent the text this route checked, never the browser's body.
    const parsed = ruleDraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      // Words that name someone are refused in the page's own words: the AI is never sent them.
      if (parsed.error.issues.some((issue) => issue.message === RULE_DRAFT_PERSONAL)) {
        return refuse(400, "bad_request", RULE_DRAFT_PERSONAL, [{ path: "text", message: "holds an email address or an account id" }]);
      }
      return refuse(400, "bad_request", DRAFT_BODY_FORM, [{ path: "text", message: `is ${RULE_DRAFT_TEXT_MIN} to ${RULE_DRAFT_TEXT_MAX} characters of text` }]);
    }
    return accept({ name, body: { text: parsed.data.text }, level: "team" }, upstream);
  }
  const problems = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
    issues.slice(0, 24).map((issue) => ({ path: settingsProblemPath(body, issue.path), message: issue.message }));
  if (name === "rule_settings_preview") {
    const parsed = ruleSettingsPreviewRequestSchema.safeParse(body);
    if (!parsed.success) return refuse(422, "rule_settings_invalid", RULE_SETTINGS_REFUSED, problems(parsed.error.issues));
    return accept({ name, body: { changes: parsed.data.changes.map(canonicalChange) }, level: "team" }, upstream);
  }
  const parsed = ruleSettingsSaveRequestSchema.safeParse(body);
  if (!parsed.success) return refuse(422, "rule_settings_invalid", RULE_SETTINGS_REFUSED, problems(parsed.error.issues));
  const { revision, changes, reason, undo_of: undoOf } = parsed.data;
  const said = reason?.trim();
  return accept(
    {
      name,
      body: { revision, changes: changes.map(canonicalChange), ...(said ? { reason: said } : {}), ...(undoOf ? { undo_of: undoOf } : {}) },
      level: "team",
    },
    upstream,
  );
}

/** POST is allowed for five endpoints, and none writes to Jira: asking a */
export function resolvePost(segments: readonly string[], search: URLSearchParams, body: unknown): Resolution {
  if (segments.length === 1 && segments[0] === "refresh") return withoutQuery({ name: "refresh_start" }, "refresh", search);
  const settings = ruleSettingsPost(segments);
  if (settings) return resolveRuleSettings(settings, search, body);
  if (segments.length !== 1 || segments[0] !== "ask") return notFound(segments);
  if ([...search.keys()].length > 0) {
    return refuse(400, "bad_request", "/api/oversight/ask takes no query parameters.");
  }
  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    return refuse(
      400,
      "bad_request",
      ASK_BODY_FORM,
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join(".") || "(body)",
        message: issue.message,
      })),
    );
  }
  // Team level until the handler knows who is asking: the least a question can be answered at.
  return accept({ name: "ask", question: parsed.data.question, mentions: parsed.data.mentions ?? [], level: "team" }, "ask");
}

export const ASK_BODY_FORM = 'Send a JSON body of the form {"question": "..."}, with "mentions" only as a list of person ids.';
export const DRAFT_BODY_FORM = `Describe the rule in ${RULE_DRAFT_TEXT_MIN} to ${RULE_DRAFT_TEXT_MAX} characters, as a JSON body of the form {"text": "..."}.`;
