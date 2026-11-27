"use client";

import { EyeOff } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import type { FindingIgnore } from "@/lib/api/schemas";
import { FALLBACK_LOCALE } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

import { ignoreSentence } from "./model";

/** Who ignored it, when and why, in the reader's own date once the page has hydrated. */
export function useIgnoreSentence(ignore: FindingIgnore | null): string {
  const now = useNow();
  if (!ignore) return "Ignored";
  return ignoreSentence(ignore, now === null ? { locale: FALLBACK_LOCALE, timeZone: "UTC" } : {});
}

/** The neutral mark of an ignored finding: neither open nor fixed. Who, when and why in its tooltip and to a screen reader. */
export function IgnoredChip({ ignore, className }: { ignore: FindingIgnore | null; className?: string }) {
  const words = useIgnoreSentence(ignore);
  return (
    <Tooltip content={words}>
      <span
        data-ignored-chip=""
        className={cn(
          "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-pill border border-rule bg-rail px-2 text-[11px] font-medium whitespace-nowrap text-ink-mid",
          className,
        )}
      >
        <EyeOff aria-hidden size={11} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        <span aria-hidden>Ignored</span>
        <span className="sr-only">{words}</span>
      </span>
    </Tooltip>
  );
}
