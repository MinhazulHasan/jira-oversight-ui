// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as callbackRoute } from "@/app/api/auth/callback/route";
import * as loginModule from "@/app/api/auth/login/route";
import * as logoutModule from "@/app/api/auth/logout/route";

import { openSession, openState, sealState } from "../cookies";
import { accountHash } from "../log";
import { emailHash } from "../roles";
import { unseal } from "../seal";

import {
  ACCESS_TOKEN,
  ACCOUNT,
  APP,
  CLIENT_ID,
  CLIENT_SECRET,
  CLOUD_ID,
  CODE,
  ME,
  ME_URL,
  PROJECTS,
  PROJECT_SEARCH_URL,
  RESOURCES,
  RESOURCES_URL,
  SECRET,
  SERVICE_PROJECTS_URL,
  SERVICE_URL,
  SESSION_KEYS,
  SITE,
  TOKEN_URL,
  setCookie,
  stubAtlassian,
  stubAuthEnv,
} from "./fixtures";

/** The three sign-in routes. Atlassian is a stub of fetch throughout: the */

const loginRoute = loginModule.GET;
const logoutRoute = logoutModule.POST;
const ADMITTED = { ...SESSION_KEYS, allowedDomains: ["stellainternational.com", "example.org"] };

function get(url: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(url, { headers: { ...headers, ...(cookie ? { cookie } : {}) } });
}

/** Presses "Sign in with Atlassian": the redirect, the state Atlassian is given, and the sealed state cookie. */
async function startSignIn(next = "/findings?severity=breach") {
  const response = await loginRoute(get(`${APP}/api/auth/login?next=${encodeURIComponent(next)}`));
  const location = new URL(response.headers.get("location") ?? "");
  const cookie = setCookie(response, "jo-auth-state");
  return { response, location, state: location.searchParams.get("state") ?? "", cookie: cookie?.value ?? "" };
}

/** Comes back from Atlassian with `query`, carrying the state cookie from startSignIn. */
async function returnFromAtlassian(query: Record<string, string>, stateCookie: string) {
  const search = new URLSearchParams(query).toString();
  return callbackRoute(get(`${APP}/api/auth/callback?${search}`, stateCookie ? { "jo-auth-state": stateCookie } : {}));
}

async function signIn(next?: string) {
  const flow = await startSignIn(next);
  return returnFromAtlassian({ code: CODE, state: flow.state }, flow.cookie);
}

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  stubAuthEnv();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Every log line written, as one string, to search for things that must never be in it. */
function logged(): string {
  return JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
}

/** What a rejection line holds instead of the account id: its keyed hash, as log.ts makes it. */
const ACCOUNT_HASH = accountHash(ACCOUNT, SECRET);

function logLines(): Record<string, unknown>[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

describe("GET /api/auth/login", () => {
  it("sends the browser to Atlassian's authorisation address, exactly as Atlassian documents it", async () => {
    const { response, location, state } = await startSignIn();
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("location")).toBe(
      "https://auth.atlassian.com/authorize" +
        "?audience=api.atlassian.com" +
        `&client_id=${CLIENT_ID}` +
        "&scope=read%3Ame%20read%3Ajira-work" +
        "&redirect_uri=http%3A%2F%2Flocalhost%3A3400%2Fapi%2Fauth%2Fcallback" +
        `&state=${state}` +
        "&response_type=code" +
        "&prompt=consent",
    );
    expect(location.searchParams.get("scope")).toBe("read:me read:jira-work");
    expect(location.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback`);
    expect(response.headers.get("location")).not.toContain(CLIENT_SECRET);
  });

  it("remembers the state and the page to return to in a sealed, short-lived, HttpOnly cookie", async () => {
    const { response, state } = await startSignIn("/issues/DEMO-1");
    const cookie = setCookie(response, "jo-auth-state");
    expect(cookie).toBeDefined();
    expect(cookie?.attributes.get("httponly")).toBe("");
    expect(cookie?.attributes.get("samesite")?.toLowerCase()).toBe("lax");
    expect(cookie?.attributes.get("path")).toBe("/api/auth");
    expect(cookie?.attributes.get("max-age")).toBe("600");
    expect(cookie?.attributes.has("secure")).toBe(false);
    expect(cookie?.value).not.toContain(state);
    expect(await openState(cookie?.value, SECRET)).toMatchObject({ state, next: "/issues/DEMO-1" });
  });

  it("asks for a fresh state every time", async () => {
    const first = await startSignIn();
    const second = await startSignIn();
    expect(first.state).not.toBe(second.state);
  });

  it("keeps only a safe page to return to", async () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "/login", "/api/auth/logout"]) {
      const { cookie } = await startSignIn(next);
      expect((await openState(cookie, SECRET))?.next, next).toBe("/");
    }
    const bare = await loginRoute(get(`${APP}/api/auth/login`));
    expect((await openState(setCookie(bare, "jo-auth-state")?.value, SECRET))?.next).toBe("/");
  });

  it("marks the cookie Secure when the dashboard is served over https", async () => {
    stubAuthEnv({ APP_URL: "https://oversight.example.com" });
    const { response, location } = await startSignIn();
    expect(setCookie(response, "jo-auth-state")?.attributes.has("secure")).toBe(true);
    expect(location.searchParams.get("redirect_uri")).toBe("https://oversight.example.com/api/auth/callback");
  });

  it("uses a stand-in for Atlassian when one is configured", async () => {
    stubAuthEnv({ ATLASSIAN_AUTH_URL: "http://127.0.0.1:3409" });
    const { location } = await startSignIn();
    expect(`${location.origin}${location.pathname}`).toBe("http://127.0.0.1:3409/authorize");
  });

  it("goes straight on when sign-in is off, and to /login when it is not set up", async () => {
    vi.stubEnv("AUTH_MODE", "off");
    const off = await loginRoute(get(`${APP}/api/auth/login?next=%2Ffindings`));
    expect(off.status).toBe(303);
    expect(off.headers.get("location")).toBe("/findings");
    expect(setCookie(off, "jo-auth-state")).toBeUndefined();

    stubAuthEnv({ AUTH_SECRET: "too-short" });
    const unconfigured = await loginRoute(get(`${APP}/api/auth/login`));
    expect(unconfigured.headers.get("location")).toBe("/login");
    expect(setCookie(unconfigured, "jo-auth-state")).toBeUndefined();
  });
});

describe("GET /api/auth/callback", () => {
  it("trades the code, asks who signed in, and starts a session", async () => {
    const upstream = stubAtlassian();
    const response = await signIn("/findings?severity=breach");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/findings?severity=breach`);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const [token, me, resources] = [TOKEN_URL, ME_URL, RESOURCES_URL].map((url) => upstream.mock.calls.find(([input]) => String(input) === url));
    const boards = upstream.mock.calls.find(([input]) => String(input).startsWith(`${PROJECT_SEARCH_URL}?`));
    // The code, who signed in, the sites, and which of the dashboard's boards the account can open.
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(token?.[1]?.method).toBe("POST");
    expect(new Headers(token?.[1]?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(token?.[1]?.body))).toEqual({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: CODE,
      redirect_uri: `${APP}/api/auth/callback`,
    });
    for (const call of [me, resources, boards]) {
      expect(call?.[1]?.method ?? "GET").toBe("GET");
      expect(new Headers(call?.[1]?.headers).get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    }
    for (const [, init] of upstream.mock.calls) {
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("sets a twelve-hour, HttpOnly, SameSite=Lax session cookie holding the display name, and no email or token", async () => {
    stubAtlassian();
    const response = await signIn();
    const cookie = setCookie(response, "jo-session");
    expect(cookie?.attributes.get("httponly")).toBe("");
    expect(cookie?.attributes.get("samesite")?.toLowerCase()).toBe("lax");
    expect(cookie?.attributes.get("path")).toBe("/");
    expect(cookie?.attributes.get("max-age")).toBe("43200");
    expect(cookie?.attributes.has("secure")).toBe(false);

    const session = await openSession(cookie?.value, ADMITTED);
    expect(session).toMatchObject({ v: 2, sub: ACCOUNT, dom: "stellainternational.com", site: CLOUD_ID, boards: ["DEMO"] });
    expect(session && session.exp - session.iat).toBe(43_200);
    // The display name, for the access log to name this person's reads by; sealed like the rest.
    expect(session?.name).toBe(ME.name);
    const opened = await unseal(cookie?.value, SECRET, "session", SITE);
    expect(opened).toMatchObject({ sub: ACCOUNT, name: ME.name });
    expect(cookie?.value).not.toContain(ME.name.split(" ")[0]);
    const payload = JSON.stringify(opened);
    for (const secret of [ME.email, "reviewer", ME.picture, ACCESS_TOKEN, CODE]) expect(payload).not.toContain(secret);
  });

  it("keeps no display name that holds an email address, and signs in all the same", async () => {
    stubAtlassian({ me: { ...ME, name: "reviewer@stellainternational.com" } });
    const response = await signIn();
    const session = await openSession(setCookie(response, "jo-session")?.value, ADMITTED);
    expect(session).toMatchObject({ sub: ACCOUNT });
    expect(session && "name" in session).toBe(false);
  });

  it("never lets the access token out of the request", async () => {
    stubAtlassian();
    const response = await signIn();
    const visible = JSON.stringify([...response.headers.entries()]) + (await response.text());
    expect(visible).not.toContain(ACCESS_TOKEN);
    expect(visible).not.toContain(CLIENT_SECRET);
    expect(logged()).not.toContain(ACCESS_TOKEN);
  });

  it("spends the state: whatever happens, the state cookie is cleared", async () => {
    stubAtlassian();
    for (const response of [await signIn(), await returnFromAtlassian({ code: CODE, state: "wrong" }, "")]) {
      const cleared = setCookie(response, "jo-auth-state");
      expect(cleared?.value).toBe("");
      expect(cleared?.attributes.get("max-age")).toBe("0");
      expect(cleared?.attributes.get("path")).toBe("/api/auth");
    }
  });

  it("marks the session Secure when the dashboard is served over https", async () => {
    stubAuthEnv({ APP_URL: "https://oversight.example.com" });
    stubAtlassian();
    const response = await signIn("/ask");
    expect(response.headers.get("location")).toBe("https://oversight.example.com/ask");
    expect(setCookie(response, "jo-session")?.attributes.has("secure")).toBe(true);
  });

  it("refuses a return it cannot match to this browser: no state cookie, another state, an expired one", async () => {
    const upstream = stubAtlassian();
    const flow = await startSignIn();
    const expired = await sealState({ state: flow.state, next: "/" }, SECRET, Date.now() - 11 * 60 * 1000);
    const other = await startSignIn();
    const attempts = [
      returnFromAtlassian({ code: CODE, state: flow.state }, ""),
      returnFromAtlassian({ code: CODE }, flow.cookie),
      returnFromAtlassian({ code: CODE, state: "" }, flow.cookie),
      returnFromAtlassian({ code: CODE, state: flow.state.slice(0, -1) }, flow.cookie),
      returnFromAtlassian({ code: CODE, state: `${flow.state}x` }, flow.cookie),
      returnFromAtlassian({ code: CODE, state: other.state }, flow.cookie),
      returnFromAtlassian({ code: CODE, state: flow.state }, expired),
      returnFromAtlassian({ code: CODE, state: flow.state }, "v1.not-a-sealed-value"),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${APP}/login?error=state`);
      expect(setCookie(response, "jo-session")).toBeUndefined();
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(logLines().every((line) => line.event === "auth.failed" && line.reason === "state")).toBe(true);
  });

  it("takes Cancel on Atlassian's consent screen calmly", async () => {
    const upstream = stubAtlassian();
    const flow = await startSignIn();
    const response = await returnFromAtlassian({ error: "access_denied", error_description: "User did not authorize the request", state: flow.state }, flow.cookie);
    expect(response.headers.get("location")).toBe(`${APP}/login?error=denied`);
    expect(upstream).not.toHaveBeenCalled();
    const other = await returnFromAtlassian({ error: "server_error", state: flow.state }, flow.cookie);
    expect(other.headers.get("location")).toBe(`${APP}/login?error=atlassian`);
  });

  it("refuses a return with no code, or a code no one issues", async () => {
    const upstream = stubAtlassian();
    const flow = await startSignIn();
    for (const code of [undefined, "", "x".repeat(5000)]) {
      const query: Record<string, string> = { state: flow.state };
      if (code !== undefined) query.code = code;
      const response = await returnFromAtlassian(query, flow.cookie);
      expect(response.headers.get("location")).toBe(`${APP}/login?error=atlassian`);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("reports a token Atlassian will not give, logging the status and nothing it said", async () => {
    stubAtlassian({ token: new Response(JSON.stringify({ error: "invalid_grant", error_description: `bad code ${CODE}` }), { status: 403 }) });
    const response = await signIn();
    expect(response.headers.get("location")).toBe(`${APP}/login?error=atlassian`);
    expect(setCookie(response, "jo-session")).toBeUndefined();
    expect(logLines()).toEqual([{ event: "auth.failed", reason: "atlassian", step: "token", status: 403, at: expect.any(String) }]);
    expect(logged()).not.toContain(CODE);
    expect(logged()).not.toContain(CLIENT_SECRET);
    expect(logged()).not.toContain("invalid_grant");
  });

  it("reports a token answer it cannot read", async () => {
    for (const token of [{ token_type: "Bearer" }, { access_token: "" }, "<html>gateway</html>", [ACCESS_TOKEN]]) {
      stubAtlassian({ token });
      const response = await signIn();
      expect(response.headers.get("location"), JSON.stringify(token)).toBe(`${APP}/login?error=atlassian`);
    }
  });

  it("gives up on Atlassian after ten seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    stubAtlassian({ token: new DOMException("The operation was aborted due to timeout", "TimeoutError") });
    const response = await signIn();
    expect(response.headers.get("location")).toBe(`${APP}/login?error=timeout`);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it("gives up when Atlassian never answers at all", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    // Like fetch: settles only when its signal aborts (at once, if it already has).
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) reject(signal.reason);
            else signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      ),
    );
    const response = await signIn();
    expect(response.headers.get("location")).toBe(`${APP}/login?error=timeout`);
  });

  it("reports Atlassian out of reach", async () => {
    stubAtlassian({ token: new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND auth.atlassian.com") }) });
    const response = await signIn();
    expect(response.headers.get("location")).toBe(`${APP}/login?error=unreachable`);
    expect(logged()).not.toContain("ENOTFOUND");
  });

  it("reports a profile or site list it cannot get or read", async () => {
    const cases: [Parameters<typeof stubAtlassian>[0], string][] = [
      [{ me: new Response("{}", { status: 401 }) }, "atlassian"],
      [{ me: { email: "reviewer@stellainternational.com" } }, "atlassian"],
      [{ me: "not json" }, "atlassian"],
      [{ me: new DOMException("timed out", "TimeoutError") }, "timeout"],
      [{ resources: new Response("[]", { status: 500 }) }, "atlassian"],
      [{ resources: { sites: RESOURCES } }, "atlassian"],
      [{ resources: new TypeError("fetch failed") }, "unreachable"],
    ];
    for (const [answers, error] of cases) {
      stubAtlassian(answers);
      const response = await signIn();
      expect(response.headers.get("location"), JSON.stringify(answers)).toBe(`${APP}/login?error=${error}`);
      expect(setCookie(response, "jo-session")).toBeUndefined();
    }
  });

  describe("the rules", () => {
    async function rejected(answers: Parameters<typeof stubAtlassian>[0], reason: string) {
      stubAtlassian(answers);
      const response = await signIn();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${APP}/no-access?reason=${reason}`);
      // No session starts, and any earlier one in this browser ends.
      const session = setCookie(response, "jo-session");
      expect(session?.value).toBe("");
      expect(session?.attributes.get("max-age")).toBe("0");
      const lines = logLines();
      expect(lines).toHaveLength(1);
      return lines[0];
    }

    it("turns away a domain not on the list, and logs it once with the domain and a keyed hash of the account only", async () => {
      const line = await rejected({ me: { ...ME, email: "Visitor@Outsider.Example" } }, "domain");
      expect(line).toEqual({ event: "auth.rejected", reason: "domain", domain: "outsider.example", account_hash: ACCOUNT_HASH, at: expect.any(String) });
      expect(Number.isNaN(Date.parse(String(line.at)))).toBe(false);
      const text = logged();
      // Never the raw Atlassian account id (the Jira accountId), nor any part of its unique half.
      for (const secret of [ACCOUNT, ACCOUNT.split(":")[1], "Visitor@Outsider.Example", "visitor@outsider.example", "Visitor", ACCESS_TOKEN, CODE, CLIENT_SECRET]) {
        expect(text).not.toContain(secret);
      }
    });

    it("hashes the account with a key of its own: stable, unreadable without AUTH_SECRET, and not the email hash", () => {
      expect(ACCOUNT_HASH).toMatch(/^[\w-]{43}$/);
      expect(accountHash(ACCOUNT, SECRET)).toBe(ACCOUNT_HASH);
      expect(accountHash(ACCOUNT, `${SECRET}-rotated`)).not.toBe(ACCOUNT_HASH);
      expect(accountHash(`${ACCOUNT}2`, SECRET)).not.toBe(ACCOUNT_HASH);
      expect(ACCOUNT_HASH).not.toBe(emailHash(ACCOUNT, SECRET));
    });

    it("matches the domain exactly: a subdomain or a look-alike is not the domain", async () => {
      for (const email of ["a@mail.stellainternational.com", "a@stellainternational.com.evil.example", "a@evilstellainternational.com", "stellainternational.com@outsider.example"]) {
        warn.mockClear();
        const line = await rejected({ me: { ...ME, email } }, "domain");
        expect(line.reason, email).toBe("domain");
      }
    });

    it("reads the domain after the last @, in any case", async () => {
      stubAtlassian({ me: { ...ME, email: '"odd@local"@StellaInternational.COM' } });
      const response = await signIn();
      expect(response.headers.get("location")).toBe(`${APP}/findings?severity=breach`);
    });

    it("turns away an account Atlassian shares no email address for", async () => {
      for (const email of [undefined, null, "", "   ", "no-at-sign", "@stellainternational.com", "someone@"]) {
        warn.mockClear();
        const line = await rejected({ me: { ...ME, email } }, "email");
        expect(line, String(email)).toEqual({ event: "auth.rejected", reason: "email", domain: null, account_hash: ACCOUNT_HASH, at: expect.any(String) });
      }
    });

    it("turns away an address Atlassian marks unverified, and anything but a plain yes or no answer", async () => {
      for (const verified of [false, "false", 0, "no"]) {
        warn.mockClear();
        const line = await rejected({ me: { ...ME, email_verified: verified } }, "unverified");
        expect(line.domain, String(verified)).toBe("stellainternational.com");
      }
    });

    it("lets in an address whose verification Atlassian does not mention", async () => {
      const { email_verified: _omitted, ...withoutVerified } = ME;
      for (const me of [withoutVerified, { ...ME, email_verified: null }]) {
        stubAtlassian({ me });
        const response = await signIn("/");
        expect(response.headers.get("location")).toBe(`${APP}/`);
        expect(setCookie(response, "jo-session")?.value).toMatch(/^v1\./);
      }
    });

    it("turns away an account that cannot reach the Jira site", async () => {
      await rejected({ resources: [RESOURCES[0]] }, "site");
      warn.mockClear();
      await rejected({ resources: [] }, "site");
      warn.mockClear();
      await rejected({ resources: [{ id: CLOUD_ID, url: "https://example.atlassian.net.evil.example" }] }, "site");
    });

    it("finds the site however Atlassian writes its address", async () => {
      stubAtlassian({ resources: [{ id: CLOUD_ID, url: "HTTPS://Example.Atlassian.net/", scopes: [] }] });
      const response = await signIn();
      expect(await openSession(setCookie(response, "jo-session")?.value, ADMITTED)).toMatchObject({ site: CLOUD_ID });
    });

    it("applies the rules in order: email, then verification, then domain, then site", async () => {
      expect((await rejected({ me: { ...ME, email: null, email_verified: false }, resources: [] }, "email")).reason).toBe("email");
      warn.mockClear();
      expect((await rejected({ me: { ...ME, email: "a@outsider.example", email_verified: false }, resources: [] }, "unverified")).reason).toBe("unverified");
      warn.mockClear();
      expect((await rejected({ me: { ...ME, email: "a@outsider.example" }, resources: [] }, "domain")).reason).toBe("domain");
    });
  });

  it("goes back to a safe page only", async () => {
    stubAtlassian();
    const response = await signIn("//evil.example/steal");
    expect(response.headers.get("location")).toBe(`${APP}/`);
  });

  it("does nothing when sign-in is off, and sends people to /login when it is not set up", async () => {
    const upstream = stubAtlassian();
    vi.stubEnv("AUTH_MODE", "off");
    expect((await callbackRoute(get(`${APP}/api/auth/callback?code=x&state=y`))).headers.get("location")).toBe("/");
    stubAuthEnv({ ALLOWED_EMAIL_DOMAINS: " , " });
    expect((await callbackRoute(get(`${APP}/api/auth/callback?code=x&state=y`))).headers.get("location")).toBe("/login");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("fails closed on a fault of its own, logging only the fault's name", async () => {
    stubAtlassian();
    const flow = await startSignIn();
    // Atlassian has answered; sealing the session is what breaks.
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValue(new Error(`broken while holding ${ACCESS_TOKEN}`));
    const response = await returnFromAtlassian({ code: CODE, state: flow.state }, flow.cookie);
    expect(response.headers.get("location")).toBe(`${APP}/login?error=internal`);
    expect(setCookie(response, "jo-session")).toBeUndefined();
    expect(setCookie(response, "jo-auth-state")?.attributes.get("max-age")).toBe("0");
    expect(logLines()).toEqual([{ event: "auth.failed", reason: "internal", step: "internal", at: expect.any(String) }]);
    expect(error).toHaveBeenCalledWith("sign-in callback failed", "Error");
    expect(logged()).not.toContain(ACCESS_TOKEN);
  });
});

describe("GET /api/auth/callback: the boards a person may read (JO-03)", () => {
  /** Three boards on the live service, its default in the middle of the list. Made-up keys: no client's boards. */
  const SERVICE_BOARDS = {
    default: "BRAVO",
    projects: [
      { key: "ALPHA", name: "Alpha", issues: 120, last_synced_at: "2026-11-10T10:00:00Z", synced: true, type: "software" },
      { key: "BRAVO", name: "Bravo", issues: 640, last_synced_at: "2026-11-10T10:00:00Z", synced: true, type: "software" },
      { key: "CHARLIE", name: "Charlie", issues: 0, last_synced_at: null, synced: false, type: "service_desk" },
    ],
  };

  function onLiveData() {
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", SERVICE_URL);
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key-never-to-be-seen");
  }

  const searched = (upstream: ReturnType<typeof stubAtlassian>) =>
    upstream.mock.calls.filter(([input]) => String(input).startsWith(`${PROJECT_SEARCH_URL}?`)).map(([input]) => new URL(String(input)));

  async function boardsOf(response: Response) {
    return (await openSession(setCookie(response, "jo-session")?.value, ADMITTED))?.boards;
  }

  /** Signs in with `picked` in this browser's board cookie (none when null). */
  async function signInPicking(picked: string | null) {
    const flow = await startSignIn();
    const cookies: Record<string, string> = { "jo-auth-state": flow.cookie };
    if (picked !== null) cookies["jo-board"] = picked;
    return callbackRoute(get(`${APP}/api/auth/callback?${new URLSearchParams({ code: CODE, state: flow.state })}`, cookies));
  }

  it("asks Jira, as the person, which of the dashboard's boards they can open, and keeps those in the session", async () => {
    const upstream = stubAtlassian();
    const response = await signIn();
    const [search] = searched(upstream);
    // Every board the sample serves, the one not synced yet too; Jira opens DEMO alone for this person.
    expect(search.searchParams.getAll("keys")).toEqual(["DEMO", "MOB", "HELP"]);
    expect(search.searchParams.get("maxResults")).toBe("50");
    expect(await boardsOf(response)).toEqual(["DEMO"]);
  });

  it("on live data, reads the boards from the oversight service and keeps the ones Jira opens, default first", async () => {
    onLiveData();
    const upstream = stubAtlassian({
      service: SERVICE_BOARDS,
      projects: { ...PROJECTS, values: [{ id: "1", key: "CHARLIE" }, { id: "2", key: "bravo" }] },
    });
    const response = await signIn();
    expect(response.headers.get("location")).toBe(`${APP}/findings?severity=breach`);
    expect(searched(upstream)[0].searchParams.getAll("keys")).toEqual(["BRAVO", "ALPHA", "CHARLIE"]);
    const service = upstream.mock.calls.find(([input]) => String(input) === SERVICE_PROJECTS_URL);
    expect(new Headers(service?.[1]?.headers).get("x-service-key")).toBe("svc-key-never-to-be-seen");
    expect(await boardsOf(response)).toEqual(["BRAVO", "CHARLIE"]);
  });

  it("turns away an account whose Jira opens none of the boards, and logs it once", async () => {
    stubAtlassian({ projects: { ...PROJECTS, total: 0, values: [] } });
    const response = await signIn();
    expect(response.headers.get("location")).toBe(`${APP}/no-access?reason=boards`);
    expect(setCookie(response, "jo-session")?.attributes.get("max-age")).toBe("0");
    expect(logLines()).toEqual([
      { event: "auth.rejected", reason: "boards", domain: "stellainternational.com", account_hash: ACCOUNT_HASH, at: expect.any(String) },
    ]);
  });

  it("lets in only keys Jira listed and the dashboard serves, whatever else Jira sends", async () => {
    stubAtlassian({ projects: { ...PROJECTS, values: [{ key: "OTHER" }, { name: "no key" }, "junk", { key: 42 }, null] } });
    expect((await signIn()).headers.get("location")).toBe(`${APP}/no-access?reason=boards`);
  });

  it("sends the person to /login when the oversight service cannot say which boards it covers", async () => {
    onLiveData();
    for (const service of [new TypeError("fetch failed"), new Response("{}", { status: 503 }), { default: "BRAVO", projects: [] }]) {
      warn.mockClear();
      stubAtlassian({ service });
      const response = await signIn();
      expect(response.headers.get("location")).toBe(`${APP}/login?error=service`);
      expect(setCookie(response, "jo-session")).toBeUndefined();
      expect(logLines()).toEqual([{ event: "auth.failed", reason: "service", step: "boards", at: expect.any(String) }]);
    }
    expect(logged()).not.toContain("svc-key-never-to-be-seen");
  });

  it("reports a board check Jira refuses, cannot answer in time, or answers with something it cannot read", async () => {
    const cases: [unknown, string][] = [
      [new Response(JSON.stringify({ errorMessages: [`token ${ACCESS_TOKEN} is bad`] }), { status: 403 }), "atlassian"],
      [{ values: "not a list" }, "atlassian"],
      [new DOMException("The operation was aborted due to timeout", "TimeoutError"), "timeout"],
      [new TypeError("fetch failed"), "unreachable"],
    ];
    for (const [projects, reason] of cases) {
      warn.mockClear();
      stubAtlassian({ projects });
      const response = await signIn();
      expect(response.headers.get("location")).toBe(`${APP}/login?error=${reason}`);
      expect(logLines().at(-1)).toMatchObject({ event: "auth.failed", reason, step: "projects" });
    }
    expect(logged()).not.toContain(ACCESS_TOKEN);
  });

  it("keeps a hash of the email address, never the address, so ADMIN_EMAILS can be checked on every request", async () => {
    stubAtlassian();
    const session = await openSession(setCookie(await signIn(), "jo-session")?.value, ADMITTED);
    expect(session?.eh).toBe(emailHash(ME.email, SECRET));
    expect(JSON.stringify(session)).not.toContain("reviewer");
  });

  it("lets an admin in even when their Jira opens none of the boards: an admin reads every board", async () => {
    stubAuthEnv({ ADMIN_EMAILS: "Reviewer@StellaInternational.com" });
    stubAtlassian({ projects: { ...PROJECTS, total: 0, values: [] } });
    const response = await signIn();
    expect(response.headers.get("location")).toBe(`${APP}/findings?severity=breach`);
    expect(await boardsOf(response)).toEqual([]);
    expect(logLines()).toEqual([]);
  });

  it("lands an admin on the Portfolio when the sign-in was going nowhere in particular, and anyone else on the Overview", async () => {
    stubAuthEnv({ ADMIN_EMAILS: "reviewer@stellainternational.com" });
    stubAtlassian();
    expect((await signIn("/")).headers.get("location")).toBe(`${APP}/portfolio`);
    stubAtlassian();
    expect((await signIn("/people")).headers.get("location")).toBe(`${APP}/people`);
    vi.stubEnv("ADMIN_EMAILS", "someone.else@stellainternational.com");
    stubAtlassian();
    expect((await signIn("/")).headers.get("location")).toBe(`${APP}/`);
  });

  it("never makes an admin of an address Atlassian does not say is verified", async () => {
    stubAuthEnv({ ADMIN_EMAILS: "reviewer@stellainternational.com" });
    const { email_verified: _verified, ...unstated } = ME;
    stubAtlassian({ me: unstated, projects: { ...PROJECTS, total: 0, values: [] } });
    // A user then, and one whose Jira opens no board: turned away.
    expect((await signIn()).headers.get("location")).toBe(`${APP}/no-access?reason=boards`);
    stubAtlassian({ me: unstated });
    const session = await openSession(setCookie(await signIn(), "jo-session")?.value, ADMITTED);
    expect(session?.eh).not.toBe(emailHash(ME.email, SECRET));
  });

  it("does not let a look-alike letter turn another domain into an allowed one", async () => {
    stubAuthEnv({ ALLOWED_EMAIL_DOMAINS: "kelvin.example" });
    stubAtlassian({ me: { ...ME, email: "reader@\u212Aelvin.example" } });
    expect((await signIn()).headers.get("location")).toBe(`${APP}/no-access?reason=domain`);
  });

  it("starts a session that opens when the service lists a board twice", async () => {
    onLiveData();
    stubAtlassian({
      service: { ...SERVICE_BOARDS, projects: [...SERVICE_BOARDS.projects, SERVICE_BOARDS.projects[1]] },
      projects: { ...PROJECTS, values: [{ id: "2", key: "BRAVO" }] },
    });
    expect(await boardsOf(await signIn())).toEqual(["BRAVO"]);
  });

  it("with ACCESS_MODE unset (everyone-admin, JO-16), lets everyone on an allowed domain in as an admin", async () => {
    stubAuthEnv({ ACCESS_MODE: "" });
    // Their Jira opens no board: an admin reads every board all the same, and lands on the Portfolio.
    stubAtlassian({ projects: { ...PROJECTS, total: 0, values: [] } });
    const response = await signIn("/");
    expect(response.headers.get("location")).toBe(`${APP}/portfolio`);
    expect(await boardsOf(response)).toEqual([]);
    expect(logLines()).toEqual([]);
    // Any board picked in this browser is kept, as an admin's is.
    stubAtlassian();
    expect(setCookie(await signInPicking("CHARLIE"), "jo-board")).toBeUndefined();
    // Sign-in itself is unchanged: only an address on an allowed domain gets in.
    stubAtlassian({ me: { ...ME, email: "reviewer@elsewhere.example" } });
    expect((await signIn()).headers.get("location")).toBe(`${APP}/no-access?reason=domain`);
  });

  it("keeps an admin's board pick, whichever board it is", async () => {
    stubAuthEnv({ ADMIN_EMAILS: "reviewer@stellainternational.com" });
    stubAtlassian();
    expect(setCookie(await signInPicking("CHARLIE"), "jo-board")).toBeUndefined();
  });

  it("forgets a board picked in this browser that the person cannot open, and keeps one they can", async () => {
    stubAtlassian();
    const forgotten = setCookie(await signInPicking("CHARLIE"), "jo-board");
    expect(forgotten?.value).toBe("");
    expect(forgotten?.attributes.get("max-age")).toBe("0");
    expect(forgotten?.attributes.get("path")).toBe("/");
    stubAtlassian();
    expect(setCookie(await signInPicking("DEMO"), "jo-board")).toBeUndefined();
    stubAtlassian();
    expect(setCookie(await signInPicking(null), "jo-board")).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  function post(headers: Record<string, string> = {}) {
    return logoutRoute(new NextRequest(`${APP}/api/auth/logout`, { method: "POST", headers: { cookie: "jo-session=v1.anything", ...headers } }));
  }

  it("clears the session and goes to /login, saying so", async () => {
    const origins: Record<string, string>[] = [{ origin: APP }, {}];
    for (const headers of origins) {
      const response = await post(headers);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${APP}/login?signed_out=1`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const cleared = setCookie(response, "jo-session");
      expect(cleared?.value).toBe("");
      expect(cleared?.attributes.get("max-age")).toBe("0");
      expect(cleared?.attributes.get("path")).toBe("/");
      expect(cleared?.attributes.get("httponly")).toBe("");
    }
  });

  it("refuses a sign-out posted from another site", async () => {
    for (const origin of ["https://evil.example", "http://localhost:3401", "https://localhost:3400", "null", "http://127.0.0.1:3400"]) {
      const response = await post({ origin });
      expect(response.status, origin).toBe(403);
      expect(setCookie(response, "jo-session"), origin).toBeUndefined();
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toMatchObject({ error: "forbidden" });
    }
  });

  it("clears a Secure cookie when the dashboard is served over https", async () => {
    stubAuthEnv({ APP_URL: "https://oversight.example.com" });
    const response = await post({ origin: "https://oversight.example.com" });
    expect(setCookie(response, "jo-session")?.attributes.has("secure")).toBe(true);
    expect(response.headers.get("location")).toBe("https://oversight.example.com/login?signed_out=1");
  });

  it("still clears an old cookie when sign-in is off", async () => {
    vi.stubEnv("AUTH_MODE", "off");
    const response = await post();
    expect(response.headers.get("location")).toBe("/login?signed_out=1");
    expect(setCookie(response, "jo-session")?.attributes.get("max-age")).toBe("0");
  });

  it("answers POST only, so no link or image can sign anyone out", () => {
    expect(Object.keys(logoutModule).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
    expect(Object.keys(loginModule).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["GET"]);
  });
});
