import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginView } from "@/components/sign-in/login-view";
import { loginError, safeNextPath } from "@/lib/sign-in";
import { authStatus } from "@/server/auth/config";
import { currentSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  const next = safeNextPath(one(query.next));

  const auth = authStatus();
  if (auth.mode === "off") redirect(next);
  if (auth.mode === "unconfigured") return <LoginView state={{ kind: "not_set_up", problem: auth.problem }} />;
  if (await currentSession()) redirect(next);

  const notice = loginError(one(query.error)) ?? (one(query.signed_out) === "1" ? "signed_out" : null);
  return <LoginView state={{ kind: "sign_in", next, notice }} />;
}
