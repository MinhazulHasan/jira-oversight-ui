"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect } from "react";

import { BoardSwitcher, boardPickerInTopBar, useBoardPickerRequested } from "./board-switcher";
import { DataSourceSummary } from "./data-source";
import { NavList } from "./nav-list";
import { BrandLink } from "./rail";
import { useShell } from "./shell-context";
import { AdminBadge, SignOutButton } from "./sign-out";

/** Below 768px the rail becomes a sheet that slides over the page; with sign-in on, Sign out sits at its foot. */
export function MobileNav({ showSignOut = false, admin = false }: { showSignOut?: boolean; admin?: boolean }) {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  const close = () => setMobileNavOpen(false);
  // Asked for the board picker (the Portfolio's boards not synced yet) where the top bar has none: it is in here.
  const pickerRequested = useBoardPickerRequested();
  useEffect(() => {
    if (pickerRequested && !boardPickerInTopBar()) setMobileNavOpen(true);
  }, [pickerRequested, setMobileNavOpen]);

  return (
    <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both] md:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-[var(--z-overlay)] flex w-[min(300px,86vw)] flex-col bg-rail shadow-pop outline-none data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both] md:hidden">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">
            {showSignOut
              ? "The Jira board, the pages of Jira Oversight, the data source and Sign out."
              : "The Jira board, the pages of Jira Oversight and the data source."}
          </Dialog.Description>
          <div className="flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-rule-weak px-4">
            <BrandLink onNavigate={close} />
            <Dialog.Close
              aria-label="Close navigation"
              className="pressable inline-flex size-8 items-center justify-center rounded-md text-ink-low hover:bg-hover hover:text-ink"
            >
              <X aria-hidden size={16} />
            </Dialog.Close>
          </div>
          <div className="border-b border-rule-weak px-3 py-3">
            <BoardSwitcher className="w-full max-w-none" />
          </div>
          <nav aria-label="Primary" className="scroll-region flex-1 px-3 py-4">
            <NavList collapsed={false} onNavigate={close} />
          </nav>
          <div className="border-t border-rule-weak px-3 py-3">
            <DataSourceSummary collapsed={false} />
          </div>
          {showSignOut ? (
            <div className="flex items-center gap-2 border-t border-rule-weak px-3 py-3">
              <SignOutButton variant="sheet" className="min-w-0 flex-1" />
              {admin ? <AdminBadge /> : null}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
