"use client";

import { Link2 } from "lucide-react";

import { copyCurrentLink } from "@/lib/copy-link";

/** The standard header action: the URL is the state, so a link is the view. */
export function CopyLinkButton() {
  return (
    <button
      type="button"
      onClick={copyCurrentLink}
      className="pressable inline-flex h-8 items-center gap-1.5 rounded-md border border-rule bg-sheet px-3 text-sm text-ink-mid hover:border-rule-strong hover:text-ink"
    >
      <Link2 aria-hidden size={14} strokeWidth={1.75} />
      Copy link
    </button>
  );
}
