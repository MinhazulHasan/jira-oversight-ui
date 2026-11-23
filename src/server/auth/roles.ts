import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import type { AskLevel } from "@/lib/api/schemas";

import { resolveAuth, type AtlassianAuthConfig } from "./config";
import type { Session } from "./cookies";

/*
 * Two levels of access, decided here and nowhere else.
 *
 *   admin  reads every board the dashboard covers, whatever their Jira allows,
 *          and sees people level: Ask about people, the People page, person
 *          cards, and Governance (the access log, usage, rule settings).
 *   user   reads only the boards their Jira account can open (the boards in
 *          their session, from sign-in), at team level.
 *
 * Who is which is ACCESS_MODE's (JO-16, the product owner's decision of 17 Nov
 * 2026): "everyone-admin", the default, makes an admin of everyone who signs
 * in (sign-in itself still admits only ALLOWED_EMAIL_DOMAINS); "admin-list"
 * makes admins of the addresses on ADMIN_EMAILS alone, and everyone else a
 * user, as before. The code for both stays; every caller goes through here.
 *
 * A session never holds the email address, only a keyed hash of it (eh). So
 * the level is decided on every request against ACCESS_MODE and ADMIN_EMAILS
 * as they are now: a change takes effect at once, without signing in again.
 */

export type Role = "admin" | "user";

const KEY_LENGTH = 32;
const keys = new Map<string, Buffer>();

/** The hashing key, derived from AUTH_SECRET for this one purpose. */
function hashKey(secret: string): Buffer {
  let key = keys.get(secret);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "jira-oversight", "email-hash", KEY_LENGTH));
    keys.set(secret, key);
  }
  return key;
}

/**
 * Lower case for A to Z only. JavaScript's toLowerCase folds some other letters
 * into ASCII (the Kelvin sign into "k"), which would let a different mailbox
 * pass for an admin's or for an allowed domain.
 */
export function asciiLower(text: string): string {
  return text.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** An email address's keyed hash, as a session keeps it. ASCII case and surrounding space do not count. */
export function emailHash(email: string, secret: string): string {
  return createHmac("sha256", hashKey(secret)).update(asciiLower(email)).digest("base64url");
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

type RoleConfig = Pick<AtlassianAuthConfig, "accessMode" | "adminEmails" | "secret">;

/** The level of access of the person behind this session, by ACCESS_MODE and ADMIN_EMAILS as they are now. */
export function roleOf(session: Pick<Session, "eh">, config: RoleConfig): Role {
  if (config.accessMode === "everyone-admin") return "admin";
  return config.adminEmails.some((email) => same(emailHash(email, config.secret), session.eh)) ? "admin" : "user";
}

/**
 * Whether the person signing in is an admin, before they have a session:
 * everyone with everyone-admin; with admin-list, an address on ADMIN_EMAILS
 * that Atlassian says is verified (an unverified one could be anyone's).
 * `email` is folded as asciiLower folds it.
 */
export function adminAtSignIn(email: string, verified: boolean, config: Pick<AtlassianAuthConfig, "accessMode" | "adminEmails">): boolean {
  if (config.accessMode === "everyone-admin") return true;
  return verified && config.adminEmails.includes(asciiLower(email));
}

/**
 * Whether the top bar says "Admin": only with admin-list, where it tells an
 * admin apart from the users. With everyone-admin everyone is one, so it
 * would tell nobody anything.
 */
export function showsAdminBadge(role: Role | null, config: Pick<AtlassianAuthConfig, "accessMode">): boolean {
  return role === "admin" && config.accessMode === "admin-list";
}

/**
 * The boards a request may read: null for every board (sign-in off, or an
 * admin), otherwise the boards in the person's session.
 */
export function readableBoards(session: Session | null): readonly string[] | null {
  if (session === null) return null;
  const auth = resolveAuth();
  if (auth.mode !== "atlassian") return null;
  return roleOf(session, auth.config) === "admin" ? null : session.boards;
}

/**
 * How far Ask may go for this request (the product owner's decision of 11 Nov
 * 2026): "people", naming people and counting their tickets and findings,
 * with sign-in off (every board is read already) and for an admin; "team" for
 * everyone else. Decided here on every request, by ACCESS_MODE and ADMIN_EMAILS
 * as they are now; the browser never chooses it. Anything this cannot place
 * reads at team level.
 */
export function askLevel(session: Session | null): AskLevel {
  const auth = resolveAuth();
  if (auth.mode === "off") return "people";
  if (auth.mode !== "atlassian" || session === null) return "team";
  return roleOf(session, auth.config) === "admin" ? "people" : "team";
}
