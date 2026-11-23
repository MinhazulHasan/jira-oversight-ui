"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import { useLayoutEffect, useState, type ReactNode } from "react";

import { PersonAvatar } from "@/components/ui/person-avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { floatingSurface } from "@/components/ui/surfaces";
import type { Person } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import type { MentionGroup } from "./mentions";

/** Where the board's people are: on their way, failed, or here. */
export type MentionMenuState = "pending" | "error" | "success";

export interface MentionMenuProps {
  open: boolean;
  /** The question's text row: the list opens against it, below (or, without room, above). */
  anchor: ReactNode;
  /** A click or focus outside the list closed it. */
  onClose: () => void;
  /** Esc closed it: the field keeps it closed until a new @. */
  onEscape: () => void;
  listId: string;
  optionId: (index: number) => string;
  state: MentionMenuState;
  /**
   * Everyone the search finds, in the list's groups ("With tickets", then
   * "No tickets"), a group the search empties left out. The options are
   * numbered through both, in order: `activeIndex` and `optionId` count them so.
   */
  groups: readonly MentionGroup[];
  /** What was typed after the @, for the empty state. */
  query: string;
  /** No one at all is on the board: nobody assigned a ticket, and no members. */
  nobody: boolean;
  activeIndex: number;
  onActive: (index: number) => void;
  onChoose: (person: Person) => void;
  onRetry: () => void;
}

/** Three rows in the list's final shape while the board's people arrive: nothing moves when they land. */
function LoadingRows() {
  return (
    <div aria-hidden className="flex flex-col gap-px p-1">
      {["w-28", "w-36", "w-24"].map((width) => (
        <span key={width} className="flex h-8 items-center gap-2.5 px-2">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className={cn("h-2.5", width)} />
        </span>
      ))}
    </div>
  );
}

/**
 * The list's width: a comfortable column for a name, never wider than a phone
 * allows, and never past the question box: it starts 12 px in from the box's
 * edge (alignOffset) and ends 12 px in from the other.
 */
export const MENU_WIDTH = "w-[min(20rem,calc(100vw-2rem),calc(var(--radix-popper-anchor-width,22rem)-1.5rem))]";

/**
 * The list's height until it is fitted (useFittedHeight): the first heading
 * and eight rows, then part of the next; never taller than the room Radix
 * finds below (or above) the box, less the list's 4 px above and below.
 */
export const LIST_HEIGHT = "max-h-[min(18.5rem,calc(var(--radix-popover-content-available-height,19rem)-1rem))]";
/** The same room, for the fitted height. */
export const ROOM = "calc(var(--radix-popover-content-available-height, 19rem) - 1rem)";
/** The list's height as a rule, and the most it grows to show the next group's heading and half its first row. */
const LIST_REM = 18.5;
const STRETCH_REM = 21.5;

/**
 * The list's height, fitted so its clipped edge always cuts a row in half,
 * the cue every menu gives that there is more: never in the gap between the
 * groups or on a heading, where a cut says nothing. When the next group's
 * heading and half its first row lie just past the rule's height (up to
 * 21.5rem), the list grows to show them, so "No tickets" is seen at once.
 * Measured after layout, again whenever the list's size changes (the room
 * Radix finds included); null while the list fits whole, or where nothing is
 * laid out.
 */
export function useFittedHeight(listId: string, groups: readonly unknown[]): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const list = document.getElementById(listId);
    if (!list) return;
    const fit = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const room = parseFloat(getComputedStyle(list).getPropertyValue("--radix-popover-content-available-height")) - rem;
      const cap = (value: number) => (Number.isFinite(room) ? Math.min(value, room) : value);
      const limit = cap(LIST_REM * rem);
      if (list.scrollHeight <= limit + 1) {
        setHeight(null);
        return;
      }
      const origin = list.getBoundingClientRect().top - list.scrollTop;
      const middle = (option: Element) => {
        const box = option.getBoundingClientRect();
        return box.top - origin + box.height / 2;
      };
      const next = list.querySelectorAll('[role="group"]')[1]?.querySelector('[role="option"]');
      const reach = next ? middle(next) : Number.NaN;
      if (reach > limit && reach <= cap(STRETCH_REM * rem)) {
        setHeight(Math.round(reach));
        return;
      }
      const cuts = [...list.querySelectorAll('[role="option"]')].map(middle).filter((cut) => cut > 0 && cut <= limit);
      setHeight(cuts.length > 0 ? Math.round(Math.max(...cuts)) : null);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    return () => observer.disconnect();
  }, [listId, groups]);
  return height;
}

/**
 * Where the list is clipped, the kit's fade, and a hairline in `--rule` along
 * the clipped edge, 4 px inside the menu's own: the fade alone says nothing
 * where the clip falls in white space (between the groups, or the scroll
 * padding below the row the keyboard is on). Both appear and go at once.
 */
export const CLIPPED_EDGES = [
  "before:transition-none after:transition-none",
  "before:border-t-[length:var(--hairline)] before:border-rule after:border-b-[length:var(--hairline)] after:border-rule",
].join(" ");

export type MentionListProps = Pick<
  MentionMenuProps,
  "listId" | "optionId" | "state" | "groups" | "query" | "nobody" | "activeIndex" | "onActive" | "onChoose" | "onRetry"
>;

/**
 * What the @ list holds, in each state: its loading rows, the reason it
 * holds no one, or the people the search finds as a listbox in two groups,
 * each a `group` named by its heading, each row their picture and name, the
 * highlighted row a ground change as in every menu. The listbox is the
 * scroller (a combobox's popup, as ARIA has it); the edge it can scroll
 * towards fades and takes a hairline, as macOS hides the scrollbar.
 */
export function MentionList({ listId, optionId, state, groups, query, nobody, activeIndex, onActive, onChoose, onRetry }: MentionListProps) {
  const fitted = useFittedHeight(listId, groups);
  if (state === "pending") return <LoadingRows />;
  if (state === "error") {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-ink-mid">
        <span>Couldn&rsquo;t load the board&rsquo;s people.</span>
        <button type="button" onClick={onRetry} className="pressable shrink-0 rounded-[5px] px-2 py-1 text-xs font-medium text-ink hover:bg-hover">
          Try again
        </button>
      </div>
    );
  }
  if (groups.every((group) => group.people.length === 0)) {
    return (
      <p className="px-3 py-2.5 text-sm text-ink-low">
        {nobody ? "No people on this board yet." : <>No one on this board matches &ldquo;{query.trim()}&rdquo;.</>}
      </p>
    );
  }
  // Each group's first option's place in the list as a whole: the keyboard runs through the groups as one list.
  const firsts = groups.map((_, at) => groups.slice(0, at).reduce((sum, group) => sum + group.people.length, 0));
  return (
    <div className="py-1">
      <ScrollArea
        axis="y"
        scrollerProps={{ id: listId, role: "listbox", "aria-label": "People to mention" }}
        // Scrolled to by the keyboard, a row stops clear of the 20 px fade; at either end the list scrolls all the way.
        className={cn(LIST_HEIGHT, "scroll-py-6 px-1")}
        style={fitted === null ? undefined : { maxHeight: `min(${fitted}px, ${ROOM})` }}
        frameClassName={CLIPPED_EDGES}
      >
        {groups.map((group, at) => {
          const headingId = `${listId}-${group.key}`;
          return (
            <div
              key={group.key}
              role="group"
              aria-labelledby={headingId}
              data-mention-group={group.key}
              className={cn(at > 0 && "hairline-t mt-1 pt-1")}
            >
              <div id={headingId} role="presentation" className="micro flex h-7 items-end px-2 pb-1.5 text-ink-low select-none">
                {group.label}
              </div>
              {group.people.map((person, offset) => {
                const index = firsts[at] + offset;
                return (
                  // Reached through the field's aria-activedescendant, so the options take the pointer but never
                  // the keyboard; the keyboard path is the field's own onKeyDown.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <div
                    key={person.id}
                    id={optionId(index)}
                    role="option"
                    // Focusable by script only: a tap moves focus here rather than away, so the list stays to be chosen from.
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex || undefined}
                    data-person={person.id}
                    onPointerMove={() => {
                      if (index !== activeIndex) onActive(index);
                    }}
                    onClick={() => onChoose(person)}
                    className="flex h-8 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-sm text-ink-mid outline-none select-none data-[active]:bg-hover data-[active]:text-ink"
                  >
                    <PersonAvatar person={person} size={24} />
                    <span className="min-w-0 truncate" title={person.name}>
                      {person.name}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}

/**
 * The @ list: everyone on the board, those who hold its tickets and then its
 * members who hold none, each with their picture and name, the one the
 * keyboard is on highlighted. A listbox the question field drives
 * (aria-activedescendant), so focus never leaves the question: the arrows
 * move, Enter or Tab chooses, Esc closes, and the pointer works as well.
 * Placed against the question box by Radix's popper, which keeps it on
 * screen; it opens and closes with the kit's calm pop, still with reduced motion.
 */
export function MentionMenu({
  open,
  anchor,
  onClose,
  onEscape,
  listId,
  optionId,
  state,
  groups,
  query,
  nobody,
  activeIndex,
  onActive,
  onChoose,
  onRetry,
}: MentionMenuProps) {
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <PopoverPrimitive.Anchor asChild>{anchor}</PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={2}
          alignOffset={12}
          collisionPadding={16}
          // The list is the field's (the combobox pattern), not a dialog of its own: no role, no focus of its own.
          role={undefined}
          tabIndex={undefined}
          data-mention-menu=""
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onEscape();
          }}
          // A press on the list keeps the caret in the question.
          onMouseDown={(event) => event.preventDefault()}
          className={cn(floatingSurface, MENU_WIDTH, "overflow-hidden")}
        >
          <MentionList
            listId={listId}
            optionId={optionId}
            state={state}
            groups={groups}
            query={query}
            nobody={nobody}
            activeIndex={activeIndex}
            onActive={onActive}
            onChoose={onChoose}
            onRetry={onRetry}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
