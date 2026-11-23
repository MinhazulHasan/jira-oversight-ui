"use client";

import { Info } from "lucide-react";
import type { Ref } from "react";

import { SeverityMark, StateDot } from "@/components/ui/badge";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { RuleSettings, RuleSettingsApply } from "@/lib/api/schemas";
import { formatCount, formatDateTime } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

/** The chip's words for each state, as the page says whether the board's findings reflect its settings. */
export const APPLY_WORDS: Record<RuleSettingsApply["state"], string> = {
  applied: "Applied",
  running: "Re-checking…",
  pending: "Will apply at the next sync",
  failed: "Couldn't re-check",
};

/** A moment as this page says it: "2:10 PM, 4 Nov 2026" in the reader's zone (UTC until the page has hydrated). */
export function useClock(): (value: string) => string {
  const hydrated = useHydrated();
  const locale = useFigureLocale();
  // Date first, as every other time on screen reads ("17 Nov 2026, 3:45 PM"; SQA: this page alone put the time first).
  return (value) => formatDateTime(value, hydrated ? { locale } : { locale, timeZone: "UTC" });
}

/** "4 closed, 0 opened": what the re-check after the latest save did to the board's findings. */
export function resultWords(result: NonNullable<RuleSettingsApply["result"]>, locale?: string): string {
  return `${formatCount(result.closed, { locale })} closed, ${formatCount(result.opened, { locale })} opened`;
}

/**
 * Whether the board's findings reflect its settings, as a chip: Applied (the
 * resolved tick), Re-checking… (a line sweeps along its foot; nothing spins),
 * Will apply at the next sync, or Couldn't re-check (the warning mark, with
 * the service's words under it). Never the accent, which means traceable.
 */
export function ApplyChip({ apply }: { apply: RuleSettingsApply }) {
  const tone =
    apply.state === "applied"
      ? "border-ok/30 bg-ok-tint text-ok-ink"
      : apply.state === "failed"
        ? "border-warn/40 bg-warn-tint text-warn-ink"
        : "border-rule bg-sheet text-ink-mid";
  return (
    <span
      data-apply={apply.state}
      className={cn("relative inline-flex h-6 shrink-0 items-center gap-1.5 overflow-hidden rounded-pill border px-2.5 text-xs font-medium whitespace-nowrap", tone)}
    >
      {apply.state === "applied" ? <SeverityMark severity="resolved" size={9} /> : null}
      {apply.state === "failed" ? <SeverityMark severity="warning" size={9} /> : null}
      {apply.state === "pending" ? <StateDot tone="hollow" size="sm" /> : null}
      {apply.state === "running" ? <StateDot tone="neutral" size="sm" /> : null}
      {APPLY_WORDS[apply.state]}
      {apply.state === "running" ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <span className="absolute inset-y-0 w-[40%] bg-current opacity-60 [animation:jo-sweep_1150ms_var(--ease-in-out)_infinite]" />
        </span>
      ) : null}
    </span>
  );
}

/**
 * What the settings are, in one line under the status: the same words while the page loads and once it has, so
 * the line wraps alike and nothing below it moves (the status above names the board).
 */
export function SettingsNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-ink-low">
      <Info aria-hidden size={13} strokeWidth={1.75} className="mt-px shrink-0" />
      These settings apply to this board only. Saving re-checks its findings.
    </p>
  );
}

export interface SettingsStatusProps {
  settings: RuleSettings;
  /** The board's name as the top bar names it; its key when the board list has not said. */
  boardName: string | null;
  ref?: Ref<HTMLDivElement>;
}

/**
 * The board, its settings' revision and who last changed them when, and
 * whether its findings reflect them yet: the chip, with what the latest
 * re-check did beside it on the same line, so the card is as tall at every
 * revision as while it loads; a re-check that is waiting or failed says why
 * on a line of its own under a hairline. A live region: a save, its re-check
 * and a change made elsewhere are said as they happen. It takes the focus
 * after a save, so the reader hears where things stand.
 */
export function SettingsStatus({ settings, boardName, ref }: SettingsStatusProps) {
  const locale = useFigureLocale();
  const clock = useClock();
  const { apply, revision } = settings;
  const waiting = revision > 0 && (apply.state === "failed" || apply.state === "pending");
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      data-settings-status=""
      className="flex flex-col gap-2.5 rounded-md border border-rule-weak bg-rail px-4 py-3 outline-none"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink">
            <span className="font-medium">{boardName ?? settings.project}</span>{" "}
            {boardName ? <span className="mono text-xs text-ink-low">{settings.project}</span> : null}
          </p>
          <p className="text-sm text-ink-mid">
            {revision > 0 && settings.updated_at && settings.updated_by ? (
              <>
                Revision <span className="mono text-ink">{formatCount(revision, { locale })}</span>
                <span aria-hidden> · </span>
                <span className="sr-only">, </span>
                last changed{" "}
                <time dateTime={settings.updated_at} data-figure>
                  {clock(settings.updated_at)}
                </time>{" "}
                by {settings.updated_by}
              </>
            ) : (
              "No changes yet. Every rule runs with its default settings."
            )}
          </p>
        </div>
        {revision > 0 ? (
          <div className="flex shrink-0 items-center gap-3">
            {apply.state === "applied" && apply.result ? (
              <p className="text-xs whitespace-nowrap text-ink-mid" data-figure>
                {resultWords(apply.result, locale)}
              </p>
            ) : null}{" "}
            <ApplyChip apply={apply} />
            {apply.state === "applied" && apply.applied_revision >= revision ? (
              <span className="sr-only">The findings reflect revision {revision}.</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {waiting ? (
        <p className="border-t border-rule-weak pt-2.5 text-xs text-pretty text-ink-mid">
          {apply.message ?? "The findings follow at the next sync."}
        </p>
      ) : null}
    </div>
  );
}
