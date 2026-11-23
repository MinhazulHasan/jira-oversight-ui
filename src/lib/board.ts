import { PROJECT_KEY_PATTERN } from "@/lib/api/schemas";

/*
 * The board picked in the top bar lives in a cookie, so the interface's server
 * route can send it to the service on every request (?project=KEY) without
 * each page knowing about it. It holds a project key and nothing else; the
 * service decides whether it is a board it serves. No "use client": the
 * server route reads the same name.
 */

export const BOARD_COOKIE = "jo-board";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** A project key from the cookie's value, or null when it is missing or not a key. */
export function boardFromCookie(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toUpperCase();
  return PROJECT_KEY_PATTERN.test(key) ? key : null;
}

/**
 * The board cookie's value in a Cookie header ("a=1; jo-board=AIL"), checked. Of two with that name, the
 * last, as Next.js's own parser (which the server reads) keeps it; a value that cannot be decoded is no pick.
 */
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

/**
 * Where to land after switching boards: the same page, without filters or a
 * selected item from the old board. An issue page has nothing to show on
 * another board, so it lands on the overview.
 */
export function landingAfterSwitch(pathname: string): string {
  if (pathname.startsWith("/issues/")) return "/";
  return pathname || "/";
}
