/*
 * What the sign-in suite, its mock Atlassian and its servers agree on. Test
 * values only: none of them is a secret, and none reaches a real Atlassian
 * site. The ports sit in 3403-3405 and 3408, clear of the developer's own 3400
 * and of the main suite's.
 */

/** The dashboard with sign-in on and set up. Open it at exactly this address: it is APP_URL. */
export const APP_URL = "http://localhost:3403";
/** A second dashboard whose sign-in is set up wrongly (AUTH_SECRET too short), to show that nobody gets in. */
export const BROKEN_APP_URL = "http://localhost:3405";
/**
 * A third dashboard with ACCESS_MODE left empty: everyone-admin, the default (JO-16). Everyone who signs in is an
 * admin there. The first runs admin-list, so its tests of users and admins are exactly as before.
 */
export const EVERYONE_APP_URL = "http://localhost:3408";
/** The mock Atlassian (e2e-auth/mock-atlassian.mjs), on the loopback address only. */
export const MOCK_PORT = 3404;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

export const CLIENT_ID = "e2e-client-id";
export const CLIENT_SECRET = "e2e-client-secret-not-a-real-one";
/** A test value at least 32 characters long, as AUTH_SECRET must be. */
export const AUTH_SECRET = "e2e-only-sealing-key-0123456789-abcdefghijklmnop";
/** Too short on purpose, for the broken dashboard. The page must name AUTH_SECRET and never show this. */
export const SHORT_SECRET = "too-short-on-purpose";

/** The Jira site every admitted account must reach. A reserved .test name: nothing can ever answer there. */
export const SITE_URL = "https://oversight-e2e.atlassian.test";
export const ALLOWED_DOMAIN = "allowed.test";
/** The one admin (ADMIN_EMAILS): the mock's "Admin account". */
export const ADMIN_EMAIL = "lead@allowed.test";

/** The mock's consent screen offers one button per account, with these names. */
export const ACCOUNTS = {
  allowed: "Allowed account",
  outsider: "Outsider on another domain",
  unverified: "Unverified email address",
  noSite: "No access to the Jira site",
  noEmail: "No email address shared",
  noBoards: "No access to any board",
  admin: "Admin account",
  cancel: "Cancel",
} as const;
