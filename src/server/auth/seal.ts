import "server-only";

/** Sealed cookies: AES-256-GCM through Web Crypto, which works the same in the */

export type SealPurpose = "session" | "state";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Far above anything sealed here (a session is about 200 characters), and below what a browser keeps. */
const MAX_SEALED_LENGTH = 4000;
const SALT = new TextEncoder().encode("jira-oversight/cookie-seal/v1");

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of a canonical, unpadded base64url string; null for anything else. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  let binary: string;
  try {
    binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  // One spelling per value: a string whose spare bits were changed decodes to the same bytes, and is refused.
  return toBase64Url(bytes) === text ? bytes : null;
}

/** A random, unguessable value for a sign-in state: 32 bytes, as 43 base64url characters. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function keyFor(secret: string, purpose: SealPurpose): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: encoder.encode(`jo-cookie:${purpose}`) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function additionalData(purpose: SealPurpose, context: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(context ? `${VERSION}:${purpose}:${context}` : `${VERSION}:${purpose}`);
}

/** Seals `payload` (anything JSON can carry) under `secret`, for `purpose` only, and bound to `context` when one is given. */
export async function seal(payload: unknown, secret: string, purpose: SealPurpose, context = ""): Promise<string> {
  const key = await keyFor(secret, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = encoder.encode(JSON.stringify(payload));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(purpose, context) }, key, plain),
  );
  const bytes = new Uint8Array(IV_BYTES + sealed.length);
  bytes.set(iv);
  bytes.set(sealed, IV_BYTES);
  return `${VERSION}.${toBase64Url(bytes)}`;
}

/** The payload sealed in `sealed`, or null when it was tampered with, sealed */
export async function unseal(
  sealed: string | null | undefined,
  secret: string,
  purpose: SealPurpose,
  context = "",
): Promise<unknown> {
  if (typeof sealed !== "string" || sealed.length > MAX_SEALED_LENGTH || !sealed.startsWith(`${VERSION}.`)) return null;
  const bytes = fromBase64Url(sealed.slice(VERSION.length + 1));
  if (!bytes || bytes.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const key = await keyFor(secret, purpose);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES), additionalData: additionalData(purpose, context) },
      key,
      bytes.subarray(IV_BYTES),
    );
    return JSON.parse(decoder.decode(plain)) as unknown;
  } catch {
    return null;
  }
}
