"use client";

import { ArrowRight, FileQuestionMark, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Keys } from "./kbd";
import { PageSheet } from "./page";
import { useShell } from "./shell-context";

/** A calm 404 inside the shell: says what was asked for and where to go instead. */
export function NotFoundView() {
  const pathname = usePathname();
  const { setPaletteOpen } = useShell();
  const issue = pathname.startsWith("/issues/");

  return (
    <PageSheet>
      <div className="flex max-w-[640px] flex-col items-start gap-5 px-6 py-14 md:px-[var(--sheet-pad)] md:py-20">
        {/* SQA: the box stood empty. */}
        <span
          aria-hidden
          data-not-found-mark
          className="flex size-11 items-center justify-center rounded-md border-[1.5px] border-dashed border-rule-strong text-ink-low"
        >
          <FileQuestionMark size={20} strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-2">
          <p className="micro text-ink-low">Not found &middot; 404</p>
          <h1 className="text-h font-semibold tracking-[-0.015em] text-ink">Nothing at this address</h1>
          <p className="text-base text-ink-mid">
            {issue
              ? "That issue key is not in this data. It may belong to another project, or the key may be mistyped."
              : "This page is not part of Jira Oversight. The link may be out of date or mistyped."}
          </p>
          <p className="mono break-all text-sm text-ink-low">{pathname}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="pressable inline-flex h-9 items-center gap-2 rounded-sm bg-cite px-3.5 text-sm font-medium text-cite-ink hover:bg-cite-hot"
          >
            Go to Overview
            <ArrowRight aria-hidden size={14} />
          </Link>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="pressable inline-flex h-9 items-center gap-2 rounded-sm border border-rule bg-sheet px-3 text-sm text-ink-mid hover:border-rule-strong hover:text-ink"
          >
            <Search aria-hidden size={14} />
            Search or jump to
            <Keys keys={["mod", "K"]} />
          </button>
        </div>
      </div>
    </PageSheet>
  );
}
