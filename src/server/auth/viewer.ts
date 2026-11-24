import "server-only";

import { createHmac } from "node:crypto";

import { LOCAL_VIEWER, LOCAL_VIEWER_NAME, SIGNED_IN_USER, type AskLevel } from "@/lib/api/schemas";

import { resolveAuth } from "./config";
import type { Session } from "./cookies";

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

/** Who is behind this request, for the access log: the local reader with */
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

/** The headers that tell the service who is reading. Header values are ASCII: */
export function readerHeaders(reader: ReaderContext): Record<string, string> {
  if (!reader.viewer) return {};
  return {
    "x-oversight-viewer": reader.viewer.hash,
    "x-oversight-viewer-name": encodeURIComponent(reader.viewer.name),
  };
}
