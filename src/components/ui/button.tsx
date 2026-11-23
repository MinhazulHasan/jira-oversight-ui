"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import type { KeyName } from "@/components/shell/kbd";
import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

/*
 * Three kinds of button, and deliberately no "danger": the product is
 * read-only, so nothing on screen can destroy anything.
 *
 * - primary: the one filled control on a view, in the accent, because the
 *   accent means "traceable" and the primary action is the one that leads to
 *   evidence (Ask, Open finding, Go to Overview).
 * - secondary: a hairline-edged control on the sheet (Copy link, Export CSV).
 * - ghost: no edge until hovered; toolbars and icon buttons.
 */
export const buttonVariants = cva(
  "pressable relative inline-flex shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-md whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-cite font-medium text-cite-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-cite-hot",
        secondary:
          "border border-rule bg-sheet text-ink-mid hover:border-rule-strong hover:text-ink data-[state=open]:border-rule-strong data-[state=open]:text-ink",
        ghost:
          "text-ink-mid hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink",
      },
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-sm [&_svg]:size-[15px]",
        lg: "h-9 px-3.5 text-sm [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ComponentProps<"button">, ButtonVariantProps {
  /** A Lucide icon before the label. */
  icon?: LucideIcon;
  /** A Lucide icon after the label, e.g. an arrow for "leads somewhere". */
  iconEnd?: LucideIcon;
  /**
   * Waiting for the action to finish: a thin line sweeps along the foot of
   * the button (nothing spins) and presses are ignored until it ends. It
   * keeps its full colour, because waiting is not the same as unavailable.
   * Announced through aria-busy; say what is happening in the label too.
   */
  loading?: boolean;
  /**
   * Render the child element instead, with the button's styles: a Next.js
   * Link that should look like a button. Icons are then the child's to draw.
   */
  asChild?: boolean;
}

/** A labelled action. See buttonVariants for the three kinds. */
export function Button({
  variant,
  size,
  icon: Icon,
  iconEnd: IconEnd,
  loading = false,
  asChild = false,
  className,
  children,
  disabled,
  type,
  onClick,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), loading && "cursor-progress", className);

  if (asChild) {
    return (
      <Slot.Root className={classes} onClick={onClick} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      type={type ?? "button"}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      {...props}
    >
      {Icon ? <Icon aria-hidden strokeWidth={1.75} /> : null}
      {children}
      {IconEnd ? <IconEnd aria-hidden strokeWidth={1.75} /> : null}
      {loading ? <LoadingSweep /> : null}
    </button>
  );
}

/** A wait, drawn as a short line travelling along the button's foot. */
function LoadingSweep() {
  return (
    <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
      <span className="absolute inset-y-0 w-[40%] bg-current opacity-60 [animation:jo-sweep_1150ms_var(--ease-in-out)_infinite]" />
    </span>
  );
}

export const iconButtonVariants = cva(
  "pressable inline-flex shrink-0 items-center justify-center rounded-md select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost:
          "text-ink-low hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink",
        secondary:
          "border border-rule bg-sheet text-ink-mid hover:border-rule-strong hover:text-ink data-[state=open]:border-rule-strong data-[state=open]:text-ink",
      },
      size: {
        sm: "size-7 [&_svg]:size-3.5",
        md: "size-8 [&_svg]:size-[15px]",
        lg: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends Omit<ComponentProps<"button">, "children">,
    VariantProps<typeof iconButtonVariants> {
  /** The accessible name, also shown as the tooltip. Required: an icon alone says nothing to a screen reader. */
  label: string;
  icon: LucideIcon;
  /** The control's keyboard shortcut, shown in the tooltip. */
  shortcut?: KeyName[];
  /** Turn the tooltip off where a visible label sits right beside the button. */
  tooltip?: boolean;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Extra content after the icon, e.g. a count. */
  children?: ReactNode;
}

/** A square icon control with an accessible name and a tooltip that repeats it. */
export function IconButton({
  label,
  icon: Icon,
  shortcut,
  tooltip = true,
  tooltipSide = "top",
  variant,
  size,
  className,
  type,
  children,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type ?? "button"}
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      <Icon aria-hidden strokeWidth={1.75} />
      {children}
    </button>
  );

  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}
