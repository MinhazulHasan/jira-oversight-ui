import "server-only";

import { CALLBACK_ROUTE } from "@/lib/sign-in";

import { ConfigError } from "../env";

/**
 * Signing in with Atlassian: its configuration, read on every request like
 * the rest (src/server/env.ts), so a mistake shows where it bites and tests
 * can switch freely. When sign-in is on and anything it needs is missing or
 * wrong, it fails closed: pages send people to /login, which says sign-in is
 * not set up here (naming the variable, never its value), the oversight API
 * answers 500, and nobody gets in.
 *
 * Sign-in defaults to on wherever the data is live, and to off for the
 * bundled sample project, which has nothing to protect.
 */

/**
 * Who is an admin (JO-16), ACCESS_MODE: "everyone-admin", the default, makes
 * everyone who signs in an admin; "admin-list" makes admins of the addresses on
 * ADMIN_EMAILS alone, and everyone else a user held to their own Jira boards.
 * roles.ts decides from it; nothing else does.
 */
export const ACCESS_MODES = ["everyone-admin", "admin-list"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];
export const DEFAULT_ACCESS_MODE: AccessMode = "everyone-admin";

export interface AtlassianAuthConfig {
  /** APP_URL's origin: the base of every absolute redirect. Never taken from the request's own headers. */
  appOrigin: string;
  /** APP_URL followed by /api/auth/callback, exactly as registered with the Atlassian app. */
  redirectUri: string;
  /** Cookies carry Secure whenever the dashboard is served over https. */
  secureCookies: boolean;
  clientId: string;
  clientSecret: string;
  /** AUTH_SECRET, which seals the cookies. */
  secret: string;
  /** Lower case; matched exactly against the part of an email address after the last "@". */
  allowedDomains: readonly string[];
  /** Who is an admin (ACCESS_MODE): everyone who signs in, or only ADMIN_EMAILS. See ./roles.ts. */
  accessMode: AccessMode;
  /** Who sees every board under admin-list, lower case (ADMIN_EMAILS); empty when there are no admins. See ./roles.ts. */
  adminEmails: readonly string[];
  /** The Jira site every account must be able to reach, normalised (see normaliseSiteUrl). */
  jiraSite: string;
  /** Atlassian's authorisation server and API, each ending in "/". */
  authBase: URL;
  apiBase: URL;
}

export type AuthConfig = { mode: "off" } | ({ mode: "atlassian" } & AtlassianAuthConfig);

/** Sign-in as a request finds it. "unconfigured" is on, but unable to admit anyone. */
export type AuthResolution =
  | { mode: "off" }
  | { mode: "atlassian"; config: AtlassianAuthConfig }
  | { mode: "unconfigured"; problem: string };

/** What a page may know about sign-in: nothing secret. `problem` names a variable, never a value. */
export type AuthStatus = { mode: "off" } | { mode: "atlassian" } | { mode: "unconfigured"; problem: string };

export const DEFAULT_AUTH_URL = "https://auth.atlassian.com/";
export const DEFAULT_API_URL = "https://api.atlassian.com/";
export const MIN_SECRET_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);
/** A host name: dot-separated labels of letters, digits and inner hyphens. */
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function value(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

/** An https address; plain http too for this machine (localhost, 127.0.0.1) unless `httpsOnly`. */
function parseUrl(raw: string, name: string, httpsOnly = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} is not a URL.`);
  }
  if (httpsOnly && url.protocol !== "https:") {
    throw new ConfigError(`${name} must start with https://.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new ConfigError(`${name} must start with https:// (http:// only for localhost or 127.0.0.1).`);
  }
  if (url.username || url.password) {
    throw new ConfigError(`${name} must not carry a user name or password.`);
  }
  if (url.search || url.hash) {
    throw new ConfigError(`${name} must not carry a query or a fragment.`);
  }
  return url;
}

/** An origin and nothing more: "https://oversight.example.com". */
function originOnly(raw: string, name: string, example: string, httpsOnly = false): URL {
  const url = parseUrl(raw, name, httpsOnly);
  if (url.pathname !== "/") throw new ConfigError(`${name} must be an address with no path, for example ${example}.`);
  return url;
}

/** A base address for Atlassian's servers, ending in "/" so paths resolve under it. */
function baseUrl(raw: string, name: string, fallback: string): URL {
  const url = parseUrl(raw || fallback, name);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

/**
 * A site address in the one form compared: scheme, host and path, lower case,
 * no trailing slash, no query. Null when it is not an http(s) address.
 */
export function normaliseSiteUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

function allowedDomains(raw: string): string[] {
  const domains = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (domains.length === 0) {
    throw new ConfigError("ALLOWED_EMAIL_DOMAINS lists no domain, so nobody could sign in.");
  }
  if (!domains.every((domain) => DOMAIN.test(domain))) {
    throw new ConfigError(
      'ALLOWED_EMAIL_DOMAINS must list email domains only, comma-separated, for example "example.com" (no "@", no wildcards).',
    );
  }
  return [...new Set(domains)];
}

/** A plain ASCII email address: one "@", a local part of printable characters but "," and "@", a domain as DOMAIN has it. */
const EMAIL = /^[!-+\--?A-~]{1,64}@([!-+\--?A-~]+)$/;

/**
 * ADMIN_EMAILS: who sees everything. Optional: empty means no admins, and
 * everyone reads only their own boards. Each address must be on an allowed
 * domain, or its holder could never sign in.
 */
function adminEmails(raw: string, domains: readonly string[]): string[] {
  // Checked before case is folded, and folded for A to Z only (see asciiLower in ./roles.ts).
  const emails = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (!EMAIL.test(entry)) {
        throw new ConfigError('ADMIN_EMAILS must list email addresses only, comma-separated, for example "lead@example.com".');
      }
      return entry.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    });
  for (const email of emails) {
    const match = EMAIL.exec(email);
    if (!match || !DOMAIN.test(match[1])) {
      throw new ConfigError('ADMIN_EMAILS must list email addresses only, comma-separated, for example "lead@example.com".');
    }
    if (!domains.includes(match[1])) {
      throw new ConfigError("Every address in ADMIN_EMAILS must be on a domain in ALLOWED_EMAIL_DOMAINS, or it could never sign in.");
    }
  }
  return [...new Set(emails)];
}

/** ACCESS_MODE: everyone-admin unless set; anything but the two modes is a mistake to report, never a guess. */
function accessMode(env: Env): AccessMode {
  const mode = value(env, "ACCESS_MODE").toLowerCase();
  if (!mode) return DEFAULT_ACCESS_MODE;
  if ((ACCESS_MODES as readonly string[]).includes(mode)) return mode as AccessMode;
  throw new ConfigError('ACCESS_MODE must be "everyone-admin" or "admin-list".');
}

function authMode(env: Env): "off" | "atlassian" {
  const mode = value(env, "AUTH_MODE").toLowerCase();
  if (mode === "off" || mode === "atlassian") return mode;
  if (mode) throw new ConfigError('AUTH_MODE must be "atlassian" or "off".');
  // Not set: on wherever the data is live; off for the bundled sample, which has nothing to protect.
  const data = value(env, "OVERSIGHT_DATA").toLowerCase() || "sample";
  if (data === "sample") return "off";
  if (data === "live") return "atlassian";
  throw new ConfigError('OVERSIGHT_DATA must be "sample" or "live".');
}

const REQUIRED = [
  "APP_URL",
  "ATLASSIAN_CLIENT_ID",
  "ATLASSIAN_CLIENT_SECRET",
  "AUTH_SECRET",
  "ALLOWED_EMAIL_DOMAINS",
  "OVERSIGHT_JIRA_BASE_URL",
] as const;

function listed(names: readonly string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sign-in configuration. Throws ConfigError, naming the variable and never its value. */
export function readAuthConfig(env: Env = process.env): AuthConfig {
  if (authMode(env) === "off") return { mode: "off" };

  const missing = REQUIRED.filter((name) => !value(env, name));
  if (missing.length > 0) {
    throw new ConfigError(`Signing in with Atlassian needs ${listed(missing)}, which ${missing.length === 1 ? "is" : "are"} not set.`);
  }

  const app = originOnly(value(env, "APP_URL"), "APP_URL", "https://oversight.example.com");
  const secret = value(env, "AUTH_SECRET");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters of random.`);
  }
  const domains = allowedDomains(value(env, "ALLOWED_EMAIL_DOMAINS"));
  const access = accessMode(env);
  const admins = adminEmails(value(env, "ADMIN_EMAILS"), domains);
  const site = originOnly(value(env, "OVERSIGHT_JIRA_BASE_URL"), "OVERSIGHT_JIRA_BASE_URL", "https://your-site.atlassian.net", true);

  return {
    mode: "atlassian",
    appOrigin: app.origin,
    redirectUri: `${app.origin}${CALLBACK_ROUTE}`,
    secureCookies: app.protocol === "https:",
    clientId: value(env, "ATLASSIAN_CLIENT_ID"),
    clientSecret: value(env, "ATLASSIAN_CLIENT_SECRET"),
    secret,
    allowedDomains: domains,
    accessMode: access,
    adminEmails: admins,
    jiraSite: normaliseSiteUrl(site.href) ?? "",
    authBase: baseUrl(value(env, "ATLASSIAN_AUTH_URL"), "ATLASSIAN_AUTH_URL", DEFAULT_AUTH_URL),
    apiBase: baseUrl(value(env, "ATLASSIAN_API_URL"), "ATLASSIAN_API_URL", DEFAULT_API_URL),
  };
}

/** Sign-in for this request, never throwing: a configuration that cannot work is "unconfigured". */
export function resolveAuth(env: Env = process.env): AuthResolution {
  try {
    const config = readAuthConfig(env);
    if (config.mode === "off") return { mode: "off" };
    const { mode: _mode, ...atlassian } = config;
    return { mode: "atlassian", config: atlassian };
  } catch (error) {
    if (error instanceof ConfigError) return { mode: "unconfigured", problem: error.message };
    throw error;
  }
}

/**
 * Whether sign-in is on, for a page to decide what to show: "off", "atlassian"
 * (on and working), or "unconfigured" (on, but nobody can get in; `problem`
 * says which variable to fix).
 */
export function authStatus(env: Env = process.env): AuthStatus {
  const auth = resolveAuth(env);
  return auth.mode === "atlassian" ? { mode: "atlassian" } : auth;
}
