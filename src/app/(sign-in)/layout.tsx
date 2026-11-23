import type { ReactNode } from "react";

import { ForgetSessionTraces } from "@/components/sign-in/forget-session-traces";

/*
 * The sign-in pages, /login and /no-access, outside the shell: no rail, no
 * top bar, and nothing that calls the oversight API, which turns away
 * anyone not signed in. One sheet in the middle of the desk, the width of a
 * phone at most, so it reads the same on a MacBook and on a phone.
 */
export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <ForgetSessionTraces />
      <div className="w-full max-w-[440px]">{children}</div>
    </main>
  );
}
