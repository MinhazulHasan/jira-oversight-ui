"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { notify } from "@/lib/notify";

import { Button, IconButton } from "./button";

const SHOWN_MS = 1600;

function preview(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

/** Copy text and say so: "Copied issue key" with what was copied, or why it could not be. */
export async function copyText(value: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    notify.ok(`Copied ${what}`, { description: preview(value) });
    return true;
  } catch {
    notify.warn("Could not copy", {
      description: "Select the text and copy it.",
    });
    return false;
  }
}

export interface CopyButtonProps {
  /** The exact text that goes on the clipboard. */
  value: string;
  /** What it is, for the label and the toast: "issue key", "changelog id", "row". */
  what: string;
  /** Show only the icon (with "Copy {what}" as its name and tooltip). */
  iconOnly?: boolean;
  variant?: "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}

/** Copies a value, then acknowledges it twice. */
export function CopyButton({ value, what, iconOnly = false, variant = "ghost", size = "sm", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    if (await copyText(value, what)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), SHOWN_MS);
    }
  };

  const label = `Copy ${what}`;
  const icon = copied ? Check : Copy;

  if (iconOnly) {
    return <IconButton label={label} icon={icon} variant={variant} size={size} onClick={onClick} className={className} />;
  }
  return (
    <Button variant={variant} size={size} icon={icon} onClick={onClick} className={className}>
      {copied ? "Copied" : label}
    </Button>
  );
}
