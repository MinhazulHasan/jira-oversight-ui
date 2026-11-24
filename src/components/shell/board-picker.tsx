"use client";

import { Check, Search } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent, type Ref } from "react";

import type { ProjectSummary } from "@/lib/api/hooks";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/* The board picker's list. */

export interface BoardGroup {
  id: "synced" | "not-synced";
  label: string;
  boards: ProjectSummary[];
}

/** Whether a board matches the search: every word typed appears in its name or its key, in any case. */
export function boardMatches(board: Pick<ProjectSummary, "key" | "name">, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${board.name} ${board.key}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The boards the search matches, synced first, then not synced yet, each in the service's order; empty groups left out. */
export function groupBoards(boards: readonly ProjectSummary[], query: string): BoardGroup[] {
  const matching = boards.filter((board) => boardMatches(board, query));
  const groups: BoardGroup[] = [
    { id: "synced", label: "Synced", boards: matching.filter((board) => board.synced) },
    { id: "not-synced", label: "Not synced yet", boards: matching.filter((board) => !board.synced) },
  ];
  return groups.filter((group) => group.boards.length > 0);
}

export interface BoardPickerPanelProps {
  boards: readonly ProjectSummary[];
  /** The board on screen: ticked, and where the keyboard starts. */
  current: string;
  onPick: (key: string) => void;
  /** The search text; the popover keeps it so Escape can clear it before it closes anything. */
  query: string;
  onQueryChange: (query: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

/** Rows a Page Up or Page Down moves. */
const PAGE = 8;

export function BoardPickerPanel({ boards, current, onPick, query, onQueryChange, inputRef }: BoardPickerPanelProps) {
  const listId = useId();
  const now = useNow();
  const groups = useMemo(() => groupBoards(boards, query), [boards, query]);
  const visible = useMemo(() => groups.flatMap((group) => group.boards), [groups]);
  const [active, setActive] = useState<string | null>(current);
  // The row the keyboard is on: the one chosen, else the first that matches (after a search, say).
  const activeIndex = visible.length === 0 ? -1 : Math.max(0, visible.findIndex((board) => board.key === active));
  const optionId = (key: string) => `${listId}-${key}`;

  const moveTo = (index: number) => {
    if (visible.length === 0) return;
    const next = visible[(index + visible.length) % visible.length];
    setActive(next.key);
    document.getElementById(optionId(next.key))?.scrollIntoView?.({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case "PageDown":
        event.preventDefault();
        moveTo(Math.min(activeIndex + PAGE, visible.length - 1));
        break;
      case "PageUp":
        event.preventDefault();
        moveTo(Math.max(activeIndex - PAGE, 0));
        break;
      case "Enter": {
        event.preventDefault();
        const board = visible[activeIndex];
        if (board) onPick(board.key);
        break;
      }
    }
  };

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-rule-weak px-3">
        <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(visible[activeIndex].key) : undefined}
          aria-label="Search boards"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setActive(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search boards"
          autoComplete="off"
          spellCheck={false}
          data-board-search=""
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-low"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        // Focus stays in the search field (aria-activedescendant); -1 only keeps the list programmatically focusable.
        tabIndex={-1}
        aria-label="Boards"
        // Keep the focus in the search field when a board is clicked.
        onMouseDown={(event) => event.preventDefault()}
        className="scroll-region max-h-[min(360px,55vh)] p-1.5"
      >
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-low">No board matches &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          groups.map((group) => {
            const headingId = `${listId}-${group.id}`;
            return (
              // A group's heading names it, as the command palette's groups are named.
              <div key={group.id} role="presentation" className="pb-1 not-first:mt-1 not-first:border-t not-first:border-rule-weak not-first:pt-1.5">
                <div id={headingId} aria-hidden className="micro px-2.5 pt-1.5 pb-1.5 text-ink-low">
                  {group.label}
                </div>
                <div role="group" aria-labelledby={headingId} data-board-group={group.id}>
                  {group.boards.map((board) => {
                    const index = visible.indexOf(board);
                    const chosen = board.key === current;
                    return (
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                      <div
                        key={board.key}
                        id={optionId(board.key)}
                        role="option"
                        tabIndex={-1}
                        aria-selected={chosen}
                        data-active={index === activeIndex || undefined}
                        data-board-option={board.key}
                        onPointerMove={() => {
                          if (index !== activeIndex) setActive(board.key);
                        }}
                        onClick={() => onPick(board.key)}
                        className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-sm text-ink-mid select-none data-[active]:bg-hover data-[active]:text-ink"
                      >
                        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
                          {chosen ? <Check size={14} strokeWidth={2} className="text-ink" /> : null}
                        </span>
                        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                          <span className={cn("truncate", chosen && "font-medium text-ink")}>{board.name}</span>
                          {board.name !== board.key ? (
                            <>
                              <span className="sr-only"> </span>
                              <span className="mono shrink-0 text-xs text-ink-low">{board.key}</span>
                            </>
                          ) : null}
                        </span>
                        {board.last_synced_at !== null && now !== null ? (
                          <span className="shrink-0 text-xs text-ink-low" title={`Synced ${formatDateTime(board.last_synced_at)}`}>
                            <span className="sr-only"> synced </span>
                            {formatRelative(board.last_synced_at, { now })}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
