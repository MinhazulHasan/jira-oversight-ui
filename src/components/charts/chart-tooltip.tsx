"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { SeverityMark, type Severity } from "@/components/ui/badge";

export interface TooltipRow {
  /** A stable key for the row. */
  id: string;
  /** The figure, already formatted. It leads: the reader has the series and wants the number. */
  value: ReactNode;
  /** The series or category, after the figure. */
  name?: ReactNode;
  /** The series colour, drawn as a short line (lines) or a small block (bars). */
  colour?: string;
  key?: "line" | "block";
  /** A status row keys with its mark rather than a colour. */
  severity?: Severity;
}

/** The content of every chart tooltip: an optional heading, then value-first rows. */
export function TooltipBody({ heading, rows }: { heading?: ReactNode; rows: readonly TooltipRow[] }) {
  return (
    <div className="jo-chart-tooltip">
      {heading ? <div className="jo-chart-tooltip-head">{heading}</div> : null}
      {rows.map((row) => (
        <div key={row.id} className="jo-chart-tooltip-row">
          <span className="flex items-center justify-center">
            {row.severity ? (
              <SeverityMark severity={row.severity} size={9} palette="chart" />
            ) : row.colour ? (
              <span
                aria-hidden
                className={row.key === "block" ? "jo-key-block" : "jo-key-line"}
                style={{ background: row.colour }}
              />
            ) : null}
          </span>
          <span className="jo-chart-tooltip-value">{row.value}</span>
          {row.name ? <span className="jo-chart-tooltip-name">{row.name}</span> : <span />}
        </div>
      ))}
    </div>
  );
}

export interface FloatingTooltipProps {
  /** The element the coordinates are measured from: the chart's own frame. */
  anchor: RefObject<HTMLElement | null>;
  /** The point the tooltip belongs to, in px from the anchor's top left. */
  x: number;
  y: number;
  children: ReactNode;
}

const GAP = 10;
const EDGE = 8;

/**
 * A tooltip for the hand-built charts: above its point when there is room,
 * below when not, and never past the viewport's sides. It is rendered into
 * the body and placed after it has been measured, so a clipped container (a
 * tile grid, a scrolling table) can never cut it off and it never renders
 * once in the wrong spot. Purely visual: the same figures are in the mark's
 * accessible name and in the table view.
 */
export function FloatingTooltip({ anchor, x, y, children }: FloatingTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const host = anchor.current;
    if (!element || !host) return;
    const box = host.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const pointX = box.left + x;
    const pointY = box.top + y;
    const above = pointY - GAP - height >= EDGE;
    const left = Math.max(EDGE, Math.min(pointX - width / 2, window.innerWidth - width - EDGE));
    element.style.left = `${left}px`;
    element.style.top = `${above ? pointY - GAP - height : pointY + GAP}px`;
    element.style.visibility = "visible";
  }, [anchor, x, y, children]);

  return createPortal(
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-[var(--z-toast)]"
      style={{ visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
