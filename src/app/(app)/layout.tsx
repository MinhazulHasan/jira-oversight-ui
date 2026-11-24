import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BoardGate } from "@/components/shell/board-gate";
import { CommandPalette } from "@/components/shell/command-palette";
import { BoardPickProvider } from "@/components/shell/current-board";
import { KeyboardShortcuts } from "@/components/shell/keyboard-shortcuts";
import { MobileNav } from "@/components/shell/mobile-nav";
import { PrintHeader } from "@/components/shell/print-header";
import { Rail } from "@/components/shell/rail";
import { RecheckFollower } from "@/components/shell/recheck-follower";
import { RAIL_COOKIE, platformFromHeaders, railCollapsedFromCookie } from "@/components/shell/rail-state";
import { ShellProvider } from "@/components/shell/shell-context";
import { ShortcutsDialog } from "@/components/shell/shortcuts-dialog";
import { SignOutConfirm } from "@/components/shell/sign-out";
import { SyncFollower } from "@/components/shell/sync-follower";
import { TopBar } from "@/components/shell/top-bar";
import { BOARD_COOKIE, boardFromCookie } from "@/lib/board";
import { LOGIN_PATH } from "@/lib/sign-in";
import { authStatus } from "@/server/auth/config";
import { currentAdminBadge, currentAskLevel, currentSession } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = authStatus();
  if (auth.mode !== "off" && (await currentSession()) === null) redirect(LOGIN_PATH);

  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const railCollapsed = railCollapsedFromCookie(cookieStore.get(RAIL_COOKIE)?.value);
  // The board picked in the top bar, as this request carries it: the shell knows it from the first render.
  const picked = boardFromCookie(cookieStore.get(BOARD_COOKIE)?.value);
  const platform = platformFromHeaders(
    headerList.get("user-agent"),
    headerList.get("sec-ch-ua-platform"),
  );
  // Sign out appears only when sign-in is on; the sample project has no one to sign out.
  const showSignOut = auth.mode === "atlassian";
  const admin = showSignOut && (await currentAdminBadge());
  // People level (an admin, or sign-in off) is offered the People page; the page and the route check again.
  const peopleLevel = (await currentAskLevel()) === "people";

  return (
    <ShellProvider initialRailCollapsed={railCollapsed} platform={platform} peopleLevel={peopleLevel}>
      <BoardPickProvider board={picked}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="flex min-h-dvh">
          <Rail />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar showSignOut={showSignOut} admin={admin} />
            <main
              id="main"
              tabIndex={-1}
              className="flex-1 px-3 py-4 outline-none sm:px-4 md:px-[var(--gutter)] md:py-6"
            >
              <div className="mx-auto w-full max-w-[var(--content-max)]">
                <PrintHeader />
                {/* A board that has never synced: every page that reads it offers its first sync instead. */}
                <BoardGate>{children}</BoardGate>
              </div>
            </main>
          </div>
        </div>
        <CommandPalette showSignOut={showSignOut} />
        {/* Every way to sign out asks here first: one confirmation for the top bar, the sheet and the palette. */}
        {showSignOut ? <SignOutConfirm /> : null}
        <ShortcutsDialog />
        <MobileNav showSignOut={showSignOut} admin={admin} />
        <KeyboardShortcuts />
        {/* A rule settings save's re-check, followed to its end whichever page the reader goes to meanwhile. */}
        <RecheckFollower />
        {/* The board's sync, followed to its end and said once, however it was started. */}
        <SyncFollower />
      </BoardPickProvider>
    </ShellProvider>
  );
}
