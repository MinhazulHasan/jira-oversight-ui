// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEAVE_GUARD_MS,
  LOGIN_ERRORS,
  NO_ACCESS_REASONS,
  loginError,
  loginPagePath,
  noAccessReason,
  safeNextPath,
  sendToSignIn,
  signInPath,
} from "../sign-in";

/*
 * Where someone may be sent after signing in: a path on this dashboard, and
 * nothing that a browser could read as another site, whatever the encoding.
 */

describe("safeNextPath", () => {
  it("keeps a path on this dashboard, with its query", () => {
    for (const path of [
      "/",
      "/findings",
      "/findings?severity=breach&rule=R-FLOW-02",
      "/issues/DEMO-12",
      "/ask?q=where%20do%20tickets%20stall",
      "/findings?q=a%2Fb%3Fc",
      "/insights?from=//not-a-host",
      "/process/",
      "/.well-known-ish",
      "/design",
      "/apis",
      "/logins",
      "/ask?q=%E2%9C%93%20done",
    ]) {
      expect(safeNextPath(path), path).toBe(path);
    }
  });

  it("drops the fragment, which never reaches a server, and a bare question mark", () => {
    expect(safeNextPath("/findings#rule-R-FLOW-02")).toBe("/findings");
    expect(safeNextPath("/findings?severity=breach#top")).toBe("/findings?severity=breach");
    expect(safeNextPath("/findings?")).toBe("/findings");
    expect(safeNextPath("/#//evil.example")).toBe("/");
  });

  const vectors = [
    // Not a path at all.
    "",
    "findings",
    "evil.example",
    "https://evil.example",
    "http://evil.example/findings",
    "HTTPS://evil.example",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "mailto:someone@evil.example",
    "?next=/findings",
    "#/findings",
    // Protocol-relative, every way a browser reads it.
    "//evil.example",
    "///evil.example",
    "////evil.example",
    "//evil.example/%2F..",
    "/\\evil.example",
    "\\\\evil.example",
    "\\/evil.example",
    "/\\/evil.example",
    "//\\evil.example",
    // Percent-encoded slashes and backslashes.
    "/%2Fevil.example",
    "/%2fevil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%5cevil.example",
    "/%5C%5Cevil.example",
    "/%2F/evil.example",
    // Whitespace and control characters, raw or encoded.
    " /findings",
    "/findings ",
    "\t//evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r\n/evil.example",
    "/%09/evil.example",
    "/%0a/evil.example",
    "/%0D%0ALocation:%20https://evil.example",
    "/%20/evil.example",
    "/findings%00",
    "/\u0000/evil.example",
    "/ /evil.example",
    "/ /evil.example",
    "/　/evil.example",
    // Look-alike slashes, and any path that is not plain ASCII once decoded (every page's is).
    "/／/evil.example",
    "/%EF%BC%8F%EF%BC%8Fevil.example",
    "/∕evil.example",
    "/%E2%9C%93",
    // Dot segments, raw and encoded.
    "/..",
    "/../evil.example",
    "/..//evil.example",
    "/./findings",
    "/findings/..",
    "/a/../../evil",
    "/%2e%2e/evil.example",
    "/%2E%2E%2F%2E%2E%2Fevil",
    "/.%2e/evil.example",
    "/%2e/findings",
    // Broken encodings.
    "/%",
    "/%zz",
    "/%E0%A4%A",
    // Back to the sign-in pages, the API or the build.
    "/login",
    "/login?next=/findings",
    "/login/",
    "/LOGIN",
    "/Login?x=1",
    "/%6Cogin",
    "/login;jsessionid=1",
    "/no-access",
    "/no-access?reason=domain",
    "/api",
    "/api/auth/login",
    "/api/auth/callback?code=x&state=y",
    "/api/auth/logout",
    "/API/oversight/health",
    "/%61pi/auth/login",
    "/api/oversight/health",
    "/_next/static/chunks/main.js",
    // Too long to be a real page.
    `/findings?q=${"a".repeat(2100)}`,
  ];

  it.each(vectors.map((vector) => [JSON.stringify(vector), vector]))("refuses %s", (_label, vector) => {
    expect(safeNextPath(vector)).toBe("/");
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 42, ["/findings"], { path: "/findings" }, new URL("https://evil.example")]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });

  it("never returns anything a browser would resolve off this origin", () => {
    const base = "https://oversight.example.com";
    for (const vector of vectors) {
      expect(new URL(safeNextPath(vector), base).origin, vector).toBe(base);
    }
  });
});

describe("sign-in addresses", () => {
  it("carry the page to return to, encoded, and nothing for the overview", () => {
    expect(loginPagePath("/findings?severity=breach")).toBe("/login?next=%2Ffindings%3Fseverity%3Dbreach");
    expect(loginPagePath("/")).toBe("/login");
    expect(loginPagePath()).toBe("/login");
    expect(loginPagePath("//evil.example")).toBe("/login");
    expect(signInPath("/issues/DEMO-1")).toBe("/api/auth/login?next=%2Fissues%2FDEMO-1");
    expect(signInPath(null)).toBe("/api/auth/login");
  });

  it("read the codes the pages are opened with, and nothing else", () => {
    expect(LOGIN_ERRORS).toEqual(["denied", "state", "atlassian", "timeout", "unreachable", "service", "internal"]);
    expect(NO_ACCESS_REASONS).toEqual(["email", "unverified", "domain", "site", "boards"]);
    for (const code of LOGIN_ERRORS) expect(loginError(code)).toBe(code);
    for (const reason of NO_ACCESS_REASONS) expect(noAccessReason(reason)).toBe(reason);
    for (const junk of [null, undefined, "", "DENIED", "denied ", "<script>", "constructor", "toString"]) {
      expect(loginError(junk)).toBeNull();
      expect(noAccessReason(junk)).toBeNull();
    }
  });
});

describe("sendToSignIn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A tab: its address, and (unless `storage` is null, as in a window that blocks it) its session storage. */
  function stubWindow(pathname: string, search = "", storage: Map<string, string> | null = new Map()) {
    const replace = vi.fn();
    const sessionStorage = storage && {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    };
    vi.stubGlobal("window", { location: { pathname, search, replace }, sessionStorage });
    return replace;
  }

  it("goes to sign in and back to this page, once however many queries find out", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-10T09:00:00Z") });
    const replace = stubWindow("/findings", "?severity=breach");
    expect(sendToSignIn()).toBe(true);
    expect(sendToSignIn()).toBe(false);
    expect(sendToSignIn()).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/login?next=%2Ffindings%3Fseverity%3Dbreach");
    // Should the browser stay (a navigation cancelled), a later failure tries again.
    vi.advanceTimersByTime(LEAVE_GUARD_MS + 1_000);
    expect(sendToSignIn()).toBe(true);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("does not go round again from the next page when it left a moment ago", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-12T09:00:00Z") });
    const tab = new Map<string, string>();
    const first = stubWindow("/findings", "", tab);
    expect(sendToSignIn()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);

    // The sign-in page sent the browser straight back and the new page met the same refusal. A fresh page
    // load (a fresh module) still knows, through the tab's session storage, and stays to show its error.
    vi.resetModules();
    const fresh = await import("@/lib/sign-in");
    vi.advanceTimersByTime(2_000);
    const second = stubWindow("/findings", "", tab);
    expect(fresh.sendToSignIn()).toBe(false);
    expect(second).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LEAVE_GUARD_MS);
    expect(fresh.sendToSignIn()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("still leaves once, and only once, where session storage is blocked", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-13T09:00:00Z") });
    const replace = stubWindow("/insights", "", null);
    expect(sendToSignIn()).toBe(true);
    expect(sendToSignIn()).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("never sends the sign-in pages to themselves", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-11T09:00:00Z") });
    for (const page of ["/login", "/no-access"]) {
      const replace = stubWindow(page, "?next=%2Ffindings");
      expect(sendToSignIn()).toBe(false);
      expect(replace, page).not.toHaveBeenCalled();
    }
  });

  it("does nothing on the server", () => {
    expect(sendToSignIn()).toBe(false);
  });
});
