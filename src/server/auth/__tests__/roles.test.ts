// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { adminAtSignIn, asciiLower, askLevel, emailHash, readableBoards, roleOf, showsAdminBadge } from "../roles";
import type { Session } from "../cookies";

import { SECRET, stubAuthEnv } from "./fixtures";

/*
 * Admin and user (JO-16): with ACCESS_MODE everyone-admin, the default,
 * everyone who signs in is an admin; with admin-list, an address on
 * ADMIN_EMAILS reads every board, anyone else the boards in their session.
 * Decided on every request from a keyed hash of the address, so a change to
 * ACCESS_MODE or ADMIN_EMAILS takes effect at once.
 */

const LEAD = "lead@stellainternational.com";
const session = (email: string, boards = ["ALPHA"]): Session => ({
  v: 2,
  sub: "557058:account",
  dom: "stellainternational.com",
  site: "cloud-id",
  eh: emailHash(email, SECRET),
  boards,
  iat: 1,
  exp: 2,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the email hash", () => {
  it("is the same for an address however it is written, and differs from address to address", () => {
    expect(emailHash(" Lead@StellaInternational.COM ", SECRET)).toBe(emailHash(LEAD, SECRET));
    expect(emailHash("po@stellainternational.com", SECRET)).not.toBe(emailHash(LEAD, SECRET));
    expect(emailHash(LEAD, SECRET)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("folds case for A to Z only: a look-alike letter is another address", () => {
    // U+212A KELVIN SIGN lower-cases to "k" in JavaScript: it must not pass for an admin spelled with "k".
    expect(emailHash("\u212Aim@stellainternational.com", SECRET)).not.toBe(emailHash("kim@stellainternational.com", SECRET));
    expect(asciiLower(" MiXeD@Example.ORG ")).toBe("mixed@example.org");
    expect(asciiLower("\u212Aim")).toBe("\u212Aim");
  });

  it("depends on AUTH_SECRET, so it means nothing without it", () => {
    expect(emailHash(LEAD, "another-secret-of-forty-eight-characters-987654")).not.toBe(emailHash(LEAD, SECRET));
    expect(emailHash(LEAD, SECRET)).not.toContain("lead");
  });
});

describe("the level of access", () => {
  it("with admin-list, is admin for an address on ADMIN_EMAILS, user for any other", () => {
    const list = { accessMode: "admin-list", secret: SECRET } as const;
    expect(roleOf(session(LEAD), { ...list, adminEmails: [LEAD] })).toBe("admin");
    expect(roleOf(session("dev@stellainternational.com"), { ...list, adminEmails: [LEAD] })).toBe("user");
    expect(roleOf(session(LEAD), { ...list, adminEmails: [] })).toBe("user");
  });

  it("with everyone-admin, is admin for everyone, whatever ADMIN_EMAILS says", () => {
    const everyone = { accessMode: "everyone-admin", secret: SECRET } as const;
    expect(roleOf(session(LEAD), { ...everyone, adminEmails: [LEAD] })).toBe("admin");
    expect(roleOf(session("dev@stellainternational.com"), { ...everyone, adminEmails: [LEAD] })).toBe("admin");
    expect(roleOf(session("dev@stellainternational.com"), { ...everyone, adminEmails: [] })).toBe("admin");
  });

  it("follows ADMIN_EMAILS as it is now, both ways, without signing in again", () => {
    stubAuthEnv({ ADMIN_EMAILS: LEAD });
    expect(readableBoards(session(LEAD))).toBeNull();
    expect(readableBoards(session("dev@stellainternational.com"))).toEqual(["ALPHA"]);
    stubAuthEnv({ ADMIN_EMAILS: "" });
    expect(readableBoards(session(LEAD))).toEqual(["ALPHA"]);
    stubAuthEnv({ ADMIN_EMAILS: "dev@stellainternational.com" });
    expect(readableBoards(session("dev@stellainternational.com"))).toBeNull();
  });

  it("leaves every board open when sign-in is off", () => {
    expect(readableBoards(null)).toBeNull();
  });
});

describe("the level Ask answers at", () => {
  it("is people for an admin and team for anyone else, by ADMIN_EMAILS as it is now", () => {
    stubAuthEnv({ ADMIN_EMAILS: LEAD });
    expect(askLevel(session(LEAD))).toBe("people");
    expect(askLevel(session("dev@stellainternational.com"))).toBe("team");
    stubAuthEnv({ ADMIN_EMAILS: "" });
    expect(askLevel(session(LEAD))).toBe("team");
    stubAuthEnv({ ADMIN_EMAILS: "dev@stellainternational.com" });
    expect(askLevel(session("dev@stellainternational.com"))).toBe("people");
  });

  it("is people with sign-in off, where every board is read already", () => {
    vi.stubEnv("AUTH_MODE", "off");
    expect(askLevel(null)).toBe("people");
  });

  it("is team for anything it cannot place: no session with sign-in on, or sign-in set up wrongly", () => {
    stubAuthEnv({ ADMIN_EMAILS: LEAD });
    expect(askLevel(null)).toBe("team");
    stubAuthEnv({ ADMIN_EMAILS: LEAD, AUTH_SECRET: "far-too-short" });
    expect(askLevel(session(LEAD))).toBe("team");
  });
});

describe("everyone who signs in is an admin, by default (JO-16)", () => {
  it("reads every board and asks at people level when ACCESS_MODE is unset or everyone-admin", () => {
    for (const mode of ["", "everyone-admin", " Everyone-Admin "]) {
      stubAuthEnv({ ACCESS_MODE: mode, ADMIN_EMAILS: LEAD });
      expect(readableBoards(session("dev@stellainternational.com")), mode).toBeNull();
      expect(askLevel(session("dev@stellainternational.com")), mode).toBe("people");
      expect(readableBoards(session(LEAD)), mode).toBeNull();
    }
  });

  it("switches back to ADMIN_EMAILS with admin-list, at once, without signing in again", () => {
    stubAuthEnv({ ACCESS_MODE: "admin-list", ADMIN_EMAILS: LEAD });
    expect(readableBoards(session("dev@stellainternational.com"))).toEqual(["ALPHA"]);
    expect(askLevel(session("dev@stellainternational.com"))).toBe("team");
    stubAuthEnv({ ACCESS_MODE: "everyone-admin", ADMIN_EMAILS: LEAD });
    expect(readableBoards(session("dev@stellainternational.com"))).toBeNull();
  });

  it("reads nobody's level from an ACCESS_MODE it does not know: sign-in is not set up, and the level is team", () => {
    stubAuthEnv({ ACCESS_MODE: "everyone" });
    expect(askLevel(session(LEAD))).toBe("team");
  });

  it("makes everyone an admin at sign-in, and with admin-list only a verified address on the list", () => {
    const everyone = { accessMode: "everyone-admin", adminEmails: [] } as const;
    const list = { accessMode: "admin-list", adminEmails: [LEAD] } as const;
    expect(adminAtSignIn("dev@stellainternational.com", true, everyone)).toBe(true);
    expect(adminAtSignIn("dev@stellainternational.com", false, everyone)).toBe(true);
    expect(adminAtSignIn(" Lead@StellaInternational.com", true, list)).toBe(true);
    expect(adminAtSignIn(LEAD, false, list)).toBe(false);
    expect(adminAtSignIn("dev@stellainternational.com", true, list)).toBe(false);
  });

  it("shows the Admin badge only with admin-list, where it tells an admin apart", () => {
    expect(showsAdminBadge("admin", { accessMode: "admin-list" })).toBe(true);
    expect(showsAdminBadge("user", { accessMode: "admin-list" })).toBe(false);
    expect(showsAdminBadge("admin", { accessMode: "everyone-admin" })).toBe(false);
    expect(showsAdminBadge(null, { accessMode: "admin-list" })).toBe(false);
  });
});
