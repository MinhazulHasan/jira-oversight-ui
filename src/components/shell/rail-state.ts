export const RAIL_COOKIE = "jo-rail";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function railCollapsedFromCookie(value: string | undefined): boolean {
  return value === "collapsed";
}

export function railCookie(collapsed: boolean): string {
  return `${RAIL_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${ONE_YEAR_S}; samesite=lax`;
}

export type Platform = "mac" | "other";

/** Read from request headers so the server renders the right modifier key. */
export function platformFromHeaders(userAgent: string | null, platformHint: string | null): Platform {
  if (platformHint) return /mac|ios/i.test(platformHint) ? "mac" : "other";
  return userAgent && /Macintosh|Mac OS X|iPhone|iPad/.test(userAgent) ? "mac" : "other";
}
