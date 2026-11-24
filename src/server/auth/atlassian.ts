import "server-only";

import type { AtlassianAuthConfig } from "./config";
import { sessionName } from "./cookies";

/** The few calls signing in makes to Atlassian, as its OAuth 2.0 (3LO) guide */

/** Who the person is (read:me), and which boards they can open (read:jira-work). Nothing that writes, no offline access. */
export const SCOPES = ["read:me", "read:jira-work"] as const;
export const ATLASSIAN_TIMEOUT_MS = 10_000;
/** A site list for an account with hundreds of sites is still far below this. */
const MAX_BODY_CHARS = 1024 * 1024;

export type AtlassianStep = "token" | "profile" | "resources" | "projects";

/** Jira's limit on the project keys one search takes (GET /rest/api/3/project/search, keys=). */
export const MAX_KEYS_PER_SEARCH = 50;

export interface AtlassianFailure {
  ok: false;
  reason: "atlassian" | "timeout" | "unreachable";
  step: AtlassianStep;
  /** Atlassian's HTTP status, when it answered. */
  status?: number;
}

export interface Profile {
  accountId: string;
  /** Null when Atlassian shared no email address. */
  email: string | null;
  /** Null when Atlassian does not say. Anything but true or nothing reads as false. */
  emailVerified: boolean | null;
  name: string | null;
}

export interface Resource {
  /** The site's cloud id. */
  id: string;
  url: string;
}

type Config = Pick<AtlassianAuthConfig, "authBase" | "apiBase" | "clientId" | "clientSecret" | "redirectUri">;

/** Where to send a person to sign in: the authorisation address with its */
export function authorizeUrl(config: Pick<Config, "authBase" | "clientId" | "redirectUri">, state: string): string {
  const parameters: [string, string][] = [
    ["audience", "api.atlassian.com"],
    ["client_id", config.clientId],
    ["scope", SCOPES.join(" ")],
    ["redirect_uri", config.redirectUri],
    ["state", state],
    ["response_type", "code"],
    ["prompt", "consent"],
  ];
  const query = parameters.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
  return `${new URL("authorize", config.authBase).href}?${query}`;
}

function isTimeout(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") return false;
    const name = "name" in current ? current.name : undefined;
    if (name === "TimeoutError" || name === "AbortError") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function call(step: AtlassianStep, url: URL, init: RequestInit): Promise<{ ok: true; body: unknown } | AtlassianFailure> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      // Never followed: a redirect would carry the client secret or the token to wherever it points.
      redirect: "manual",
      signal: AbortSignal.timeout(ATLASSIAN_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: isTimeout(error) ? "timeout" : "unreachable", step };
  }
  try {
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_BODY_CHARS) {
      // Drained and dropped: what Atlassian says about a failure is not passed on.
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "atlassian", step, status: response.status };
    }
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) return { ok: false, reason: "atlassian", step, status: response.status };
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch (error) {
    // The body can time out as well. A parse error quotes the body, so the error itself goes no further.
    return { ok: false, reason: isTimeout(error) ? "timeout" : "atlassian", step, status: response.status };
  }
}

/** Trades the code Atlassian sent back for an access token, which lives only as long as the request that asked. */
export async function exchangeCode(config: Config, code: string): Promise<{ ok: true; accessToken: string } | AtlassianFailure> {
  const result = await call("token", new URL("oauth/token", config.authBase), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!result.ok) return result;
  const token = record(result.body)?.access_token;
  if (typeof token !== "string" || token.length === 0) return { ok: false, reason: "atlassian", step: "token" };
  return { ok: true, accessToken: token };
}

function bearer(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}`, accept: "application/json" };
}

/** The account behind the token, from the User Identity API (GET /me). */
export async function fetchProfile(config: Config, accessToken: string): Promise<{ ok: true; profile: Profile } | AtlassianFailure> {
  const result = await call("profile", new URL("me", config.apiBase), { headers: bearer(accessToken) });
  if (!result.ok) return result;
  const body = record(result.body);
  const accountId = body?.account_id;
  if (!body || typeof accountId !== "string" || accountId.length === 0 || accountId.length > 128) {
    return { ok: false, reason: "atlassian", step: "profile" };
  }
  const email = typeof body.email === "string" && body.email.length <= 320 ? body.email.trim() : "";
  const verified = body.email_verified;
  return {
    ok: true,
    profile: {
      accountId,
      email: email || null,
      emailVerified: verified === undefined || verified === null ? null : verified === true,
      name: sessionName(body.name),
    },
  };
}

/** The sites the token reaches (GET /oauth/token/accessible-resources). Entries without an id and a url are skipped. */
export async function fetchResources(config: Config, accessToken: string): Promise<{ ok: true; resources: Resource[] } | AtlassianFailure> {
  const result = await call("resources", new URL("oauth/token/accessible-resources", config.apiBase), {
    headers: bearer(accessToken),
  });
  if (!result.ok) return result;
  if (!Array.isArray(result.body)) return { ok: false, reason: "atlassian", step: "resources" };
  const resources = result.body.flatMap((entry: unknown) => {
    const item = record(entry);
    return item && typeof item.id === "string" && item.id && typeof item.url === "string" ? [{ id: item.id, url: item.url }] : [];
  });
  return { ok: true, resources };
}

/** Which of `keys` the account can open on the Jira site `cloudId`. Jira's */
export async function fetchBoardAccess(
  config: Pick<Config, "apiBase">,
  accessToken: string,
  cloudId: string,
  keys: readonly string[],
): Promise<{ ok: true; keys: Set<string> } | AtlassianFailure> {
  const open = new Set<string>();
  for (let start = 0; start < keys.length; start += MAX_KEYS_PER_SEARCH) {
    const url = new URL(`ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/project/search`, config.apiBase);
    for (const key of keys.slice(start, start + MAX_KEYS_PER_SEARCH)) url.searchParams.append("keys", key);
    url.searchParams.set("maxResults", String(MAX_KEYS_PER_SEARCH));
    // "browse": projects whose issues the account can see (Browse Projects), not merely administer.
    url.searchParams.set("action", "browse");
    const result = await call("projects", url, { headers: bearer(accessToken) });
    if (!result.ok) return result;
    const values = record(result.body)?.values;
    if (!Array.isArray(values)) return { ok: false, reason: "atlassian", step: "projects" };
    for (const entry of values) {
      const key = record(entry)?.key;
      if (typeof key === "string") open.add(key.toUpperCase());
    }
  }
  return { ok: true, keys: open };
}
