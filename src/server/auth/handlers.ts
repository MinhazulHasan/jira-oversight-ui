import "server-only";

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { BOARD_COOKIE, boardFromCookie } from "@/lib/board";
import { LOGIN_PATH, NO_ACCESS_PATH, PORTFOLIO_PATH, safeNextPath, type LoginError, type NoAccessReason } from "@/lib/sign-in";

import { servedBoards } from "../boards";
import { readConfig } from "../env";
import {
  authorizeUrl,
  exchangeCode,
  fetchBoardAccess,
  fetchProfile,
  fetchResources,
  type Profile,
  type Resource,
} from "./atlassian";
import { normaliseSiteUrl, resolveAuth, type AtlassianAuthConfig } from "./config";
import {
  MAX_SESSION_BOARDS,
  STATE_COOKIE,
  clearedSessionCookie,
  clearedStateCookie,
  openState,
  sealSession,
  sealState,
  sessionCookie,
  stateCookie,
} from "./cookies";
import { logFailure, logRejection } from "./log";
import { adminAtSignIn, asciiLower, emailHash } from "./roles";
import { randomToken } from "./seal";

/** The three sign-in routes under /api/auth (thin route files call these): */

/** Far longer than any code Atlassian issues; anything longer is not one. */
const MAX_CODE_LENGTH = 4096;

/** A 303 to `location`: on APP_URL's origin when one is given (and never off it), as given otherwise. */
function seeOther(location: string, appOrigin?: string): NextResponse {
  let target = location;
  if (appOrigin) {
    const url = new URL(location, appOrigin);
    target = url.origin === appOrigin ? url.href : `${appOrigin}/`;
  }
  return new NextResponse(null, { status: 303, headers: { location: target, "cache-control": "no-store" } });
}

/** The two values compared in constant time, so the comparison says nothing about how much of a guess was right. */
function sameState(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ login -- */

export async function startSignIn(request: NextRequest): Promise<Response> {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const auth = resolveAuth();
  // Nothing to sign in to; or nothing that could work, which /login explains.
  if (auth.mode === "off") return seeOther(next);
  if (auth.mode === "unconfigured") return seeOther(LOGIN_PATH);

  const { config } = auth;
  const state = randomToken();
  const response = seeOther(authorizeUrl(config, state));
  response.cookies.set(stateCookie(await sealState({ state, next }, config.secret), config.secureCookies));
  return response;
}

/* --------------------------------------------------------------- callback -- */

/** Where a sign-in lands. Back where the reader was going, as always; but a */
export function landingFor(next: string, admin: boolean): string {
  return admin && next === "/" ? PORTFOLIO_PATH : next;
}

/** The boards the dashboard serves, or null when they cannot be read (the oversight service is down or set up wrongly). */
async function boardsServed(): Promise<string[] | null> {
  try {
    return await servedBoards(readConfig());
  } catch {
    return null;
  }
}

type Verdict = { ok: true; domain: string; cloudId: string } | { ok: false; reason: NoAccessReason; domain: string | null };

/** The rules, in order: an email address, not marked unverified, on an admitted domain, with the Jira site in reach. */
function judge(profile: Profile, resources: readonly Resource[], config: AtlassianAuthConfig): Verdict {
  const email = profile.email ?? "";
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return { ok: false, reason: "email", domain: null };
  // Case folded for A to Z only: a look-alike letter must not turn another domain into an allowed one.
  const domain = asciiLower(email.slice(at + 1));
  if (profile.emailVerified === false) return { ok: false, reason: "unverified", domain };
  if (!config.allowedDomains.includes(domain)) return { ok: false, reason: "domain", domain };
  const site = resources.find((resource) => normaliseSiteUrl(resource.url) === config.jiraSite);
  if (!site) return { ok: false, reason: "site", domain };
  return { ok: true, domain, cloudId: site.id };
}

async function completeSignIn(request: NextRequest, config: AtlassianAuthConfig): Promise<NextResponse> {
  const failed = (reason: LoginError, step: Parameters<typeof logFailure>[1], status?: number) => {
    logFailure(reason, step, status);
    return seeOther(`${LOGIN_PATH}?error=${reason}`, config.appOrigin);
  };
  const query = request.nextUrl.searchParams;

  // Cancel on Atlassian's consent screen comes back as error=access_denied (RFC 6749, 4.1.2.1).
  const error = query.get("error");
  if (error !== null) return failed(error === "access_denied" ? "denied" : "atlassian", "callback");

  const flow = await openState(request.cookies.get(STATE_COOKIE)?.value, config.secret);
  if (!flow || !sameState(query.get("state"), flow.state)) return failed("state", "callback");
  const code = query.get("code");
  if (!code || code.length > MAX_CODE_LENGTH) return failed("atlassian", "callback");

  const token = await exchangeCode(config, code);
  if (!token.ok) return failed(token.reason, token.step, token.status);
  const [profile, resources] = await Promise.all([
    fetchProfile(config, token.accessToken),
    fetchResources(config, token.accessToken),
  ]);
  if (!profile.ok) return failed(profile.reason, profile.step, profile.status);
  if (!resources.ok) return failed(resources.reason, resources.step, resources.status);

  const refuse = (reason: NoAccessReason, domain: string | null) => {
    logRejection(reason, domain, profile.profile.accountId, config.secret);
    const refused = seeOther(`${NO_ACCESS_PATH}?reason=${reason}`, config.appOrigin);
    // Turned away is signed out: an earlier session in this browser ends here too.
    refused.cookies.set(clearedSessionCookie(config.secureCookies));
    return refused;
  };

  const verdict = judge(profile.profile, resources.resources, config);
  if (!verdict.ok) return refuse(verdict.reason, verdict.domain);

  const email = asciiLower(profile.profile.email ?? "");
  const verified = profile.profile.emailVerified === true;
  const admin = adminAtSignIn(email, verified, config);
  const hashed = verified ? email : `unverified:${profile.profile.accountId}`;

  const served = await boardsServed();
  if (served === null) return failed("service", "boards");
  const access = await fetchBoardAccess(config, token.accessToken, verdict.cloudId, served);
  if (!access.ok) return failed(access.reason, access.step, access.status);
  const boards = served.filter((key) => access.keys.has(key)).slice(0, MAX_SESSION_BOARDS);
  if (boards.length === 0 && !admin) return refuse("boards", verdict.domain);

  const session = await sealSession(
    {
      sub: profile.profile.accountId,
      dom: verdict.domain,
      site: verdict.cloudId,
      eh: emailHash(hashed, config.secret),
      boards,
      ...(profile.profile.name === null ? {} : { name: profile.profile.name }),
    },
    config,
  );
  const response = seeOther(landingFor(flow.next, admin), config.appOrigin);
  response.cookies.set(sessionCookie(session, config.secureCookies));
  const picked = boardFromCookie(request.cookies.get(BOARD_COOKIE)?.value);
  if (!admin && picked !== null && !boards.includes(picked)) {
    response.cookies.set({ name: BOARD_COOKIE, value: "", path: "/", sameSite: "lax", maxAge: 0, expires: new Date(0) });
  }
  return response;
}

export async function finishSignIn(request: NextRequest): Promise<Response> {
  const auth = resolveAuth();
  if (auth.mode === "off") return seeOther("/");
  if (auth.mode === "unconfigured") return seeOther(LOGIN_PATH);

  const { config } = auth;
  let response: NextResponse;
  try {
    response = await completeSignIn(request, config);
  } catch (error) {
    // Only the error's name: a message could quote a body Atlassian sent.
    logFailure("internal", "internal");
    console.error("sign-in callback failed", error instanceof Error ? error.name : typeof error);
    response = seeOther(`${LOGIN_PATH}?error=internal`, config.appOrigin);
  }
  // One sign-in, one use: whatever happened, the state is spent.
  response.cookies.set(clearedStateCookie(config.secureCookies));
  return response;
}

/* ----------------------------------------------------------------- logout -- */

export async function signOut(request: NextRequest): Promise<Response> {
  const auth = resolveAuth();
  if (auth.mode !== "atlassian") {
    // Sign-in is off or not set up, so there is no session to end; an old cookie is cleared all the same.
    const response = seeOther(`${LOGIN_PATH}?signed_out=1`);
    response.cookies.set(clearedSessionCookie(false));
    return response;
  }

  const { config } = auth;
  // Only this dashboard's own pages may sign someone out; a form on another site may not.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== config.appOrigin) {
    return NextResponse.json(
      { error: "forbidden", message: "Sign out from the dashboard's own pages." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const response = seeOther(`${LOGIN_PATH}?signed_out=1`, config.appOrigin);
  response.cookies.set(clearedSessionCookie(config.secureCookies));
  return response;
}
