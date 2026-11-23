import { useEffect, useState, type RefObject } from "react";

/**
 * The rendered width of an element, kept current as it resizes. Zero until
 * the browser has laid it out (and on the server), so a chart drawn in pixels
 * can hold its frame and draw its marks once the width is known.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
