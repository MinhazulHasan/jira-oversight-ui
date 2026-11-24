"use client";

import { Eraser } from "lucide-react";

import { StateDot } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Timestamp } from "@/components/ui/timestamp";
import type { AskOutcome, AskResponse } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { DECLINE_LABEL, declineOf, OUTCOME_LABEL } from "./describe";
import type { HistoryEntry } from "./history";

function Mark({ outcome }: { outcome: AskOutcome }) {
  if (outcome === "answered") return <StateDot tone="cite" size="sm" />;
  if (outcome === "not_measurable") return <span aria-hidden className="hatch size-2 shrink-0 rounded-[2px] border border-hatch-edge" />;
  return <StateDot tone="hollow" size="sm" />;
}

function outcomeText(entry: AskResponse): string {
  if (entry.outcome === "answered") return `${entry.citations.length} cited`;
  const decline = declineOf(entry);
  return decline ? DECLINE_LABEL[decline] : OUTCOME_LABEL[entry.outcome];
}

export function HistoryRail({
  entries,
  currentId,
  onSelect,
  onClear,
  className,
}: {
  entries: readonly HistoryEntry[];
  currentId: string | null;
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
  className?: string;
}) {
  return (
    <section aria-labelledby="ask-history-title" data-print="hide" className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <div className="flex min-h-7 items-center gap-2">
        <h2 id="ask-history-title" className="micro text-ink-low">
          This session
        </h2>
        {entries.length > 0 ? <span className="mono text-xs text-ink-low">{entries.length}</span> : null}
        <span aria-hidden className="h-px min-w-4 flex-1 bg-rule-weak" />
        {entries.length > 0 ? (
          <IconButton label="Clear this session's questions" icon={Eraser} size="sm" onClick={onClear} />
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-ink-low">No questions yet.</p>
      ) : (
        // The hover ground reaches past the column so the questions line up with the heading; the inset keeps focus rings whole.
        <ScrollArea axis="y" className="@min-[66rem]:max-h-[calc(100dvh-var(--topbar-h)-7rem)]" frameClassName="-mx-3.5">
          <ol className="flex flex-col gap-px p-1">
            {entries.map((kept) => {
              const entry = kept.response;
              const current = entry.qa_id === currentId;
              return (
                <li key={entry.qa_id}>
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    onClick={() => onSelect(kept)}
                    className={cn(
                      "pressable flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left",
                      current ? "bg-pressed text-ink" : "text-ink-mid hover:bg-hover hover:text-ink",
                    )}
                  >
                    <span className="line-clamp-2 text-sm leading-snug">{entry.question || "An empty question"}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-ink-low">
                      <Mark outcome={entry.outcome} />
                      <span className="truncate">{outcomeText(entry)}</span>
                      <span aria-hidden className="text-ink-dim">
                        ·
                      </span>
                      <Timestamp value={entry.asked_at} mode="time" className="shrink-0" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      )}
    </section>
  );
}
