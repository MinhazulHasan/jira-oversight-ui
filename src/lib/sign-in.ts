/** The sign-in page. Outside the shell, and it never calls the oversight API. */
export const LOGIN_PATH = "/login";
/** Where an account that signed in but may not use the dashboard is told so. */
export const NO_ACCESS_PATH = "/no-access";
/** Starts signing in with Atlassian (GET, optionally ?next=/path). */
export const SIGN_IN_ROUTE = "/api/auth/login";
/** Where Atlassian sends people back. Registered with the Atlassian app as APP_URL followed by this path. */
export const CALLBACK_ROUTE = "/api/auth/callback";
/** Ends the session: POST, from this dashboard's own pages (Sign out sends it as a same-origin fetch). */
export const SIGN_OUT_ROUTE = "/api/auth/logout";
/** Every board at once: where an admin's sign-in lands when it was going nowhere in particular. */
export const PORTFOLIO_PATH = "/portfolio";

export const LOGIN_ERRORS = [
  /** The person chose Cancel on Atlassian's consent screen. */
  "denied",
  "state",
  /** Atlassian answered with an error, or with something this dashboard could not read. */
  "atlassian",
  /** Atlassian did not answer within ten seconds. */
  "timeout",
  /** Atlassian could not be reached from this server. */
  "unreachable",
  /** The oversight service could not say which boards the dashboard covers, so the person's boards could not be checked. */
  "service",
  /** A fault in this dashboard. */
  "internal",
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

/** What /no-access?reason= can say: the account signed in, but may not use this dashboard. */
export const NO_ACCESS_REASONS = [
  /** Atlassian did not share an email address for the account. */
  "email",
  /** Atlassian says the account's email address is not verified. */
  "unverified",
  /** The email address's domain is not one this dashboard admits (ALLOWED_EMAIL_DOMAINS). */
  "domain",
  /** The account cannot reach the Jira site this dashboard oversees. */
  "site",
  /** The account's Jira cannot open any of the boards this dashboard covers. */
  "boards",
] as const;
export type NoAccessReason = (typeof NO_ACCESS_REASONS)[number];

export function loginError(raw: string | null | undefined): LoginError | null {
  return LOGIN_ERRORS.find((code) => code === raw) ?? null;
}

export function noAccessReason(raw: string | null | undefined): NoAccessReason | null {
  return NO_ACCESS_REASONS.find((reason) => reason === raw) ?? null;
}

/* -------------------------------------------------------------- next path -- */

const MAX_NEXT_LENGTH = 2048;
/** Printable ASCII without the space and the backslash: a path and query as a browser sends them, encoded. */
const PLAIN = /^[\x21-\x5b\x5d-\x7e]*$/;
/** Nowhere worth returning to after signing in, or nowhere that is a page. Matched on the decoded path. */
const NOT_A_DESTINATION = /^\/(?:login|no-access|api|_next)(?:[/?#;]|$)/i;
const BASE = "http://next-path.invalid";

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return "/";
  if (!PLAIN.test(raw) || raw[0] !== "/" || raw[1] === "/") return "/";

  const cut = raw.search(/[?#]/);
  const path = cut === -1 ? raw : raw.slice(0, cut);
  const query = cut !== -1 && raw[cut] === "?" ? raw.slice(cut).split("#", 1)[0] : "";

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "/";
  }
  // Decoded, the path must pass the same test: "/%2F%2Fhost" and "/%5Chost" are "//host" and "/\host" in disguise.
  if (!PLAIN.test(decoded) || decoded[1] === "/") return "/";
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return "/";
  if (NOT_A_DESTINATION.test(decoded)) return "/";

  const next = query === "?" ? path : path + query;
  // Whatever the rules above might miss, the result has to stay on this origin.
  try {
    return new URL(next, BASE).origin === BASE ? next : "/";
  } catch {
    return "/";
  }
}

function withNext(route: string, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe === "/" ? route : `${route}?next=${encodeURIComponent(safe)}`;
}

/** The sign-in page, coming back to `next` afterwards: "/login?next=%2Ffindings". */
export function loginPagePath(next?: string | null): string {
  return withNext(LOGIN_PATH, next);
}

/** The address that starts signing in with Atlassian, coming back to `next`: the sign-in button's href. */
export function signInPath(next?: string | null): string {
  return withNext(SIGN_IN_ROUTE, next);
}

/* ------------------------------------------------------------- the browser -- */

/** How long one departure for the sign-in page holds off the next, in this tab. */
export const LEAVE_GUARD_MS = 10_000;
/** Where this tab remembers its last departure, so the guard outlives the page loads in between. */
const LEFT_AT_KEY = "jo-left-for-sign-in";

let leftAt = 0;

function lastDeparture(): number {
  try {
    const stored = Number(window.sessionStorage.getItem(LEFT_AT_KEY));
    return Number.isFinite(stored) ? Math.max(stored, leftAt) : leftAt;
  } catch {
    return leftAt;
  }
}

function rememberDeparture(now: number): void {
  leftAt = now;
  try {
    window.sessionStorage.setItem(LEFT_AT_KEY, String(now));
  } catch {
    // Storage is blocked (some private windows): the memory above still covers this page.
  }
}

export function sendToSignIn(): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, search } = window.location;
  if (pathname === LOGIN_PATH || pathname === NO_ACCESS_PATH) return false;
  const now = Date.now();
  const last = lastDeparture();
  if (now >= last && now - last < LEAVE_GUARD_MS) return false;
  rememberDeparture(now);
  window.location.replace(loginPagePath(pathname + search));
  return true;
}
