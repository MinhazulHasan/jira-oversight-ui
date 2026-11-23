"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Citation } from "@/lib/api/schemas";
import { isTypingTarget } from "@/lib/shortcuts";

import { cellId, targetKey, valueKey } from "./describe";

/**
 * Tick and tie: which cited value is traced to its row, and how the reader
 * moves between them.
 *
 * A value is traced while the pointer is on it or on its row (transient), or
 * while it is held. An answer that arrives holds its first value by itself
 * ("auto"), so the apparatus shows before anyone touches it. Clicking a
 * value, focusing it or stepping to it holds it for the reader ("user"):
 * from then on the arrow keys step through the values, and Esc lets go.
 */

type Source = "auto" | "user";
export type Step = "next" | "previous" | "first" | "last";

interface Hold {
  marker: number;
  source: Source;
}

interface TraceValue {
  /** The marker traced now: under the pointer, else held. */
  active: number | null;
  /** The held marker and who placed it. */
  held: Hold | null;
  /** Every citation drawn in the prose, by marker. */
  citations: ReadonlyMap<number, Citation>;
  /** Markers in reading order, for stepping. */
  order: readonly number[];
  point: (marker: number | null) => void;
  hold: (marker: number | null, source?: Source) => void;
  /** Move the hold, and keyboard focus, to another value. */
  step: (from: number | null, where: Step) => void;
  register: (key: string, node: HTMLElement | null) => void;
  node: (key: string) => HTMLElement | undefined;
  /** Bumped when the geometry may have changed, so the line is measured again. */
  epoch: number;
}

const TraceContext = createContext<TraceValue | null>(null);

/** The ledger's scrollers: the kit's ScrollArea frame carries data-axis, its scrolling child .jo-scroller. */
export const LEDGER_Y_SCROLLER = '[data-ledger] [data-axis="y"] > .jo-scroller';
export const LEDGER_X_SCROLLER = '[data-ledger] [data-axis="x"] > .jo-scroller';

/** Scroll `node` into view inside its own scroller only: never the page, so the value being read stays put. */
function revealWithin(node: HTMLElement, scroller: Element | null, axis: "x" | "y"): void {
  if (!(scroller instanceof HTMLElement)) return;
  const outer = scroller.getBoundingClientRect();
  const inner = node.getBoundingClientRect();
  const margin = 12;
  if (axis === "y") {
    if (inner.top < outer.top + margin) scroller.scrollTop -= outer.top + margin - inner.top;
    else if (inner.bottom > outer.bottom - margin) scroller.scrollTop += inner.bottom - outer.bottom + margin;
  } else if (inner.left < outer.left + margin) {
    scroller.scrollLeft -= outer.left + margin - inner.left;
  } else if (inner.right > outer.right - margin) {
    scroller.scrollLeft += inner.right - outer.right + margin;
  }
}

/** What the reader did, remembered for one answer only: a new answer starts from its own first value. */
interface Stored {
  answerId: string | null;
  marker: number | null;
  source: Source;
}

export function TraceProvider({
  answerId,
  citations,
  order,
  children,
}: {
  /** The answer on screen (its qa_id), or null. */
  answerId: string | null;
  citations: readonly Citation[];
  order: readonly number[];
  children: ReactNode;
}) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [pointed, setPointed] = useState<{ answerId: string | null; marker: number | null } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const nodes = useRef(new Map<string, HTMLElement>());

  // The first value is traced as soon as an answer is on screen; Esc (a stored null) lets it go.
  const held = useMemo<Hold | null>(() => {
    if (stored && stored.answerId === answerId) return stored.marker === null ? null : { marker: stored.marker, source: stored.source };
    return order.length > 0 ? { marker: order[0], source: "auto" } : null;
  }, [stored, answerId, order]);
  const pointer = pointed && pointed.answerId === answerId ? pointed.marker : null;

  const heldRef = useRef(held);
  const orderRef = useRef(order);
  const byMarker = useMemo(() => new Map(citations.map((citation) => [citation.marker, citation])), [citations]);

  useEffect(() => {
    heldRef.current = held;
    orderRef.current = order;
  });

  const setHeld = useCallback(
    (hold: Hold | null) => setStored({ answerId, marker: hold?.marker ?? null, source: hold?.source ?? "user" }),
    [answerId],
  );
  const setPointer = useCallback((marker: number | null) => setPointed({ answerId, marker }), [answerId]);

  const register = useCallback((key: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
    requestAnimationFrame(() => setEpoch((value) => value + 1));
  }, []);

  const node = useCallback((key: string) => nodes.current.get(key), []);

  /** Bring the traced row, and the cited cell within it, into view in the ledger. */
  const reveal = useCallback(
    (marker: number) => {
      const citation = byMarker.get(marker);
      if (!citation) return;
      const target = nodes.current.get(targetKey(citation));
      if (!target) return;
      revealWithin(target, target.closest(LEDGER_Y_SCROLLER), "y");
      const cell = target.querySelector<HTMLElement>(
        `[data-cell="${cellId(citation.fact_ref, citation.row_index, citation.column)}"]`,
      );
      if (cell) revealWithin(cell, cell.closest(LEDGER_X_SCROLLER), "x");
    },
    [byMarker],
  );

  const hold = useCallback(
    (marker: number | null, source: Source = "user") => {
      setHeld(marker === null ? null : { marker, source });
      if (marker !== null && source === "user") requestAnimationFrame(() => reveal(marker));
    },
    [reveal, setHeld],
  );

  const step = useCallback((from: number | null, where: Step) => {
    const list = orderRef.current;
    if (list.length === 0) return;
    const at = from === null ? -1 : list.indexOf(from);
    const index =
      where === "first"
        ? 0
        : where === "last"
          ? list.length - 1
          : at < 0
            ? 0
            : Math.min(list.length - 1, Math.max(0, at + (where === "next" ? 1 : -1)));
    // Focusing the value holds it (its focus handler), so the keyboard and the trace never disagree.
    nodes.current.get(valueKey(list[index]))?.focus();
  }, []);

  // Esc lets go; once the reader holds a value, the arrow keys step through them from anywhere on the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        if (heldRef.current) setHeld(null);
        return;
      }
      const where: Step | null =
        event.key === "ArrowDown" || event.key === "ArrowRight"
          ? "next"
          : event.key === "ArrowUp" || event.key === "ArrowLeft"
            ? "previous"
            : null;
      if (!where || heldRef.current?.source !== "user") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // The ledger's rows answer the arrow keys themselves.
      if (event.target instanceof Element && event.target.closest("[data-ledger]")) return;
      event.preventDefault();
      step(heldRef.current.marker, where);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, setHeld]);

  const value = useMemo<TraceValue>(
    () => ({
      active: pointer ?? held?.marker ?? null,
      held,
      citations: byMarker,
      order,
      point: setPointer,
      hold,
      step,
      register,
      node,
      epoch,
    }),
    [pointer, held, byMarker, order, setPointer, hold, step, register, node, epoch],
  );

  return <TraceContext.Provider value={value}>{children}</TraceContext.Provider>;
}

/** The trace, or null outside a TraceProvider (a component rendered on its own, as in a test). */
export function useTrace(): TraceValue | null {
  return useContext(TraceContext);
}

/** The citation being traced now, if any. */
export function useActiveCitation(): Citation | null {
  const trace = useTrace();
  if (!trace || trace.active === null) return null;
  return trace.citations.get(trace.active) ?? null;
}
