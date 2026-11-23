import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ Badge */

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 rounded-pill border whitespace-nowrap",
  {
    variants: {
      tone: {
        /** A plain fact: a type, a count, a version. */
        neutral: "border-rule bg-sheet text-ink-mid",
        /** Recedes: secondary metadata. */
        muted: "border-transparent bg-rail text-ink-low",
        /** Traceable: a citation, a bound value, a link to evidence. */
        cite: "border-transparent bg-cite-tint text-cite",
      },
      size: {
        sm: "h-5 px-2 text-[11px] leading-none",
        md: "h-[22px] px-2.5 text-xs leading-none",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  /** Set figures and ids in Plex Mono. */
  mono?: boolean;
}

/** A small rounded label for a fact about something. Never interactive. */
export function Badge({ tone, size, mono = false, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), mono && "mono", className)} {...props} />;
}

/* ---------------------------------------------------------- SeverityMark */

export type Severity = "breach" | "warning" | "resolved" | "not-measurable";

const MARK_COLOUR: Record<"ui" | "chart", Record<Severity | "neutral", string>> = {
  ui: {
    breach: "var(--breach)",
    warning: "var(--warn)",
    resolved: "var(--ok)",
    "not-measurable": "var(--hatch-edge)",
    neutral: "var(--text-low)",
  },
  chart: {
    breach: "var(--chart-breach)",
    warning: "var(--chart-warn)",
    resolved: "var(--chart-ok)",
    "not-measurable": "var(--hatch-edge)",
    neutral: "var(--text-low)",
  },
};

export interface SeverityMarkProps {
  severity: Severity | "neutral";
  /** Edge length in px. */
  size?: number;
  /** "chart" uses the chart's status steps, so a legend matches its marks. */
  palette?: "ui" | "chart";
  /** The shape in the quiet ink, for something that is not in force (a rule turned off on the board). */
  muted?: boolean;
  className?: string;
}

/**
 * The shape that carries a status, so it never rests on colour alone:
 * breach is a filled square, warning a triangle, resolved a tick, not
 * measurable a hatched square and neutral a dot. Decorative: the label beside
 * it says the same in words.
 */
export function SeverityMark({ severity, size = 10, palette = "ui", muted = false, className }: SeverityMarkProps) {
  const colour = muted ? MARK_COLOUR.ui.neutral : MARK_COLOUR[palette][severity];
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={cn("shrink-0", className)}
      style={{ color: colour }}
    >
      {severity === "breach" ? <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="currentColor" /> : null}
      {severity === "warning" ? (
        <path d="M5 0.6 9.6 9.2H0.4Z" fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="0.8" />
      ) : null}
      {severity === "resolved" ? (
        <path
          d="M1.2 5.4 3.9 8 8.8 2.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {severity === "not-measurable" ? (
        <>
          <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1.5" fill="var(--hatch-a)" stroke="currentColor" strokeWidth="1" />
          <path d="M1 6.5 6.5 1M3.5 9 9 3.5" stroke="currentColor" strokeWidth="1" />
        </>
      ) : null}
      {severity === "neutral" ? <circle cx="5" cy="5" r="3" fill="currentColor" /> : null}
    </svg>
  );
}

/* --------------------------------------------------------- SeverityBadge */

export const SEVERITY_LABEL: Record<Severity, string> = {
  breach: "Breach",
  warning: "Warning",
  resolved: "Resolved",
  "not-measurable": "Not measurable",
};

const severityBadge = cva(
  "inline-flex shrink-0 items-center gap-1.5 rounded-pill whitespace-nowrap font-medium",
  {
    variants: {
      severity: {
        breach: "bg-breach-tint text-breach-ink",
        warning: "bg-warn-tint text-warn-ink",
        resolved: "bg-ok-tint text-ok-ink",
        "not-measurable": "border border-dashed border-hatch-edge text-ink-low",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-[22px] px-2.5 text-xs",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface SeverityBadgeProps {
  severity: Severity;
  /** Replace the default word ("Breach", "Warning", ...), e.g. "Breached 2 Nov". */
  children?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/**
 * A status in words with its mark: breach, warning, resolved, or not
 * measurable. The text uses the ink step of the status colour, which clears
 * 4.5:1; the mark carries the shape.
 */
export function SeverityBadge({ severity, children, size, className }: SeverityBadgeProps) {
  return (
    <span className={cn(severityBadge({ severity, size }), className)}>
      <SeverityMark severity={severity} size={size === "sm" ? 8 : 9} />
      {children ?? SEVERITY_LABEL[severity]}
    </span>
  );
}

/* --------------------------------------------------------------- StateDot */

const stateDot = cva("inline-block shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-ink-low",
      ok: "bg-ok",
      warn: "bg-warn",
      breach: "bg-breach",
      cite: "bg-cite",
      /** Nothing live behind it, e.g. sample data or a paused source. */
      hollow: "border-[1.5px] border-ink-low",
    },
    size: { sm: "size-1.5", md: "size-2" },
  },
  defaultVariants: { tone: "neutral", size: "md" },
});

export interface StateDotProps extends VariantProps<typeof stateDot> {
  /** The words for the state. Shown beside the dot; the dot alone is never the message. */
  label?: ReactNode;
  className?: string;
}

/** A small dot that marks a state, followed by its label. */
export function StateDot({ tone, size, label, className }: StateDotProps) {
  if (label === undefined) return <span aria-hidden className={cn(stateDot({ tone, size }), className)} />;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className={stateDot({ tone, size })} />
      {label}
    </span>
  );
}
