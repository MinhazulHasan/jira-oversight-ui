import type { ReactNode } from "react";

import { SeverityMark, type Severity } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface LegendItem {
  id: string;
  label: ReactNode;
  /** The series colour. Text stays in ink; only the swatch carries the colour. */
  colour?: string;
  /** Mirror the mark: a line for lines, a block for bars and areas. */
  shape?: "line" | "block";
  /** A status series keys with its mark (square, triangle, tick). */
  severity?: Severity;
  /** The not-measurable texture. */
  hatch?: boolean;
}

export function Legend({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-mid", className)}>
      {items.map((item) => (
        <li key={item.id} className="inline-flex items-center gap-1.5">
          <Swatch item={item} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Swatch({ item }: { item: LegendItem }) {
  if (item.severity) return <SeverityMark severity={item.severity} size={9} palette="chart" />;
  if (item.hatch) return <span aria-hidden className="hatch inline-block size-2.5 rounded-[2px] border border-hatch-edge" />;
  return (
    <span
      aria-hidden
      className={item.shape === "line" ? "jo-key-line" : "jo-key-block"}
      style={{ background: item.colour }}
    />
  );
}
