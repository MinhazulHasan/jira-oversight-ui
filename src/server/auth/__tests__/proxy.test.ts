// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { apiErrorBodySchema } from "@/lib/api/schemas";
import { config, proxy } from "@/proxy";

import { sealSession } from "../cookies";
import { seal } from "../seal";

import { SECRET, SESSION_KEYS, SITE, stubAuthEnv } from "./fixtures";

/*
 * src/proxy.ts: the sign-in gate in front of every page and API call, and the
 * Content Security Policy on every page, as before. The gate reads the path
 * and the session cookie only, so no header, prefix or encoding gets a
 * request past it.
 */

const ORIGIN = "http://localhost:3400";
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };
const NONCE_POLICY = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/;

function request(path: string, init: { headers?: Record<string, string>; session?: string; method?: string } = {}): NextRequest {
  const headers: Record<string, string> = { ...init.headers };
  if (init.session !== undefined) headers.cookie = `jo-session=${init.session}`;
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers });
}

/** NextResponse.next() or a rewrite: the request goes on to the page or route. */
function wentThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1" || response.headers.has("x-middleware-rewrite");
}

function policyOf(response: Response): string | null {
  return response.headers.get("content-security-policy");
}

async function expectSentToLogin(response: Response, location: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(location);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(wentThrough(response)).toBe(false);
}

async function expectUnauthenticated(response: Response) {
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe("unauthenticated");
  expect(body.message.length).toBeGreaterThan(0);
  expect(wentThrough(response)).toBe(false);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with sign-in off", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "off");
  });

  it("lets every request through", async () => {
    for (const path of ["/", "/findings?severity=breach", "/login", "/api/oversight/health", "/api/auth/logout", "/design"]) {
      expect(wentThrough(await proxy(request(path))), path).toBe(true);
    }
  });

  it("sets the policy on pages exactly as before: a fresh nonce, in the response and handed on to the render", async () => {
    const first = await proxy(request("/findings"));
    const second = await proxy(request("/findings"));
    const policy = policyOf(first) ?? "";
    const nonce = NONCE_POLICY.exec(policy)?.[1];
    expect(nonce).toBeDefined();
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("upgrade-insecure-requests");
    expect(policyOf(second)).not.toBe(policy);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(first.headers.get("x-middleware-override-headers")?.split(",")).toEqual(
      expect.arrayContaining(["x-nonce", "content-security-policy"]),
    );
    expect(policyOf(await proxy(request("/", { headers: { "x-forwarded-proto": "https" } })))).toContain("upgrade-insecure-requests");
  });

  it("still sends an issue address that cannot be a key to the real 404", async () => {
    const response = await proxy(request("/issues/not-a-key"));
    expect(new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/_no-such-page");
    expect(policyOf(response)).toMatch(NONCE_POLICY);
    expect(response.headers.has("x-middleware-rewrite")).toBe(true);
    expect((await proxy(request("/issues/DEMO-12"))).headers.has("x-middleware-rewrite")).toBe(false);
  });

  it("does no policy work for the API or for the browser's own prefetch (Purpose: prefetch)", async () => {
    // Router prefetches are not among these. Next.js strips Next-Router-Prefetch (and its other router headers)
    // before the proxy sees a request, so in a real server a router prefetch looks like a navigation: it goes
    // through the gate, as it must, and gets a nonce and a policy of its own like any page request. Neither
    // does anything there, since a prefetch's answer is not HTML. (The old matcher skipped them altogether.)
    for (const response of [
      await proxy(request("/api/oversight/health")),
      await proxy(request("/api/auth/login")),
      await proxy(request("/findings", { headers: { purpose: "prefetch" } })),
    ]) {
      expect(wentThrough(response)).toBe(true);
      expect(policyOf(response)).toBeNull();
      expect(response.headers.has("x-middleware-request-x-nonce")).toBe(false);
    }
  });
});

describe("with sign-in on", () => {
  beforeEach(() => {
    stubAuthEnv();
  });

  it("sends a page without a session to /login, to come back afterwards", async () => {
    await expectSentToLogin(await proxy(request("/findings?severity=breach&rule=R-FLOW-02")), `${ORIGIN}/login?next=%2Ffindings%3Fseverity%3Dbreach%26rule%3DR-FLOW-02`);
    await expectSentToLogin(await proxy(request("/")), `${ORIGIN}/login`);
    await expectSentToLogin(await proxy(request("/issues/DEMO-1")), `${ORIGIN}/login?next=%2Fissues%2FDEMO-1`);
    await expectSentToLogin(await proxy(request("/design")), `${ORIGIN}/login?next=%2Fdesign`);
    await expectSentToLogin(await proxy(request("/issues/not-a-key")), `${ORIGIN}/login?next=%2Fissues%2Fnot-a-key`);
  });

  it("answers the API without a session with the error shape and 401", async () => {
    await expectUnauthenticated(await proxy(request("/api/oversight/health")));
    await expectUnauthenticated(await proxy(request("/api/oversight/findings?severity=breach")));
    await expectUnauthenticated(await proxy(request("/api/oversight/ask", { method: "POST" })));
    await expectUnauthenticated(await proxy(request("/api/oversight/refresh", { method: "POST" })));
    await expectUnauthenticated(await proxy(request("/api/anything-else")));
  });

  it("lets no header talk its way past: prefetch, RSC, data or anything else", async () => {
    const tricks: Record<string, string>[] = [
      { rsc: "1" },
      { "next-router-prefetch": "1" },
      { "next-router-prefetch": "1", rsc: "1", "next-router-segment-prefetch": "/_tree" },
      { "next-router-state-tree": "%5B%22%22%5D", rsc: "1" },
      { purpose: "prefetch" },
      { "sec-purpose": "prefetch;prerender" },
      { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" },
      { "x-middleware-subrequest": "src/proxy:src/proxy:src/proxy:src/proxy:src/proxy" },
      { "x-nextjs-data": "1" },
      { "next-action": "abc123" },
      { "x-invoke-path": "/login", "x-matched-path": "/login" },
      { authorization: "Bearer anything", "x-service-key": "anything" },
      { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", "x-original-url": "/login", "x-rewrite-url": "/login" },
      { cookie: "jo-session=; jo-auth-state=v1.x; session=admin" },
    ];
    for (const headers of tricks) {
      const label = JSON.stringify(headers);
      const page = await proxy(request("/findings", { headers }));
      expect(page.status, label).toBe(303);
      expect(page.headers.get("location"), label).toBe(`${ORIGIN}/login?next=%2Ffindings`);
      const api = await proxy(request("/api/oversight/overview", { headers }));
      expect(api.status, label).toBe(401);
    }
  });

  it("redirects from APP_URL, never from the request's Host or forwarded headers", async () => {
    stubAuthEnv({ APP_URL: "https://oversight.example.com" });
    const response = await proxy(
      request("/findings", { headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" } }),
    );
    expect(response.headers.get("location")).toBe("https://oversight.example.com/login?next=%2Ffindings");
  });

  it("leaves the sign-in pages and routes open, with the policy on the pages", async () => {
    for (const path of ["/login", "/login?next=%2Ffindings&error=state", "/no-access?reason=domain"]) {
      const response = await proxy(request(path));
      expect(wentThrough(response), path).toBe(true);
      expect(policyOf(response), path).toMatch(NONCE_POLICY);
    }
    for (const path of ["/api/auth/login?next=%2Ffindings", "/api/auth/callback?code=x&state=y"]) {
      const response = await proxy(request(path));
      expect(wentThrough(response), path).toBe(true);
      expect(policyOf(response), path).toBeNull();
    }
    expect(wentThrough(await proxy(request("/api/auth/logout", { method: "POST" })))).toBe(true);
  });

  it("gates every address that is not exactly a public one", async () => {
    for (const path of ["/login/extra", "/LOGIN", "/Login", "/no-access/x", "/%6Cogin", "/login.html", "/login;x", "/api", "/no-accessx"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(303);
      expect(response.headers.get("location"), path).toMatch(/^http:\/\/localhost:3400\/login(\?next=.*)?$/);
    }
    for (const path of ["/api/auth", "/api/auth/", "/api/auth/other", "/api/auth/login/x", "/api/auth/callbackx", "/api/oversight", "/api/%61uth/login"]) {
      expect((await proxy(request(path))).status, path).toBe(401);
    }
  });

  it("never sends anyone back to a sign-in page or off the dashboard after signing in", async () => {
    // The page asked for is a sign-in page or not a path: /login carries no next.
    await expectSentToLogin(await proxy(request("/login/extra")), `${ORIGIN}/login`);
    await expectSentToLogin(await proxy(request("/no-access/x?reason=domain")), `${ORIGIN}/login`);
  });

  it("lets a valid session through, with the policy on pages and none on the API", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const page = await proxy(request("/findings?severity=breach", { session }));
    expect(wentThrough(page)).toBe(true);
    expect(policyOf(page)).toMatch(NONCE_POLICY);
    const api = await proxy(request("/api/oversight/health", { session }));
    expect(wentThrough(api)).toBe(true);
    expect(policyOf(api)).toBeNull();
    const malformedIssue = await proxy(request("/issues/not-a-key", { session }));
    expect(new URL(malformedIssue.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/_no-such-page");
  });

  it("treats a tampered, expired, foreign or malformed cookie as signed out", async () => {
    const good = await sealSession(IDENTITY, SESSION_KEYS);
    const flipped = good.slice(0, 10) + (good[10] === "A" ? "B" : "A") + good.slice(11);
    const cookies = [
      flipped,
      await sealSession(IDENTITY, SESSION_KEYS, Date.now() - 13 * 60 * 60 * 1000),
      await sealSession(IDENTITY, { ...SESSION_KEYS, secret: "another-secret-of-forty-eight-characters-987654" }),
      await sealSession(IDENTITY, { ...SESSION_KEYS, jiraSite: "https://a-different-site.atlassian.net" }),
      await seal({ v: 1, ...IDENTITY, iat: 0, exp: 4_102_444_800 }, SECRET, "session", SITE),
      await seal({ v: 1, state: "x", next: "/", exp: 4_102_444_800 }, SECRET, "state"),
      "",
      "v1.",
      "admin",
      "true",
      "%00",
      `${good}x`,
    ];
    for (const session of cookies) {
      const label = session.slice(0, 24);
      expect((await proxy(request("/findings", { session }))).status, label).toBe(303);
      expect((await proxy(request("/api/oversight/health", { session }))).status, label).toBe(401);
    }
  });

  it("signs out a domain as soon as it is taken off the list", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    stubAuthEnv({ ALLOWED_EMAIL_DOMAINS: "example.org" });
    expect((await proxy(request("/findings", { session }))).status).toBe(303);
  });

  it("signs everyone out when AUTH_SECRET changes", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    stubAuthEnv({ AUTH_SECRET: "a-new-secret-after-rotation-0123456789abcdefgh" });
    expect((await proxy(request("/findings", { session }))).status).toBe(303);
  });

  it("signs everyone out when OVERSIGHT_JIRA_BASE_URL changes", async () => {
    // Signed in against one site; the same server, secret and domains, now pointed at another site.
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    expect(wentThrough(await proxy(request("/findings", { session })))).toBe(true);
    stubAuthEnv({ OVERSIGHT_JIRA_BASE_URL: "https://a-different-site.atlassian.net" });
    expect((await proxy(request("/findings", { session }))).status).toBe(303);
    expect((await proxy(request("/api/oversight/overview", { session }))).status).toBe(401);
    // The site is compared in its normalised form, so writing the same address differently changes nothing.
    stubAuthEnv({ OVERSIGHT_JIRA_BASE_URL: "HTTPS://Example.Atlassian.net/" });
    expect(wentThrough(await proxy(request("/findings", { session })))).toBe(true);
  });

  it("reads two cookies of the same name as the oversight route does: the last one counts", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const both = (cookie: string) => request("/api/oversight/health", { headers: { cookie } });
    expect(wentThrough(await proxy(both(`jo-session=garbage; jo-session=${session}`)))).toBe(true);
    expect((await proxy(both(`jo-session=${session}; jo-session=garbage`))).status).toBe(401);
  });

  it("fails closed when sign-in is on but not set up: pages to /login, the API a 500 naming the variable", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    stubAuthEnv({ APP_URL: "" });
    await expectSentToLogin(await proxy(request("/findings", { session })), `${ORIGIN}/login?next=%2Ffindings`);
    const api = await proxy(request("/api/oversight/health", { session }));
    expect(api.status).toBe(500);
    const body = apiErrorBodySchema.parse(await api.json());
    expect(body).toEqual({ error: "not_configured", message: "Signing in with Atlassian needs APP_URL, which is not set." });

    stubAuthEnv({ ALLOWED_EMAIL_DOMAINS: "*" });
    const wildcard = await proxy(request("/api/oversight/health", { session }));
    const text = await wildcard.text();
    expect(wildcard.status).toBe(500);
    expect(text).toContain("ALLOWED_EMAIL_DOMAINS");
    expect(text).not.toContain(SECRET);
    // The sign-in page itself stays open, to say what is wrong.
    expect(wentThrough(await proxy(request("/login")))).toBe(true);
  });

  it("is on by default for live data, and closed until it is set up", async () => {
    vi.stubEnv("AUTH_MODE", "");
    vi.stubEnv("OVERSIGHT_DATA", "live");
    for (const name of ["APP_URL", "ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET", "AUTH_SECRET", "ALLOWED_EMAIL_DOMAINS", "OVERSIGHT_JIRA_BASE_URL"]) {
      vi.stubEnv(name, "");
    }
    expect((await proxy(request("/findings"))).status).toBe(303);
    expect((await proxy(request("/api/oversight/health"))).status).toBe(500);
    vi.stubEnv("OVERSIGHT_DATA", "sample");
    expect(wentThrough(await proxy(request("/findings")))).toBe(true);
  });
});

describe("the matcher", () => {
  async function matches(url: string, headers: Record<string, string> = {}): Promise<boolean> {
    // Next.js's matcher helper expects the AsyncLocalStorage a Next server installs.
    (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
    const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
    return unstable_doesMiddlewareMatch({ config, url, headers });
  }

  it("runs the proxy for pages, their RSC and prefetch requests, and the whole API", async () => {
    for (const url of ["/", "/findings?severity=breach", "/login", "/no-access", "/design", "/issues/DEMO-1", "/findings.rsc", "/api/oversight/health", "/api/auth/login", "/api"]) {
      expect(await matches(url), url).toBe(true);
    }
    const prefetches: Record<string, string>[] = [{ "next-router-prefetch": "1", rsc: "1" }, { purpose: "prefetch" }, { rsc: "1", "next-router-state-tree": "x" }];
    for (const headers of prefetches) {
      expect(await matches("/findings", headers), JSON.stringify(headers)).toBe(true);
      expect(await matches("/api/oversight/overview", headers), JSON.stringify(headers)).toBe(true);
    }
  });

  it("skips only the build's static files, image optimisation and the icons, by exact name", async () => {
    for (const url of ["/_next/static/chunks/main.js", "/_next/static/css/app.css", "/_next/static/media/inter.woff2", "/_next/image?url=%2Fa.png&w=64", "/favicon.ico", "/icon.svg", "/icon.svg?v=1", "/apple-icon.png"]) {
      expect(await matches(url), url).toBe(false);
    }
    for (const url of ["/_next/staticx", "/_next/image/x", "/favicon.ico/x", "/faviconXico", "/icon.svgx", "/iconXsvg", "/apple-icon.pngx", "/apple-iconXpng", "/%5Fnext/static/x.js", "/%61pi/oversight/health"]) {
      expect(await matches(url), url).toBe(true);
    }
  });
});
