"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { Keys, type KeyName } from "@/components/shell/kbd";
import { cn } from "@/lib/utils";

import { tooltipSurface } from "./surfaces";

export interface TooltipProps {
  /** What the tooltip says. Keep it to a line; it supplements, never replaces, a visible label. */
  content: ReactNode;
  /** The keyboard shortcut for the control, shown as key caps ("mod" is Cmd or Ctrl). */
  shortcut?: KeyName[];
  /** Placed between the keys of a sequence, e.g. "then" for G then F. */
  shortcutJoiner?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Override the provider's 350 ms delay, e.g. 0 for a chart readout. */
  delayDuration?: number;
  /** Control it, e.g. to show it open in the design specimen. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Exactly one element that can hold a ref and receive focus. */
  children: ReactElement;
  className?: string;
}

/**
 * A short label on hover and keyboard focus (Radix Tooltip, so it opens on
 * focus, closes on Escape and is announced as the trigger's description).
 * Every icon-only control in the product carries one.
 */
export function Tooltip({
  content,
  shortcut,
  shortcutJoiner,
  side = "top",
  align = "center",
  delayDuration,
  open,
  onOpenChange,
  children,
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={onOpenChange} delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(tooltipSurface, className)}
        >
          <span>{content}</span>
          {shortcut ? <Keys keys={shortcut} joiner={shortcutJoiner} /> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
