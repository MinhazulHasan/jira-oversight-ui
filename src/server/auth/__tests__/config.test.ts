// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConfigError } from "../../env";
import { authStatus, normaliseSiteUrl, readAuthConfig, resolveAuth } from "../config";

import { AUTH_ENV, CLIENT_SECRET, SECRET } from "./fixtures";

/*
 * Sign-in's configuration: on by default wherever the data is live, off for
 * the sample, and closed (nobody in, the variable named, never its value)
 * whenever something it needs is missing or wrong.
 */

const env = (overrides: Record<string, string | undefined> = {}) => ({ ...AUTH_ENV, ...overrides });

afterEach(() => {
  vi.unstubAllEnvs();
});

function problem(record: Record<string, string | undefined>): string {
  try {
    readAuthConfig(record);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error("expected a ConfigError");
}

describe("whether sign-in is on", () => {
  it("is off for the bundled sample and on for live data, when AUTH_MODE is not set", () => {
    expect(readAuthConfig({})).toEqual({ mode: "off" });
    expect(readAuthConfig({ OVERSIGHT_DATA: "sample" })).toEqual({ mode: "off" });
    expect(readAuthConfig({ OVERSIGHT_DATA: " Sample " })).toEqual({ mode: "off" });
    expect(readAuthConfig(env({ AUTH_MODE: "", OVERSIGHT_DATA: "live" })).mode).toBe("atlassian");
    expect(readAuthConfig(env({ AUTH_MODE: undefined, OVERSIGHT_DATA: "LIVE" })).mode).toBe("atlassian");
  });

  it("follows AUTH_MODE when it is set, in either data mode", () => {
    expect(readAuthConfig({ AUTH_MODE: "off", OVERSIGHT_DATA: "live" })).toEqual({ mode: "off" });
    expect(readAuthConfig(env({ AUTH_MODE: "atlassian", OVERSIGHT_DATA: "sample" })).mode).toBe("atlassian");
    expect(readAuthConfig(env({ AUTH_MODE: " Atlassian " })).mode).toBe("atlassian");
  });

  it("refuses any other AUTH_MODE, and an unknown data mode when it has to choose", () => {
    for (const mode of ["on", "true", "1", "yes", "basic", "atlassian,off"]) {
      expect(problem({ AUTH_MODE: mode }), mode).toMatch(/^AUTH_MODE must be "atlassian" or "off"\.$/);
    }
    expect(problem({ OVERSIGHT_DATA: "demo" })).toMatch(/OVERSIGHT_DATA/);
  });

  it("fails closed when live data is configured without sign-in's variables, naming every one missing", () => {
    expect(problem({ OVERSIGHT_DATA: "live" })).toBe(
      "Signing in with Atlassian needs APP_URL, ATLASSIAN_CLIENT_ID, ATLASSIAN_CLIENT_SECRET, AUTH_SECRET, ALLOWED_EMAIL_DOMAINS and OVERSIGHT_JIRA_BASE_URL, which are not set.",
    );
  });

  it("names each required variable when it alone is missing or blank", () => {
    for (const name of ["APP_URL", "ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET", "AUTH_SECRET", "ALLOWED_EMAIL_DOMAINS", "OVERSIGHT_JIRA_BASE_URL"]) {
      expect(problem(env({ [name]: undefined })), name).toBe(`Signing in with Atlassian needs ${name}, which is not set.`);
      expect(problem(env({ [name]: "   " })), name).toBe(`Signing in with Atlassian needs ${name}, which is not set.`);
    }
  });
});

describe("a working configuration", () => {
  it("is read into the shape the routes use", () => {
    const config = readAuthConfig(env());
    if (config.mode !== "atlassian") throw new Error("expected sign-in on");
    const { authBase, apiBase, ...rest } = config;
    expect(rest).toEqual({
      mode: "atlassian",
      appOrigin: "http://localhost:3400",
      redirectUri: "http://localhost:3400/api/auth/callback",
      secureCookies: false,
      clientId: "test-client-id",
      clientSecret: CLIENT_SECRET,
      secret: SECRET,
      allowedDomains: ["stellainternational.com", "example.org"],
      accessMode: "admin-list",
      adminEmails: [],
      jiraSite: "https://example.atlassian.net",
    });
    expect(authBase.href).toBe("https://auth.atlassian.com/");
    expect(apiBase.href).toBe("https://api.atlassian.com/");
  });

  it("builds the callback from APP_URL's origin, and seals cookies Secure over https", () => {
    const config = readAuthConfig(env({ APP_URL: "https://Oversight.Example.com/" }));
    expect(config).toMatchObject({
      appOrigin: "https://oversight.example.com",
      redirectUri: "https://oversight.example.com/api/auth/callback",
      secureCookies: true,
    });
    expect(readAuthConfig(env({ APP_URL: "http://127.0.0.1:3400" }))).toMatchObject({ appOrigin: "http://127.0.0.1:3400" });
  });

  it("reads the allowed domains in lower case, trimmed and once each", () => {
    const config = readAuthConfig(env({ ALLOWED_EMAIL_DOMAINS: " StellaInternational.COM ,, stellainternational.com,mail.example.org " }));
    expect(config.mode === "atlassian" && config.allowedDomains).toEqual(["stellainternational.com", "mail.example.org"]);
  });

  it("lets tests point at a local stand-in for Atlassian, and nowhere else over http", () => {
    const config = readAuthConfig(env({ ATLASSIAN_AUTH_URL: "http://127.0.0.1:3409/auth", ATLASSIAN_API_URL: "http://localhost:3409" }));
    expect(config.mode === "atlassian" && config.authBase.href).toBe("http://127.0.0.1:3409/auth/");
    expect(config.mode === "atlassian" && config.apiBase.href).toBe("http://localhost:3409/");
    expect(problem(env({ ATLASSIAN_AUTH_URL: "http://auth.example.com" }))).toMatch(/^ATLASSIAN_AUTH_URL must start with https:\/\//);
    expect(problem(env({ ATLASSIAN_API_URL: "ftp://api.example.com" }))).toMatch(/^ATLASSIAN_API_URL must start with https:\/\//);
    expect(problem(env({ ATLASSIAN_API_URL: "https://user:pass@api.example.com" }))).toMatch(/^ATLASSIAN_API_URL must not carry/);
  });
});

describe("failing closed", () => {
  const cases: [string, string, RegExp][] = [
    // "localhost:3400" parses, as the scheme "localhost:".
    ["APP_URL", "localhost:3400", /^APP_URL must start with https:\/\//],
    ["APP_URL", "no scheme at all", /^APP_URL is not a URL\.$/],
    ["APP_URL", "ftp://oversight.example.com", /^APP_URL must start with https:\/\//],
    ["APP_URL", "http://oversight.example.com", /^APP_URL must start with https:\/\/ \(http:\/\/ only for localhost or 127\.0\.0\.1\)\.$/],
    ["APP_URL", "http://[::1]:3400", /^APP_URL must start with https:\/\//],
    ["APP_URL", "https://oversight.example.com/dashboard", /^APP_URL must be an address with no path/],
    ["APP_URL", "https://oversight.example.com/?from=here", /^APP_URL must not carry a query or a fragment\.$/],
    ["APP_URL", "https://oversight.example.com/#top", /^APP_URL must not carry a query or a fragment\.$/],
    ["APP_URL", "https://someone:hunter2@oversight.example.com", /^APP_URL must not carry a user name or password\.$/],
    ["AUTH_SECRET", "x".repeat(31), /^AUTH_SECRET must be at least 32 characters of random\.$/],
    ["ALLOWED_EMAIL_DOMAINS", " , ,, ", /^ALLOWED_EMAIL_DOMAINS lists no domain, so nobody could sign in\.$/],
    ["ALLOWED_EMAIL_DOMAINS", "*.stellainternational.com", /^ALLOWED_EMAIL_DOMAINS must list email domains only/],
    ["ALLOWED_EMAIL_DOMAINS", "@stellainternational.com", /^ALLOWED_EMAIL_DOMAINS must list email domains only/],
    ["ALLOWED_EMAIL_DOMAINS", "someone@stellainternational.com", /^ALLOWED_EMAIL_DOMAINS must list email domains only/],
    ["ALLOWED_EMAIL_DOMAINS", "stellainternational", /^ALLOWED_EMAIL_DOMAINS must list email domains only/],
    ["ALLOWED_EMAIL_DOMAINS", "stellainternational.com; example.org", /^ALLOWED_EMAIL_DOMAINS must list email domains only/],
    ["ALLOWED_EMAIL_DOMAINS", "-bad-.example.org", /^ALLOWED_EMAIL_DOMAINS must list email domains only/],
    ["OVERSIGHT_JIRA_BASE_URL", "example.atlassian.net", /^OVERSIGHT_JIRA_BASE_URL is not a URL\.$/],
    ["OVERSIGHT_JIRA_BASE_URL", "http://example.atlassian.net", /^OVERSIGHT_JIRA_BASE_URL must start with https:\/\/\.$/],
    ["OVERSIGHT_JIRA_BASE_URL", "http://localhost:8080", /^OVERSIGHT_JIRA_BASE_URL must start with https:\/\/\.$/],
    ["OVERSIGHT_JIRA_BASE_URL", "https://example.atlassian.net/jira", /^OVERSIGHT_JIRA_BASE_URL must be an address with no path/],
  ];

  it.each(cases)("refuses %s=%s, naming the variable and never the value", (name, value, message) => {
    const text = problem(env({ [name]: value }));
    expect(text).toMatch(message);
    if (value.trim().length > 3) expect(text).not.toContain(value.trim());
  });

  it("accepts exactly 32 characters of secret", () => {
    expect(readAuthConfig(env({ AUTH_SECRET: "y".repeat(32) })).mode).toBe("atlassian");
  });

  it("never puts a secret into a message", () => {
    const messages = [
      problem(env({ AUTH_SECRET: "short-but-secret" })),
      problem(env({ APP_URL: `https://u:${CLIENT_SECRET}@oversight.example.com` })),
      problem(env({ ATLASSIAN_CLIENT_ID: undefined })),
    ];
    for (const message of messages) {
      expect(message).not.toContain("short-but-secret");
      expect(message).not.toContain(CLIENT_SECRET);
      expect(message).not.toContain(SECRET);
    }
  });
});

describe("resolving sign-in for a request", () => {
  it("reports a configuration that cannot work as unconfigured, never throwing", () => {
    expect(resolveAuth({ OVERSIGHT_DATA: "live" })).toEqual({
      mode: "unconfigured",
      problem: expect.stringMatching(/^Signing in with Atlassian needs APP_URL, /),
    });
    expect(resolveAuth({ AUTH_MODE: "maybe" })).toEqual({ mode: "unconfigured", problem: 'AUTH_MODE must be "atlassian" or "off".' });
    expect(resolveAuth({})).toEqual({ mode: "off" });
  });

  it("hands pages the mode and the problem, and nothing secret", () => {
    expect(authStatus({})).toEqual({ mode: "off" });
    expect(authStatus(env())).toEqual({ mode: "atlassian" });
    expect(authStatus(env({ APP_URL: "" }))).toEqual({ mode: "unconfigured", problem: "Signing in with Atlassian needs APP_URL, which is not set." });
    const status = JSON.stringify(authStatus(env()));
    expect(status).not.toContain(SECRET);
    expect(status).not.toContain(CLIENT_SECRET);
  });

  it("reads the environment afresh on every call", () => {
    vi.stubEnv("AUTH_MODE", "off");
    expect(authStatus().mode).toBe("off");
    vi.stubEnv("AUTH_MODE", "atlassian");
    vi.stubEnv("APP_URL", "");
    expect(authStatus().mode).toBe("unconfigured");
  });
});

describe("normaliseSiteUrl", () => {
  it("compares sites in lower case, with no trailing slash, query or fragment", () => {
    expect(normaliseSiteUrl("https://Example.Atlassian.NET/")).toBe("https://example.atlassian.net");
    expect(normaliseSiteUrl(" https://example.atlassian.net// ")).toBe("https://example.atlassian.net");
    expect(normaliseSiteUrl("https://example.atlassian.net/?x=1#y")).toBe("https://example.atlassian.net");
    expect(normaliseSiteUrl("https://example.atlassian.net/Wiki/")).toBe("https://example.atlassian.net/wiki");
    expect(normaliseSiteUrl("https://example.atlassian.net:443")).toBe("https://example.atlassian.net");
  });

  it("is null for anything that is not an http(s) address", () => {
    for (const raw of ["", "example.atlassian.net", "javascript:alert(1)", "ftp://example.atlassian.net", "//example.atlassian.net"]) {
      expect(normaliseSiteUrl(raw), raw).toBeNull();
    }
  });
});

describe("ACCESS_MODE: who is an admin (JO-16)", () => {
  const mode = (raw: string | undefined) => {
    const config = readAuthConfig(env({ ACCESS_MODE: raw }));
    return config.mode === "atlassian" ? config.accessMode : null;
  };

  it("is everyone-admin when it is not set: everyone who signs in is an admin", () => {
    expect(mode(undefined)).toBe("everyone-admin");
    expect(mode("")).toBe("everyone-admin");
    expect(mode("   ")).toBe("everyone-admin");
  });

  it("takes either mode, in any case", () => {
    expect(mode("everyone-admin")).toBe("everyone-admin");
    expect(mode(" Admin-List ")).toBe("admin-list");
  });

  it("refuses anything else, so sign-in fails closed rather than guessing who is an admin", () => {
    for (const raw of ["everyone", "admins", "list", "off", "true"]) {
      expect(problem(env({ ACCESS_MODE: raw })), raw).toBe('ACCESS_MODE must be "everyone-admin" or "admin-list".');
    }
  });
});

describe("ADMIN_EMAILS: who sees every board", () => {
  const admins = (raw: string | undefined) => {
    const config = readAuthConfig(env({ ADMIN_EMAILS: raw }));
    return config.mode === "atlassian" ? config.adminEmails : null;
  };

  it("is optional: without it there are no admins", () => {
    expect(admins(undefined)).toEqual([]);
    expect(admins("")).toEqual([]);
    expect(admins(" , ")).toEqual([]);
  });

  it("lists addresses in lower case, each once", () => {
    expect(admins(" Lead@StellaInternational.com, po@example.org ,lead@stellainternational.com")).toEqual([
      "lead@stellainternational.com",
      "po@example.org",
    ]);
  });

  it("takes email addresses only", () => {
    for (const raw of [
      "stellainternational.com",
      "lead@",
      "@stellainternational.com",
      "lead@@stellainternational.com",
      "lead name@stellainternational.com",
      "lead@*.com",
      // Not ASCII: a look-alike letter (U+212A KELVIN SIGN) that toLowerCase would fold into "k".
      "\u212Aim@stellainternational.com",
    ]) {
      expect(problem(env({ ADMIN_EMAILS: raw })), raw).toBe(
        'ADMIN_EMAILS must list email addresses only, comma-separated, for example "lead@example.com".',
      );
    }
  });

  it("takes only addresses on an allowed domain, which are the only ones that can sign in", () => {
    const message = problem(env({ ADMIN_EMAILS: "lead@stellainternational.com, outsider@elsewhere.example" }));
    expect(message).toBe("Every address in ADMIN_EMAILS must be on a domain in ALLOWED_EMAIL_DOMAINS, or it could never sign in.");
    expect(message).not.toContain("outsider");
  });
});
