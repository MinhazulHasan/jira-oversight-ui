import { cva } from "class-variance-authority";
import { Info, TriangleExclamationPoint } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CalloutTone = "info" | "not-measurable" | "warn";

const callout = cva("flex overflow-hidden rounded-md border", {
  variants: {
    tone: {
      info: "border-rule-weak bg-rail",
      "not-measurable": "border-rule bg-sheet",
      warn: "border-warn/40 bg-warn-tint",
    },
  },
});

const DEFAULT_LABEL: Record<CalloutTone, string> = {
  info: "Note",
  "not-measurable": "Not measurable",
  warn: "Attention",
};

export interface CalloutProps {
  tone?: CalloutTone;
  /** The small label above the text. Defaults to "Note", "Not measurable" or "Attention". */
  label?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  /** A follow-on control, e.g. "See the process map". */
  action?: ReactNode;
  className?: string;
}

/**
 * A short passage set apart from the page.
 *
 * - info: context the reader should have (how a figure is counted).
 * - not-measurable: the process step exists but Jira holds no evidence for
 *   it. It carries the hatch, calmly: for James that gap is a finding in
 *   itself, not a fault.
 * - warn: something to keep in mind before trusting a figure (stale data).
 */
export function Callout({ tone = "info", label, title, children, action, className }: CalloutProps) {
  return (
    <aside className={cn(callout({ tone }), className)}>
      {tone === "not-measurable" ? <span aria-hidden className="hatch w-3 shrink-0 border-r border-rule" /> : null}
      <div className="flex min-w-0 flex-1 gap-3 px-4 py-3.5">
        {tone === "info" ? <Info aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-low" /> : null}
        {tone === "warn" ? (
          <TriangleExclamationPoint aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warn" />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <p className={cn("micro", tone === "warn" ? "text-warn-ink" : "text-ink-low")}>{label ?? DEFAULT_LABEL[tone]}</p>
          {title ? <p className="text-sm font-medium text-ink">{title}</p> : null}
          <div className="max-w-[68ch] text-sm text-ink-mid">{children}</div>
          {action ? <div className="mt-1.5">{action}</div> : null}
        </div>
      </div>
    </aside>
  );
}
