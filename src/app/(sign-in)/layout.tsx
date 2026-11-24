import type { ReactNode } from "react";

import { ForgetSessionTraces } from "@/components/sign-in/forget-session-traces";

export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <ForgetSessionTraces />
      <div className="w-full max-w-[440px]">{children}</div>
    </main>
  );
}
