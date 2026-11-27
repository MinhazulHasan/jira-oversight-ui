"use client";

import { EyeOff, RotateCcw } from "lucide-react";
import { Keys } from "@/components/shell/kbd";
import { Button } from "@/components/ui/button";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Finding } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { actionable, isSelected, pageState, type Selection } from "./selection";

export interface BulkBarProps {
  selection: Selection;
  /** The page's rows, as shown. */
  rows: readonly Finding[];
  /** Findings the filters match, over every page. */
  total: number;
  /** The state the filters list: every match can be taken at once in the open and the ignored views. */
  matchState: "open" | "resolved" | "ignored" | "all";
  onSelectMatching: () => void;
  onClear: () => void;
  onIgnore: () => void;
  onRestore: () => void;
}

/** The selection's actions, risen from the foot of the page: "3 selected · Ignore · Clear". Its room is kept, so nothing moves. */
export function BulkBar({ selection, rows, total, matchState, onSelectMatching, onClear, onIgnore, onRestore }: BulkBarProps) {
  const locale = useFigureLocale();
  const figure = (value: number) => formatCount(value, { locale });
  const picked = selection.kind === "rows" ? rows.filter((finding) => isSelected(selection, finding)) : [];
  const matching = selection.kind === "matching";
  const toIgnore = matching ? (matchState === "open" ? total : 0) : picked.filter((finding) => finding.state === "open").length;
  const toRestore = matching ? (matchState === "ignored" ? total : 0) : picked.filter((finding) => finding.state === "ignored").length;
  const canMatchAll = matchState === "open" || matchState === "ignored";
  const shown = selection.kind === "matching" || picked.length > 0;
  const offerAll = selection.kind === "rows" && canMatchAll && pageState(selection, rows) === "all" && total > rows.filter(actionable).length;

  return (
    <div className="sticky bottom-4 z-[var(--z-sticky)] -mt-4 flex h-12 justify-center px-2" data-print="hide">
      {shown ? (
        <div
          role="region"
          aria-label="Selected findings"
          data-selection-bar=""
          className="flex max-w-full animate-[jo-rise_200ms_var(--ease-out)_both] items-center gap-2 rounded-lg border border-rule bg-sheet py-2 pr-2 pl-4 shadow-pop sm:gap-3"
        >
          <p className="text-sm whitespace-nowrap text-ink" aria-live="polite" data-selection-count="">
            {selection.kind === "matching" ? (
              <>
                All <span className="mono">{figure(total)}</span> matching
              </>
            ) : (
              <>
                <span className="mono">{figure(picked.length)}</span> selected
              </>
            )}
          </p>
          {offerAll ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelectMatching}
              className="-mx-1 text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
              data-select-matching=""
            >
              <span className="hidden sm:inline">Select all</span>
              <span className="sm:hidden">All</span> <span className="mono">{figure(total)}</span>{" "}
              <span className="hidden sm:inline">matching</span>
            </Button>
          ) : null}
          <span aria-hidden className="h-5 w-px shrink-0 bg-rule-weak" />
          {toIgnore > 0 ? (
            <Button variant="primary" size="sm" icon={EyeOff} onClick={onIgnore} data-bulk-ignore="">
              Ignore
            </Button>
          ) : null}
          {toRestore > 0 ? (
            <Button size="sm" icon={RotateCcw} onClick={onRestore} data-bulk-restore="">
              Restore
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClear} aria-keyshortcuts="Escape" data-selection-clear="">
            Clear
            <Keys keys={["Esc"]} className="hidden sm:inline-flex" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
