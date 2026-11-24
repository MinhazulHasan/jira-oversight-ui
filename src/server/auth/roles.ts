import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import type { AskLevel } from "@/lib/api/schemas";

import { resolveAuth, type AtlassianAuthConfig } from "./config";
import type { Session } from "./cookies";

/** Two levels of access, decided here and nowhere else */

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

/** Lower case for A to Z only. JavaScript's toLowerCase folds some other letters */
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

/** Whether the person signing in is an admin, before they have a session: */
export function adminAtSignIn(email: string, verified: boolean, config: Pick<AtlassianAuthConfig, "accessMode" | "adminEmails">): boolean {
  if (config.accessMode === "everyone-admin") return true;
  return verified && config.adminEmails.includes(asciiLower(email));
}

/** Whether the top bar says "Admin": only with admin-list, where it tells an */
export function showsAdminBadge(role: Role | null, config: Pick<AtlassianAuthConfig, "accessMode">): boolean {
  return role === "admin" && config.accessMode === "admin-list";
}

/** The boards a request may read: null for every board (sign-in off, or an */
export function readableBoards(session: Session | null): readonly string[] | null {
  if (session === null) return null;
  const auth = resolveAuth();
  if (auth.mode !== "atlassian") return null;
  return roleOf(session, auth.config) === "admin" ? null : session.boards;
}

export function askLevel(session: Session | null): AskLevel {
  const auth = resolveAuth();
  if (auth.mode === "off") return "people";
  if (auth.mode !== "atlassian" || session === null) return "team";
  return roleOf(session, auth.config) === "admin" ? "people" : "team";
}
