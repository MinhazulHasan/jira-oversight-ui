import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { CALLBACK_ROUTE, LOGIN_PATH, NO_ACCESS_PATH, SIGN_IN_ROUTE, SIGN_OUT_ROUTE, loginPagePath } from "@/lib/sign-in";

import { problem } from "../http";
import { resolveAuth } from "./config";
import { SESSION_COOKIE, openSession, type Session } from "./cookies";

/*
 * The sign-in gate. src/proxy.ts runs it on every request but the build's
 * static files and the icons, and the oversight route runs it again behind
 * that (defence in depth). It looks at the path and the session cookie only:
 * no header can talk its way past it, and an address that is not exactly one
 * of the public ones is gated like any other.
 *
 * Every check reads the cookie the same way, with Next.js's own parser
 * (request.cookies here and in the route, cookies() in the pages), which
 * keeps the last of two cookies with one name. Two readings of one request
 * can then never disagree, which would send a page and its API calls (and so
 * the browser) round in a loop.
 */

/** Open to everyone, signed in or not. Exact paths: anything below them is another address, and gated. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([LOGIN_PATH, NO_ACCESS_PATH, SIGN_IN_ROUTE, CALLBACK_ROUTE, SIGN_OUT_ROUTE]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** Answered with JSON, never a redirect. (A bare "/api" is an unknown page like any other.) */
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export const UNAUTHENTICATED_MESSAGE = "You are not signed in, or your session has ended. Sign in to continue.";

export type SessionCheck =
  /** Through: the session, or null when sign-in is off. */
  | { ok: true; session: Session | null }
  | { ok: false; why: "signed_out"; appOrigin: string }
  /** Sign-in is on but cannot work: nobody gets in. */
  | { ok: false; why: "unconfigured"; problem: string };

/** The jo-session cookie a request carries, read as every check reads it (see above). */
function sessionCookieOf(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value;
}

/** Whether a request carrying this jo-session cookie may use the dashboard. */
export async function checkSession(cookie: string | null | undefined): Promise<SessionCheck> {
  const auth = resolveAuth();
  if (auth.mode === "off") return { ok: true, session: null };
  if (auth.mode === "unconfigured") return { ok: false, why: "unconfigured", problem: auth.problem };
  const session = await openSession(cookie, auth.config);
  return session ? { ok: true, session } : { ok: false, why: "signed_out", appOrigin: auth.config.appOrigin };
}

function refusal(check: Extract<SessionCheck, { ok: false }>): Response {
  return check.why === "unconfigured"
    ? problem(500, "not_configured", check.problem)
    : problem(401, "unauthenticated", UNAUTHENTICATED_MESSAGE);
}

/**
 * Null to let a request through the proxy, or the answer that turns it away:
 * a page goes to /login (coming back to where it was afterwards, from
 * APP_URL); anything under /api/ gets JSON, 401 "unauthenticated" or, when
 * sign-in cannot work, 500 "not_configured". Any fault here fails closed.
 */
export async function gate(request: NextRequest): Promise<Response | null> {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return null;
  const api = isApiPath(pathname);
  try {
    const check = await checkSession(sessionCookieOf(request));
    if (check.ok) return null;
    if (api) return refusal(check);
    // Without a working APP_URL the request's own address serves as the base: inside the proxy that is the
    // server's internal address, never the Host header, and Next.js sends it on as a relative Location.
    const base = check.why === "signed_out" ? check.appOrigin : request.nextUrl.origin;
    const response = NextResponse.redirect(new URL(loginPagePath(pathname + search), base), 303);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    console.error("sign-in gate failed", error);
    if (api) return problem(500, "internal_error", "Something went wrong in this interface. Try again in a moment.");
    const response = NextResponse.redirect(new URL(LOGIN_PATH, request.nextUrl.origin), 303);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}

/** The oversight route's own check, behind the proxy's: null to go on, or the JSON answer that refuses. */
export async function refuseWithoutSession(request: NextRequest): Promise<Response | null> {
  const check = await checkSession(sessionCookieOf(request));
  return check.ok ? null : refusal(check);
}

/**
 * The same check, for a route that needs the session itself (its boards): the
 * session, or null when sign-in is off; or the JSON answer that refuses.
 */
export async function sessionOrRefusal(
  request: NextRequest,
): Promise<{ ok: true; session: Session | null } | { ok: false; response: Response }> {
  const check = await checkSession(sessionCookieOf(request));
  return check.ok ? { ok: true, session: check.session } : { ok: false, response: refusal(check) };
}
