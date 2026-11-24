import "server-only";

import { createHmac, hkdfSync } from "node:crypto";

import type { LoginError, NoAccessReason } from "@/lib/sign-in";

import type { AtlassianStep } from "./atlassian";

/** One JSON line per sign-in that did not end in a session, on the server's */

const KEY_LENGTH = 32;
const keys = new Map<string, Buffer>();

/** The hashing key, derived from AUTH_SECRET for this one purpose (not the email hash's key). */
function hashKey(secret: string): Buffer {
  let key = keys.get(secret);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "jira-oversight", "account-hash", KEY_LENGTH));
    keys.set(secret, key);
  }
  return key;
}

/** An account id's keyed hash, as the log line keeps it. */
export function accountHash(account: string, secret: string): string {
  return createHmac("sha256", hashKey(secret)).update(account).digest("base64url");
}

function line(fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ ...fields, at: new Date().toISOString() }));
}

/** An account Atlassian vouched for, turned away by this dashboard's rules (it is sent to /no-access). */
export function logRejection(reason: NoAccessReason, domain: string | null, account: string | null, secret: string): void {
  line({
    event: "auth.rejected",
    reason,
    domain: domain === null ? null : domain.slice(0, 253),
    account_hash: account === null ? null : accountHash(account.slice(0, 128), secret),
  });
}

/** A sign-in that failed before anyone could be judged (it is sent to /login?error=). */
export function logFailure(reason: LoginError, step: AtlassianStep | "callback" | "boards" | "internal", status?: number): void {
  line({ event: "auth.failed", reason, step, ...(status === undefined ? {} : { status }) });
}
