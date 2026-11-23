"use client";

import { ArrowRight, History as HistoryIcon, RotateCcw, Undo2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useReturnFocus } from "@/components/ui/use-return-focus";
import type { CustomRuleDefinition, RuleCheck, RuleSettingsHistoryEntry, RuleSettingsRule } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useClock } from "./apply-status";
import { changesWord, definitionWords, fieldWords, ruleChangeWords, undoneIn } from "./model";

/**
 * One field a change set, in words: "R-EFF-01 Effort far beyond the estimate · Effort ratio 1.5× → 2×". A custom
 * rule added, deleted or brought back (JO-20) is a sentence of its own, "Added rule “Bugs in review over 3 days”",
 * with what it was under it; in an undo's question, what the undo will do ("Deletes rule …").
 */
function ChangeLine({
  rules,
  checks,
  change,
  titles,
  undo = false,
  restore = false,
}: {
  rules: readonly RuleSettingsRule[];
  checks: readonly RuleCheck[];
  change: RuleSettingsHistoryEntry["changes"][number];
  /** The names the history gives custom rules no longer on the board (deleted since), by id. */
  titles?: ReadonlyMap<string, string>;
  undo?: boolean;
  restore?: boolean;
}) {
  const locale = useFigureLocale();
  const sentence = change.field === "rule" ? ruleChangeWords(change, { undo, restore }) : null;
  if (sentence) {
    const definition = (change.to ?? change.from) as CustomRuleDefinition;
    return (
      <li className="flex flex-col gap-0.5 text-sm" data-rule-change={change.rule_id}>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="mono text-xs text-ink-low">{change.rule_id}</span> <span className="text-ink">{sentence}</span>
        </span>
        <span className="text-xs text-pretty text-ink-low">{definitionWords(definition, checks, locale)}</span>
      </li>
    );
  }
  const words = fieldWords(rules, change, locale);
  const title = rules.find((rule) => rule.rule_id === change.rule_id)?.title ?? titles?.get(change.rule_id);
  // A threshold's values are figures, in Plex Mono; On, Off, Breach and Warning are words.
  const figure = change.field.startsWith("params.") ? "mono" : undefined;
  // The spaces between the parts are for a copy and a screen reader; the gaps are the layout's.
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="mono text-xs text-ink-low">{change.rule_id}</span>{" "}
      {title ? <span className="text-ink-mid">{title}</span> : null}{" "}
      <span aria-hidden className="text-ink-dim">
        ·
      </span>{" "}
      <span className="text-ink-mid">{words.label}</span>{" "}
      <span className="inline-flex items-center gap-1.5">
        <span className={cn(figure, "text-ink-low")}>{words.from}</span>
        <ArrowRight aria-hidden size={12} strokeWidth={1.75} className="text-ink-low" />
        <span className="sr-only"> to </span>
        <span className={cn(figure, "text-ink")}>{words.to}</span>
      </span>
    </li>
  );
}

export interface HistoryListProps {
  history: readonly RuleSettingsHistoryEntry[];
  rules: readonly RuleSettingsRule[];
  /** The board's checks: a custom rule's definition in words (JO-20). */
  checks?: readonly RuleCheck[];
  board: string;
  /** Undo is the latest change's alone, and held back while the page has unsaved edits (they would be lost). */
  undoBlocked: string | null;
  onUndo: (entry: RuleSettingsHistoryEntry) => void;
}

/** The names the history gives custom rules (JO-20), by id: the latest it says, for a rule deleted since. */
export function historyTitles(history: readonly RuleSettingsHistoryEntry[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const entry of [...history].reverse()) {
    for (const change of entry.changes) {
      const definition = (change.field === "rule" ? (change.to ?? change.from) : null) as CustomRuleDefinition | null;
      if (definition) titles.set(change.rule_id, definition.title);
      if (change.field === "title" && typeof change.to === "string") titles.set(change.rule_id, change.to);
    }
  }
  return titles;
}

/**
 * Every change to the board's rule settings, newest first: when (the
 * 12-hour clock, the reader's zone), who (by name, never an address), why, and
 * each field it set, from and to. The latest has Undo; one that a later change
 * undid says so, and an undo says what it undid. A custom rule added, deleted
 * or brought back (JO-20) reads as a sentence.
 */
export function HistoryList({ history, rules, checks = [], board, undoBlocked, onUndo }: HistoryListProps) {
  const clock = useClock();
  const locale = useFigureLocale();
  const titles = historyTitles(history);
  if (history.length === 0) {
    return (
      <div className="rounded-md border border-rule-weak">
        <EmptyState
          size="compact"
          icon={HistoryIcon}
          title="No changes yet"
        />
      </div>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-rule-weak rounded-md border border-rule-weak" aria-label={`Changes to ${board}'s rule settings, newest first`}>
      {history.map((entry, index) => {
        const undone = undoneIn(history, entry);
        const undid = entry.undo_of ? history.find((candidate) => candidate.change_id === entry.undo_of) : undefined;
        return (
          <li key={entry.change_id} className="flex flex-col gap-2 px-4 py-3" data-revision={entry.revision}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-ink">
                  Revision <span className="mono">{formatCount(entry.revision, { locale })}</span>
                </span>{" "}
                <span aria-hidden className="text-ink-dim">
                  ·
                </span>{" "}
                <time dateTime={entry.at} className="text-ink-mid" data-figure>
                  {clock(entry.at)}
                </time>{" "}
                <span aria-hidden className="text-ink-dim">
                  ·
                </span>{" "}
                <span className="text-ink-mid">{entry.by.name}</span>{" "}
                <span className="text-xs text-ink-low">{changesWord(entry.changes.length)}</span>
              </p>
              {index === 0 ? (
                undoBlocked ? (
                  <Tooltip content={undoBlocked}>
                    <Button size="sm" icon={Undo2} aria-disabled>
                      Undo
                    </Button>
                  </Tooltip>
                ) : (
                  <Button size="sm" icon={Undo2} onClick={() => onUndo(entry)} data-undo={entry.change_id}>
                    Undo
                  </Button>
                )
              ) : null}
            </div>
            {entry.reason ? <p className="max-w-[72ch] text-sm text-pretty text-ink">&ldquo;{entry.reason}&rdquo;</p> : null}
            <ul className="flex flex-col gap-1">
              {entry.changes.map((change) => (
                <ChangeLine
                  key={`${change.rule_id}.${change.field}`}
                  rules={rules}
                  checks={checks}
                  change={change}
                  titles={titles}
                  restore={entry.undo_of !== null}
                />
              ))}
            </ul>
            {undone !== null || entry.undo_of ? (
              <p className="flex items-center gap-1.5 text-xs text-ink-low">
                <RotateCcw aria-hidden size={12} strokeWidth={1.75} />
                {undone !== null ? <>Undone in revision {formatCount(undone, { locale })}</> : null}
                {undone !== null && entry.undo_of ? <span aria-hidden>·</span> : null}
                {entry.undo_of ? (
                  undid ? (
                    <>Undoes revision {formatCount(undid.revision, { locale })}</>
                  ) : (
                    <>Undoes an earlier change</>
                  )
                ) : null}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export interface UndoConfirmProps {
  entry: RuleSettingsHistoryEntry | null;
  rules: readonly RuleSettingsRule[];
  /** The board's checks: a custom rule's definition in words (JO-20). */
  checks?: readonly RuleCheck[];
  board: string;
  undoing: boolean;
  /** Why the undo did not go through, in plain words (someone else saved since, the service refused it). */
  problem: string | null;
  conflict: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onReload: () => void;
  /** What takes the focus as it closes when the Undo that opened it is gone (the undo went through). */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

/**
 * Undo, asked first: what it sets back, whose change it was and when, and that
 * the board is re-checked. "Keep it" has the focus, so Enter or a second
 * stray press changes nothing; only "Undo revision N" does. Closed, it gives
 * the focus back to the Undo that opened it, or to `fallbackFocus` once that
 * is gone.
 */
export function UndoConfirm({ entry, rules, checks = [], board, undoing, problem, conflict, onConfirm, onCancel, onReload, fallbackFocus }: UndoConfirmProps) {
  const clock = useClock();
  // The change asked about stays drawn while the dialog fades out, rather than its words going first.
  const [shown, setShown] = useState(entry);
  if (entry !== null && entry !== shown) setShown(entry);
  const display = entry ?? shown;
  // A browser that does not focus a button it clicks (Safari) leaves no opener: the change's own Undo stands for it.
  const returnFocus = useReturnFocus(() => (display ? document.querySelector<HTMLElement>(`[data-undo="${display.change_id}"]`) : null) ?? fallbackFocus?.());
  return (
    <AlertDialog.Root
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open && !undoing) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both]" />
        <AlertDialog.Content
          onOpenAutoFocus={returnFocus.onOpenAutoFocus}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            if (undoing) event.preventDefault();
          }}
          className="fixed top-1/2 left-1/2 z-[var(--z-overlay)] flex max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-rule-weak bg-sheet shadow-pop outline-none data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-rise_200ms_var(--ease-out)_both]"
        >
          {display ? (
            <>
              <div className="flex flex-col gap-2 px-6 pt-5 pb-4">
                <AlertDialog.Title className="text-lg font-semibold tracking-[-0.01em] text-ink">Undo revision {display.revision}?</AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-ink-mid">
                  Sets back what {display.by.name} changed on {clock(display.at)} and re-checks {board}&rsquo;s findings. The undo is
                  recorded in the history as a change of its own.
                </AlertDialog.Description>
              </div>
              <div className="scroll-region min-h-0 flex-1 px-6 pb-4">
                <p className="micro pb-2 text-ink-low">{changesWord(display.changes.length)} set back</p>
                <ul className="flex flex-col gap-1 rounded-md border border-rule-weak px-3 py-2.5">
                  {display.changes.map((change) => (
                    <ChangeLine
                      key={`${change.rule_id}.${change.field}`}
                      rules={rules}
                      checks={checks}
                      change={{ ...change, from: change.to, to: change.from }}
                      undo
                    />
                  ))}
                </ul>
                {problem ? (
                  <p role="alert" className="mt-3 text-sm text-ink">
                    {problem}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-rule-weak bg-rail px-6 py-3">
                <AlertDialog.Cancel asChild>
                  <Button variant="secondary" disabled={undoing}>
                    Keep it
                  </Button>
                </AlertDialog.Cancel>
                {conflict ? (
                  <Button variant="primary" icon={RotateCcw} onClick={onReload}>
                    Reload
                  </Button>
                ) : (
                  <Button variant="primary" icon={Undo2} loading={undoing} onClick={onConfirm}>
                    {undoing ? "Undoing…" : `Undo revision ${display.revision}`}
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
