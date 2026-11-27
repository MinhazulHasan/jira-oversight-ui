import type { z } from "zod";

import { LEAVE_GUARD_MS, sendToSignIn } from "@/lib/sign-in";

import {
  ignoredPageSchema,
  ignorePreviewSchema,
  ignoreResultSchema,
  restoreResultSchema,
  type IgnoredPage,
  type IgnorePreview,
  type IgnorePreviewRequest,
  type IgnoreRequest,
  type IgnoreResult,
  type RestoreResult,
} from "./ignores";
import {
  accessLogSearchParams,
  creditSearchParams,
  findingsSearchParams,
  ignoredSearchParams,
  personCardSearchParams,
  proofSearchParams,
  scorecardSearchParams,
  trendSearchParams,
  type AccessLogQueryInput,
  type CreditQueryInput,
  type FindingsQueryInput,
  type IgnoredQueryInput,
  type PersonCardQueryInput,
  type ProofQueryInput,
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
  peopleCreditSchema,
  peopleDirectorySchema,
  peopleProofSchema,
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
  type PeopleCredit,
  type PeopleCreditSaveRequest,
  type PeopleDirectory,
  type PeopleProof,
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

export const API_BASE = "/api/oversight";

export interface ApiErrorIssue {
  path: string;
  message: string;
}

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

function postRequest(body: unknown, options: RequestOptions): RequestInit {
  return {
    ...options,
    method: "POST",
    referrerPolicy: "same-origin",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

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

export function getPeopleScorecard(query: ScorecardQueryInput = {}, options: RequestOptions = {}): Promise<PeopleScorecard> {
  return request(withQuery("people/scorecard", scorecardSearchParams(query)), peopleScorecardSchema, options);
}

/** The tickets behind one figure on the People page (people level only): a person's, or the whole board's. */
export function getPeopleProof(query: ProofQueryInput, options: RequestOptions = {}): Promise<PeopleProof> {
  return request(withQuery("people/scorecard/tickets", proofSearchParams(query)), peopleProofSchema, options);
}

/** Whom the board's tickets count for, and each choice's coverage over the period (people level only). */
export function getPeopleCredit(query: CreditQueryInput = {}, options: RequestOptions = {}): Promise<PeopleCredit> {
  return request(withQuery("people/credit", creditSearchParams(query)), peopleCreditSchema, options);
}

/** Changes whom the board's tickets count for, from the revision the page read. */
export function putPeopleCredit(body: PeopleCreditSaveRequest, options: RequestOptions = {}): Promise<PeopleCredit> {
  return request("people/credit", peopleCreditSchema, { ...postRequest(body, options), method: "PUT" });
}

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

/** What an ignore would do now (people level only): the open findings it would resolve, by rule; nothing is written. */
export function postIgnorePreview(body: IgnorePreviewRequest, options: RequestOptions = {}): Promise<IgnorePreview> {
  return request("findings/ignore/preview", ignorePreviewSchema, postRequest(body, options));
}

export function postIgnore(body: IgnoreRequest, options: RequestOptions = {}): Promise<IgnoreResult> {
  return request("findings/ignore", ignoreResultSchema, postRequest(body, options));
}

/** Removes ignores; the board's findings are re-checked, so those the rules still hold reopen. */
export function postRestore(ignoreIds: readonly string[], options: RequestOptions = {}): Promise<RestoreResult> {
  return request("findings/restore", restoreResultSchema, postRequest({ ignore_ids: ignoreIds }, options));
}

/** The board's standing ignores, a page at a time (people level only). */
export function getIgnored(query: IgnoredQueryInput = {}, options: RequestOptions = {}): Promise<IgnoredPage> {
  return request(withQuery("findings/ignored", ignoredSearchParams(query)), ignoredPageSchema, options);
}

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

export function getRuleSettings(options: RequestOptions = {}): Promise<RuleSettings> {
  return request("rules/settings", ruleSettingsSchema, options);
}

/** What changes to the board's rule settings would do to its open findings, worked out without saving anything. */
export function postRuleSettingsPreview(body: RuleSettingsPreviewRequest, options: RequestOptions = {}): Promise<RuleSettingsPreview> {
  return request("rules/settings/preview", ruleSettingsPreviewSchema, postRequest(body, options));
}

export function postRuleSettings(body: RuleSettingsSaveRequest, options: RequestOptions = {}): Promise<RuleSettings> {
  return request("rules/settings", ruleSettingsSchema, postRequest(body, options));
}

export function postRuleDraft(text: string, options: RequestOptions = {}): Promise<RuleDraft> {
  return request("rules/settings/draft", ruleDraftSchema, postRequest({ text }, options));
}
