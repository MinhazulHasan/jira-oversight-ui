"use client";

import { LogOut } from "lucide-react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { forgetAll } from "@/components/ask/history";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { LOGIN_PATH, SIGN_OUT_ROUTE } from "@/lib/sign-in";
import { cn } from "@/lib/utils";

/** Where a finished sign-out lands: the sign-in page, which acknowledges it. */
export const SIGNED_OUT_PATH = `${LOGIN_PATH}?signed_out=1`;

/** The way off the page once the session has ended. An object, so a test can watch it. */
export const leave = { to: (path: string) => window.location.assign(path) };

/**
 * Ends the session: a POST to /api/auth/logout, which accepts only this
 * dashboard's own Origin. The site's Referrer-Policy (no-referrer) makes a
 * browser send a form's own POST with the Origin "null", which the route
 * refuses, so the POST goes as a same-origin fetch with a referrer policy of
 * its own, which carries the real Origin. The route answers with a 303 to
 * /login?signed_out=1; under redirect "manual" that arrives as an opaque
 * redirect, its cookie cleared all the same.
 */
async function endSession(): Promise<boolean> {
  try {
    const response = await fetch(SIGN_OUT_ROUTE, {
      method: "POST",
      referrerPolicy: "same-origin",
      redirect: "manual",
      cache: "no-store",
    });
    return response.type === "opaqueredirect" || response.ok;
  } catch {
    return false;
  }
}

/*
 * Asking first (the product owner, 13 Nov 2026: a stray click must never sign
 * anyone out). Every way to sign out (the top bar, the navigation sheet, the
 * command palette) opens one confirmation, mounted once by the (app) layout
 * (SignOutConfirm). Its open state lives here, outside React, so any of them
 * can open it without a provider.
 */
let confirmOpen = false;
const confirmListeners = new Set<() => void>();

function setConfirmOpen(open: boolean): void {
  if (confirmOpen === open) return;
  confirmOpen = open;
  for (const listener of confirmListeners) listener();
}

function subscribeConfirm(listener: () => void): () => void {
  confirmListeners.add(listener);
  return () => confirmListeners.delete(listener);
}

/** What had the focus when the confirmation opened: where the focus goes back if the reader stays. */
let opener: HTMLElement | null = null;

/** Opens the sign-out confirmation; a test can call it directly. */
export function requestSignOut(): void {
  opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  setConfirmOpen(true);
}

/**
 * The focus after the reader stays: back on what opened the confirmation, or, when that is gone (the
 * command palette has closed) or never held the focus (a click in Safari), on the top bar's Sign out,
 * else on the page's main region. Never lost on the body.
 */
function returnFocus(): void {
  const visible = (element: HTMLElement | null): element is HTMLElement =>
    element !== null && element.isConnected && element.getClientRects().length > 0;
  const bar = document.querySelector<HTMLElement>("[data-sign-out-trigger]");
  const target = [opener, bar, document.getElementById("main")].find(visible);
  opener = null;
  target?.focus();
}

/** Closes the confirmation without signing out (what "Stay signed in" does); tests use it to start clean. */
export function cancelSignOut(): void {
  setConfirmOpen(false);
}

/**
 * Sign out, from the top bar, the navigation sheet or the command palette:
 * asks first (SignOutConfirm). The session ends only from the confirmation.
 */
export function useSignOut(): () => void {
  return requestSignOut;
}

/**
 * Ends the session now: the confirmation's own action. Goes to the sign-in
 * page, which says so; or stays and says that the dashboard did not answer.
 * A second press while one is under way does nothing.
 */
function useEndSessionNow(): { leaving: boolean; failed: boolean; signOut: () => void; reset: () => void } {
  const busy = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const signOut = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setLeaving(true);
    setFailed(false);
    void endSession().then((ended) => {
      if (ended) {
        // This tab's questions and answers go with the session: the next person here sees none of them.
        forgetAll();
        leave.to(SIGNED_OUT_PATH);
        return;
      }
      busy.current = false;
      setLeaving(false);
      setFailed(true);
      notify.warn("Could not sign out", { id: "sign-out", description: "The dashboard did not answer. Try again in a moment." });
    });
  }, []);
  const reset = useCallback(() => setFailed(false), []);
  return { leaving, failed, signOut, reset };
}

/**
 * The sign-out confirmation: a small alert dialog, centred, that holds focus.
 * "Stay signed in" has the focus when it opens, so Enter, Escape or a second
 * stray click keep the session; only a deliberate press on "Sign out" ends it.
 * While the sign-out is under way it says so and cannot be dismissed; if the
 * dashboard does not answer, it stays open and says that too.
 */
export function SignOutConfirm() {
  const open = useSyncExternalStore(subscribeConfirm, () => confirmOpen, () => false);
  const { leaving, failed, signOut, reset } = useEndSessionNow();
  const onOpenChange = (next: boolean) => {
    if (leaving) return;
    if (!next) reset();
    setConfirmOpen(next);
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay backdrop-blur-[2px] data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both]" />
        <AlertDialogPrimitive.Content
          data-sign-out-confirm
          onEscapeKeyDown={(event) => {
            if (leaving) event.preventDefault();
          }}
          // Opened from a store, not a Trigger, so the dialog cannot know its opener: put the focus back ourselves.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus();
          }}
          className="fixed top-1/2 left-1/2 z-[var(--z-overlay)] flex w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-rule-weak bg-sheet shadow-pop outline-none data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-rise_200ms_var(--ease-out)_both]"
        >
          <div className="flex flex-col items-center gap-3 px-6 pt-7 pb-5 text-center">
            <span
              aria-hidden
              className="inline-flex size-11 items-center justify-center rounded-full bg-hover text-ink-mid ring-1 ring-rule-weak ring-inset"
            >
              <LogOut size={19} strokeWidth={1.75} />
            </span>
            <AlertDialogPrimitive.Title className="text-lg font-semibold tracking-[-0.01em] text-balance text-ink">
              Sign out of Jira Oversight?
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="max-w-[30ch] text-sm text-pretty text-ink-mid">
              You&rsquo;ll sign in with Atlassian next time. This tab&rsquo;s Ask history is cleared.
            </AlertDialogPrimitive.Description>
            {failed ? (
              <p role="status" className="text-sm text-ink">
                The dashboard did not answer. Try again in a moment.
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-rule-weak bg-rail px-6 py-4">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" size="lg" disabled={leaving} className="w-full">
                Stay signed in
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button variant="primary" size="lg" loading={leaving} onClick={signOut} className="w-full">
              <LogOut aria-hidden />
              {leaving ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/**
 * The Sign out button. A plain button, never a form and never a link: a
 * link could sign someone out from anywhere that merely loads it, and a form
 * would submit on its own when pressed before the page has hydrated, sending
 * the POST the route refuses. Until the script runs, pressing it does
 * nothing. The (app) layout shows it only when sign-in is on: in the top bar
 * from 768px, in the navigation sheet below that. It names no one.
 */
export function SignOutButton({ variant, className }: { variant: "bar" | "sheet"; className?: string }) {
  const signOut = useSignOut();

  return variant === "bar" ? (
    <IconButton label="Sign out" icon={LogOut} tooltipSide="bottom" onClick={signOut} className={className} data-sign-out-trigger="" />
  ) : (
    <button
      type="button"
      onClick={signOut}
      className={cn(
        "pressable flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-sm text-ink-mid hover:bg-hover hover:text-ink",
        className,
      )}
    >
      <LogOut aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      Sign out
    </button>
  );
}

/**
 * Says the signed-in person is an admin: they read every board the dashboard
 * covers, not only the boards their Jira opens. Shown only with ACCESS_MODE
 * admin-list (ADMIN_EMAILS), where it tells admins apart from users; with
 * everyone-admin everyone is one (auth/roles.ts). A role, never a name.
 */
export function AdminBadge({ className }: { className?: string }) {
  return (
    <Badge tone="neutral" size="sm" data-role="admin" title="Admin: every board" className={className}>
      Admin
    </Badge>
  );
}
