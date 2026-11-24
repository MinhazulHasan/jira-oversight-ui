import type { LoginError, NoAccessReason } from "@/lib/sign-in";

/* What the sign-in pages say. */

export interface Notice {
  /** The small label above the title. */
  label: string;
  title: string;
  body: string;
}

/** Where Atlassian signs an account out, so that another one can sign in. */
export const ATLASSIAN_LOGOUT_URL = "https://id.atlassian.com/logout";

/** The one line under "Sign in": how, and that Jira is only ever read. */
export const SIGN_IN_PURPOSE =
  "Use your Atlassian account. Jira Oversight only reads Jira; it never changes anything there.";

/** /login?error=: a sign-in that failed on the way, not a refusal, so trying again is always the way on. */
export const LOGIN_ERROR_NOTICES: Record<LoginError, Notice> = {
  denied: {
    label: "Not signed in",
    title: "You chose Cancel at Atlassian",
    body: "You are not signed in. Sign in again when you are ready.",
  },
  state: {
    label: "Not signed in",
    title: "That sign-in could not be finished",
    body: "Signing in took too long, or started in another tab or browser. Start again here.",
  },
  atlassian: {
    label: "Not signed in",
    title: "Atlassian could not complete the sign-in",
    body: "Try again in a moment. If it keeps happening, tell your administrator.",
  },
  timeout: {
    label: "Not signed in",
    title: "Atlassian took too long to answer",
    body: "Try again in a moment.",
  },
  unreachable: {
    label: "Not signed in",
    title: "Atlassian could not be reached",
    body: "Try again in a moment. If it keeps happening, tell your administrator.",
  },
  service: {
    label: "Not signed in",
    title: "Your boards could not be checked",
    body: "Try again in a moment.",
  },
  internal: {
    label: "Not signed in",
    title: "Something went wrong in Jira Oversight",
    body: "Try again in a moment. If it keeps happening, tell your administrator.",
  },
};

/** /login?signed_out=1. Signing out of the dashboard leaves the Atlassian account signed in at Atlassian. */
export const SIGNED_OUT_NOTICE: Notice = {
  label: "Signed out",
  title: "You have signed out of Jira Oversight",
  body: "You are still signed in at Atlassian. On a shared computer, sign out there too.",
};

/** /login when sign-in is on but cannot work. The detail names a variable, never its value. */
export const NOT_SET_UP = {
  title: "Sign-in is not set up on this server",
  purpose:
    "Sign-in settings are missing or wrong. Nobody can sign in yet.",
  label: "For whoever runs this server",
} as const;

export interface Refusal {
  title: string;
  body: string;
  /** The primary action's label: the same address either way, /api/auth/login. */
  action: string;
}

/** /no-access?reason=: the account signed in at Atlassian, but may not use this dashboard. */
export const NO_ACCESS_REFUSALS: Record<NoAccessReason, Refusal> = {
  domain: {
    title: "This account cannot open Jira Oversight",
    body: "Only accounts on approved email domains can open Jira Oversight. This one is on another domain.",
    action: "Try another account",
  },
  unverified: {
    title: "Verify your email address first",
    body: "Atlassian has not verified this email address. Verify it there, then sign in again.",
    action: "Sign in again",
  },
  site: {
    title: "This account cannot see the Jira site",
    body: "If Atlassian asked you to choose a site, sign in again and choose your company's Jira site. Otherwise ask a Jira administrator for access.",
    action: "Sign in again",
  },
  boards: {
    title: "This account cannot see any of the boards",
    body: "Ask a Jira administrator for access, or use another account.",
    action: "Try another account",
  },
  email: {
    title: "Atlassian did not share an email address",
    body: "Access depends on the email domain, and this account has none to check.",
    action: "Try another account",
  },
};

/** /no-access without a reason it knows. */
export const NO_ACCESS_FALLBACK: Refusal = {
  title: "This account cannot open Jira Oversight",
  body: "Try another account, or ask your administrator for access.",
  action: "Try another account",
};
