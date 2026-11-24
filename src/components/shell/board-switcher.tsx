"use client";

import { ChevronsUpDown, SquareKanban } from "lucide-react";
import { usePathname } from "next/navigation";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { floatingSurface } from "@/components/ui/surfaces";
import { useHealth, useProjects } from "@/lib/api/hooks";
import { boardCookie, landingAfterSwitch } from "@/lib/board";
import { cn } from "@/lib/utils";

import { BoardPickerPanel } from "./board-picker";
import { useCurrentBoard } from "./current-board";

/** The Jira board every page reads, and the way to switch to another. */

export function switchBoard(key: string, pathname: string): void {
  document.cookie = boardCookie(key);
  boardNavigation.assign(landingAfterSwitch(pathname));
}

/** The page load a switch ends with; replaceable in tests, since jsdom cannot navigate. */
export const boardNavigation = { assign: (href: string) => window.location.assign(href) };

/** Pick `key` in the board picker and open `href` on it (the Portfolio's rows and its oldest breaches). */
export function openOnBoard(key: string, href: string): void {
  document.cookie = boardCookie(key);
  boardNavigation.assign(href);
}

/** Pick `key` for the next page load (a link opened in a new tab), leaving this page as it is. */
export function pickBoard(key: string): void {
  document.cookie = boardCookie(key);
}

/** At most one reload a minute from the switcher's own repairs, so a cookie it cannot change never loops. */
const REPAIR_KEY = "jo-board-repaired";
const REPAIR_GAP_MS = 60_000;

/** The page reload a repair ends with; replaceable in tests, since jsdom cannot reload. */
export const boardRepair = { reload: () => window.location.reload() };

function repairOnce(write: string): void {
  try {
    const last = Number(window.sessionStorage.getItem(REPAIR_KEY) ?? 0);
    if (Date.now() - last < REPAIR_GAP_MS) return;
    window.sessionStorage.setItem(REPAIR_KEY, String(Date.now()));
  } catch {
    // No storage (a private window, say): repair all the same; the cookie write is what matters.
  }
  document.cookie = write;
  boardRepair.reload();
}

/* Opening the picker from elsewhere (the Portfolio's line about boards not synced yet). */
let pickerRequested = false;
const pickerListeners = new Set<() => void>();

function subscribePicker(listener: () => void): () => void {
  pickerListeners.add(listener);
  return () => pickerListeners.delete(listener);
}

/** Opens the board picker on screen, focus in its search; on a phone, in the navigation sheet. */
export function requestBoardPicker(): void {
  pickerRequested = true;
  for (const listener of pickerListeners) listener();
}

/** Whether a request to open the picker waits for a picker on screen to take it up. */
export function useBoardPickerRequested(): boolean {
  return useSyncExternalStore(subscribePicker, () => pickerRequested, () => false);
}

/** Whether the top bar's picker is on screen (from 768px up); below that it is in the navigation sheet. */
export function boardPickerInTopBar(): boolean {
  const trigger = document.querySelector<HTMLElement>("header [data-board]");
  return trigger !== null && trigger.getClientRects().length > 0;
}

export function BoardSwitcher({ className }: { className?: string }) {
  const projects = useProjects();
  const health = useHealth();
  const pathname = usePathname();
  const { key: current, name, picked } = useCurrentBoard();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A pick the service cannot show (no longer served, or not one of this person's boards): forget it, show the default.
  const boards = projects.data?.projects;
  const unshowable = picked !== null && boards !== undefined && !boards.some((board) => board.key === picked);
  useEffect(() => {
    if (unshowable) repairOnce(boardCookie(null));
  }, [unshowable]);
  const fallback = picked === null && health.error?.code === "unknown_board" ? projects.data?.default : undefined;
  useEffect(() => {
    if (fallback) repairOnce(boardCookie(fallback));
  }, [fallback]);

  // Asked to open from elsewhere: the picker on screen does, and the request is spent.
  const requested = useBoardPickerRequested();
  const ready = boards !== undefined && current !== null && !unshowable;
  useEffect(() => {
    if (!requested || !ready) return;
    const trigger = triggerRef.current;
    if (!trigger || trigger.getClientRects().length === 0) return;
    pickerRequested = false;
    setOpen(true);
  }, [requested, ready]);

  if (projects.isError) return null; // the data-source pill already says the service is unreachable
  if (!ready) {
    return (
      <span className={cn("inline-flex", className)}>
        <span aria-hidden className="skeleton h-8 w-[132px] rounded-md" />
        <span className="sr-only">Loading the boards</span>
      </span>
    );
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const pick = (key: string) => {
    onOpenChange(false);
    if (key !== current) switchBoard(key, pathname);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger
        ref={triggerRef}
        data-board={current}
        className={cn(
          "pressable inline-flex h-8 max-w-[220px] min-w-[7rem] items-center gap-1.5 rounded-md border border-rule bg-sheet pr-1.5 pl-2 text-sm text-ink hover:border-rule-strong data-[state=open]:border-rule-strong",
          className,
        )}
      >
        <SquareKanban aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        {/* The name is the visible text plus "Board:", so what is read out contains what is seen (WCAG 2.5.3). */}
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          <span className="sr-only">Board: </span>
          {name}
        </span>
        {name !== current ? <span className="mono hidden text-xs text-ink-low min-[90rem]:inline">{current}</span> : null}
        <ChevronsUpDown aria-hidden size={13} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-label="Jira boards"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // The first Escape clears the search; the next one closes the picker.
            if (query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          className={cn(floatingSurface, "w-[min(360px,calc(100vw-32px))] overflow-hidden")}
        >
          <BoardPickerPanel boards={boards} current={current} onPick={pick} query={query} onQueryChange={setQuery} inputRef={inputRef} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
