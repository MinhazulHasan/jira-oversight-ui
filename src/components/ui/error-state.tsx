"use client";

import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

export interface ErrorStateProps {
  /** What could not be shown: "Couldn't load the findings". */
  title: ReactNode;
  /** One short line, e.g. "Try again." */
  description?: ReactNode;
  /** The technical detail (an HTTP status, a reference) in small mono, for a support message. */
  detail?: ReactNode;
  /** Try again. The button shows its own waiting state while retrying is true. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Compact sits inside a chart or a table. */
  size?: "regular" | "compact";
  className?: string;
}

/** A data region that failed to load, inline where the data would be. */
export function ErrorState({
  title,
  description,
  detail,
  onRetry,
  retrying = false,
  size = "regular",
  className,
}: ErrorStateProps) {
  const compact = size === "compact";
  return (
    <div role="alert" className={cn("flex items-stretch gap-4", compact ? "px-4 py-5" : "px-5 py-8", className)}>
      <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-warn" />
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <p className={cn("font-medium text-ink", compact ? "text-sm" : "text-md")}>{title}</p>
        {description ? <p className={cn("max-w-[60ch] text-ink-mid", compact ? "text-xs" : "text-sm")}>{description}</p> : null}
        {detail ? <p className="mono text-xs text-ink-low">{detail}</p> : null}
        {onRetry ? (
          <Button
            size={compact ? "sm" : "md"}
            icon={RotateCcw}
            loading={retrying}
            onClick={onRetry}
            className="mt-2"
          >
            {retrying ? "Retrying" : "Try again"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
