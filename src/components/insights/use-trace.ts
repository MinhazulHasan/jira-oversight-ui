"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type RefObject } from "react";

import { isTypingTarget } from "@/lib/shortcuts";

export type TraceKind = "sentence" | "candidate";
export type TraceTarget = { kind: TraceKind; id: string } | null;

const ROW = "[data-trace-kind]";
const INTERACTIVE = "a, button, input, select, textarea, summary, [role='button'], [role='link']";

function sameTarget(a: TraceTarget, b: TraceTarget): boolean {
  return a?.kind === b?.kind && a?.id === b?.id;
}

function targetOf(container: HTMLElement, node: EventTarget | null): TraceTarget {
  if (!(node instanceof Element)) return null;
  const row = node.closest<HTMLElement>(ROW);
  if (!row || !container.contains(row)) return null;
  const kind = row.dataset.traceKind;
  const id = row.dataset.traceId;
  return (kind === "sentence" || kind === "candidate") && id ? { kind, id } : null;
}

/** What the reader is on: the row under the pointer, else the row holding focus. */
export function useTrace(containerRef: RefObject<HTMLElement | null>): TraceTarget {
  const [hovered, setHovered] = useState<TraceTarget>(null);
  const [focused, setFocused] = useState<TraceTarget>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const next = targetOf(container, event.target);
      setHovered((previous) => (sameTarget(previous, next) ? previous : next));
    };
    const onLeave = () => setHovered(null);
    const onFocusIn = (event: FocusEvent) => {
      const next = targetOf(container, event.target);
      setFocused((previous) => (sameTarget(previous, next) ? previous : next));
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !container.contains(event.relatedTarget)) setFocused(null);
    };
    container.addEventListener("pointerover", onOver);
    container.addEventListener("pointerleave", onLeave);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    return () => {
      container.removeEventListener("pointerover", onOver);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
    };
  }, [containerRef]);

  return hovered ?? focused;
}

/** Bring a row into view and put focus on its own link. */
export function focusRow(row: Element | null): void {
  if (!(row instanceof HTMLElement)) return;
  const link = row.querySelector<HTMLElement>("[data-row-primary]");
  (link ?? row).focus({ preventScroll: true });
  row.scrollIntoView?.({ block: "nearest" });
}

/** Rows lead somewhere on click, and j / k walk them from anywhere on the page. */
export function useRowNavigation(containerRef: RefObject<HTMLElement | null>): void {
  const router = useRouter();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest(INTERACTIVE)) return;
      const row = event.target.closest<HTMLElement>("[data-row-href]");
      const href = row?.dataset.rowHref;
      if (!row || !href || !container.contains(row)) return;
      // A drag that selected words is the reader copying a sentence, not choosing it.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && row.contains(selection.anchorNode)) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(href, "_blank", "noopener");
        return;
      }
      // Through the router, a jump within the page too, so Back can return to it.
      router.push(href);
      if (href.startsWith("#")) requestAnimationFrame(() => focusRow(document.getElementById(href.slice(1))));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "j" && event.key !== "k") return;
      if (isTypingTarget(event.target)) return;
      const rows = [...container.querySelectorAll<HTMLElement>("[data-row-href]")];
      if (rows.length === 0) return;
      const current = rows.findIndex((row) => row.contains(document.activeElement));
      const step = event.key === "j" ? 1 : -1;
      const next = current < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, current + step));
      event.preventDefault();
      focusRow(rows[next]);
    };

    container.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, router]);
}
