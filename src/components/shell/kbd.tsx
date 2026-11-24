"use client";

import { Fragment } from "react";

import { cn } from "@/lib/utils";

import { useShell } from "./shell-context";

/** "mod" is Cmd on a Mac and Ctrl everywhere else. */
export type KeyName = "mod" | (string & {});

function useKeyLabel() {
  const { platform } = useShell();
  return (key: KeyName) => (key === "mod" ? (platform === "mac" ? "⌘" : "Ctrl") : key);
}

/** The value for aria-keyshortcuts, e.g. "Control+K". */
export function useAriaShortcut(keys: KeyName[]): string {
  const { platform } = useShell();
  return keys
    .map((key) => (key === "mod" ? (platform === "mac" ? "Meta" : "Control") : key))
    .join("+");
}

/** Keys as the reader's keyboard labels them. */
export function Keys({
  keys,
  joiner,
  className,
}: {
  keys: KeyName[];
  /** Placed between keys of a sequence, e.g. "then". Omit for a combination. */
  joiner?: string;
  className?: string;
}) {
  const label = useKeyLabel();
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-1", className)}>
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 && joiner ? <span className="text-xs text-ink-low">{joiner}</span> : null}
          <kbd className="kbd">{label(key)}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
