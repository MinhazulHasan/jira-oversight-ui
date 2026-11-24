"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useReturnFocus } from "./use-return-focus";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** One or two lines on what the dialog is for; its accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  /** What must be seen whatever the body's scroll. */
  notice?: ReactNode;
  /** Buttons, right-aligned in a ruled footer. Put the primary action last. */
  footer?: ReactNode;
  /** 480 px by default. */
  width?: number;
  className?: string;
  /** Where the focus goes as it opens (Radix's onOpenAutoFocus): prevent the default and focus a field. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Where the focus goes as it closes, instead of back to the control that opened it: prevent the default and focus it. */
  onCloseAutoFocus?: (event: Event) => void;
  /** What takes the focus as it closes when the control that opened it is gone. */
  fallbackFocus?: () => HTMLElement | null | undefined;
  /** A key pressed anywhere in the dialog, e.g. a shortcut its primary action answers to from every control. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  notice,
  footer,
  width = 480,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  fallbackFocus,
  onKeyDown,
}: DialogProps) {
  const returnFocus = useReturnFocus(fallbackFocus);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both]" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            returnFocus.onOpenAutoFocus();
            onOpenAutoFocus?.(event);
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            returnFocus.onCloseAutoFocus(event);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "fixed top-1/2 left-1/2 z-[var(--z-overlay)] flex max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-sheet shadow-pop outline-none data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-rise_200ms_var(--ease-out)_both]",
            className,
          )}
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
            <div className="flex min-w-0 flex-col gap-1">
              <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.01em] text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-sm text-ink-mid">{description}</DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="pressable -mt-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-low hover:bg-hover hover:text-ink"
            >
              <X aria-hidden size={16} strokeWidth={1.75} />
            </DialogPrimitive.Close>
          </div>
          {/* Never more than a third of the window, so the body keeps room; a longer notice scrolls on its own. */}
          {notice ? (
            <div className="scroll-region max-h-[33dvh] shrink-0 px-6 pb-4 text-sm" data-dialog-notice="">
              {notice}
            </div>
          ) : null}
          {children ? (
            <div className="scroll-region min-h-0 flex-1 px-6 pb-5 text-sm text-ink-mid" data-dialog-body="">
              {children}
            </div>
          ) : null}
          {footer ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule-weak bg-rail px-6 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Closes the dialog it sits in; wrap a Button with asChild semantics via this. */
export const DialogClose = DialogPrimitive.Close;
