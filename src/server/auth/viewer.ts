import "server-only";

import { createHmac } from "node:crypto";

import { LOCAL_VIEWER, LOCAL_VIEWER_NAME, SIGNED_IN_USER, type AskLevel } from "@/lib/api/schemas";

import { resolveAuth } from "./config";
import type { Session } from "./cookies";

/*
 * Who is reading, as the oversight service's access log records them (JO-12):
 * so an organisation can answer "who looked at this person's figures, and
 * when". This server sends it with every request it forwards, beside the
 * service key and the level, in two headers the browser can never set:
 *
 *   X-Oversight-Viewer       a keyed hash of the session's Atlassian account id:
 *                            HMAC-SHA-256 under AUTH_SECRET, hex, its first 32
 *                            characters; "local" while sign-in is off
 *   X-Oversight-Viewer-Name  the display name the session holds, percent-encoded
 *                            (a header carries ASCII only); "Signed-in user" for a
 *                            session from before the name was kept; "Local
 *                            (sign-in off)" while sign-in is off
 *
 * Never an email address, never the raw account id. The hash is stable for a
 * person while AUTH_SECRET stays the same, so their reads can be listed
 * together; it cannot be turned back into the account id without the secret.
 */

export interface Viewer {
  hash: string;
  name: string;
}

/** Every reader while sign-in is off (sample data, a local run): the access log cannot tell them apart. */
export const LOCAL_READER: Viewer = { hash: LOCAL_VIEWER, name: LOCAL_VIEWER_NAME };

const HASH_LENGTH = 32;

/** The viewer hash of an Atlassian account id: HMAC-SHA-256 under AUTH_SECRET, hex, the first 32 characters. */
export function viewerHash(accountId: string, secret: string): string {
  return createHmac("sha256", secret).update(accountId, "utf8").digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Who is behind this request, for the access log: the local reader with
 * sign-in off; the session's person with it on; null when there is no one to
 * name (sign-in on but not set up, or no session: such a request is refused
 * before it could be forwarded).
 */
export function viewerOf(session: Session | null): Viewer | null {
  const auth = resolveAuth();
  if (auth.mode === "off") return LOCAL_READER;
  if (auth.mode !== "atlassian" || session === null) return null;
  return { hash: viewerHash(session.sub, auth.config.secret), name: session.name ?? SIGNED_IN_USER };
}

/** Who is reading and at what level, as every forwarded request tells the service. */
export interface ReaderContext {
  viewer: Viewer | null;
  level: AskLevel;
}

/**
 * The headers that tell the service who is reading. Header values are ASCII:
 * the name is percent-encoded, as encodeURIComponent writes it (UTF-8). The
 * level travels as the contract has it, never as a header: Ask's body, and
 * the `level` parameter of the routes that read it (live.ts).
 */
export function readerHeaders(reader: ReaderContext): Record<string, string> {
  if (!reader.viewer) return {};
  return {
    "x-oversight-viewer": reader.viewer.hash,
    "x-oversight-viewer-name": encodeURIComponent(reader.viewer.name),
  };
}
