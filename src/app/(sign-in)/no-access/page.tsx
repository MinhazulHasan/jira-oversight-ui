import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NoAccessView } from "@/components/sign-in/no-access-view";
import { LOGIN_PATH, noAccessReason } from "@/lib/sign-in";
import { authStatus } from "@/server/auth/config";
import { currentSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "No access" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Where the sign-in callback sends an account this dashboard may not admit,
 * with ?reason= saying which rule turned it away (and the session already
 * ended). Without sign-in, or with a session open, it has nothing to say, so
 * it sends the reader on; when sign-in is not set up, /login explains.
 */
export default async function NoAccessPage({ searchParams }: PageProps<"/no-access">) {
  const auth = authStatus();
  if (auth.mode === "off") redirect("/");
  if (auth.mode === "unconfigured") redirect(LOGIN_PATH);
  if (await currentSession()) redirect("/");

  return <NoAccessView reason={noAccessReason(one((await searchParams).reason))} />;
}
