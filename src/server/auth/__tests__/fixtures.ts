import { vi } from "vitest";

/** Sign-in as the tests configure it: a local dashboard, a made-up Atlassian */

export const APP = "http://localhost:3400";
export const SECRET = "a-test-secret-of-forty-eight-characters-0123456";
export const CLIENT_ID = "test-client-id";
export const CLIENT_SECRET = "test-client-secret-never-to-be-seen";
export const SITE = "https://example.atlassian.net";
/** What seals a session on the dashboard AUTH_ENV describes: its secret, and its Jira site (already in normalised form). */
export const SESSION_KEYS = { secret: SECRET, jiraSite: SITE } as const;
export const CLOUD_ID = "11111111-2222-3333-4444-555555555555";
export const ACCOUNT = "557058:aaaabbbb-cccc-dddd-eeee-ffff00001111";
export const ACCESS_TOKEN = "atlassian-access-token-never-to-be-seen";
export const CODE = "authorisation-code-from-atlassian";

export const AUTH_ENV: Readonly<Record<string, string>> = {
  AUTH_MODE: "atlassian",
  ACCESS_MODE: "admin-list",
  APP_URL: APP,
  ATLASSIAN_CLIENT_ID: CLIENT_ID,
  ATLASSIAN_CLIENT_SECRET: CLIENT_SECRET,
  AUTH_SECRET: SECRET,
  ALLOWED_EMAIL_DOMAINS: "stellainternational.com, example.org",
  OVERSIGHT_JIRA_BASE_URL: SITE,
  ATLASSIAN_AUTH_URL: "",
  ATLASSIAN_API_URL: "",
};

/** Turns sign-in on for this test, with `overrides` on top (vi.unstubAllEnvs undoes it). */
export function stubAuthEnv(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...AUTH_ENV, ...overrides })) vi.stubEnv(name, value);
}

export const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const ME_URL = "https://api.atlassian.com/me";
export const RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
/** Jira's project search on the site, as signing in asks it which boards the account can open. */
export const PROJECT_SEARCH_URL = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/project/search`;
/** The live oversight service's board list, when a test runs the dashboard on live data. */
export const SERVICE_URL = "http://oversight.internal:3300/";
export const SERVICE_PROJECTS_URL = `${SERVICE_URL}api/v1/projects`;

/** Jira's answer for an account that can open the sample's one board. */
export const PROJECTS = { self: PROJECT_SEARCH_URL, maxResults: 50, startAt: 0, total: 1, isLast: true, values: [{ id: "10000", key: "DEMO", name: "Demo project" }] };

export const ME = {
  account_type: "atlassian",
  account_id: ACCOUNT,
  email: "reviewer@stellainternational.com",
  email_verified: true,
  // Kept in the session since for the access log to name this person's reads by; never shown to anyone else.
  name: "Robin Okafor",
  picture: "https://avatar.example/not-shown",
  account_status: "active",
};

export const RESOURCES = [
  { id: "99999999-0000-0000-0000-000000000000", url: "https://another-site.atlassian.net", name: "Elsewhere", scopes: ["read:jira-work"] },
  { id: CLOUD_ID, url: SITE, name: "The site", scopes: ["read:jira-work"], avatarUrl: "https://avatar.example/site" },
];

type Answer = unknown | Response | Error | (() => Promise<Response>);

const snapshots = new WeakMap<Response, Promise<{ status: number; headers: [string, string][]; text: string }>>();

/** A fresh Response every call. (Not clone(): a cloned body is a tee, and */
async function respond(answer: Answer): Promise<Response> {
  if (answer instanceof Error) throw answer;
  if (answer instanceof Response) {
    let snapshot = snapshots.get(answer);
    if (!snapshot) {
      snapshot = answer.text().then((text) => ({ status: answer.status, headers: [...answer.headers], text }));
      snapshots.set(answer, snapshot);
    }
    const { status, headers, text } = await snapshot;
    return new Response(text, { status, headers });
  }
  if (typeof answer === "function") return (answer as () => Promise<Response>)();
  return Response.json(answer);
}

export function stubAtlassian(
  answers: { token?: Answer; me?: Answer; resources?: Answer; projects?: Answer; service?: Answer } = {},
) {
  const {
    token = { access_token: ACCESS_TOKEN, expires_in: 3600, scope: "read:me read:jira-work" },
    me = ME,
    resources = RESOURCES,
    projects = PROJECTS,
    service = new Error("no oversight service in this test"),
  } = answers;
  const upstream = vi.fn<typeof fetch>((input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === TOKEN_URL) return respond(token);
    if (url === ME_URL) return respond(me);
    if (url === RESOURCES_URL) return respond(resources);
    if (url.split("?")[0] === PROJECT_SEARCH_URL) return respond(projects);
    if (url === SERVICE_PROJECTS_URL) return respond(service);
    return Promise.reject(new Error(`unexpected call to ${url}`));
  });
  vi.stubGlobal("fetch", upstream);
  return upstream;
}

export interface SetCookie {
  name: string;
  value: string;
  attributes: Map<string, string>;
}

/** The Set-Cookie headers of a response, parsed: attribute names lower case. */
export function setCookies(response: Response): SetCookie[] {
  return response.headers.getSetCookie().map((header) => {
    const [pair, ...rest] = header.split(";");
    const at = pair.indexOf("=");
    const attributes = new Map<string, string>();
    for (const part of rest) {
      const [name, ...value] = part.trim().split("=");
      attributes.set(name.toLowerCase(), value.join("="));
    }
    return { name: pair.slice(0, at).trim(), value: decodeURIComponent(pair.slice(at + 1)), attributes };
  });
}

export function setCookie(response: Response, name: string): SetCookie | undefined {
  return setCookies(response).find((cookie) => cookie.name === name);
}
