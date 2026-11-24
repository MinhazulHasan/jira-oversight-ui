"use client";

import { useRouter } from "next/navigation";
import { AlertDialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useReturnFocus } from "@/components/ui/use-return-focus";
import { holdNavigation } from "@/lib/leave-guard";

/** The page load the page itself asks for (the board changed in another tab); replaceable in tests, since jsdom cannot reload. */
export const pageReload = { now: () => window.location.reload() };

export function useLeaveGuard(active: boolean): { asking: boolean; stay: () => void; leave: () => void; reload: () => void } {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const chosen = useRef(false);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (chosen.current) return;
      event.preventDefault();
      // Older WebKit asks only when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const release = holdNavigation((go) => {
      setPending(() => go);
      return true;
    });
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      // Off the dashboard the browser asks itself; a link to this very view loses nothing.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      setPending(() => () => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    // Capture, so the guard hears the press before the link's own handler (Next.js's Link) acts on it.
    document.addEventListener("click", onClick, true);
    return () => {
      release();
      document.removeEventListener("click", onClick, true);
    };
  }, [active, router]);

  return {
    asking: pending !== null,
    stay: () => setPending(null),
    leave: () => {
      const go = pending;
      setPending(null);
      go?.();
    },
    reload: () => {
      chosen.current = true;
      pageReload.now();
    },
  };
}

export interface LeaveConfirmProps {
  open: boolean;
  /** "3 unsaved changes to DEMO's rule settings". */
  what: string;
  onStay: () => void;
  onLeave: () => void;
  /** What takes the focus on staying when the control that asked to leave is gone (the palette's field). */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

export function LeaveConfirm({ open, what, onStay, onLeave, fallbackFocus }: LeaveConfirmProps) {
  const returnFocus = useReturnFocus(fallbackFocus);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both]" />
        <AlertDialog.Content
          onOpenAutoFocus={returnFocus.onOpenAutoFocus}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          className="fixed top-1/2 left-1/2 z-[var(--z-overlay)] flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-rule-weak bg-sheet shadow-pop outline-none data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-rise_200ms_var(--ease-out)_both]"
        >
          <div className="flex flex-col gap-2 px-6 pt-5 pb-5">
            <AlertDialog.Title className="text-lg font-semibold tracking-[-0.01em] text-ink">Leave without saving?</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-ink-mid">
              Your {what} will be lost. Nothing has been saved yet.
            </AlertDialog.Description>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-rule-weak bg-rail px-6 py-4">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" size="lg" className="w-full">
                Keep editing
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" size="lg" className="w-full" onClick={onLeave}>
                Leave without saving
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
