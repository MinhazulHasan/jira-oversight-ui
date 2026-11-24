"use client";

import { Check, ChevronDown, RotateCcw, Search } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { CLIPPED_EDGES, LIST_HEIGHT, ROOM, useFittedHeight } from "@/components/ask/mention-menu";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { fieldTrigger, floatingSurface } from "@/components/ui/surfaces";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { DirectoryEntry, Person } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { foldText } from "@/lib/names";
import { cn } from "@/lib/utils";

export interface PersonPickerProps {
  /** The directory's entries; undefined while they load. */
  entries: readonly DirectoryEntry[] | undefined;
  state: "pending" | "error" | "success";
  onRetry: () => void;
  value: string | null;
  onValueChange: (person: Person) => void;
  className?: string;
}

interface Group {
  id: "holding" | "none";
  label: string;
  entries: DirectoryEntry[];
}

/** The two groups, each in the directory's order, narrowed by a search; a group it empties goes. */
export function pickerGroups(entries: readonly DirectoryEntry[], query: string): Group[] {
  const words = foldText(query).trim().split(/\s+/).filter(Boolean);
  const matches = (entry: DirectoryEntry) => words.every((word) => foldText(entry.person.name).includes(word));
  const shown = entries.filter(matches);
  return [
    { id: "holding" as const, label: "With tickets", entries: shown.filter((entry) => entry.tickets > 0) },
    { id: "none" as const, label: "No tickets", entries: shown.filter((entry) => entry.tickets === 0) },
  ].filter((group) => group.entries.length > 0);
}

function Fitted({ listId, groups, children }: { listId: string; groups: readonly unknown[]; children: (fitted: number | null) => ReactNode }) {
  const fitted = useFittedHeight(listId, groups);
  return <>{children(fitted)}</>;
}

export function PersonPicker({ entries, state, onRetry, value, onValueChange, className }: PersonPickerProps) {
  const locale = useFigureLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const chosen = entries?.find((entry) => entry.person.id === value)?.person ?? null;
  const groups = useMemo(() => pickerGroups(entries ?? [], query), [entries, query]);
  const flat = groups.flatMap((group) => group.entries);
  const positions = new Map(flat.map((entry, index) => [entry.person.id, index]));
  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActive(0);
    }
  };

  const choose = (entry: DirectoryEntry) => {
    onValueChange(entry.person);
    close(false);
  };

  const moveTo = (index: number) => {
    if (flat.length === 0) return;
    const wrapped = (index + flat.length) % flat.length;
    setActive(wrapped);
    document.getElementById(optionId(wrapped))?.scrollIntoView?.({ block: "nearest" });
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
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(flat.length - 1);
        break;
      case "Enter": {
        event.preventDefault();
        if (state === "error") onRetry();
        const entry = flat[activeIndex];
        if (entry) choose(entry);
        break;
      }
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={close}>
      <PopoverPrimitive.Trigger className={cn(fieldTrigger, "h-8 pr-2 pl-3 text-sm", className)} aria-label={chosen ? `Person: ${chosen.name}` : "Person: choose someone"}>
        <span className="text-ink-low">Person</span>{" "}
        {chosen ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <PersonAvatar person={chosen} />
            <span className="truncate font-medium text-ink">{chosen.name}</span>
          </span>
        ) : (
          <span className="truncate text-ink-mid">Choose someone</span>
        )}
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-label="Person"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // The first Escape clears the search; the next one closes the list.
            if (query) {
              event.preventDefault();
              setQuery("");
              setActive(0);
            }
          }}
          className={cn(floatingSurface, "w-[min(20rem,calc(100vw-2rem))] overflow-hidden")}
        >
          <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-rule-weak px-3">
            <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              aria-label="Search people"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search people"
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-low"
            />
          </div>
          {state === "pending" && !entries ? (
            <div aria-hidden className="flex flex-col p-1">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex h-8 items-center gap-2.5 px-2.5">
                  <Skeleton className="size-5 rounded-full" />
                  <Skeleton className={cn("h-3", row === 1 ? "w-24" : "w-32")} />
                </div>
              ))}
            </div>
          ) : state === "error" && !entries ? (
            <div className="flex flex-col items-start gap-2 px-3 py-3 text-sm text-ink-mid">
              <span>Could not load people. Press Enter to retry.</span>
              <button
                type="button"
                onClick={onRetry}
                className="pressable inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs text-ink hover:bg-hover"
              >
                <RotateCcw aria-hidden size={12} strokeWidth={1.75} /> Try again
              </button>
            </div>
          ) : flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-low">
              {(entries ?? []).length === 0 ? "No people on this board yet." : "No one on this board matches that."}
            </p>
          ) : null}
          {/* Said aloud too: the field keeps the focus, so a status the list's states would otherwise leave silent. */}
          <p role="status" className="sr-only">
            {state === "error" && !entries
              ? "Could not load people. Press Enter to retry."
              : entries && flat.length === 0
                ? (entries ?? []).length === 0
                  ? "No people on this board yet."
                  : "No one on this board matches that."
                : ""}
          </p>
          <Fitted listId={listId} groups={groups}>
            {(fitted) => (
          <ScrollArea
            axis="y"
            scrollerProps={{
              id: listId,
              role: "listbox",
              "aria-label": "People on this board",
              "aria-busy": (state === "pending" && !entries) || undefined,
              onMouseDown: (event) => event.preventDefault(),
            }}
            className={cn(LIST_HEIGHT, "scroll-py-6 px-1", flat.length > 0 && "py-1")}
            style={fitted === null ? undefined : { maxHeight: `min(${fitted}px, ${ROOM})` }}
            frameClassName={CLIPPED_EDGES}
          >
            {flat.length === 0
              ? null
              : groups.map((group, groupIndex) => {
                const headingId = `${listId}-${group.id}`;
                return (
                  <div
                    key={group.id}
                    role="group"
                    aria-labelledby={headingId}
                    className={cn(groupIndex > 0 && "mt-1 border-t border-rule-weak pt-1")}
                  >
                    <div id={headingId} role="presentation" className="micro flex h-7 items-center px-2.5 text-ink-low">
                      {group.label}
                    </div>
                    {group.entries.map((entry) => {
                      const index = positions.get(entry.person.id) ?? -1;
                      const selected = entry.person.id === value;
                      return (
                        // Reached through the field's aria-activedescendant (the listbox pattern), so pointer only here.
                        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                        <div
                          key={entry.person.id}
                          id={optionId(index)}
                          role="option"
                          tabIndex={-1}
                          aria-selected={selected}
                          data-active={index === activeIndex || undefined}
                          onPointerMove={() => {
                            if (index !== activeIndex) setActive(index);
                          }}
                          onClick={() => choose(entry)}
                          className="flex h-8 cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 text-sm text-ink-mid select-none data-[active]:bg-hover data-[active]:text-ink"
                        >
                          <PersonAvatar person={entry.person} />
                          <span className={cn("min-w-0 flex-1 truncate", selected && "font-medium text-ink")} title={entry.person.name}>
                            {entry.person.name}
                          </span>
                          {entry.tickets > 0 ? (
                            <span className="mono shrink-0 text-xs text-ink-low">{formatCount(entry.tickets, { locale })}</span>
                          ) : null}
                          {selected ? <Check aria-hidden size={14} strokeWidth={2} className="shrink-0 text-ink" /> : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </ScrollArea>
            )}
          </Fitted>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
