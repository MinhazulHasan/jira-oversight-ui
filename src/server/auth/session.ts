import "server-only";

import { cookies } from "next/headers";

import type { AskLevel } from "@/lib/api/schemas";

import { resolveAuth } from "./config";
import { SESSION_COOKIE, openSession, type Session } from "./cookies";
import { askLevel, roleOf, showsAdminBadge, type Role } from "./roles";

/** The signed-in session for the request a server component is rendering, or */
export async function currentSession(): Promise<Session | null> {
  const auth = resolveAuth();
  if (auth.mode !== "atlassian") return null;
  return openSession((await cookies()).get(SESSION_COOKIE)?.value, auth.config);
}

/** The signed-in person's level of access (./roles.ts), or null when sign-in is off or nobody is signed in. */
export async function currentRole(): Promise<Role | null> {
  const auth = resolveAuth();
  if (auth.mode !== "atlassian") return null;
  const session = await openSession((await cookies()).get(SESSION_COOKIE)?.value, auth.config);
  return session ? roleOf(session, auth.config) : null;
}

/** Whether the top bar shows the signed-in person's "Admin" badge (./roles.ts): */
export async function currentAdminBadge(): Promise<boolean> {
  const auth = resolveAuth();
  if (auth.mode !== "atlassian") return false;
  return showsAdminBadge(await currentRole(), auth.config);
}

/** The level Ask answers this page's reader at (./roles.ts), so the page offers */
export async function currentAskLevel(): Promise<AskLevel> {
  return askLevel(await currentSession());
}
