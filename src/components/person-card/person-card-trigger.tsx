"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import { usePeopleLevel } from "@/components/shell/people-level";
import { CONTAINED_EVENTS, keepBackspaceFromBrowser } from "@/components/ui/contained-events";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { WithoutNameTooltips } from "@/components/ui/person-name";
import { Sheet } from "@/components/ui/sheet";
import { notify } from "@/lib/notify";
import { SCORECARD_DEFAULT_DAYS, type Person, type ScorecardDays } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { edgeCrossing, insidePolygon, laneArea, wayArea, type Point } from "./grace";
import { CARD_WIDTH_PX, PersonCardPopoverBody, usePersonCardSheetParts } from "./person-card";

/** How long the pointer rests on a name before its card opens. */
export const HOVER_INTENT_MS = 350;
/** How long after the pointer has left both the name and the card (and the way between them) before the card closes. */
export const HOVER_CLOSE_MS = 150;
/** How long the pointer may stand still on the way from a name to its card before it is taken to have gone elsewhere. */
export const GRACE_REST_MS = 500;
export const TYPING_QUIET_MS = 300;

/** A pointer that hovers, on a window wide enough for a card beside a name. Anywhere else a tap opens a bottom sheet. */
export const DESKTOP_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 40rem)";

/** Taller than the card with a two-line name (about 592 px): below or above a name only where it fits whole, else beside it. */
const CARD_ROOM_PX = 600;
const GAP_PX = 8;
const EDGE_PX = 12;
/** What takes focus when pressed: a press on one of these keeps the focus it gave, rather than going back to the name. */
const FOCUSABLE = "a[href], button, input, select, textarea, [contenteditable='true'], [tabindex]:not([tabindex='-1'])";
/** What Tab stops on. */
const TAB_STOPS =
  "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

type Mode = "hover" | "pinned" | "sheet";

export const NAME_TRIGGER =
  "inline-flex max-w-full min-w-0 items-center align-middle [&_[data-person-name]]:decoration-rule-strong [&_[data-person-name]]:underline-offset-[3px] hover:[&_[data-person-name]]:underline data-[state=open]:[&_[data-person-name]]:underline";

/* ------------------------------------------------- one card at a time --- */

interface OpenCard {
  id: string;
  mode: Mode;
}

let openCard: OpenCard | null = null;
const listeners = new Set<() => void>();

function setOpenCard(next: OpenCard | null): void {
  openCard = next;
  for (const listener of listeners) listener();
}

function subscribeOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Which card is open, and how: one for the whole page. */
function useOpenCard(): OpenCard | null {
  return useSyncExternalStore(
    subscribeOpen,
    () => openCard,
    () => null,
  );
}

/* ------------------------------------------------------------- typing --- */

/** When a key was last pressed in the question box. */
let typedAt = Number.NEGATIVE_INFINITY;
/** The waits for a hover card now running, each cancelled by a key. */
const intents = new Set<() => void>();

export function noteTyping(): void {
  typedAt = performance.now();
  for (const cancel of intents) cancel();
  intents.clear();
}

/* ------------------------------------------------------------ the way --- */

let travel: { id: string; end: () => void; inLane: boolean } | null = null;
/** Names the pointer came onto in the lane: their wait starts once it is out of the lane, if it is still there. */
const afterTravel = new Set<() => void>();

/** The names held back by the lane may start their wait. */
function releaseHeld(): void {
  const waiting = [...afterTravel];
  afterTravel.clear();
  for (const retry of waiting) retry();
}

/** Ends the travel now running: its listener and its timer go, and the names it held back may start their wait. */
function endTravel(): void {
  const current = travel;
  if (current === null) return;
  travel = null;
  current.end();
  releaseHeld();
}

/** Closes whatever card is open, and forgets any typing and any travel (a test's tidy-up). */
export function closePersonCards(): void {
  typedAt = Number.NEGATIVE_INFINITY;
  for (const cancel of intents) cancel();
  intents.clear();
  afterTravel.clear();
  endTravel();
  setOpenCard(null);
}

/* ------------------------------------------------------------ desktop --- */

function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True where the card opens beside the name on hover; false on a touch screen or a phone, where it is a bottom sheet. */
export function useDesktopCards(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_QUERY).matches : true),
    () => true,
  );
}

type Side = "bottom" | "top" | "right";

function sideFor(anchor: Element | null): Side {
  if (!anchor) return "bottom";
  const rect = anchor.getBoundingClientRect();
  if (window.innerHeight - rect.bottom - GAP_PX - EDGE_PX >= CARD_ROOM_PX) return "bottom";
  if (rect.top - GAP_PX - EDGE_PX >= CARD_ROOM_PX) return "top";
  return "right";
}

/* -------------------------------------------------------- the keyboard --- */

/** The elements Tab stops on inside `root`, in order: shown, enabled, never a focus guard. */
function tabStops(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TAB_STOPS)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.hasAttribute("data-radix-focus-guard") &&
      !element.closest("[hidden], [inert], [aria-hidden='true']") &&
      (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true })),
  );
}

/** The first Tab stop on the page after `origin` (neither inside it nor inside the card): where Tab goes past a card. */
function nextTabStop(origin: Element, card: Element): HTMLElement | null {
  return (
    tabStops(document).find(
      (element) => !card.contains(element) && !origin.contains(element) && (origin.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ) ?? null
  );
}

function letGoOfOutsideCaret(card: Element | null): void {
  const selection = document.getSelection();
  const at = selection && selection.rangeCount > 0 ? selection.anchorNode : null;
  const holder = at instanceof Element ? at : (at?.parentElement ?? null);
  if (!holder || card?.contains(holder)) return;
  const editable = (holder instanceof HTMLElement && holder.isContentEditable) || holder.closest("[contenteditable]:not([contenteditable='false'])") !== null;
  if (editable) selection?.removeAllRanges();
}

/** Focus into a pinned card, the caret outside it let go first. */
function focusCard(card: HTMLElement | null): void {
  if (!card) return;
  letGoOfOutsideCaret(card);
  card.focus({ preventScroll: true });
}

/* ------------------------------------------------------------ behaviour --- */

interface CardOptions {
  /** A press opens the card and pins it (a bottom sheet where nothing hovers); without, the press is the control's own. */
  pressable: boolean;
  /** No card on hover while what the control opens is open (the Person menu). */
  disabled?: boolean;
}

/** One name's card: its state from the page's one open card, the hover's timers, the way to the card, and the handlers. */
function useCard({ pressable, disabled = false }: CardOptions) {
  const id = useId();
  const open = useOpenCard();
  const desktop = useDesktopCards();
  const mode: Mode | null = open?.id === id ? open.mode : null;
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  /** The open card's element: where the pointer leaving the name is heading. */
  const content = useRef<HTMLDivElement | null>(null);
  /** The pointer is on the name and has not had its card yet: a move tries again where its arrival could not open one. */
  const wanting = useRef(false);
  /** `disabled` as the timers read it when they fire. */
  const blocked = useRef(disabled);
  /** `arm` as it is now, for a wait held back by another card's travel and started when it ends. */
  const armNow = useRef<() => void>(() => {});
  /** Where the pointer was last seen on the name or the card: one that leaves is read from where it crossed the edge. */
  const lastOn = useRef<{ element: Element; point: Point } | null>(null);
  /** The places the pointer has been reported at on this name since it came onto it: one is a pass, two a hand on it. */
  const onName = useRef<{ count: number; at: Point | null }>({ count: 0, at: null });
  const [side, setSide] = useState<Side>("bottom");

  const clearOpen = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    clearOpen();
    intents.delete(clearOpen);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (travel?.id === id) endTravel();
  }, [clearOpen, id]);

  const show = useCallback(
    (next: Mode) => {
      clearTimers();
      wanting.current = false;
      if (next !== "sheet") setSide(sideFor(anchor.current));
      setOpenCard({ id, mode: next });
    },
    [clearTimers, id],
  );

  const close = useCallback(() => {
    clearTimers();
    if (openCard?.id === id) setOpenCard(null);
  }, [clearTimers, id]);

  /** The 150 ms before a hover card closes, from now. */
  const startClose = useCallback(() => {
    if (openCard?.id === id && openCard.mode === "hover" && !closeTimer.current) closeTimer.current = setTimeout(close, HOVER_CLOSE_MS);
  }, [close, id]);

  /** A wait held back by another card's travel, started now if the pointer is still on the name. */
  const armAgain = useCallback(() => {
    if (wanting.current) armNow.current();
  }, []);

  useEffect(() => {
    blocked.current = disabled;
    if (disabled) {
      clearOpen();
      intents.delete(clearOpen);
    }
  }, [clearOpen, disabled]);

  /** The element the card is placed against (the name), as a ref callback, and read back when the card closes. */
  const setAnchor = useCallback((node: HTMLElement | null) => {
    anchor.current = node;
  }, []);
  const getAnchor = useCallback(() => anchor.current, []);

  // Gone from the page (a row redrawn, a chip deleted, a page left): no timer fires, and its card closes with it.
  useEffect(
    () => () => {
      afterTravel.delete(armAgain);
      clearTimers();
      if (openCard?.id === id) setOpenCard(null);
    },
    [armAgain, clearTimers, id],
  );

  /** The wait before a hover card opens, where one may: never over a pinned card, while typing, or over the control's own menu. */
  const arm = useCallback(() => {
    if (openTimer.current || openCard?.id === id || openCard?.mode === "pinned" || blocked.current) return;
    if (performance.now() - typedAt < TYPING_QUIET_MS) return;
    if (travel !== null && travel.id !== id && (travel.inLane || onName.current.count < 2)) {
      afterTravel.add(armAgain);
      return;
    }
    const armedAt = performance.now();
    intents.add(clearOpen);
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      intents.delete(clearOpen);
      if (openCard?.mode === "pinned" || blocked.current || typedAt > armedAt) return;
      show("hover");
    }, HOVER_INTENT_MS);
  }, [armAgain, clearOpen, id, show]);

  useEffect(() => {
    armNow.current = arm;
  }, [arm]);

  // No longer open (closed, or another card opened in its place): no way to it is left to travel.
  useEffect(() => {
    if (mode === null && travel?.id === id) endTravel();
  }, [id, mode]);

  const travelFrom = useCallback(
    (exit: Point, now: Point, from: Element, to: Element | null) => {
      if (to === null) {
        startClose();
        return;
      }
      const fromBox = from.getBoundingClientRect();
      const toCard = to === content.current;
      let shapes: { way: Point[]; lane: Point[] } | null = null;
      const draw = () => {
        if (shapes) return shapes;
        const toBox = to.getBoundingClientRect();
        // Measured off the page, above the window: not placed yet.
        if (toCard && toBox.bottom <= 0) return null;
        shapes = { way: wayArea(exit, fromBox, toBox), lane: laneArea(exit, fromBox, toBox) };
        return shapes;
      };
      let rest: ReturnType<typeof setTimeout> | null = null;
      const gone = () => {
        if (travel !== mine) return;
        endTravel();
        startClose();
      };
      const step = (point: Point) => {
        const drawn = draw();
        if (drawn && !insidePolygon(point, drawn.way)) {
          gone();
          return;
        }
        const inLane = drawn === null || insidePolygon(point, drawn.lane);
        if (mine.inLane && !inLane) {
          // Off the straight ways, still on the way: a name the pointer has come onto may start its wait.
          mine.inLane = false;
          releaseHeld();
        } else mine.inLane = inLane;
        if (rest) clearTimeout(rest);
        rest = setTimeout(gone, GRACE_REST_MS);
      };
      const track = (event: globalThis.PointerEvent) => {
        if (event.pointerType !== "touch") step({ x: event.clientX, y: event.clientY });
      };
      const mine = {
        id,
        inLane: true,
        end: () => {
          document.removeEventListener("pointermove", track, true);
          if (rest) clearTimeout(rest);
        },
      };
      endTravel();
      travel = mine;
      // Captured at the document, before anything on the page (a card's own events stop at its edge) can stop it.
      document.addEventListener("pointermove", track, true);
      // Where it is now is its first step: out by a side facing away from the other, it is off the way at once.
      step(now);
    },
    [id, startClose],
  );

  /** The pointer seen on the name or the card (not a touch, which has no way between them). */
  const sighted = useCallback((event: PointerEvent<HTMLElement>) => {
    lastOn.current = { element: event.currentTarget, point: { x: event.clientX, y: event.clientY } };
  }, []);

  const enter = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch" || !desktop) return;
      sighted(event);
      onName.current = { count: 1, at: { x: event.clientX, y: event.clientY } };
      // Back on the name (or the card) before it closed: it stays.
      if (travel?.id === id) endTravel();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      wanting.current = true;
      arm();
    },
    [arm, desktop, id, sighted],
  );

  /** The pointer moving on the name: the wait starts now if its arrival could not start it (typing, a pinned card, a menu). */
  const move = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch" || !desktop) return;
      sighted(event);
      // A report at a new place (the move that brought the pointer here, sent with its arrival, is not one).
      const at = onName.current.at;
      if (at === null || at.x !== event.clientX || at.y !== event.clientY) {
        onName.current = { count: onName.current.count + 1, at: { x: event.clientX, y: event.clientY } };
      }
      if (wanting.current) arm();
    },
    [arm, desktop, sighted],
  );

  const leave = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      wanting.current = false;
      onName.current = { count: 0, at: null };
      afterTravel.delete(armAgain);
      clearOpen();
      intents.delete(clearOpen);
      const from = event.currentTarget;
      const seen = lastOn.current;
      lastOn.current = null;
      if (openCard?.id !== id || openCard.mode !== "hover" || closeTimer.current) return;
      // Where it crossed the edge, from its last sighting on what it left: the first move off it can be far past it.
      const at = { x: event.clientX, y: event.clientY };
      const exit = seen?.element === from ? edgeCrossing(seen.point, at, from.getBoundingClientRect()) : at;
      travelFrom(exit, at, from, from === anchor.current ? content.current : anchor.current);
    },
    [armAgain, clearOpen, id, travelFrom],
  );

  /** The pointer is on the card: it stays. */
  const hold = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      sighted(event);
      if (travel?.id === id) endTravel();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
    },
    [id, sighted],
  );

  /** The pointer moving on the card: its last sighting there, for where it leaves. */
  const moveOnCard = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") sighted(event);
    },
    [sighted],
  );

  /** A press on the name: the card pinned (a bottom sheet where nothing hovers), or closed when it already is. */
  const press = useCallback(() => {
    if (!pressable) return;
    wanting.current = false;
    if (!desktop) show("sheet");
    else if (openCard?.id === id && openCard.mode === "pinned") close();
    else show("pinned");
  }, [close, desktop, id, pressable, show]);

  const stepAside = useCallback(() => {
    wanting.current = false;
    if (openCard?.id === id) close();
    else {
      clearOpen();
      intents.delete(clearOpen);
    }
  }, [clearOpen, close, id]);

  return { mode, desktop, setAnchor, getAnchor, content, side, enter, move, leave, hold, moveOnCard, press, close, stepAside };
}

/* ------------------------------------------------------------- the card --- */

interface CardPopoverProps {
  person: Person;
  days: ScorecardDays;
  board?: string | null;
  mode: Mode | null;
  side: Side;
  /** The card's element, for its owner's way to it (the grace area) and for focus. */
  contentRef: RefObject<HTMLDivElement | null>;
  getAnchor: () => HTMLElement | null;
  /** What opened the card and takes focus back, when it is not what the card is placed against (a pill's picture). */
  getOpener?: () => HTMLElement | null;
  onHold: (event: PointerEvent<HTMLElement>) => void;
  /** The pointer moving on the card, for where it leaves it. */
  onTrack: (event: PointerEvent<HTMLElement>) => void;
  onLeave: (event: PointerEvent<HTMLElement>) => void;
  onClose: () => void;
  /** Where focus goes when a pinned card closes, in place of the name: a chip gives it to its field. */
  onReturnFocus?: () => void;
}

function CardPopover({ person, days, board, mode, side, contentRef, getAnchor, getOpener, onHold, onTrack, onLeave, onClose, onReturnFocus }: CardPopoverProps) {
  const pinned = mode === "pinned";
  const [overflowing, setOverflowing] = useState(false);
  /** How the card was last open, and how it was left: read once it has closed, when its mode is gone. */
  const last = useRef<{ pinned: boolean; outside: Element | null; onAnchor: boolean; tabbedAway: boolean; followed: boolean }>({
    pinned: false,
    outside: null,
    onAnchor: false,
    tabbedAway: false,
    followed: false,
  });

  useEffect(() => {
    if (mode === null) return;
    last.current = { pinned: mode === "pinned", outside: null, onAnchor: false, tabbedAway: false, followed: false };
    // Pinned from a hover card already on screen: focus moves inside, as when a press opens it.
    if (mode === "pinned") focusCard(contentRef.current);
  }, [contentRef, mode]);

  /** The card's element as it mounts: a render after it opens, since its portal mounts first. */
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      setElement(node);
    },
    [contentRef],
  );

  useEffect(() => {
    if (!element) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [element]);

  const follow = useCallback(() => {
    last.current.followed = true;
    onClose();
  }, [onClose]);

  const tab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (pinned) keepBackspaceFromBrowser(event);
    if (!pinned || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const card = contentRef.current;
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    const stops = tabStops(card);
    const at = stops.findIndex((stop) => stop === document.activeElement);
    const next = event.shiftKey ? (at === -1 ? -1 : at - 1) : at + 1;
    if (next >= 0 && next < stops.length) {
      stops[next].focus();
      return;
    }
    last.current.tabbedAway = true;
    const origin = getOpener?.() ?? getAnchor();
    if (event.shiftKey) {
      if (onReturnFocus) onReturnFocus();
      else origin?.focus({ preventScroll: true });
    } else {
      const after = origin ? nextTabStop(origin, card) : null;
      (after ?? origin)?.focus({ preventScroll: true });
    }
    onClose();
  };

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        {...CONTAINED_EVENTS}
        ref={attach}
        tabIndex={-1}
        side={side}
        align="start"
        sideOffset={GAP_PX}
        collisionPadding={EDGE_PX}
        data-person-card-mode={mode ?? undefined}
        data-overflowing={overflowing || undefined}
        onKeyDownCapture={tab}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // A hover card is to be looked at, not stepped into: focus stays where it was (the question box, a row).
          if (pinned) focusCard(contentRef.current);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const { pinned: wasPinned, outside, onAnchor, tabbedAway, followed } = last.current;
          const name = getOpener?.() ?? getAnchor();
          // Another card has opened in its place, or the card was left for one of its links: focus is theirs.
          if (!wasPinned || openCard !== null || tabbedAway || followed || !name?.isConnected) return;
          if (!onAnchor && outside?.closest(FOCUSABLE)) return;
          if (onReturnFocus) onReturnFocus();
          else name.focus({ preventScroll: true });
        }}
        onPointerDownOutside={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          const onAnchor = target !== null && (getAnchor()?.contains(target) ?? false);
          last.current.outside = target;
          last.current.onAnchor = onAnchor;
          // A press on the name is the name's own (it closes the pinned card, or pins a hover card): the layer leaves it.
          if (onAnchor) event.preventDefault();
        }}
        onFocusOutside={(event) => {
          // A press on plain page text moves focus to the page itself before the card closes: that is not tabbing away.
          const landed = event.target instanceof Element ? event.target : null;
          if (landed && !landed.closest(FOCUSABLE)) return;
          last.current.tabbedAway = true;
        }}
        onPointerEnter={onHold}
        onPointerMove={(event) => {
          // Still kept from the row or field the name sits in, as CONTAINED_EVENTS does.
          event.stopPropagation();
          onTrack(event);
        }}
        onPointerLeave={onLeave}
        style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
        className="jo-person-card z-[var(--z-overlay)] max-w-[calc(100vw-24px)] overflow-x-hidden overflow-y-auto rounded-lg bg-raised shadow-pop outline-none data-[overflowing]:overscroll-contain"
      >
        {/* The brief's 340 px: a fixed width, so the card is the same height whatever it holds. */}
        <div style={{ width: CARD_WIDTH_PX }} className="max-w-full">
          <PersonCardPopoverBody person={person} days={days} board={board} pinned={pinned} onClose={follow} />
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

interface CardSheetProps {
  person: Person;
  days: ScorecardDays;
  board?: string | null;
  open: boolean;
  onClose: () => void;
  onReturnFocus: () => void;
}

function CardSheet({ person, days, board, open, onClose, onReturnFocus }: CardSheetProps) {
  /** Left for one of its links: the page is moving on, so focus goes nowhere. */
  const followed = useRef(false);
  useEffect(() => {
    if (!open) return;
    followed.current = false;
    // Focus goes into the sheet: a caret left in the question box is let go, as for a pinned card.
    letGoOfOutsideCaret(null);
    notify.dismiss();
  }, [open]);
  const follow = useCallback(() => {
    followed.current = true;
    onClose();
  }, [onClose]);
  const parts = usePersonCardSheetParts({ person, days, board, onClose: follow, enabled: open });
  return (
    <Sheet
      side="bottom"
      contained
      keepBackspace
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onCloseFocus={() => {
        if (!followed.current) onReturnFocus();
      }}
      title={person.name}
      leading={<PersonAvatar person={person} size={48} board={board} />}
      description={parts.description}
      footer={parts.footer}
    >
      {parts.body}
    </Sheet>
  );
}

/* ------------------------------------------------------------- triggers --- */

export interface PersonCardTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type"> {
  /** Whose card: the API's person object, as the page names them. */
  person: Person;
  /** The period the card's counts cover: the page's where it has one (the People page), else 90 days. */
  days?: ScorecardDays;
  /** The board to read the card on, where the page names one (an access log entry's); else the top bar's. */
  board?: string | null;
  inRow?: boolean;
  /** Out of the Tab order, in a table whose rows have one tab stop between them (the card is a key away elsewhere). */
  tabbable?: boolean;
  /** What the name looks like: the picture and the name, or the pill. */
  children: ReactNode;
}

export function PersonCardTrigger(props: PersonCardTriggerProps) {
  const peopleLevel = usePeopleLevel();
  if (!peopleLevel) return <>{props.children}</>;
  return <CardButton {...props} />;
}

function CardButton({
  person,
  days = SCORECARD_DEFAULT_DAYS,
  board,
  inRow = false,
  tabbable = true,
  children,
  className,
  onKeyDown,
  onFocus,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  ...rest
}: PersonCardTriggerProps) {
  const { mode, desktop, setAnchor, getAnchor, content, side, enter, move, leave, hold, moveOnCard, press, close } = useCard({ pressable: true });
  const returnFocus = useCallback(() => getAnchor()?.focus({ preventScroll: true }), [getAnchor]);

  return (
    <WithoutNameTooltips>
      <PopoverPrimitive.Root
        open={desktop && (mode === "hover" || mode === "pinned")}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        modal={false}
      >
        <PopoverPrimitive.Trigger asChild>
          <button
            {...rest}
            ref={setAnchor}
            type="button"
            tabIndex={tabbable ? undefined : -1}
            data-person-card-trigger={person.id}
            onPointerEnter={(event) => {
              onPointerEnter?.(event);
              enter(event);
            }}
            onPointerMove={(event) => {
              onPointerMove?.(event);
              move(event);
            }}
            onPointerLeave={(event) => {
              onPointerLeave?.(event);
              leave(event);
            }}
            onClick={(event) => {
              // The card is the name's own doing: Radix's toggle, and the row around it, stay out of it.
              event.preventDefault();
              if (inRow) event.stopPropagation();
              press();
            }}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
              onKeyDown?.(event);
              // Enter and Space are the name's (they pin its card), never the row's around it.
              if (inRow && (event.key === "Enter" || event.key === " ")) event.stopPropagation();
            }}
            onFocus={(event: FocusEvent<HTMLButtonElement>) => {
              onFocus?.(event);
              if (inRow) event.stopPropagation();
            }}
            className={cn("-my-0.5 cursor-pointer rounded-[4px] py-0.5 text-left outline-offset-2 select-text", className)}
          >
            {children}
          </button>
        </PopoverPrimitive.Trigger>
        {desktop ? (
          <CardPopover
            person={person}
            days={days}
            board={board}
            mode={mode}
            side={side}
            contentRef={content}
            getAnchor={getAnchor}
            onHold={hold}
            onTrack={moveOnCard}
            onLeave={leave}
            onClose={close}
          />
        ) : null}
      </PopoverPrimitive.Root>
      {desktop ? null : <CardSheet person={person} days={days} board={board} open={mode === "sheet"} onClose={close} onReturnFocus={returnFocus} />}
    </WithoutNameTooltips>
  );
}

export interface PersonCardChipProps {
  /** Whose card: the person the chip stands for. */
  person: Person;
  days?: ScorecardDays;
  onReturnFocus: () => void;
  /** The chip: an element that takes a ref and the pointer's handlers, and is never focused itself. */
  children: ReactElement;
}

export function PersonCardChip({ person, days = SCORECARD_DEFAULT_DAYS, onReturnFocus, children }: PersonCardChipProps) {
  const peopleLevel = usePeopleLevel();
  if (!peopleLevel) return children;
  return (
    <ChipCard person={person} days={days} onReturnFocus={onReturnFocus}>
      {children}
    </ChipCard>
  );
}

function ChipCard({ person, days, onReturnFocus, children }: { person: Person; days: ScorecardDays; onReturnFocus: () => void; children: ReactElement }) {
  const { mode, desktop, setAnchor, getAnchor, content, side, enter, move, leave, hold, moveOnCard, press, close } = useCard({ pressable: true });
  return (
    <>
      <PopoverPrimitive.Root
        open={desktop && (mode === "hover" || mode === "pinned")}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        modal={false}
      >
        <PopoverPrimitive.Anchor
          asChild
          ref={setAnchor}
          data-card-open={mode ? "" : undefined}
          onPointerEnter={enter}
          onPointerMove={move}
          onPointerLeave={leave}
          onClick={(event: MouseEvent<HTMLElement>) => {
            // Shift and a press reaches the selection to the chip (the field's); a plain press is the card's.
            if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            press();
          }}
        >
          {children}
        </PopoverPrimitive.Anchor>
        {desktop ? (
          <CardPopover
            person={person}
            days={days}
            mode={mode}
            side={side}
            contentRef={content}
            getAnchor={getAnchor}
            onHold={hold}
            onTrack={moveOnCard}
            onLeave={leave}
            onClose={close}
            onReturnFocus={onReturnFocus}
          />
        ) : null}
      </PopoverPrimitive.Root>
      {desktop ? null : <CardSheet person={person} days={days} open={mode === "sheet"} onClose={close} onReturnFocus={onReturnFocus} />}
    </>
  );
}

export interface PersonCardPillProps {
  person: Person;
  days?: ScorecardDays;
  /** The board to read the card on (an access log entry's), else the top bar's. */
  board?: string | null;
  /** The pill's picture: it stands in the card's own button, at the pill's start. */
  picture: ReactNode;
  /** The rest of the pill: a control with a press of its own (the access log's filter by person). */
  children: ReactNode;
  /** The pill's look: its ground, corners and height; its two parts sit inside. */
  className?: string;
}

export function PersonCardPill({ person, days = SCORECARD_DEFAULT_DAYS, board, picture, children, className }: PersonCardPillProps) {
  const peopleLevel = usePeopleLevel();
  if (!peopleLevel) {
    return (
      <span className={className}>
        <span className="inline-flex shrink-0 p-0.5">{picture}</span>
        {children}
      </span>
    );
  }
  return (
    <CardPill person={person} days={days} board={board} picture={picture} className={className}>
      {children}
    </CardPill>
  );
}

function CardPill({ person, days, board, picture, children, className }: Omit<PersonCardPillProps, "days"> & { days: ScorecardDays }) {
  const { mode, desktop, setAnchor, getAnchor, content, side, enter, move, leave, hold, moveOnCard, press, close, stepAside } = useCard({ pressable: true });
  const opener = useRef<HTMLButtonElement>(null);
  /** The pill's own control, when a press on it put the card aside: focus stays with what was pressed. */
  const pressed = useRef<HTMLElement | null>(null);
  const getOpener = useCallback(() => opener.current, []);
  const returnFocus = useCallback(() => {
    const to = pressed.current?.isConnected ? pressed.current : opener.current;
    pressed.current = null;
    to?.focus({ preventScroll: true });
  }, []);
  return (
    <WithoutNameTooltips>
      <PopoverPrimitive.Root
        open={desktop && (mode === "hover" || mode === "pinned")}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        modal={false}
      >
        <PopoverPrimitive.Anchor
          asChild
          ref={setAnchor}
          onPointerEnter={enter}
          onPointerMove={move}
          onPointerLeave={leave}
          onPointerDown={(event: PointerEvent<HTMLElement>) => {
            // A press on the pill's own control (anywhere but its picture) is that control's: the card steps aside.
            if (event.button !== 0 || !(event.target instanceof Element) || opener.current?.contains(event.target)) return;
            pressed.current = event.target.closest<HTMLElement>("button, a[href]");
            stepAside();
          }}
        >
          <span className={className} data-person-card-pill={person.id}>
            <button
              ref={opener}
              type="button"
              aria-label={`${person.name}'s card`}
              aria-haspopup="dialog"
              aria-expanded={mode !== null}
              data-person-card-trigger={person.id}
              onClick={(event) => {
                event.preventDefault();
                pressed.current = null;
                press();
              }}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5"
            >
              {picture}
            </button>
            {children}
          </span>
        </PopoverPrimitive.Anchor>
        {desktop ? (
          <CardPopover
            person={person}
            days={days}
            board={board}
            mode={mode}
            side={side}
            contentRef={content}
            getAnchor={getAnchor}
            getOpener={getOpener}
            onHold={hold}
            onTrack={moveOnCard}
            onLeave={leave}
            onClose={close}
            onReturnFocus={returnFocus}
          />
        ) : null}
      </PopoverPrimitive.Root>
      {desktop ? null : <CardSheet person={person} days={days} board={board} open={mode === "sheet"} onClose={close} onReturnFocus={returnFocus} />}
    </WithoutNameTooltips>
  );
}

export interface PersonCardHoverProps {
  person: Person;
  days?: ScorecardDays;
  board?: string | null;
  /** The element the pointer rests on: one that keeps its own press (a filter's trigger, a link to their findings). */
  children: ReactElement;
  /** While what the control opens is open (the Person menu), resting on the name opens no card over it. */
  disabled?: boolean;
}

export function PersonCardHover({ person, days = SCORECARD_DEFAULT_DAYS, board, disabled = false, children }: PersonCardHoverProps) {
  const peopleLevel = usePeopleLevel();
  if (!peopleLevel) return children;
  return (
    <HoverCard person={person} days={days} board={board} disabled={disabled}>
      {children}
    </HoverCard>
  );
}

function HoverCard({
  person,
  days,
  board,
  disabled,
  children,
}: {
  person: Person;
  days: ScorecardDays;
  board?: string | null;
  disabled: boolean;
  children: ReactElement;
}) {
  const { mode, desktop, setAnchor, getAnchor, content, side, enter, move, leave, hold, moveOnCard, close, stepAside } = useCard({ pressable: false, disabled });
  return (
    <PopoverPrimitive.Root
      open={desktop && mode === "hover"}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      modal={false}
    >
      <PopoverPrimitive.Anchor asChild ref={setAnchor} onPointerEnter={enter} onPointerMove={move} onPointerLeave={leave} onPointerDown={stepAside}>
        {children}
      </PopoverPrimitive.Anchor>
      {desktop ? (
        <CardPopover
          person={person}
          days={days}
          board={board}
          mode={mode}
          side={side}
          contentRef={content}
          getAnchor={getAnchor}
          onHold={hold}
          onTrack={moveOnCard}
          onLeave={leave}
          onClose={close}
        />
      ) : null}
    </PopoverPrimitive.Root>
  );
}
