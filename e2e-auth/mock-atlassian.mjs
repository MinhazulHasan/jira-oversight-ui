/**
 * A stand-in for Atlassian, for the sign-in end-to-end tests only
 * (playwright.auth.config.ts starts it). It speaks just enough OAuth 2.0
 * (3LO) for the dashboard's sign-in: the consent screen, the code exchange,
 * the User Identity API's /me, the sites a token can reach and Jira's project
 * search. Nothing here talks to Atlassian. Codes and tokens live in memory and
 * end with the process.
 *
 *   GET  /authorize                           the consent screen: one button per test account, and Cancel
 *   GET  /decide                              what a button does: back to the dashboard with a code, or an error
 *   POST /oauth/token                         a code for an access token (single use, ten minutes)
 *   GET  /me                                  who the token belongs to
 *   GET  /oauth/token/accessible-resources    the sites the token reaches
 *   GET  /ex/jira/{cloudId}/rest/api/3/project/search?keys=...
 *                                             which of those projects the account can open on the site
 *   GET  /health                              for the test runner, to know it is up
 *
 * Settings (playwright.auth.config.ts passes them; the defaults suit a run by hand):
 *   MOCK_ATLASSIAN_PORT   the port, on 127.0.0.1 only (default 3404)
 *   MOCK_CLIENT_ID        the client id and secret the dashboard must present
 *   MOCK_CLIENT_SECRET
 *   MOCK_SITE_URL         the Jira site the admitted accounts can reach
 *
 * It sends people back only to a callback on this machine (localhost or
 * 127.0.0.1), always with the state it was given. Test accounts have
 * generic names and .test addresses: no real person, no real domain.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_ATLASSIAN_PORT ?? 3404);
const CLIENT_ID = process.env.MOCK_CLIENT_ID ?? "e2e-client-id";
const CLIENT_SECRET = process.env.MOCK_CLIENT_SECRET ?? "e2e-client-secret-not-a-real-one";
const SITE_URL = process.env.MOCK_SITE_URL ?? "https://oversight-e2e.atlassian.test";
const SCOPE = "read:me read:jira-work";
const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_S = 3600;
const MAX_BODY_BYTES = 64 * 1024;

/** Atlassian writes the site's address its own way; a trailing slash checks that the dashboard normalises it. */
const SITE = { id: "e2e-cloud-0001", url: `${SITE_URL}/`, name: "Oversight e2e", scopes: ["read:jira-work"] };
const OTHER_SITE = {
  id: "e2e-cloud-0002",
  url: "https://another-site.atlassian.test",
  name: "Another site",
  scopes: ["read:jira-work"],
};

/**
 * One per button on the consent screen. Keep the labels in step with ACCOUNTS in e2e-auth/settings.ts.
 * `boards` are the Jira projects the account may browse on its sites; the dashboard's sample serves DEMO.
 */
const ACCOUNTS = [
  {
    key: "allowed",
    label: "Allowed account",
    profile: { account_id: "e2e-account-allowed", email: "reader@allowed.test", email_verified: true },
    sites: [SITE],
    boards: ["DEMO", "ELSEWHERE"],
  },
  {
    key: "outsider",
    label: "Outsider on another domain",
    profile: { account_id: "e2e-account-outsider", email: "reader@elsewhere.test", email_verified: true },
    sites: [SITE],
    boards: ["DEMO"],
  },
  {
    key: "unverified",
    label: "Unverified email address",
    profile: { account_id: "e2e-account-unverified", email: "new-reader@allowed.test", email_verified: false },
    sites: [SITE],
    boards: ["DEMO"],
  },
  {
    key: "no-site",
    label: "No access to the Jira site",
    profile: { account_id: "e2e-account-no-site", email: "visitor@allowed.test", email_verified: true },
    sites: [OTHER_SITE],
    boards: ["DEMO"],
  },
  {
    key: "no-email",
    label: "No email address shared",
    profile: { account_id: "e2e-account-no-email" },
    sites: [SITE],
    boards: ["DEMO"],
  },
  {
    // On ADMIN_EMAILS in playwright.auth.config.ts. Its Jira opens no board, to show an admin reads every board anyway.
    key: "admin",
    label: "Admin account",
    profile: { account_id: "e2e-account-admin", email: "lead@allowed.test", email_verified: true },
    sites: [SITE],
    boards: [],
  },
  {
    key: "no-boards",
    label: "No access to any board",
    profile: { account_id: "e2e-account-no-boards", email: "observer@allowed.test", email_verified: true },
    sites: [SITE],
    boards: ["ELSEWHERE"],
  },
];

/** code -> { account, redirectUri, expires }, and token -> { account, expires }. */
const codes = new Map();
const tokens = new Map();

const mint = (prefix) => `${prefix}-${randomBytes(18).toString("base64url")}`;

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function send(response, status, body, type = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  response.end(text);
}

function redirect(response, location) {
  response.writeHead(302, { location, "cache-control": "no-store" });
  response.end();
}

/** A callback address on this machine, or null: the mock sends no one anywhere else. */
function localCallback(raw) {
  try {
    const url = new URL(raw ?? "");
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return local && (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** The authorisation request as the dashboard must send it, or what is wrong with it. */
function checkAuthorize(query) {
  const expected = { audience: "api.atlassian.com", client_id: CLIENT_ID, scope: SCOPE, response_type: "code", prompt: "consent" };
  for (const [name, value] of Object.entries(expected)) {
    if (query.get(name) !== value) return `${name} must be ${JSON.stringify(value)}`;
  }
  if (!query.get("state")) return "state is missing";
  if (!localCallback(query.get("redirect_uri"))) return "redirect_uri must be an address on localhost or 127.0.0.1";
  return null;
}

function consentPage(query) {
  const carry = (key) =>
    `/decide?account=${encodeURIComponent(key)}&redirect_uri=${encodeURIComponent(query.get("redirect_uri"))}&state=${encodeURIComponent(query.get("state"))}`;
  const buttons = [...ACCOUNTS.map((account) => ({ key: account.key, label: account.label })), { key: "cancel", label: "Cancel" }]
    .map(({ key, label }) => `<li><a href="${escapeHtml(carry(key))}">${escapeHtml(label)}</a></li>`)
    .join("\n      ");
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Mock Atlassian</title>
  </head>
  <body>
    <main>
      <h1>Mock Atlassian</h1>
      <p>A stand-in for Atlassian's consent screen, for the sign-in tests. Choose who signs in.</p>
      <ul>
      ${buttons}
      </ul>
    </main>
  </body>
</html>`;
}

function decide(query, response) {
  const callback = localCallback(query.get("redirect_uri"));
  const state = query.get("state");
  if (!callback || !state) return send(response, 400, "Bad request: a local redirect_uri and a state are required.", "text/plain");

  if (query.get("account") === "cancel") {
    // What Atlassian sends when the person chooses Cancel (RFC 6749, 4.1.2.1).
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("error_description", "access_denied");
    callback.searchParams.set("state", state);
    return redirect(response, callback.href);
  }
  const account = ACCOUNTS.find((candidate) => candidate.key === query.get("account"));
  if (!account) return send(response, 400, "Bad request: no such test account.", "text/plain");

  const code = mint("code");
  codes.set(code, { account, redirectUri: query.get("redirect_uri"), expires: Date.now() + CODE_TTL_MS });
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return redirect(response, callback.href);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function exchange(request, response) {
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    return send(response, 415, { error: "invalid_request", error_description: "JSON only" });
  }
  let body;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    return send(response, 400, { error: "invalid_request" });
  }
  if (body?.grant_type !== "authorization_code") return send(response, 400, { error: "unsupported_grant_type" });
  if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET) {
    return send(response, 401, { error: "access_denied", error_description: "Unauthorized" });
  }
  const grant = codes.get(body.code);
  // Single use, whatever happens next.
  codes.delete(body.code);
  if (!grant || grant.expires < Date.now() || grant.redirectUri !== body.redirect_uri) {
    return send(response, 403, { error: "invalid_grant", error_description: "Invalid authorization code" });
  }
  const token = mint("token");
  tokens.set(token, { account: grant.account, expires: Date.now() + TOKEN_TTL_S * 1000 });
  return send(response, 200, { access_token: token, expires_in: TOKEN_TTL_S, scope: SCOPE, token_type: "Bearer" });
}

function holder(request) {
  const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
  const entry = match ? tokens.get(match[1]) : undefined;
  return entry && entry.expires > Date.now() ? entry.account : null;
}

function me(request, response) {
  const account = holder(request);
  if (!account) return send(response, 401, { code: 401, message: "Unauthorized" });
  return send(response, 200, {
    account_type: "atlassian",
    account_status: "active",
    name: "Test account",
    nickname: "test",
    locale: "en-GB",
    zoneinfo: "Europe/London",
    ...account.profile,
  });
}

function resources(request, response) {
  const account = holder(request);
  if (!account) return send(response, 401, { code: 401, message: "Unauthorized" });
  return send(response, 200, account.sites);
}

const PROJECT_SEARCH = /^\/ex\/jira\/([^/]+)\/rest\/api\/3\/project\/search$/;

/** Jira's project search: of the keys asked for, the projects the account may browse, as Jira pages them. */
function projectSearch(request, response, url, cloudId) {
  const account = holder(request);
  if (!account) return send(response, 401, { code: 401, message: "Unauthorized" });
  if (!account.sites.some((site) => site.id === cloudId)) return send(response, 404, { errorMessages: ["Site not found"] });
  const asked = url.searchParams.getAll("keys");
  if (asked.length > 50) return send(response, 400, { errorMessages: ["Up to 50 project keys can be provided."] });
  if (url.searchParams.get("action") !== "browse") return send(response, 400, { errorMessages: ["The dashboard must ask with action=browse."] });
  const values = asked
    .filter((key) => account.boards.includes(key))
    .map((key, index) => ({ id: String(10000 + index), key, name: `${key} project`, projectTypeKey: "software" }));
  return send(response, 200, { self: url.href, maxResults: 50, startAt: 0, total: values.length, isLast: true, values });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const route = `${request.method} ${url.pathname}`;
  Promise.resolve()
    .then(() => {
      const search = request.method === "GET" ? PROJECT_SEARCH.exec(url.pathname) : null;
      if (search) return projectSearch(request, response, url, decodeURIComponent(search[1]));
      switch (route) {
        case "GET /health":
          return send(response, 200, { status: "ok" });
        case "GET /authorize": {
          const problem = checkAuthorize(url.searchParams);
          return problem
            ? send(response, 400, `Bad authorisation request: ${problem}.`, "text/plain")
            : send(response, 200, consentPage(url.searchParams), "text/html");
        }
        case "GET /decide":
          return decide(url.searchParams, response);
        case "POST /oauth/token":
          return exchange(request, response);
        case "GET /me":
          return me(request, response);
        case "GET /oauth/token/accessible-resources":
          return resources(request, response);
        default:
          return send(response, 404, { error: "not_found" });
      }
    })
    .catch((error) => {
      console.error("mock Atlassian:", error instanceof Error ? error.message : error);
      if (!response.headersSent) send(response, 500, { error: "server_error" });
    });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Atlassian on http://127.0.0.1:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}
