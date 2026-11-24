"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useReducedMotion } from "@/components/charts/use-reduced-motion";

import { targetKey, valueKey } from "./describe";
import { LEDGER_X_SCROLLER, LEDGER_Y_SCROLLER, useTrace } from "./trace";

interface Path {
  marker: number;
  d: string;
  from: [number, number];
  to: [number, number];
}

/** The band of the viewport a line may use: below the sticky top bar, above the bottom edge. */
function visibleBand(): { top: number; bottom: number } {
  const banner = document.querySelector('[role="banner"]');
  const top = banner ? Math.max(0, banner.getBoundingClientRect().bottom) : 0;
  return { top, bottom: window.innerHeight };
}

function inside(rect: DOMRect, top: number, bottom: number): boolean {
  return rect.bottom > top + 2 && rect.top < bottom - 2;
}

export function Connector() {
  const trace = useTrace();
  const reduced = useReducedMotion();
  const [path, setPath] = useState<Path | null>(null);
  const active = trace?.active ?? null;

  useEffect(() => {
    if (!trace) return;
    let frame = 0;

    const measure = () => {
      const citation = active === null ? undefined : trace.citations.get(active);
      const start = active === null ? undefined : trace.node(valueKey(active));
      const end = citation ? trace.node(targetKey(citation)) : undefined;
      if (active === null || !start || !end) {
        setPath(null);
        return;
      }
      // The line leaves from the value's own underline, not from its marker.
      const s = (start.querySelector("[data-bound-text]") ?? start).getBoundingClientRect();
      const r = end.getBoundingClientRect();
      const band = visibleBand();
      const scroller = end.closest(LEDGER_Y_SCROLLER)?.getBoundingClientRect();
      const ledger = end.closest("[data-ledger]")?.getBoundingClientRect();
      const visible =
        inside(s, band.top, band.bottom) &&
        inside(r, band.top, band.bottom) &&
        (!scroller || inside(r, scroller.top, scroller.bottom));
      // Stacked on a narrow screen the ledger is below the prose, and a line would cross the text.
      const gutter = (ledger?.left ?? r.left) - 16;
      const x1 = s.right + 2;
      if (!visible || gutter < x1 + 6) {
        setPath(null);
        return;
      }
      // The mark sits on the value's underline; the line drops into the gap between lines before it runs to the gutter.
      const y1 = s.bottom - 1;
      const yRun = s.bottom + 5;
      // A row is tied at its left edge, where the traced row carries its bar, even when its table is scrolled sideways.
      const sideways = end.closest(LEDGER_X_SCROLLER)?.getBoundingClientRect();
      const left = Math.max(r.left, sideways?.left ?? r.left);
      const x2 = end.tagName === "TR" ? left + 1 : left - 4;
      const y2 = r.top + r.height / 2;
      if (x2 < gutter + 4) {
        setPath(null);
        return;
      }
      setPath({ marker: active, d: `M ${x1} ${y1} V ${yRun} H ${gutter} V ${y2} H ${x2}`, from: [x1, y1], to: [x2, y2] });
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    schedule();
    // Content rising into place, the sticky ledger scrolling, a font arriving: measure again.
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("animationend", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    const observer = new ResizeObserver(schedule);
    const root = document.querySelector("[data-ask-root]");
    if (root) observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("animationend", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      observer.disconnect();
    };
  }, [trace, active]);

  if (!path || typeof document === "undefined") return null;

  return createPortal(
    <svg
      aria-hidden
      data-print="hide"
      data-trace-line={path.marker}
      className="pointer-events-none fixed inset-0 z-20 h-dvh w-screen overflow-visible"
    >
      <path
        key={path.marker}
        d={path.d}
        fill="none"
        stroke="var(--cite-line)"
        strokeWidth={1.25}
        strokeLinecap="square"
        strokeLinejoin="miter"
        style={reduced ? undefined : { strokeDasharray: 1400, animation: "jo-draw 260ms var(--ease-out) both" }}
      />
      {/* The mark at the value, and the tick at the row. */}
      <circle cx={path.from[0]} cy={path.from[1]} r={2.5} fill="var(--cite)" />
      <rect x={path.to[0] - 1} y={path.to[1] - 5} width={2} height={10} rx={0.5} fill="var(--cite)" />
    </svg>,
    document.body,
  );
}
