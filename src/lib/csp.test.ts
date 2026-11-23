import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, createNonce } from "./csp";

const directives = (policy: string) =>
  new Map(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values] as const;
    }),
  );

describe("contentSecurityPolicy", () => {
  it("runs only nonced scripts in production, with no eval", () => {
    const policy = directives(contentSecurityPolicy("abc", { dev: false, secure: false }));
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("allows eval only in development", () => {
    const policy = directives(contentSecurityPolicy("abc", { dev: true, secure: false }));
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
  });

  it("names no third-party origin anywhere", () => {
    const policy = contentSecurityPolicy("abc", { dev: false, secure: true });
    expect(policy).not.toMatch(/https?:\/\//);
    expect(policy).not.toContain("*");
  });

  it("refuses framing, plugins and foreign form targets", () => {
    const policy = directives(contentSecurityPolicy("abc", { dev: false, secure: false }));
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
  });

  it("upgrades insecure requests only when served over https", () => {
    expect(contentSecurityPolicy("abc", { dev: false, secure: true })).toContain(
      "upgrade-insecure-requests",
    );
    expect(contentSecurityPolicy("abc", { dev: false, secure: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("createNonce", () => {
  it("is fresh every time and safe inside a header", () => {
    const first = createNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(first);
  });
});
