// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PROJECT_KEY_PATTERN } from "@/lib/api/schemas";

vi.mock("server-only", () => ({}));

import { BOARD_KEY_PATTERN, MAX_SESSION_BOARDS, SESSION_TTL_S, STATE_TTL_S, openSession, openState, sealSession, sealState } from "../cookies";
import { fromBase64Url, randomToken, seal, toBase64Url, unseal } from "../seal";

import { SECRET, SESSION_KEYS, SITE } from "./fixtures";

/*
 * Sealed cookies: what one server seals, only that server opens, for the one
 * purpose it was sealed for, unchanged and in time. Everything else is
 * "signed out", never an error.
 */

const OTHER_SECRET = "another-secret-of-forty-eight-characters-987654";
const NOW = Date.parse("2026-11-10T09:00:00Z");
const ADMITTED = { ...SESSION_KEYS, allowedDomains: ["stellainternational.com"] };
const OTHER_SITE = "https://a-different-site.atlassian.net";
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };

/** `sealed` with one bit of its body flipped at `index` (counted from the end when negative). */
function flipBit(sealed: string, index: number): string {
  const bytes = fromBase64Url(sealed.slice(3));
  if (!bytes) throw new Error("not sealed");
  const at = index < 0 ? bytes.length + index : index;
  bytes[at] ^= 0x01;
  return `v1.${toBase64Url(bytes)}`;
}

describe("seal and unseal", () => {
  it("round-trips what it sealed", async () => {
    const payload = { v: 1, list: [1, "two", null], nested: { ok: true }, text: "émigré ✓" };
    expect(await unseal(await seal(payload, SECRET, "session"), SECRET, "session")).toEqual(payload);
  });

  it("is base64url behind a version, with a fresh IV every time", async () => {
    const first = await seal({ same: true }, SECRET, "session");
    const second = await seal({ same: true }, SECRET, "session");
    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
    expect(first.slice(3, 19)).not.toBe(second.slice(3, 19));
    // The payload is encrypted, not merely encoded.
    expect(Buffer.from(fromBase64Url(first.slice(3)) ?? []).toString("latin1")).not.toContain("same");
  });

  it("opens nothing tampered with, anywhere: IV, ciphertext or tag", async () => {
    const sealed = await seal({ sub: "a" }, SECRET, "session");
    for (const index of [0, 11, 12, 13, -17, -1]) {
      expect(await unseal(flipBit(sealed, index), SECRET, "session"), String(index)).toBeNull();
    }
  });

  it("opens nothing sealed under another secret or for another purpose", async () => {
    const sealed = await seal({ sub: "a" }, SECRET, "session");
    expect(await unseal(sealed, OTHER_SECRET, "session")).toBeNull();
    expect(await unseal(sealed, SECRET, "state")).toBeNull();
    expect(await unseal(await seal({ state: "x" }, SECRET, "state"), SECRET, "session")).toBeNull();
  });

  it("opens a value bound to a context only with that same context", async () => {
    const bound = await seal({ sub: "a" }, SECRET, "session", SITE);
    expect(await unseal(bound, SECRET, "session", SITE)).toEqual({ sub: "a" });
    expect(await unseal(bound, SECRET, "session", OTHER_SITE)).toBeNull();
    expect(await unseal(bound, SECRET, "session")).toBeNull();
    expect(await unseal(await seal({ sub: "a" }, SECRET, "session"), SECRET, "session", SITE)).toBeNull();
  });

  it("treats anything malformed as nothing, without throwing", async () => {
    const sealed = await seal({ sub: "a" }, SECRET, "session");
    const body = sealed.slice(3);
    const malformed = [
      undefined,
      null,
      "",
      "v1.",
      "v1",
      body,
      `v2.${body}`,
      `V1.${body}`,
      `v1.${body}=`,
      `v1.${body}!`,
      `v1.${body.slice(0, -4)}`,
      `v1.${body}AAAA`,
      // Standard base64's alphabet and padding are not base64url.
      `v1.+${body.slice(1)}`,
      `v1./${body.slice(1)}`,
      `v1.${"A".repeat(37)}`,
      `v1.${"A".repeat(5000)}`,
      "v1.%%%%",
      "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.",
      JSON.stringify({ sub: "a" }),
    ];
    for (const value of malformed) {
      await expect(unseal(value, SECRET, "session"), String(value).slice(0, 40)).resolves.toBeNull();
    }
  });

  it("refuses a second spelling of the same bytes", async () => {
    // 12 bytes of IV, 12 of payload ({"sub":"ab"}) and 16 of tag: 40 bytes, not a multiple of three, so the
    // last of the 54 characters carries four spare bits. Flipping one spells the same bytes another way.
    const sealed = await seal({ sub: "ab" }, SECRET, "session");
    const body = sealed.slice(3);
    expect(body.length % 4).not.toBe(0);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(body[body.length - 1]);
    const twin = body.slice(0, -1) + alphabet[last ^ 1];
    expect(fromBase64Url(twin)).toBeNull();
    expect(await unseal(`v1.${twin}`, SECRET, "session")).toBeNull();
    expect(await unseal(sealed, SECRET, "session")).toEqual({ sub: "ab" });
  });

  it("makes random states that are unguessable and safe in a URL", () => {
    const states = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(states.size).toBe(50);
    for (const state of states) expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("the session cookie", () => {
  it("opens with exactly the identity it was given, for twelve hours", async () => {
    const value = await sealSession(IDENTITY, SESSION_KEYS, NOW);
    const session = await openSession(value, ADMITTED, NOW + 1000);
    const iat = Math.floor(NOW / 1000);
    expect(session).toEqual({ v: 2, ...IDENTITY, iat, exp: iat + 12 * 60 * 60 });
    expect(SESSION_TTL_S).toBe(43_200);
  });

  it("holds no email address, no name and no token: an account id, a domain, an email hash, a site and board keys", async () => {
    const payload = await unseal(await sealSession(IDENTITY, SESSION_KEYS, NOW), SECRET, "session", SITE);
    expect(Object.keys(payload as object).sort()).toEqual(["boards", "dom", "eh", "exp", "iat", "site", "sub", "v"]);
    expect((payload as { boards: unknown }).boards).toEqual(["DEMO"]);
  });

  it("keeps the boards in the order given, a copy of them", async () => {
    const boards = ["AIL", "LEADRSDRE", "LEADRSCOMS"];
    const value = await sealSession({ ...IDENTITY, boards }, SESSION_KEYS, NOW);
    boards.push("CHANGED");
    expect((await openSession(value, ADMITTED, NOW))?.boards).toEqual(["AIL", "LEADRSDRE", "LEADRSCOMS"]);
  });

  it("reads a session from before boards were kept as signed out, so its holder signs in once more", async () => {
    const iat = Math.floor(NOW / 1000);
    const { boards: _boards, ...v1 } = IDENTITY;
    expect(await openSession(await seal({ v: 1, ...v1, iat, exp: iat + 60 }, SECRET, "session", SITE), ADMITTED, NOW)).toBeNull();
  });

  it("holds no boards only for an admin whose Jira opens none, and opens all the same", async () => {
    expect((await openSession(await sealSession({ ...IDENTITY, boards: [] }, SESSION_KEYS, NOW), ADMITTED, NOW))?.boards).toEqual([]);
  });

  it("refuses to seal what it would refuse to open, so a bad session fails at sign-in, not after it", async () => {
    for (const identity of [
      { ...IDENTITY, boards: ["DEMO", "DEMO"] },
      { ...IDENTITY, boards: ["demo"] },
      { ...IDENTITY, eh: "short" },
      { ...IDENTITY, sub: "" },
    ]) {
      await expect(sealSession(identity, SESSION_KEYS, NOW), JSON.stringify(identity)).rejects.toThrow();
    }
  });

  it("checks board keys as the API contract writes them", () => {
    expect(BOARD_KEY_PATTERN.source).toBe(PROJECT_KEY_PATTERN.source);
    expect(BOARD_KEY_PATTERN.flags).toBe(PROJECT_KEY_PATTERN.flags);
  });

  it("ends twelve hours after signing in, however busy the person is", async () => {
    const value = await sealSession(IDENTITY, SESSION_KEYS, NOW);
    expect(await openSession(value, ADMITTED, NOW + SESSION_TTL_S * 1000 - 1000)).not.toBeNull();
    expect(await openSession(value, ADMITTED, NOW + SESSION_TTL_S * 1000)).toBeNull();
    expect(await openSession(value, ADMITTED, NOW + 30 * 24 * 3600 * 1000)).toBeNull();
  });

  it("opens nothing with a wrong key, a wrong purpose or no value", async () => {
    const value = await sealSession(IDENTITY, SESSION_KEYS, NOW);
    expect(await openSession(value, { ...ADMITTED, secret: OTHER_SECRET }, NOW)).toBeNull();
    expect(await openSession(await sealState({ state: "s", next: "/" }, SECRET, NOW), ADMITTED, NOW)).toBeNull();
    expect(await openSession(undefined, ADMITTED, NOW)).toBeNull();
    expect(await openSession("", ADMITTED, NOW)).toBeNull();
    expect(await openSession("garbage", ADMITTED, NOW)).toBeNull();
  });

  it("signs out a domain as soon as it is taken off the list", async () => {
    const value = await sealSession(IDENTITY, SESSION_KEYS, NOW);
    expect(await openSession(value, { ...ADMITTED, allowedDomains: ["example.org"] }, NOW)).toBeNull();
  });

  it("signs everyone out when the dashboard is pointed at another Jira site", async () => {
    const value = await sealSession(IDENTITY, SESSION_KEYS, NOW);
    expect(await openSession(value, ADMITTED, NOW)).not.toBeNull();
    // Same secret, same domains, another OVERSIGHT_JIRA_BASE_URL: the session was checked against the old site only.
    expect(await openSession(value, { ...ADMITTED, jiraSite: OTHER_SITE }, NOW)).toBeNull();
    // And a session sealed for the other site does not open here.
    expect(await openSession(await sealSession(IDENTITY, { ...SESSION_KEYS, jiraSite: OTHER_SITE }, NOW), ADMITTED, NOW)).toBeNull();
  });

  it("refuses payloads this server would never have sealed, even under its own key and site", async () => {
    const iat = Math.floor(NOW / 1000);
    // The well-formed payload opens, so each refusal below is the payload's own doing.
    expect(await openSession(await seal({ v: 2, ...IDENTITY, iat, exp: iat + 60 }, SECRET, "session", SITE), ADMITTED, NOW)).not.toBeNull();
    const forged = [
      { v: 3, ...IDENTITY, iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, sub: "", iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, dom: undefined, iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, site: 42, iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, iat: "now", exp: iat + 60 },
      { v: 2, ...IDENTITY, iat, exp: iat + 60.5 },
      // Lasting longer than twelve hours, or issued in the future.
      { v: 2, ...IDENTITY, iat, exp: iat + SESSION_TTL_S + 1 },
      { v: 2, ...IDENTITY, iat: iat + 3600, exp: iat + 7200 },
      // The email hash: missing, or not one ./roles.ts could have written.
      { v: 2, ...IDENTITY, eh: undefined, iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, eh: "short", iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, eh: "reviewer@stellainternational.com".padEnd(43, "x"), iat, exp: iat + 60 },
      // Boards: missing, not a list, not keys, repeated, or more than any dashboard serves.
      { v: 2, ...IDENTITY, boards: undefined, iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, boards: "DEMO", iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, boards: ["demo"], iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, boards: ["DEMO", 7], iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, boards: ["DEMO", "DEMO"], iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, boards: ["AIL OR 1=1"], iat, exp: iat + 60 },
      { v: 2, ...IDENTITY, boards: Array.from({ length: MAX_SESSION_BOARDS + 1 }, (_, i) => `B${i + 10}`), iat, exp: iat + 60 },
      "a string",
      [IDENTITY],
      null,
    ];
    for (const payload of forged) {
      expect(await openSession(await seal(payload, SECRET, "session", SITE), ADMITTED, NOW), JSON.stringify(payload)).toBeNull();
    }
  });
});

describe("the sign-in state cookie", () => {
  it("carries the state and a safe page to return to, for ten minutes", async () => {
    const value = await sealState({ state: "abc", next: "/findings?severity=breach" }, SECRET, NOW);
    expect(await openState(value, SECRET, NOW + 60_000)).toEqual({
      v: 1,
      state: "abc",
      next: "/findings?severity=breach",
      exp: Math.floor(NOW / 1000) + STATE_TTL_S,
    });
    expect(await openState(value, SECRET, NOW + STATE_TTL_S * 1000)).toBeNull();
    expect(await openState(value, OTHER_SECRET, NOW)).toBeNull();
  });

  it("never carries a page that leaves this dashboard", async () => {
    const value = await sealState({ state: "abc", next: "//evil.example/steal" }, SECRET, NOW);
    expect((await openState(value, SECRET, NOW))?.next).toBe("/");
    // Even a state sealed with a bad page (by an older build, say) is cleaned on the way out.
    const old = await seal({ v: 1, state: "abc", next: "https://evil.example", exp: Math.floor(NOW / 1000) + 60 }, SECRET, "state");
    expect((await openState(old, SECRET, NOW))?.next).toBe("/");
  });

  it("refuses a session cookie offered as a state, and states that last too long", async () => {
    expect(await openState(await sealSession(IDENTITY, SESSION_KEYS, NOW), SECRET, NOW)).toBeNull();
    const long = await seal({ v: 1, state: "abc", next: "/", exp: Math.floor(NOW / 1000) + 24 * 3600 }, SECRET, "state");
    expect(await openState(long, SECRET, NOW)).toBeNull();
  });
});
