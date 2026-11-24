import "server-only";

import type { NextRequest } from "next/server";

import {
  askResponseSchema,
  healthSchema,
  personCardSchema,
  PORTFOLIO_ATTENTION_MAX,
  portfolioSchema,
  projectsSchema,
  type AskLevel,
  type Health,
} from "@/lib/api/schemas";
import { BOARD_COOKIE, boardFromCookie } from "@/lib/board";

import { resolveAuth } from "./auth/config";
import { sessionOrRefusal } from "./auth/gate";
import { askLevel, readableBoards } from "./auth/roles";
import { LOCAL_READER, viewerOf, type ReaderContext } from "./auth/viewer";
import { cardForBoards, projectsFor } from "./boards";
import { ASK_BODY_FORM, DRAFT_BODY_FORM, RESPONSE_SCHEMAS, resolveGet, resolvePost, ruleSettingsPost, type Resolution, type Resolved } from "./endpoints";
import { ConfigError, readConfig, type LiveConfig, type SampleConfig, type ServerConfig } from "./env";
import { json, problem } from "./http";
import { BOARD_NOT_SYNCED, BOARDLESS_ROUTES, forward, unknownBoard } from "./live";
import { NO_PICTURE, picture } from "./pictures";
import { DEFAULT_BOARD, sampleBoard } from "./sample/boards";
import { API_VERSION, REPORT_TIMEZONE } from "./sample/catalogue";
import { sampleNow } from "./sample/clock";
import { sampleDataset } from "./sample/dataset";
import { boardPicture } from "./sample/people";
import { sampleBoardsAt } from "./sample/served";
import { sampleResponse } from "./sample";

/** /api/oversight/*: the credential boundary between the browser and the */

const BOARD_NOT_ALLOWED = "Your Jira account cannot open the board picked in the top bar. Pick one of yours.";
const NO_BOARDS = "Your Jira account cannot open any of the boards this dashboard covers.";
const ASK_OUTSIDE = "That question reaches a board your Jira account cannot open, so it was not answered.";
const PEOPLE_NOT_ALLOWED = "Only admins can ask about a person. Ask about the work instead, or use the Person filter on Findings.";
const DIRECTORY_NOT_ALLOWED = "Only admins can pick people to ask about.";
const SCORECARD_NOT_ALLOWED = "Only admins can see people's scorecards.";
const ACCESS_LOG_NOT_ALLOWED = "Only admins can see the access log.";
const USAGE_NOT_ALLOWED = "Only admins can see Ask's usage.";
const CARD_NOT_ALLOWED = "Only admins can see person cards.";
const RULE_SETTINGS_NOT_SHOWN = "Only admins can see rule settings.";
const RULE_SETTINGS_NOT_CHANGED = "Only admins can change rule settings.";
const NAMED_AT_TEAM_LEVEL = "The oversight service named people in a team-level answer, so it was not passed on.";

/** What a POST refused for where it came from, or for a body that is not JSON, is told; null for one with no body. */
interface PostWords {
  elsewhere: string;
  notJson: string | null;
}

const SETTINGS_POST: PostWords = {
  elsewhere: "Rule settings can be changed only from this dashboard's own pages, so nothing was changed.",
  notJson: "Rule settings are changed with a JSON body, so nothing was changed.",
};
const DRAFT_POST: PostWords = {
  elsewhere: "A rule can be drafted only from this dashboard's own pages, so nothing was drafted.",
  notJson: "A rule is drafted from a JSON body, so nothing was drafted.",
};
const QUESTION_POST: PostWords = {
  elsewhere: "Questions can be asked only from this dashboard's own pages, so nothing was asked.",
  notJson: "A question is sent as a JSON body, so nothing was asked.",
};
const SYNC_POST: PostWords = {
  elsewhere: "A sync can be started only from this dashboard's own pages, so none was started.",
  notJson: null,
};

/** A question is at most 2,000 characters, and rule settings far less than this: a body near this size is neither. */
const MAX_BODY_BYTES = 16 * 1024;
/** How long the sample's re-check after a save takes, in reads: a moment at the default latency, none at 0. */
const SAMPLE_RECHECK_READS = 4;
/** application/json, with or without its parameters ("; charset=utf-8"). */
const JSON_TYPE = /^application\/json\s*(?:;|$)/i;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function refusal(resolution: Extract<Resolution, { ok: false }>): Response {
  return problem(resolution.status, resolution.error, resolution.message, resolution.issues);
}

const RULE_SETTINGS_ROUTES: ReadonlySet<Resolved["route"]["name"]> = new Set([
  "rule_settings",
  "rule_settings_preview",
  "rule_settings_save",
  "rule_settings_draft",
]);
/** The routes that wait on a model in the service (Ask, an AI draft of a rule): the sample takes Ask's time over them. */
const MODEL_ROUTES: ReadonlySet<Resolved["route"]["name"]> = new Set(["ask", "rule_settings_draft"]);

async function serveSample(config: SampleConfig, resolved: Resolved, reader: ReaderContext, picked: string | null): Promise<Response> {
  const { route } = resolved;
  const delay = MODEL_ROUTES.has(route.name) ? config.latency.ask : config.latency.read;
  // Simulated, so the loading states are seen as a reader would see them against the real service.
  if (delay > 0) await pause(delay);

  const now = sampleNow(config.now);
  const board = BOARDLESS_ROUTES.has(route.name) ? DEFAULT_BOARD : sampleBoard(picked ?? DEFAULT_BOARD.key);
  if (board === null) return unknownBoard(resolved);
  const boards = sampleBoardsAt(now);
  const synced = boards.synced(board);
  if (!synced && route.name === "health") return json(notSyncedHealth({ data_mode: "sample", api_version: API_VERSION, report_timezone: REPORT_TIMEZONE }, board.key));
  if (!synced && route.name !== "refresh" && route.name !== "refresh_start") return problem(409, "board_not_synced", BOARD_NOT_SYNCED);
  // A board that has never synced has no dataset yet: its sync is answered beside DEMO's.
  const dataset = sampleDataset(now, synced ? board : DEFAULT_BOARD);
  // The sample's clock: pinned, its "now"; else the server's own.
  const at = config.now !== null ? now : Date.now();

  if (route.name === "person_avatar") {
    // The sample's own pictures, drawn in code (sample/pictures.ts): two of its eight people have one.
    const found = boardPicture(dataset, route.personId);
    return found ? picture(found.bytes, found.type) : problem(404, "not_found", NO_PICTURE);
  }

  // A save is recorded under the reader and the sample's clock.
  const settings = RULE_SETTINGS_ROUTES.has(route.name)
    ? { reader: reader.viewer ?? LOCAL_READER, at, recheckMs: SAMPLE_RECHECK_READS * config.latency.read }
    : undefined;
  const answer = sampleResponse(dataset, route, delay, {
    peopleComparison: config.peopleComparison,
    settings,
    boards,
    sync: { board, at, readMs: config.latency.read },
  });
  if (!answer.found) return problem(answer.status ?? 404, answer.error ?? "not_found", answer.message, answer.issues);

  const parsed = RESPONSE_SCHEMAS[route.name].safeParse(answer.body);
  if (!parsed.success) {
    console.error("sample response breaks the contract", route.name, parsed.error.issues.slice(0, 5));
    return problem(500, "internal_error", "The sample data broke the interface's contract. This is a fault in the interface.");
  }
  return json(parsed.data);
}

function notSyncedHealth(service: Pick<Health, "data_mode" | "api_version" | "report_timezone">, board: string): Health {
  return {
    status: "ok",
    message: null,
    data_mode: service.data_mode,
    read_only: true,
    api_version: service.api_version,
    last_synced_at: null,
    projects: [board],
    report_timezone: service.report_timezone,
  };
}

/** The live health of a board the service says has never synced: see notSyncedHealth. Null when it cannot say. */
async function liveNotSyncedHealth(live: LiveConfig, resolved: Resolved, board: string, reader: ReaderContext): Promise<Response | null> {
  const fallback = await forward(live, resolved, null, reader);
  if (!fallback.ok) return null;
  const parsed = healthSchema.safeParse(await fallback.json());
  return parsed.success ? json(notSyncedHealth(parsed.data, board)) : null;
}

/** The body as text, or null once it passes the limit: read a chunk at a time, so an endless body is never held whole. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** The board list as this person may see it: their boards only. */
async function boardListFor(response: Response, allowed: readonly string[]): Promise<Response> {
  const parsed = projectsSchema.safeParse(await response.json());
  if (!parsed.success) return problem(500, "internal_error", "Something went wrong in this interface. Try again in a moment.");
  const mine = projectsFor(parsed.data, allowed);
  return mine ? json(mine) : problem(403, "board_not_allowed", NO_BOARDS);
}

async function portfolioFor(response: Response, allowed: readonly string[]): Promise<Response> {
  if (allowed.length === 0) return problem(403, "board_not_allowed", NO_BOARDS);
  const parsed = portfolioSchema.safeParse(await response.json());
  if (!parsed.success) return problem(500, "internal_error", "Something went wrong in this interface. Try again in a moment.");
  const { meta, boards, attention, boards_not_synced: notSynced } = parsed.data;
  const mine = boards.filter((board) => allowed.includes(board.project.key));
  const named = meta.projects.filter((key) => allowed.includes(key));
  // Their boards not synced yet are, at most, their boards without a row (the Portfolio lists synced boards only).
  const withoutRow = allowed.filter((key) => !mine.some((board) => board.project.key === key)).length;
  return json({
    meta: { ...meta, projects: named.length > 0 ? named : [allowed[0]] },
    boards: mine,
    attention: attention.filter((item) => allowed.includes(item.project)).slice(0, PORTFOLIO_ATTENTION_MAX),
    boards_not_synced: Math.min(notSynced, withoutRow),
  });
}

async function personCardFor(response: Response, allowed: readonly string[]): Promise<Response> {
  const parsed = personCardSchema.safeParse(await response.json());
  if (!parsed.success) return problem(500, "internal_error", "Something went wrong in this interface. Try again in a moment.");
  return json(cardForBoards(parsed.data, allowed));
}

/** An Ask answer passed on only when it keeps to its reader's limits: read */
async function answerWithin(response: Response, board: string | null, level: AskLevel): Promise<Response> {
  const parsed = askResponseSchema.safeParse(await response.json());
  if (!parsed.success) return problem(500, "internal_error", "Something went wrong in this interface. Try again in a moment.");
  const { meta, facts, plan, people } = parsed.data;
  if (level === "team" && people.length > 0) return problem(502, "upstream_invalid", NAMED_AT_TEAM_LEVEL);
  if (board === null) return json(parsed.data);
  const boardOf = (params: Record<string, unknown>): string | null => {
    if (typeof params.project === "string") return params.project.toUpperCase();
    if (typeof params.issue_key === "string") return params.issue_key.toUpperCase().replace(/-\d+$/, "");
    return null;
  };
  const named = [...facts.map((set) => boardOf(set.params)), ...plan.map((step) => boardOf(step.params))];
  const elsewhere = meta.projects.some((key) => key !== board) || named.some((key) => key !== null && key !== board);
  return elsewhere ? problem(403, "board_not_allowed", ASK_OUTSIDE) : json(parsed.data);
}

/** What a body that cannot be read is told: too large, or not JSON. */
interface BodyWords {
  tooLarge: string;
  notJson: string;
}

const QUESTION_BODY: BodyWords = { tooLarge: "The request body is far larger than a question.", notJson: ASK_BODY_FORM };
const SETTINGS_BODY: BodyWords = {
  tooLarge: "The request body is far larger than rule settings can be.",
  notJson: 'Send a JSON body of the form {"changes": [...]}, as the rule settings page does.',
};
const DRAFT_BODY: BodyWords = { tooLarge: "The request body is far larger than a rule's description can be.", notJson: DRAFT_BODY_FORM };

async function readBody(request: Request, words: BodyWords): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) {
    return { ok: false, response: problem(413, "bad_request", words.tooLarge) };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: problem(400, "bad_request", words.notJson) };
  }
}

/** The host the browser addressed: a proxy in front names it in */
function addressedHost(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("host") || new URL(request.url).host;
}

/** With sign-in off there is no APP_URL to hold an Origin to: it must name the */
function ownHost(origin: string | null, request: NextRequest): boolean {
  if (origin === null) return false;
  try {
    const url = new URL(origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) return false;
    // Read as the Origin is read: lower case, the scheme's own port left out.
    return url.host === new URL(`${url.protocol}//${addressedHost(request)}`).host;
  } catch {
    return false;
  }
}

/** Whether a POST came from somewhere it may not: it must carry this */
function crossSiteRefusal(request: NextRequest, words: PostWords): Response | null {
  const auth = resolveAuth();
  const origin = request.headers.get("origin");
  const own = auth.mode === "atlassian" ? origin === auth.config.appOrigin : ownHost(origin, request);
  if (!own) return problem(403, "forbidden", words.elsewhere);
  if (words.notJson !== null && !JSON_TYPE.test(request.headers.get("content-type") ?? "")) return problem(403, "forbidden", words.notJson);
  return null;
}

export async function handle(method: "GET" | "POST", segments: readonly string[], request: NextRequest): Promise<Response> {
  try {
    // src/proxy.ts turns away requests without a session before they get here; checked again all the same.
    const access = await sessionOrRefusal(request);
    if (!access.ok) return access.response;
    // The boards this person may read; null for every board (sign-in off, or an admin).
    const allowed = readableBoards(access.session);

    let config: ServerConfig;
    try {
      config = readConfig();
    } catch (error) {
      if (error instanceof ConfigError) return problem(500, "not_configured", error.message);
      throw error;
    }

    const search = new URL(request.url).searchParams;
    let resolution: Resolution;
    if (method === "GET") {
      resolution = resolveGet(segments, search);
    } else if (segments.length === 1 && segments[0] === "ask") {
      // A question: from this dashboard's own pages, as JSON, decided before its body is read.
      const forged = crossSiteRefusal(request, QUESTION_POST);
      if (forged) return forged;
      const read = await readBody(request, QUESTION_BODY);
      if (!read.ok) return read.response;
      resolution = resolvePost(segments, search, read.body);
    } else if (ruleSettingsPost(segments)) {
      const draft = ruleSettingsPost(segments) === "rule_settings_draft";
      const forged = crossSiteRefusal(request, draft ? DRAFT_POST : SETTINGS_POST);
      if (forged) return forged;
      if (askLevel(access.session) === "team") return problem(403, "people_not_allowed", RULE_SETTINGS_NOT_CHANGED);
      const read = await readBody(request, draft ? DRAFT_BODY : SETTINGS_BODY);
      if (!read.ok) return read.response;
      resolution = resolvePost(segments, search, read.body);
    } else {
      // "Sync now" takes no body, so only where it came from is checked: a live sync is never started from elsewhere.
      if (segments.length === 1 && segments[0] === "refresh") {
        const forged = crossSiteRefusal(request, SYNC_POST);
        if (forged) return forged;
      }
      // The path is refused before any body is read: nothing but /ask and rule settings accept one.
      resolution = resolvePost(segments, search, null);
    }
    if (!resolution.ok) return refusal(resolution);
    let resolved = resolution.value;

    if (resolved.route.name === "ask") {
      const level = askLevel(access.session);
      if (level === "team" && resolved.route.mentions.length > 0) return problem(403, "people_not_allowed", PEOPLE_NOT_ALLOWED);
      resolved = { ...resolved, route: { ...resolved.route, level } };
    }
    const { route } = resolved;

    const named = route.name === "person_avatar" ? (route.board ?? null) : route.name === "person_card" ? (route.query.board ?? null) : null;
    let board = named ?? boardFromCookie(request.cookies.get(BOARD_COOKIE)?.value);
    if (allowed !== null && !BOARDLESS_ROUTES.has(route.name)) {
      // Only an admin's session can hold no boards: taken off ADMIN_EMAILS, they have none of their own to read.
      if (allowed.length === 0) return problem(403, "board_not_allowed", NO_BOARDS);
      if (board !== null && !allowed.includes(board)) return problem(403, "board_not_allowed", BOARD_NOT_ALLOWED);
      // No pick: their first board, never the service's default, which they may not be able to open.
      board ??= allowed[0];
    }
    if (route.name === "people_directory" && askLevel(access.session) === "team") {
      return problem(403, "people_not_allowed", DIRECTORY_NOT_ALLOWED);
    }
    if (route.name === "people_scorecard") {
      if (askLevel(access.session) === "team") return problem(403, "people_not_allowed", SCORECARD_NOT_ALLOWED);
      resolved = { ...resolved, route: { ...route, level: "people" } };
    }
    if (route.name === "person_card") {
      if (askLevel(access.session) === "team") return problem(403, "people_not_allowed", CARD_NOT_ALLOWED);
      resolved = { ...resolved, route: { ...route, level: "people" } };
    }
    if (route.name === "access_log" || route.name === "usage") {
      if (askLevel(access.session) === "team") {
        return problem(403, "people_not_allowed", route.name === "access_log" ? ACCESS_LOG_NOT_ALLOWED : USAGE_NOT_ALLOWED);
      }
      resolved = { ...resolved, route: { ...route, level: "people" } };
    }
    if (
      route.name === "rule_settings" ||
      route.name === "rule_settings_preview" ||
      route.name === "rule_settings_save" ||
      route.name === "rule_settings_draft"
    ) {
      if (askLevel(access.session) === "team") {
        return problem(403, "people_not_allowed", route.name === "rule_settings" ? RULE_SETTINGS_NOT_SHOWN : RULE_SETTINGS_NOT_CHANGED);
      }
      resolved = { ...resolved, route: { ...route, level: "people" } };
    }

    if (route.name === "portfolio" && allowed !== null && allowed.length > 0) {
      resolved = { ...resolved, route: { ...route, boards: allowed } };
    }

    // Who is reading and at what level, for the service's access log: from the session, never the browser.
    const reader = { viewer: viewerOf(access.session), level: askLevel(access.session) };
    let response =
      config.mode === "sample" ? await serveSample(config.sample, resolved, reader, board) : await forward(config.live, resolved, board, reader);
    if (config.mode === "live" && route.name === "health" && response.status === 409 && board !== null) {
      // A board that has never synced: health still says the service is up, with no sync time for the board.
      response = (await liveNotSyncedHealth(config.live, resolved, board, reader)) ?? response;
    }
    if (allowed !== null && route.name === "projects" && response.ok) return await boardListFor(response, allowed);
    if (allowed !== null && route.name === "portfolio" && response.ok) return await portfolioFor(response, allowed);
    if (allowed !== null && route.name === "person_card" && response.ok) return await personCardFor(response, allowed);
    if (route.name === "ask" && response.ok && (route.level === "team" || allowed !== null)) {
      return await answerWithin(response, allowed !== null ? board : null, route.level);
    }
    return response;
  } catch (error) {
    console.error("oversight route failed", error);
    return problem(500, "internal_error", "Something went wrong in this interface. Try again in a moment.");
  }
}
