"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { PageSheet } from "@/components/shell/page";

function digestOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const { digest } = error;
    return typeof digest === "string" ? digest : undefined;
  }
  return undefined;
}

/**
 * A page that failed to render. Calm and specific: nothing about the data has
 * changed, only this view could not be drawn, and trying again re-fetches it.
 * Data regions handle their own errors inline; this is the last line.
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = digestOf(error);

  return (
    <PageSheet>
      <div
        role="alert"
        className="flex max-w-[640px] flex-col items-start gap-5 px-6 py-14 md:px-[var(--sheet-pad)] md:py-20"
      >
        <span aria-hidden className="block h-11 w-[3px] rounded-full bg-warn" />
        <div className="flex flex-col gap-2">
          <p className="micro text-ink-low">Something went wrong</p>
          <h1 className="text-h font-semibold tracking-[-0.015em] text-ink">This view could not be shown</h1>
          <p className="text-base text-ink-mid">
            Try again.
          </p>
          {digest ? (
            <p className="text-sm text-ink-low">
              Reference <code className="mono text-ink-mid">{digest}</code> (quote it if you report this)
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="pressable inline-flex h-9 items-center gap-2 rounded-sm bg-cite px-3.5 text-sm font-medium text-cite-ink hover:bg-cite-hot"
          >
            <RotateCcw aria-hidden size={14} />
            Try again
          </button>
          <Link
            href="/"
            className="pressable inline-flex h-9 items-center gap-2 rounded-sm border border-rule bg-sheet px-3 text-sm text-ink-mid hover:border-rule-strong hover:text-ink"
          >
            Go to Overview
            <ArrowRight aria-hidden size={14} />
          </Link>
        </div>
      </div>
    </PageSheet>
  );
}
