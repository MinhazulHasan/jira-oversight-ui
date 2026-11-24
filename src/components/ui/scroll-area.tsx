"use client";

import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ScrollAreaProps {
  /** The direction it scrolls. A wide table is "x"; a drawer body is "y". */
  axis: "x" | "y";
  children: ReactNode;
  /** Classes for the scrolling element (height, max-height). */
  className?: string;
  /** Classes for the frame that draws the edge fades. */
  frameClassName?: string;
  style?: CSSProperties;
  /** The colour the edges fade into; defaults to the sheet. */
  fade?: string;
  /** Name the region, which also makes it focusable. */
  label?: string;
  /** The scrolling element's own identity, when it is more than a region (and `label` is unset). */
  scrollerProps?: Pick<HTMLAttributes<HTMLDivElement>, "id" | "role" | "aria-label" | "aria-busy" | "onMouseDown">;
}

/** A scroll region that says when there is more to see. */
export function ScrollArea({
  axis,
  children,
  className,
  frameClassName,
  style,
  fade,
  label,
  scrollerProps,
}: ScrollAreaProps) {
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    const host = frame.current;
    if (!element || !host) return;

    const update = () => {
      const start = axis === "x" ? element.scrollLeft : element.scrollTop;
      const size = axis === "x" ? element.clientWidth : element.clientHeight;
      const total = axis === "x" ? element.scrollWidth : element.scrollHeight;
      host.dataset.moreStart = String(start > 1);
      host.dataset.moreEnd = String(start + size < total - 1);
      host.dataset.scrolled = String(element.scrollTop > 0);
    };

    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [axis]);

  // axe's scrollable-region-focusable: a labelled region scrolls by keyboard on its own.
  const focusable = label ? { tabIndex: 0, role: "region", "aria-label": label } : {};

  return (
    <div
      ref={frame}
      data-axis={axis}
      className={cn("jo-scroll-frame", frameClassName)}
      style={fade ? ({ "--jo-fade": fade } as CSSProperties) : undefined}
    >
      <div
        ref={scroller}
        data-print="flow"
        {...scrollerProps}
        {...focusable}
        className={cn("jo-scroller", axis === "x" ? "overflow-x-auto" : "overflow-y-auto", className)}
        style={style}
      >
        {children}
      </div>
    </div>
  );
}
