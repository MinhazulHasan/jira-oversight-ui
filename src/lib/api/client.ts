import type { z } from "zod";

import { LEAVE_GUARD_MS, sendToSignIn } from "@/lib/sign-in";

import {
  accessLogSearchParams,
  findingsSearchParams,
  personCardSearchParams,
  scorecardSearchParams,
  trendSearchParams,
  type AccessLogQueryInput,
  type FindingsQueryInput,
  type PersonCardQueryInput,
  type ScorecardQueryInput,
  type TrendQueryInput,
} from "./params";
import {
  accessLogSchema,
  apiErrorBodySchema,
  askResponseSchema,
  baselineSchema,
  findingDetailSchema,
  findingsPageSchema,
  healthSchema,
  insightsSchema,
  issueTimelineSchema,
  overviewSchema,
  peopleDirectorySchema,
  peopleSchema,
  peopleScorecardSchema,
  personCardSchema,
  portfolioSchema,
  projectsSchema,
  refreshSchema,
  ruleDraftSchema,
  ruleSettingsPreviewSchema,
  ruleSettingsSchema,
  rulesSchema,
  trendSchema,
  usageSchema,
  type AccessLog,
  type AskResponse,
  type Baseline,
  type FindingDetail,
  type FindingsPage,
  type Health,
  type Insights,
  type IssueTimeline,
  type Overview,
  type People,
  type PeopleDirectory,
  type PeopleScorecard,
  type PersonCard,
  type Portfolio,
  type Projects,
  type Refresh,
  type RuleDraft,
  type RuleSettings,
  type RuleSettingsPreview,
  type RuleSettingsPreviewRequest,
  type RuleSettingsSaveRequest,
  type Rules,
  type Trend,
  type Usage,
} from "./schemas";

/**
 * Typed fetchers for /api/oversight, the interface's own server route. The
 * browser never talks to the oversight service directly, and never trusts a
 * body it has not parsed: every response goes through its schema, so a page
 * either gets data in the contract's shape or an ApiError it can explain.
 */

export const API_BASE = "/api/oversight";

export interface ApiErrorIssue {
  path: string;
  message: string;
}

/**
 * A request that did not produce data. `status` is the HTTP status, or 0 when
 * no answer arrived at all; the QueryClient reads it to skip retrying a 4xx.
 * `code` is the route's stable error code, or one of network_error,
 * invalid_response and http_error raised here.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: readonly ApiErrorIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Worth another try: nothing answered, or the server or the service behind it failed. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  get notFound(): boolean {
    return this.status === 404;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/**
 * The browser is on its way to the sign-in page: hold the call instead of
 * failing it, so the page keeps what it shows, rather than an error that
 * blames the data source, until the browser has left. Should it still be
 * here once the guard has passed (a navigation cancelled, say), the call
 * fails as any other would. A cancelled query still ends at once.
 */
function holdWhileLeaving(error: ApiError, signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => reject(error), LEAVE_GUARD_MS);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function request<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path}`, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    // A cancelled query is not a failure; TanStack Query expects the abort to propagate.
    if (isAbort(error)) throw error;
    throw new ApiError(0, "network_error", "The dashboard's server could not be reached. Check the connection and try again.");
  }

  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    if (isAbort(error)) throw error;
    body = null;
  }

  if (!response.ok) {
    const failure = apiErrorBodySchema.safeParse(body);
    if (failure.success) {
      const error = new ApiError(response.status, failure.data.error, failure.data.message, failure.data.issues ?? []);
      // The session has ended (or never began): sign in again, then come back to this page.
      if (response.status === 401 && failure.data.error === "unauthenticated" && sendToSignIn()) {
        return holdWhileLeaving(error, init.signal);
      }
      throw error;
    }
    // The status stays on the error for a detail line; the words a reader may see never quote it (SQA).
    throw new ApiError(response.status, "http_error", "The dashboard's server could not answer. Try again.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "invalid_response",
      "The dashboard's server answered with data this page does not understand.",
      parsed.error.issues.slice(0, 12).map((issue) => ({ path: issue.path.map(String).join(".") || "(body)", message: issue.message })),
    );
  }
  return parsed.data;
}

function withQuery(path: string, search: URLSearchParams): string {
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/* ------------------------------------------------------------- endpoints -- */

export function getHealth(options: RequestOptions = {}): Promise<Health> {
  return request("health", healthSchema, options);
}

export function getProjects(options: RequestOptions = {}): Promise<Projects> {
  return request("projects", projectsSchema, options);
}

/**
 * A POST as the route takes it (a question, "Sync now", a change to rule
 * settings): from this page, so it carries this dashboard's own Origin, which
 * the route requires of every POST (a referrer policy of its own, as signing
 * out has, so Safari sends the real one under the site's no-referrer policy);
 * a body, where there is one, as JSON.
 */
function postRequest(body: unknown, options: RequestOptions): RequestInit {
  return {
    ...options,
    method: "POST",
    referrerPolicy: "same-origin",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

/**
 * Sync (JO-18): starts the sync of the board picked in the top bar (the server adds it), queued behind another
 * board's while one runs, unless that board's is under way or just finished; its state either way.
 */
export function postRefresh(options: RequestOptions = {}): Promise<Refresh> {
  return request("refresh", refreshSchema, postRequest(undefined, options));
}

/** The sync of the board picked in the top bar: queued, running, or how it last ended. */
export function getRefresh(options: RequestOptions = {}): Promise<Refresh> {
  return request("refresh", refreshSchema, options);
}

export function getOverview(options: RequestOptions = {}): Promise<Overview> {
  return request("overview", overviewSchema, options);
}

/** Everyone assigned a ticket on the board, with their open findings, and the unassigned tickets. */
export function getPeople(options: RequestOptions = {}): Promise<People> {
  return request("people", peopleSchema, options);
}

/** Everyone on the board, as Jira's assignee picker lists them: the assignees and the members with no tickets. */
export function getPeopleDirectory(options: RequestOptions = {}): Promise<PeopleDirectory> {
  return request("people/directory", peopleDirectorySchema, options);
}

/**
 * How tickets are handled, person by person, next to the whole board, over the
 * last 30, 90 or 180 days (people level only). No person: everyone who holds a
 * ticket on the board, or, where comparison is turned off, the board's figures
 * alone; with people (ten at most), those people.
 */
export function getPeopleScorecard(query: ScorecardQueryInput = {}, options: RequestOptions = {}): Promise<PeopleScorecard> {
  return request(withQuery("people/scorecard", scorecardSearchParams(query)), peopleScorecardSchema, options);
}

/**
 * One person's card (people level only): their work, findings and process
 * next to the board's over the period (90 days unless said), on the board
 * picked in the top bar, or on `board` where the page names one (an access
 * log entry's). Every read is recorded in the service's access log, at most
 * once in ten minutes for one person, board and reader.
 */
export function getPersonCard(personId: string, query: PersonCardQueryInput = {}, options: RequestOptions = {}): Promise<PersonCard> {
  return request(withQuery(`people/${encodeURIComponent(personId)}/card`, personCardSearchParams(query)), personCardSchema, options);
}

export function getFindings(query: FindingsQueryInput = {}, options: RequestOptions = {}): Promise<FindingsPage> {
  return request(withQuery("findings", findingsSearchParams(query)), findingsPageSchema, options);
}

export function getFinding(findingId: string, options: RequestOptions = {}): Promise<FindingDetail> {
  return request(`findings/${encodeURIComponent(findingId)}`, findingDetailSchema, options);
}

export function getIssueTimeline(issueKey: string, options: RequestOptions = {}): Promise<IssueTimeline> {
  return request(`issues/${encodeURIComponent(issueKey)}/timeline`, issueTimelineSchema, options);
}

/**
 * Ask a question. `mentions` are the people picked from the @ list, by id;
 * sent only when there are any. Whether Ask may answer about people is this
 * dashboard's server's decision, never the page's: it is not sent.
 */
export function postAsk(question: string, mentions: readonly string[] = [], options: RequestOptions = {}): Promise<AskResponse> {
  return request("ask", askResponseSchema, postRequest(mentions.length > 0 ? { question, mentions } : { question }, options));
}

export function getInsights(options: RequestOptions = {}): Promise<Insights> {
  return request("insights/latest", insightsSchema, options);
}

export function getTrend(query: TrendQueryInput, options: RequestOptions = {}): Promise<Trend> {
  return request(withQuery("trends", trendSearchParams(query)), trendSchema, options);
}

export function getRules(options: RequestOptions = {}): Promise<Rules> {
  return request("rules", rulesSchema, options);
}

export function getBaseline(options: RequestOptions = {}): Promise<Baseline> {
  return request("baseline/latest", baselineSchema, options);
}

/** Every board the reader may open, with the Overview's figures for each, and the oldest open breaches across them. */
export function getPortfolio(options: RequestOptions = {}): Promise<Portfolio> {
  return request("portfolio", portfolioSchema, options);
}

/** One page of the access log (people level only): who read whose figures, newest first, and where the next starts. */
export function getAccessLog(query: AccessLogQueryInput = {}, options: RequestOptions = {}): Promise<AccessLog> {
  return request(withQuery("access-log", accessLogSearchParams(query)), accessLogSchema, options);
}

/** Ask's questions, model calls and tokens today and over the last 7 days, against the daily budget (people level only). */
export function getUsage(options: RequestOptions = {}): Promise<Usage> {
  return request("usage", usageSchema, options);
}

/**
 * A board's rule settings (JO-15, people level only), on the board picked in
 * the top bar: every catalogue rule as the board runs it, whether its findings
 * reflect them yet, and the newest changes.
 */
export function getRuleSettings(options: RequestOptions = {}): Promise<RuleSettings> {
  return request("rules/settings", ruleSettingsSchema, options);
}

/** What changes to the board's rule settings would do to its open findings, worked out without saving anything. */
export function postRuleSettingsPreview(body: RuleSettingsPreviewRequest, options: RequestOptions = {}): Promise<RuleSettingsPreview> {
  return request("rules/settings/preview", ruleSettingsPreviewSchema, postRequest(body, options));
}

/**
 * Saves changes to the board's rule settings, made against `revision` (409
 * rule_settings_conflict when the board has moved on since), and starts the
 * re-check of its findings; answers the settings as they now stand.
 */
export function postRuleSettings(body: RuleSettingsSaveRequest, options: RequestOptions = {}): Promise<RuleSettings> {
  return request("rules/settings", ruleSettingsSchema, postRequest(body, options));
}

/**
 * The AI's draft of a rule from an admin's words (JO-20), built from the board's
 * checks and names: a rule to check in the form, or why it could not be made.
 * Nothing is saved.
 */
export function postRuleDraft(text: string, options: RequestOptions = {}): Promise<RuleDraft> {
  return request("rules/settings/draft", ruleDraftSchema, postRequest({ text }, options));
}
