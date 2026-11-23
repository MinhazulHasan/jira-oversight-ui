import "server-only";

import { safeNextPath } from "@/lib/sign-in";

import { seal, unseal } from "./seal";

/*
 * The two cookies sign-in uses, both sealed (./seal.ts), HttpOnly and
 * SameSite=Lax, and Secure whenever the dashboard is served over https.
 *
 * jo-session: who signed in, for twelve hours from the moment they did, and
 * no longer however busy they are. It holds an Atlassian account id, the
 * email address's domain, a keyed hash of the address (so ./roles.ts can tell
 * an admin on every request without the address itself), the Jira site's
 * cloud id, the keys of the boards their Jira account can open, worked out
 * at sign-in, and (since JO-12) their Atlassian display name, which the
 * access log records them by (./viewer.ts): no email address, no token. A
 * session from before the name was kept still opens, and reads as a
 * "Signed-in user" there. A change of
 * permissions in Jira therefore applies from the next sign-in. A session from
 * before boards were kept (version 1) reads as signed out, so everyone signs
 * in once more and gets their boards. It is sealed for the Jira site this dashboard watches
 * (OVERSIGHT_JIRA_BASE_URL), so pointing the dashboard at another site ends
 * every session, as a new AUTH_SECRET does. Anything unreadable, expired, for
 * a domain no longer admitted or for another site means "signed out".
 *
 * A session lives only in its cookie; the server keeps no list of them.
 * Signing out clears the cookie in that browser. A copy of it taken
 * elsewhere would still open until it expires, unless AUTH_SECRET or the
 * site changes first.
 *
 * jo-auth-state: one sign-in in flight, for ten minutes, sent only to
 * /api/auth/*. It carries the random state the callback must see again, and
 * the page to return to.
 */

export const SESSION_COOKIE = "jo-session";
export const STATE_COOKIE = "jo-auth-state";
export const SESSION_TTL_S = 12 * 60 * 60;
export const STATE_TTL_S = 10 * 60;
const STATE_COOKIE_PATH = "/api/auth";
/** How far ahead of this server's clock an issue time may be and still count (clocks drift). */
const CLOCK_SKEW_S = 60;
/** The most boards one session lists: far more than any dashboard serves, and well inside a cookie. */
export const MAX_SESSION_BOARDS = 50;
/**
 * A Jira project key, as PROJECT_KEY_PATTERN in src/lib/api/schemas.ts has it (a test keeps the two equal).
 * Repeated here so the proxy, which opens every session, does not load the whole API contract.
 */
export const BOARD_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,19}$/;

export interface Session {
  v: 2;
  /** The Atlassian account id. */
  sub: string;
  /** The email address's domain, lower case. */
  dom: string;
  /** The Jira site's cloud id. */
  site: string;
  /** The email address's keyed hash (./roles.ts), to tell an admin by ADMIN_EMAILS as it is now. */
  eh: string;
  /**
   * The boards their Jira account can open, the dashboard's default first when it is one of them. Empty only
   * for an admin whose Jira opens none: an admin reads every board anyway.
   */
  boards: string[];
  /**
   * Their Atlassian display name, from the /me call signing in makes (JO-12): what the access log names them by.
   * Absent from a session sealed before it was kept, or when Atlassian gave none fit to keep (sessionName).
   */
  name?: string;
  /** Issued and expires, in seconds since the epoch. */
  iat: number;
  exp: number;
}

export interface SignInState {
  v: 1;
  state: string;
  next: string;
  exp: number;
}

interface CookieOptions {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
  expires?: Date;
}

/** What seals and opens a session: AUTH_SECRET, and the Jira site the session is for (normalised, as config.ts keeps it). */
export interface SessionKeys {
  secret: string;
  jiraSite: string;
}

const seconds = (now: number) => Math.floor(now / 1000);

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** An email hash as ./roles.ts writes it: SHA-256, base64url. */
const EMAIL_HASH = /^[A-Za-z0-9_-]{43}$/;

/** Up to MAX_SESSION_BOARDS project keys, each once. */
function boardList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SESSION_BOARDS &&
    value.every((key) => typeof key === "string" && BOARD_KEY_PATTERN.test(key)) &&
    new Set(value).size === value.length
  );
}

/** A display name's limit, in characters (code points), as the contract's person names have it. */
const NAME_MAX = 128;
/** An email address anywhere in a name: some accounts are given their address as a display name. */
const EMAIL_IN_NAME = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
/** Control characters (C0, DEL, C1): never part of a name a page or a log line shows. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * A display name fit to keep in a session, trimmed, or null: 1 to 128
 * characters, no control character, and no email address in it (an address
 * is never kept, even where Atlassian gives one as a name).
 */
export function sessionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length === 0 || [...name].length > NAME_MAX || CONTROL.test(name) || EMAIL_IN_NAME.test(name)) return null;
  return name;
}

/* ---------------------------------------------------------------- session -- */

export async function sealSession(
  identity: Pick<Session, "sub" | "dom" | "site" | "eh" | "boards" | "name">,
  keys: SessionKeys,
  now = Date.now(),
): Promise<string> {
  // What openSession would refuse is refused here, so a bad session fails loudly at sign-in (the callback
  // reports it) instead of sealing a cookie that can never open.
  if (!text(identity.sub, 128) || !text(identity.dom, 253) || !text(identity.site, 128)) {
    throw new Error("session identity out of shape");
  }
  if (!EMAIL_HASH.test(identity.eh) || !boardList(identity.boards)) throw new Error("session boards or hash out of shape");
  const iat = seconds(now);
  // A name not fit to keep is left out, never sealed: the session works without one.
  const name = sessionName(identity.name);
  const session: Session = {
    v: 2,
    sub: identity.sub,
    dom: identity.dom,
    site: identity.site,
    eh: identity.eh,
    boards: [...identity.boards],
    ...(name === null ? {} : { name }),
    iat,
    exp: iat + SESSION_TTL_S,
  };
  return seal(session, keys.secret, "session", keys.jiraSite);
}

/**
 * The session in a jo-session cookie, or null: missing, tampered with,
 * expired, sealed for another Jira site, for a domain no longer admitted, or
 * from before boards were kept.
 */
export async function openSession(
  value: string | null | undefined,
  config: SessionKeys & { allowedDomains: readonly string[] },
  now = Date.now(),
): Promise<Session | null> {
  if (!value) return null;
  const payload = await unseal(value, config.secret, "session", config.jiraSite);
  if (typeof payload !== "object" || payload === null) return null;
  const session = payload as Record<string, unknown>;
  const { iat, exp } = session;
  if (session.v !== 2 || !text(session.sub, 128) || !text(session.dom, 253) || !text(session.site, 128)) return null;
  if (typeof session.eh !== "string" || !EMAIL_HASH.test(session.eh) || !boardList(session.boards)) return null;
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isInteger(iat) || !Number.isInteger(exp)) return null;
  const at = seconds(now);
  if (exp <= at || iat > at + CLOCK_SKEW_S || exp - iat > SESSION_TTL_S) return null;
  // Taking a domain off ALLOWED_EMAIL_DOMAINS signs its people out at once, not twelve hours later.
  if (!config.allowedDomains.includes(session.dom)) return null;
  // The name is optional (sessions from before JO-12 have none), and one not fit to keep is dropped, never trusted.
  const name = sessionName(session.name);
  return {
    v: 2,
    sub: session.sub,
    dom: session.dom,
    site: session.site,
    eh: session.eh,
    boards: [...session.boards],
    ...(name === null ? {} : { name }),
    iat,
    exp,
  };
}

export function sessionCookie(value: string, secure: boolean): CookieOptions {
  return { name: SESSION_COOKIE, value, httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL_S };
}

export function clearedSessionCookie(secure: boolean): CookieOptions {
  return { ...sessionCookie("", secure), maxAge: 0, expires: new Date(0) };
}

/* ------------------------------------------------------------------ state -- */

export async function sealState(flow: Pick<SignInState, "state" | "next">, secret: string, now = Date.now()): Promise<string> {
  const state: SignInState = { v: 1, state: flow.state, next: safeNextPath(flow.next), exp: seconds(now) + STATE_TTL_S };
  return seal(state, secret, "state");
}

/** The sign-in in flight, or null when there is none, it has expired, or the cookie is not one this server sealed. */
export async function openState(value: string | null | undefined, secret: string, now = Date.now()): Promise<SignInState | null> {
  if (!value) return null;
  const payload = await unseal(value, secret, "state");
  if (typeof payload !== "object" || payload === null) return null;
  const flow = payload as Record<string, unknown>;
  if (flow.v !== 1 || !text(flow.state, 256) || typeof flow.next !== "string" || typeof flow.exp !== "number") return null;
  if (flow.exp <= seconds(now) || flow.exp > seconds(now) + STATE_TTL_S + CLOCK_SKEW_S) return null;
  return { v: 1, state: flow.state, next: safeNextPath(flow.next), exp: flow.exp };
}

export function stateCookie(value: string, secure: boolean): CookieOptions {
  return { name: STATE_COOKIE, value, httpOnly: true, sameSite: "lax", secure, path: STATE_COOKIE_PATH, maxAge: STATE_TTL_S };
}

export function clearedStateCookie(secure: boolean): CookieOptions {
  return { ...stateCookie("", secure), maxAge: 0, expires: new Date(0) };
}
