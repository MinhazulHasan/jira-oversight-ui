import "server-only";

import {
  askRateLimitMessage,
  RULE_ID_PATTERN,
  RULE_SETTINGS_CONFLICT,
  SCORECARD_SENTENCES,
  type AccessLog,
  type PeopleCredit,
  type PeopleProof,
  type PeopleScorecard,
  type PersonCard,
  type Refresh,
  type RuleDraft,
  type RuleSettings,
  type RuleSettingsPreview,
} from "@/lib/api/schemas";

import { readerHeaders, type ReaderContext } from "./auth/viewer";
import { noteComparison } from "./comparison";
import { RESPONSE_SCHEMAS, settingsProblemPath, type Resolved } from "./endpoints";
import type { LiveConfig } from "./env";
import { json, problem } from "./http";
import { isPicture, MAX_PICTURE_BYTES, NO_PICTURE, picture, PICTURE_TYPES, pictureType } from "./pictures";

/** Live mode: one validated request to the oversight dashboard API, with the */

export const READ_TIMEOUT_MS = 15_000;
/** Ask waits on the analyst: several rounds of model calls and queries (6 at */
export const ASK_TIMEOUT_MS = 120_000;
/** Far above any real body (a 100-row findings page is about 150 KB); a guard, not a limit anyone meets. */
const MAX_BODY_CHARS = 8 * 1024 * 1024;
/** An access log export: up to 10,000 entries, each with the people it read (a comparison names several). */
const MAX_EXPORT_CHARS = 48 * 1024 * 1024;
/** What a reader is told when the service could not record a read of person-level figures, so served none. */
export const ACCESS_LOG_UNAVAILABLE =
  "The access log could not record this read, so the figures were not shown. Nothing was lost; try again in a moment.";
const MAX_ISSUES_SHOWN = 12;

function isTimeout(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") return false;
    const name = "name" in current ? current.name : undefined;
    if (name === "TimeoutError" || name === "AbortError") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function unreachable(error: unknown): Response {
  return isTimeout(error)
    ? problem(503, "upstream_timeout", "The oversight service did not answer in time. Try again in a moment.")
    : problem(503, "upstream_unavailable", "The oversight service cannot be reached right now. Try again in a moment.");
}

/** A failed status from the service, in this interface's words. The service's own text is never passed on. */
function upstreamFailure(status: number, resolved: Resolved): Response {
  const { route } = resolved;
  if (status === 404 && route.name === "finding") {
    return problem(404, "not_found", "No finding with that id is in the synced data.");
  }
  if (status === 404 && route.name === "issue_timeline") {
    return problem(404, "not_found", `${route.issueKey} is not in the synced data.`);
  }
  // Nothing written yet is a state to show calmly, not a fault.
  if (status === 404 && route.name === "insights") {
    return problem(404, "not_found", "No weekly briefing has been written yet.");
  }
  if (status === 404 && route.name === "baseline") {
    return problem(404, "not_found", "No baseline report has been generated yet.");
  }
  // No picture, or nobody by that id on the board: the browser shows the person's initials.
  if (status === 404 && route.name === "person_avatar") return problem(404, "not_found", NO_PICTURE);
  // Someone asked for is not on the board. (Asked for no one, a 404 can only be the board, as below.)
  if (status === 404 && route.name === "people_scorecard" && route.query.person.length > 0) {
    return problem(404, "not_found", SCORECARD_PERSON_NOT_FOUND);
  }
  if (status === 404 && route.name === "person_card") return problem(404, "not_found", PERSON_CARD_NOT_FOUND);
  // The tickets behind a figure: someone not on the board, or (asked for the board) a service from before the route.
  if (status === 404 && route.name === "scorecard_tickets") {
    return route.query.person !== null ? problem(404, "not_found", PROOF_PERSON_NOT_FOUND) : problem(502, "upstream_error", PROOF_MISSING);
  }
  // Rule settings on a service from before them: a route it does not have, never the board.
  if (status === 404 && (route.name === "rule_settings" || route.name === "rule_settings_preview" || route.name === "rule_settings_save")) {
    return problem(502, "upstream_error", RULE_SETTINGS_MISSING);
  }
  // An AI draft of a rule on a service from before it: the same, said of the draft.
  if (status === 404 && route.name === "rule_settings_draft") return problem(502, "upstream_error", RULE_DRAFT_MISSING);
  // The credit setting on a service from before it: the same, said of the setting.
  if (status === 404 && (route.name === "people_credit" || route.name === "people_credit_save")) return problem(502, "upstream_error", CREDIT_MISSING);
  // Ignoring findings on a service from before it: the same, said of ignoring.
  if (status === 404 && IGNORE_ROUTES.has(route.name)) return problem(502, "upstream_error", IGNORE_MISSING);
  // Every other 404 here is a board the service no longer serves: the top bar resets the pick.
  if (status === 404) return unknownBoard(resolved);
  if (status === 401 || status === 403) {
    return problem(502, "upstream_refused", "The oversight service refused this interface's credentials.");
  }
  if (status === 429 || status === 503) {
    return problem(503, "upstream_unavailable", "The oversight service is busy or starting up. Try again in a moment.");
  }
  if (status === 504) return problem(503, "upstream_timeout", "The oversight service did not answer in time.");
  return problem(502, "upstream_error", `The oversight service could not answer this request (HTTP ${status}).`);
}

export const BOARDLESS_ROUTES: ReadonlySet<Resolved["route"]["name"]> = new Set(["projects", "portfolio", "access_log", "usage"]);

/** A served board that has never synced: every page offers its first sync instead of figures. */
export const BOARD_NOT_SYNCED = "This board hasn't been synced yet.";

/** The longest wait a Retry-After is taken at: a day. Longer is a service's mistake, read as a day. */
const MAX_RETRY_AFTER_S = 24 * 60 * 60;

/** The wait a 429 asks for, in seconds: its Retry-After (seconds, or an HTTP */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  const text = header?.trim() ?? "";
  if (/^\d{1,9}$/.test(text)) return Math.min(Number(text), MAX_RETRY_AFTER_S);
  const at = Date.parse(text);
  if (text && !Number.isNaN(at)) return Math.min(Math.max(0, Math.ceil((at - now) / 1000)), MAX_RETRY_AFTER_S);
  return 60;
}

export const SCORECARD_PERSON_NOT_FOUND = "Someone asked for is not on this board.";
/** A service from before rule settings answers their routes 404 without a code: said as what it is. */
export const RULE_SETTINGS_MISSING = "The oversight service does not offer rule settings yet: it may be an earlier version than this dashboard.";
/** A service from before has no AI draft of a rule: said as what it is. */
export const RULE_DRAFT_MISSING = "The oversight service does not draft rules yet: it may be an earlier version than this dashboard.";
export const PERSON_CARD_NOT_FOUND = "This person is not on this board.";
/** The routes of ignoring findings: the ignored list, an ignore's preview, the ignore, and a restore. */
const IGNORE_ROUTES: ReadonlySet<Resolved["route"]["name"]> = new Set(["ignored", "ignore_preview", "ignore", "restore"]);
/** A service from before ignoring answers its routes 404 without a code: said as what it is. */
export const IGNORE_MISSING = "The oversight service does not ignore findings yet: it may be an earlier version than this dashboard.";
/** The service's 422 on an ignore or a restore, when it gives no words that can be shown. */
export const IGNORE_REFUSED = "The oversight service refused this request, so nothing was changed.";
export const PROOF_PERSON_NOT_FOUND = "This person is not on this board.";
/** A service from before the tickets behind figures answers their route 404 without a code: said as what it is. */
export const PROOF_MISSING = "The oversight service does not list the tickets behind figures yet: it may be an earlier version than this dashboard.";
export const PROOF_NOT_MEASURABLE = "This board can't show that figure, so there are no tickets behind it.";
/** A service from before the credit setting answers its route 404 without a code: said as what it is. */
export const CREDIT_MISSING = "The oversight service does not offer the credit setting yet: it may be an earlier version than this dashboard.";
/** The service's 409 stale_revision on a change of the credit setting, in this interface's words. */
export const CREDIT_STALE = "Someone changed how finished work is counted on this board since you opened it. Look again, then choose.";
/** The service's 422 on a change of the credit setting, when it gives no words that can be shown. */
export const CREDIT_REFUSED = "The oversight service refused this choice for the board.";
/** A card read on a board the service does not serve (an access log entry's board, since taken off its list). */
export const PERSON_CARD_UNKNOWN_BOARD = "The board this card is read on is not one the oversight service serves.";

/** A board the service does not serve: the top bar's pick (it resets it), or the board a person card names. */
export function unknownBoard({ route }: Resolved): Response {
  return route.name === "person_card"
    ? problem(404, "unknown_board", PERSON_CARD_UNKNOWN_BOARD)
    : problem(404, "unknown_board", "The board picked in the top bar is not one the oversight service serves.");
}
/** A refusal's body is a line or two of JSON; nothing longer is read. */
const MAX_REFUSAL_CHARS = 4 * 1024;

/** Whether the service refused a scorecard because comparing people is turned */
export async function refusedForComparison(response: Response): Promise<boolean> {
  return (await refusalCodes(response)).includes("comparison_off");
}

/** The codes a refusal's body names, wherever FastAPI's body puts them; nothing else of the body is read. */
async function refusalCodes(response: Response): Promise<string[]> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_REFUSAL_CHARS) return [];
  let text: string;
  try {
    text = await response.text();
  } catch {
    return [];
  }
  if (text.length > MAX_REFUSAL_CHARS) return [];
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return [];
  }
  const codes = (value: unknown, depth = 0): string[] => {
    if (typeof value === "string") return [value];
    if (depth > 2 || typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    return ["code", "error", "detail"].flatMap((key) => codes(record[key], depth + 1));
  };
  return codes(body);
}

/** Ask's 429 for a reader over the service's limit on questions */
async function rateLimited(response: Response): Promise<Response | null> {
  const wait = retryAfterSeconds(response.headers.get("retry-after"));
  if (!(await refusalCodes(response)).includes("ask_rate_limited")) return null;
  const refusal = problem(429, "ask_rate_limited", askRateLimitMessage(wait));
  refusal.headers.set("retry-after", String(wait));
  return refusal;
}

/* --------------------------------------------------------- rule settings -- */

/** A preview works the rules over the board's data, and a save writes and starts a re-check: more than a read's time. */
export const SETTINGS_TIMEOUT_MS = 30_000;
export const DRAFT_TIMEOUT_MS = 60_000;
/** A refusal of rule settings names each problem: more than a line or two, never more than this. */
const MAX_SETTINGS_REFUSAL_CHARS = 32 * 1024;
const MAX_SETTINGS_PROBLEMS = 24;
const MAX_PROBLEM_CHARS = 300;
/** A problem's place, in this interface's form: "R-EFF-01.params.threshold", "new-0.title", "reason"; "(settings)" for the whole. */
const PROBLEM_PATH = /^(?:[A-Za-z0-9_.-]{1,80}|\(settings\))$/;
/** A field of one rule's change, as the service names it beside the rule. */
const SETTING_FIELD =
  /^(?:rule_id|enabled|severity|reset|op|rule|title|description|check|applies_to(?:\.(?:status_category|issue_type))?|params(?:\.[a-z][a-z0-9_]{0,39})?)$/;
/** A field of the request itself, which the service names with no rule. */
const REQUEST_FIELD = /^(?:changes|revision|reason|undo_of)$/;
/** A place within one of the request's changes, as a path: "changes.2.rule.title" (a new rule's, ). */
const CHANGE_PLACE = /^changes\.\d+(?:\.[A-Za-z0-9_]+)*$/;
/** A field of a new rule's definition, which the service names with no rule: the rule has no id yet. */
const NEW_RULE_FIELD = /^(?:title|description|check|severity|applies_to(?:\.(?:status_category|issue_type))?|params(?:\.[a-z][a-z0-9_]{0,39})?)$/;

/** The change a problem's `index` names, by its place in the request (as FastAPI's own `loc` counts it); null for none. */
function changeIndex(request: unknown, index: unknown): number | null {
  const changes = (request as { changes?: unknown } | null)?.changes;
  return Array.isArray(changes) && typeof index === "number" && Number.isInteger(index) && index >= 0 && index < changes.length ? index : null;
}

function newRulePlace(request: unknown, field: string, index: unknown): string | null {
  const at = changeIndex(request, index);
  if (at !== null) return settingsProblemPath(request, ["changes", at, ...field.split(".")]);
  const changes = (request as { changes?: unknown } | null)?.changes;
  const added = Array.isArray(changes) ? changes.filter((change) => (change as { op?: unknown } | null)?.op === "create").length : 0;
  return added === 1 ? `new-0.${field}` : null;
}
/** Where a problem the service places nowhere is said: in the review, as a problem with the settings as a whole. */
const WHOLE = "(settings)";

export const SETTINGS_REFUSED = "The oversight service refused these rule settings. Each problem is said beside its setting.";
/** A save the service could not write because a rules run held the board's lock (503 rule_settings_busy). */
export const SETTINGS_BUSY = "The rules are running on this board right now. Try again in a moment.";

/** Words from the service fit to show a reader: plain text on one line, not */
export function plainWords(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || [...text].length > MAX_PROBLEM_CHARS) return null;
  if (/[\u0000-\u001f\u007f<>]/.test(text) || /\b(?:https?|ftp):\/\//i.test(text) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return null;
  return text;
}

/** The problems a refusal names, wherever the service's body puts them (a list */
function settingsProblems(body: unknown, request: unknown): { path: string; message: string }[] {
  const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const top = record(body);
  const lists = [top, record(top?.detail)].flatMap((holder) =>
    holder ? ["errors", "problems", "issues", "fields", "detail"].map((key) => holder[key]).filter(Array.isArray) : [],
  ) as unknown[][];
  const problems: { path: string; message: string }[] = [];
  for (const item of lists.flat()) {
    const entry = record(item);
    const message = plainWords(entry?.message ?? entry?.msg ?? entry?.detail);
    if (!entry || !message) continue;
    const ruleId = typeof entry.rule_id === "string" && RULE_ID_PATTERN.test(entry.rule_id) ? entry.rule_id : null;
    const named = typeof entry.field === "string" ? entry.field : null;
    let path = WHOLE;
    if (ruleId) path = named !== null && SETTING_FIELD.test(named) ? `${ruleId}.${named}` : ruleId;
    else if (named !== null && REQUEST_FIELD.test(named)) path = named;
    else if (named !== null && NEW_RULE_FIELD.test(named)) path = newRulePlace(request, named, entry.index) ?? WHOLE;
    // A change named by its place in the request (a new rule has no id yet): its rule's, or "new-0" for the first new rule.
    else if (named !== null && CHANGE_PLACE.test(named)) path = settingsProblemPath(request, named.split("."));
    // A change as a whole, named by its index alone (a new rule over the board's limit): its rule's, or its new rule's.
    else if (named === null && changeIndex(request, entry.index) !== null) path = settingsProblemPath(request, ["changes", entry.index as number]);
    else if (typeof entry.path === "string") path = entry.path;
    else if (Array.isArray(entry.loc)) path = settingsProblemPath(request, entry.loc.filter((part, index) => !(index === 0 && part === "body")) as PropertyKey[]);
    problems.push({ path: PROBLEM_PATH.test(path) ? path : WHOLE, message });
    if (problems.length >= MAX_SETTINGS_PROBLEMS) break;
  }
  if (problems.length === 0) {
    const detail = plainWords(top?.detail) ?? plainWords(record(top?.detail)?.message);
    if (detail) problems.push({ path: WHOLE, message: detail });
  }
  return problems;
}

/** The service's refusal of rule settings in this interface's words: 409 */
async function settingsRefusal(response: Response, request: unknown): Promise<Response | null> {
  if (Number(response.headers.get("content-length")) > MAX_SETTINGS_REFUSAL_CHARS) return null;
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > MAX_SETTINGS_REFUSAL_CHARS) return null;
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const codes = (value: unknown, depth = 0): string[] => {
    if (typeof value === "string") return [value];
    if (depth > 2 || typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return ["code", "error", "detail"].flatMap((key) => codes((value as Record<string, unknown>)[key], depth + 1));
  };
  const named = codes(body);
  if (response.status === 409 && named.includes("rule_settings_conflict")) return problem(409, "rule_settings_conflict", RULE_SETTINGS_CONFLICT);
  if (response.status === 422 && named.includes("rule_settings_invalid")) {
    return problem(422, "rule_settings_invalid", SETTINGS_REFUSED, settingsProblems(body, request));
  }
  return null;
}

/** The service's own words in a refusal, when they are fit to show (plain text on one line); null otherwise. */
async function refusalWords(response: Response): Promise<string | null> {
  if (Number(response.headers.get("content-length")) > MAX_SETTINGS_REFUSAL_CHARS) return null;
  try {
    const text = await response.text();
    if (text.length === 0 || text.length > MAX_SETTINGS_REFUSAL_CHARS) return null;
    return settingsProblems(JSON.parse(text), null)[0]?.message ?? null;
  } catch {
    return null;
  }
}

/** The service refused an AI draft's words and gave no words of its own that can be shown. */
export const DRAFT_REFUSED = "The oversight service can't draft from these words. Describe the rule another way.";

async function draftRefusal(response: Response): Promise<Response> {
  let said: string | null = null;
  try {
    const text = Number(response.headers.get("content-length")) > MAX_SETTINGS_REFUSAL_CHARS ? "" : await response.text();
    if (text.length > 0 && text.length <= MAX_SETTINGS_REFUSAL_CHARS) said = settingsProblems(JSON.parse(text), null)[0]?.message ?? null;
  } catch {
    said = null;
  }
  return problem(400, "bad_request", said ?? DRAFT_REFUSED, [{ path: "text", message: "was refused by the oversight service" }]);
}

/** Whether one page of the access log is other than what was asked for: an */
function accessLogMismatch(log: AccessLog, query: Extract<Resolved["route"], { name: "access_log" }>["query"]): boolean {
  if (log.entries.length > query.limit) return true;
  return log.entries.some(
    (entry) =>
      (query.action.length > 0 && !query.action.includes(entry.action)) ||
      (query.viewer !== undefined && entry.viewer.hash !== query.viewer) ||
      (query.person !== undefined && !entry.subjects.some((subject) => subject.id === query.person)),
  );
}

function jiraLink(base: URL | null, key: string): string | null {
  return base ? new URL(`browse/${encodeURIComponent(key)}`, base).href : null;
}

const notAPicture = () =>
  problem(502, "upstream_invalid", "The oversight service sent something other than a picture where a picture was asked for.");

/** The body's bytes, or null once they pass the limit: read a chunk at a time, so an endless body is never held whole. */
async function readBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** A person's picture, which the service fetched from Jira at sync and keeps: */
async function forwardPicture(config: LiveConfig, resolved: Resolved, board: string | null): Promise<Response> {
  const url = new URL(`api/v1/${resolved.upstream}`, config.apiUrl);
  if (board) url.searchParams.set("project", board);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: new Headers({ accept: PICTURE_TYPES.join(", "), "x-service-key": config.serviceKey }),
      cache: "no-store",
      // A redirect would carry the key to wherever it points.
      redirect: "error",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return upstreamFailure(response.status, resolved);
    }
    const type = pictureType(response.headers.get("content-type"));
    if (type === null || Number(response.headers.get("content-length")) > MAX_PICTURE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return notAPicture();
    }
    const bytes = await readBytes(response, MAX_PICTURE_BYTES);
    return bytes !== null && isPicture(type, bytes) ? picture(bytes, type) : notAPicture();
  } catch (error) {
    return unreachable(error);
  }
}

/** `board` is the board picked in the top bar (a checked project key), or null */
export async function forward(
  config: LiveConfig,
  resolved: Resolved,
  board: string | null = null,
  reader: ReaderContext | null = null,
): Promise<Response> {
  const { route, upstream } = resolved;
  if (route.name === "person_avatar") return forwardPicture(config, resolved, board);
  const ask = route.name === "ask";
  // A change to rule settings: its body the one this interface checked and rebuilt (endpoints.ts).
  const settingsBody = route.name === "rule_settings_preview" || route.name === "rule_settings_save" ? route.body : null;
  // An AI draft of a rule: the admin's words as this interface checked them, as plain text.
  const draftBody = route.name === "rule_settings_draft" ? route.body : null;
  // A change of the credit setting: the choice and revision this interface checked and rebuilt.
  const creditBody = route.name === "people_credit_save" ? route.body : null;
  // An ignore, its preview or a restore: the body this interface checked and rebuilt.
  const ignoreBody = route.name === "ignore_preview" || route.name === "ignore" || route.name === "restore" ? route.body : null;
  const post = ask || route.name === "refresh_start" || settingsBody !== null || draftBody !== null || ignoreBody !== null;
  const headers = new Headers({
    accept: "application/json",
    "x-service-key": config.serviceKey,
    ...(reader ? readerHeaders(reader) : {}),
  });
  if (ask || settingsBody !== null || draftBody !== null || creditBody !== null || ignoreBody !== null) headers.set("content-type", "application/json");
  const url = new URL(`api/v1/${upstream}`, config.apiUrl);
  if (board && !BOARDLESS_ROUTES.has(route.name)) url.searchParams.set("project", board);
  // The level this interface decided for the reader (handler.ts), as Ask's body carries it: never the browser's.
  if (
    route.name === "people_scorecard" ||
    route.name === "scorecard_tickets" ||
    route.name === "person_card" ||
    route.name === "access_log" ||
    route.name === "usage" ||
    route.name === "rule_settings" ||
    route.name === "rule_settings_preview" ||
    route.name === "rule_settings_save" ||
    route.name === "rule_settings_draft" ||
    route.name === "people_credit" ||
    route.name === "people_credit_save"
  ) {
    url.searchParams.set("level", route.level);
  }
  // Every read of findings carries the reader's level: who ignored one is named at the people level alone, and findings
  // filtered by a person are recorded in the access log with the level they were read at.
  if (route.name === "findings" || route.name === "finding" || route.name === "issue_timeline") {
    url.searchParams.set("level", reader?.level ?? "team");
  }
  if (IGNORE_ROUTES.has(route.name) && "level" in route) url.searchParams.set("level", route.level);
  // The Portfolio across a reader's own boards (handler.ts): none for an admin, who reads every board.
  if (route.name === "portfolio") for (const key of route.boards ?? []) url.searchParams.append("board", key);
  const bodyLimit = route.name === "access_log" && route.query.export ? MAX_EXPORT_CHARS : MAX_BODY_CHARS;

  let status: number;
  let text: string;
  try {
    const response = await fetch(url, {
      method: post ? "POST" : creditBody !== null ? "PUT" : "GET",
      headers,
      // The level is this interface's decision (handler.ts); the mentions are ids it has checked.
      body: ask
        ? JSON.stringify({ question: route.question, level: route.level, mentions: route.mentions })
        : settingsBody !== null
          ? JSON.stringify(settingsBody)
          : draftBody !== null
            ? JSON.stringify(draftBody)
            : creditBody !== null
              ? JSON.stringify(creditBody)
              : ignoreBody !== null
                ? JSON.stringify(ignoreBody)
              : undefined,
      cache: "no-store",
      // A redirect would carry the key to wherever it points.
      redirect: "error",
      signal: AbortSignal.timeout(
        ask
          ? ASK_TIMEOUT_MS
          : draftBody !== null
            ? DRAFT_TIMEOUT_MS
            : settingsBody !== null || creditBody !== null || ignoreBody !== null
              ? SETTINGS_TIMEOUT_MS
              : READ_TIMEOUT_MS,
      ),
    });
    status = response.status;
    if (status === 409 && !BOARDLESS_ROUTES.has(route.name)) {
      if (Number(response.headers.get("content-length")) > MAX_SETTINGS_REFUSAL_CHARS) {
        await response.body?.cancel().catch(() => undefined);
        return upstreamFailure(status, resolved);
      }
      const text = await response.text();
      const again = () => new Response(text.length > MAX_SETTINGS_REFUSAL_CHARS ? "" : text, { status });
      if ((await refusalCodes(again())).includes("board_not_synced")) return problem(409, "board_not_synced", BOARD_NOT_SYNCED);
      // A figure the board cannot show has no tickets behind it: said calmly, never as a fault.
      if (route.name === "scorecard_tickets" && (await refusalCodes(again())).includes("not_measurable")) {
        return problem(409, "not_measurable", PROOF_NOT_MEASURABLE);
      }
      if (settingsBody !== null) return (await settingsRefusal(again(), settingsBody)) ?? upstreamFailure(status, resolved);
      // Someone else changed the board's credit setting since the reader's revision: nothing was written.
      if (creditBody !== null && (await refusalCodes(again())).includes("stale_revision")) return problem(409, "stale_revision", CREDIT_STALE);
      return upstreamFailure(status, resolved);
    }
    if (status === 422 && ignoreBody !== null) {
      // The service refused the body this interface sent: said in its own words where they can be shown.
      const said = await refusalWords(response);
      return problem(400, "bad_request", said ?? IGNORE_REFUSED, [{ path: "(body)", message: said ?? IGNORE_REFUSED }]);
    }
    if (status === 422 && creditBody !== null) {
      const said = await refusalWords(response);
      return problem(422, "credit_invalid", said ?? CREDIT_REFUSED, [{ path: "field", message: said ?? CREDIT_REFUSED }]);
    }
    if ((status === 409 || status === 422) && settingsBody !== null) {
      // The board moved on since the reader's revision, or the settings cannot be made: said in this interface's words.
      const refused = await settingsRefusal(response, settingsBody);
      return refused ?? upstreamFailure(status, resolved);
    }
    if (status === 422 && draftBody !== null) return draftRefusal(response);
    if (status === 503 && settingsBody !== null && (await refusalCodes(response)).includes("rule_settings_busy")) {
      // A rules run held the board's lock past the service's wait: nothing was written, and trying again soon will do.
      return problem(503, "upstream_unavailable", SETTINGS_BUSY);
    }
    if (status === 403 && route.name === "people_scorecard" && route.query.person.length > 1) {
      if (await refusedForComparison(response)) {
        noteComparison("off");
        return problem(403, "comparison_off", SCORECARD_SENTENCES.comparisonOff);
      }
      return upstreamFailure(status, resolved);
    }
    if (status === 429 && (ask || draftBody !== null)) {
      const limited = await rateLimited(response);
      return limited ?? upstreamFailure(status, resolved);
    }
    if (status === 500) {
      if ((await refusalCodes(response)).includes("access_log_unavailable")) {
        return problem(503, "access_log_unavailable", ACCESS_LOG_UNAVAILABLE);
      }
      return upstreamFailure(status, resolved);
    }
    if (status === 404) {
      if ((await refusalCodes(response)).includes("unknown_board")) return unknownBoard(resolved);
      return upstreamFailure(status, resolved);
    }
    if (!response.ok) {
      // Drain and drop: the body may name hosts, paths or stack frames.
      await response.body?.cancel().catch(() => undefined);
      return upstreamFailure(status, resolved);
    }
    const declared = Number(response.headers.get("content-length"));
    if (declared > bodyLimit) {
      await response.body?.cancel().catch(() => undefined);
      return problem(502, "upstream_invalid", "The oversight service sent a response far larger than expected.");
    }
    text = await response.text();
  } catch (error) {
    return unreachable(error);
  }

  if (text.length > bodyLimit) {
    return problem(502, "upstream_invalid", "The oversight service sent a response far larger than expected.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return problem(502, "upstream_malformed", "The oversight service sent a response that is not JSON.");
  }

  const parsed = RESPONSE_SCHEMAS[route.name].safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => ({
      path: issue.path.map(String).join(".") || "(body)",
      message: issue.message,
    }));
    return problem(
      502,
      "upstream_invalid",
      "The oversight service sent a response this interface does not understand. It may be a different version.",
      issues,
    );
  }

  const data = parsed.data;
  if (route.name === "people_scorecard") {
    // The figures asked for and no others: the period, and when people were named, those people alone.
    const card = data as PeopleScorecard;
    const asked = new Set(route.query.person);
    if (card.period.days !== route.query.days || (asked.size > 0 && card.people.some((row) => !asked.has(row.person.id)))) {
      return problem(502, "upstream_invalid", "The oversight service sent figures for something other than what was asked.");
    }
    // The organisation's setting, as the service has it now: the People page lays itself out for it next time.
    noteComparison(card.comparison);
  }
  if (route.name === "person_card") {
    // The card asked for and no other: the person, the period, and the board read (when this interface named one).
    const card = data as PersonCard;
    if (card.person.id !== route.personId || card.work.days !== route.query.days || (board !== null && card.board.key !== board)) {
      return problem(502, "upstream_invalid", "The oversight service sent a card other than the one asked for.");
    }
  }
  if (
    (route.name === "rule_settings" || route.name === "rule_settings_save" || route.name === "rule_settings_preview" || route.name === "rule_settings_draft") &&
    board !== null
  ) {
    if ((data as RuleSettings | RuleSettingsPreview | RuleDraft).project !== board) {
      return problem(502, "upstream_invalid", "The oversight service sent rule settings for another board than the one asked for.");
    }
  }
  if ((route.name === "people_credit" || route.name === "people_credit_save") && board !== null) {
    // The board asked about, and for a read the period asked for: a choice is never shown as another board's.
    const credit = data as PeopleCredit;
    if (!credit.meta.projects.includes(board) || (route.name === "people_credit" && credit.period.days !== route.query.days)) {
      return problem(502, "upstream_invalid", "The oversight service sent another board's credit setting than the one asked for.");
    }
  }
  if ((route.name === "refresh" || route.name === "refresh_start") && board !== null && (data as Refresh).project !== board) {
    // The sync asked about and no other: "Sync" says which board it syncs, and must report that board.
    return problem(502, "upstream_invalid", "The oversight service reported the sync of another board than the one asked for.");
  }
  if (route.name === "access_log" && accessLogMismatch(data as AccessLog, route.query)) {
    // Entries the filters would have left out are never shown as if they were what was asked for.
    return problem(502, "upstream_invalid", "The oversight service sent access log entries other than the ones asked for.");
  }
  if (route.name === "issue_timeline" && "issue" in data) {
    // Links to Jira come from this interface's configuration, so the service never decides where a click goes.
    data.issue.url = jiraLink(config.jiraBaseUrl, data.issue.key);
  }
  if (route.name === "scorecard_tickets") {
    // The figure asked for and no other: its measure, its period, and its person (or the whole board).
    const proof = data as PeopleProof;
    const { measure, days, person } = route.query;
    if (proof.measure.key !== measure || proof.period.days !== days || (proof.person?.id ?? null) !== person) {
      return problem(502, "upstream_invalid", "The oversight service sent the tickets behind another figure than the one asked for.");
    }
    for (const ticket of [...proof.tickets, ...proof.left_out]) ticket.url = jiraLink(config.jiraBaseUrl, ticket.key);
  }
  return json(data);
}
