import { PROJECT_KEY_PATTERN } from "@/lib/api/schemas";

export const BOARD_COOKIE = "jo-board";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** A project key from the cookie's value, or null when it is missing or not a key. */
export function boardFromCookie(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toUpperCase();
  return PROJECT_KEY_PATTERN.test(key) ? key : null;
}

export function boardFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  let raw: string | null = null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name?.trim() === BOARD_COOKIE) raw = rest.join("=");
  }
  if (raw === null) return null;
  try {
    return boardFromCookie(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/** document.cookie text that picks a board, or forgets the pick (null: the service's default board). */
export function boardCookie(key: string | null): string {
  return key === null
    ? `${BOARD_COOKIE}=; path=/; max-age=0; samesite=lax`
    : `${BOARD_COOKIE}=${encodeURIComponent(key)}; path=/; max-age=${ONE_YEAR_S}; samesite=lax`;
}

export function landingAfterSwitch(pathname: string): string {
  if (pathname.startsWith("/issues/")) return "/";
  return pathname || "/";
}
