"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, type ReactNode } from "react";

import { Keys } from "@/components/shell/kbd";
import { cn } from "@/lib/utils";

import { CONTAINED_EVENTS, keepBackspaceFromBrowser } from "./contained-events";
import { ScrollArea } from "./scroll-area";

export interface SheetProps {
  /** Open or closed. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** A short label above the title: "Finding", or the rule id. */
  eyebrow?: ReactNode;
  /** One line under the title. Also the dialog's accessible description. */
  description?: ReactNode;
  /** Controls in the header, before the close button (Copy link, Open issue). */
  actions?: ReactNode;
  /** A ruled footer, e.g. previous and next. */
  footer?: ReactNode;
  children: ReactNode;
  /** The panel's width; 560 px, or the viewport on a phone. A bottom sheet is as wide as the screen, up to 40rem. */
  width?: number;
  /** Where the panel comes from. */
  side?: "right" | "bottom";
  /** Before the title, in the header: a person card's picture. */
  leading?: ReactNode;
  /** React's events from inside stop at the sheet's edge (`CONTAINED_EVENTS`). */
  contained?: boolean;
  keepBackspace?: boolean;
  /** Where focus goes when it closes, in place of what held it when it opened: a mention chip's field, say. */
  onCloseFocus?: () => void;
  className?: string;
}

// One layout for the live drawer and its still preview, so the two cannot drift apart.
const PANEL = "flex max-w-full flex-col bg-sheet shadow-pop outline-none";
/** A bottom sheet: the screen's width up to 40rem, centred, its top corners rounded, at most most of the screen tall. */
const BOTTOM_PANEL = "jo-sheet-bottom fixed inset-x-0 bottom-0 z-[var(--z-overlay)] mx-auto max-h-[min(88dvh,46rem)] w-full max-w-[40rem] rounded-t-lg pb-[env(safe-area-inset-bottom)]";
const HEADER = "flex shrink-0 items-start gap-3 border-b border-rule-weak px-6 pt-5 pb-4";
/** A bottom sheet's header: tighter, under the grab handle, the picture beside the title. */
const BOTTOM_HEADER = "flex shrink-0 items-center gap-3 border-b border-rule-weak px-4 pt-2 pb-3.5";
const TITLE = "text-lg font-semibold tracking-[-0.01em] text-balance text-ink";
const DESCRIPTION = "text-sm text-ink-mid";
const HEADER_TOOLS = "-mt-0.5 -mr-2 flex shrink-0 items-center gap-1";
const BOTTOM_TOOLS = "-mr-1 flex shrink-0 items-center gap-1 self-start";
/** A bottom sheet's body. */
const BOTTOM_FRAME = "flex min-h-0 flex-1 flex-col";
const BOTTOM_BODY = "min-h-0 flex-1 px-4 py-4";
/** A bottom sheet's footer: a ruled bar edge to edge, its cells the footer's own (a person card's ways on). */
const BOTTOM_FOOTER = "flex shrink-0 items-stretch border-t border-rule-weak bg-rail";
const CLOSE =
  "pressable inline-flex size-8 items-center justify-center rounded-md text-ink-low hover:bg-hover hover:text-ink";
const ESC_HINT = "mr-0.5 hidden sm:inline-flex";
const BODY = "h-full px-6 py-5";
const FOOTER = "flex shrink-0 items-center gap-2 border-t border-rule-weak bg-rail px-6 py-3";

/** The evidence drawer. */
export function Sheet({
  open,
  onOpenChange,
  title,
  eyebrow,
  description,
  actions,
  footer,
  children,
  width = 560,
  side = "right",
  leading,
  contained = false,
  keepBackspace = false,
  onCloseFocus,
  className,
}: SheetProps) {
  const bottom = side === "bottom";
  const returnFocus = useRef<HTMLElement | null>(null);
  const events = contained ? CONTAINED_EVENTS : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          {...events}
          className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-[jo-fade-out_160ms_ease_both] data-[state=open]:animate-[jo-fade-in_180ms_ease_both]"
        />
        <Dialog.Content
          {...events}
          onKeyDownCapture={keepBackspace ? keepBackspaceFromBrowser : undefined}
          // The panel's own look first, then the side's: a bottom sheet's width cap (40rem) outranks the panel's max-w-full.
          className={cn(PANEL, bottom ? BOTTOM_PANEL : "jo-sheet-panel fixed inset-y-0 right-0 z-[var(--z-overlay)]", className)}
          style={bottom ? undefined : { width: `min(${width}px, 100vw)` }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const opener = document.activeElement;
            returnFocus.current = opener instanceof HTMLElement && opener !== document.body ? opener : null;
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
          }}
          onCloseAutoFocus={(event) => {
            const opener = returnFocus.current;
            returnFocus.current = null;
            if (onCloseFocus) {
              event.preventDefault();
              onCloseFocus();
              return;
            }
            if (!opener?.isConnected) return;
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }}
          // Without a description, say so explicitly rather than point at nothing.
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          {/* The grab handle says the sheet rose from the bottom edge; decorative (Escape and Close shut it). */}
          {bottom ? <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-pill bg-rule-strong" /> : null}
          <header className={bottom ? BOTTOM_HEADER : HEADER}>
            {leading}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {eyebrow ? <div className="micro flex items-center gap-2 text-ink-low">{eyebrow}</div> : null}
              <Dialog.Title className={TITLE}>{title}</Dialog.Title>
              {description ? <Dialog.Description className={DESCRIPTION}>{description}</Dialog.Description> : null}
            </div>
            <div className={bottom ? BOTTOM_TOOLS : HEADER_TOOLS}>
              {actions}
              {/* The key cap sits beside the button, not in it, so the button's name is just "Close". */}
              {bottom ? null : <Keys keys={["Esc"]} className={ESC_HINT} />}
              <Dialog.Close aria-label="Close" aria-keyshortcuts="Escape" className={CLOSE}>
                <X aria-hidden size={16} strokeWidth={1.75} />
              </Dialog.Close>
            </div>
          </header>

          <ScrollArea axis="y" frameClassName={bottom ? BOTTOM_FRAME : "min-h-0 flex-1"} className={bottom ? BOTTOM_BODY : BODY}>
            {children}
          </ScrollArea>

          {footer ? <footer className={bottom ? BOTTOM_FOOTER : FOOTER}>{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type SheetPreviewProps = Omit<SheetProps, "open" | "onOpenChange">;

/** The drawer drawn still, in the page, for the style guide and for documentation pictures. */
export function SheetPreview({
  title,
  eyebrow,
  description,
  actions,
  footer,
  children,
  width = 560,
  className,
}: SheetPreviewProps) {
  return (
    <div inert aria-hidden className={cn(PANEL, "h-full", className)} style={{ width: `min(${width}px, 100%)` }}>
      <div className={HEADER}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {eyebrow ? <div className="micro flex items-center gap-2 text-ink-low">{eyebrow}</div> : null}
          <p className={TITLE}>{title}</p>
          {description ? <p className={DESCRIPTION}>{description}</p> : null}
        </div>
        <div className={HEADER_TOOLS}>
          {actions}
          <Keys keys={["Esc"]} className={ESC_HINT} />
          <span className={CLOSE}>
            <X aria-hidden size={16} strokeWidth={1.75} />
          </span>
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-hidden", BODY)}>{children}</div>
      {footer ? <div className={FOOTER}>{footer}</div> : null}
    </div>
  );
}
