"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";

import { Keys } from "@/components/shell/kbd";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Timestamp } from "@/components/ui/timestamp";
import type { ApiError } from "@/lib/api/client";
import { useHealth } from "@/lib/api/hooks";

export function IssueNotFound({ issueKey }: { issueKey: string }) {
  const { setPaletteOpen } = useShell();
  const health = useHealth().data;

  return (
    <section aria-labelledby="issue-missing-title" className="flex max-w-[640px] flex-col items-start gap-5 py-6 md:py-10">
      <span aria-hidden className="block size-11 rounded-md border-[1.5px] border-dashed border-rule-strong" />
      <div className="flex flex-col gap-2">
        <p className="micro text-ink-low">Not found</p>
        <h2 id="issue-missing-title" className="text-xl font-semibold tracking-[-0.01em] text-ink">
          No issue <span className="mono font-medium">{issueKey}</span>
        </h2>
        <p className="text-base text-ink-mid">
          {health?.last_synced_at ? (
            <>
              Not in the last sync (<Timestamp value={health.last_synced_at} mode="datetime" />).
            </>
          ) : (
            "Not in the last sync."
          )}{" "}
          It may be new since the sync, on another board, or mistyped.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="primary">
          <Link href="/">
            Go to Overview
            <ArrowRight aria-hidden strokeWidth={1.75} />
          </Link>
        </Button>
        <Button asChild>
          <Link href="/findings">Browse findings</Link>
        </Button>
        <Button icon={Search} onClick={() => setPaletteOpen(true)}>
          Search or jump to
          <Keys keys={["mod", "K"]} />
        </Button>
      </div>
    </section>
  );
}

/** The issue could not be loaded: inline, with what it means and a retry. */
export function IssueError({
  issueKey,
  error,
  onRetry,
  retrying,
}: {
  issueKey: string;
  error: ApiError;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="rounded-md border border-rule-weak">
      <ErrorState
        title={`Couldn't load ${issueKey}`}
        description={
          error.retryable
            ? "Try again."
            : "The request was refused."
        }
        detail={`${error.code}${error.status ? ` · HTTP ${error.status}` : ""}`}
        onRetry={onRetry}
        retrying={retrying}
      />
    </div>
  );
}
