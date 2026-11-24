"use client";

import { useCallback } from "react";

import type { Citation, FactSet } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { cellId } from "./describe";
import { personColumnsOf } from "./people-in-facts";
import { useTrace } from "./trace";

type Column = FactSet["columns"][number];

/** Citations by the cell they bind and by the ledger node they tie to (describe.ts indexCitations). */
export type CitationIndex = { byCell: ReadonlyMap<string, Citation[]>; byTarget: ReadonlyMap<string, Citation[]> };

/** A shown column, with the descriptive column folded under it ("Data import pipeline" under DEMO-704). */
export interface ShownColumn {
  column: Column;
  companion?: Column;
}

export function shownColumns(fact: FactSet, index: CitationIndex): ShownColumn[] {
  const cited = (key: string) => fact.rows.some((_, row) => index.byCell.has(cellId(fact.ref, row, key)));
  // A person's id never shows: the column beside it names them, with their picture (people-in-facts.tsx).
  const { hidden } = personColumnsOf(fact);
  const shown: ShownColumn[] = [];
  fact.columns.forEach((column, position) => {
    if (hidden.has(column.key)) return;
    const previous = fact.columns[position - 1];
    const folds =
      previous !== undefined &&
      (previous.kind === "issue_key" || previous.key === "rule_id") &&
      column.kind === "text" &&
      /(title|summary)$/.test(column.key) &&
      !cited(column.key);
    if (folds) shown[shown.length - 1].companion = column;
    else shown.push({ column });
  });
  return shown;
}

/** A ref that registers a ledger node under `key`, so a line can be tied to it. */
export function useTraceTarget(key: string) {
  const register = useTrace()?.register;
  return useCallback((node: HTMLElement | null) => register?.(key, node), [register, key]);
}

export function markerRuns(markers: readonly number[]): { shown: string; spoken: string } {
  const sorted = [...new Set(markers)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const marker of sorted) {
    const run = runs.at(-1);
    if (run && marker === run[1] + 1) run[1] = marker;
    else runs.push([marker, marker]);
  }
  return {
    shown: runs.map(([from, to]) => (from === to ? `${from}` : to === from + 1 ? `${from},${to}` : `${from}–${to}`)).join(","),
    spoken: runs.map(([from, to]) => (from === to ? `${from}` : `${from} to ${to}`)).join(", "),
  };
}

/** The markers that cite a value, set small after it; spoken as ", cited as 2". */
export function Markers({ citations, hot = false }: { citations: readonly Citation[]; hot?: boolean }) {
  const { shown, spoken } = markerRuns(citations.map((citation) => citation.marker));
  return (
    <>
      <sup aria-hidden className={cn("mono ml-1 shrink-0 text-[9.5px] font-medium", hot ? "text-cite-hot" : "text-cite")}>
        {shown}
      </sup>
      <span className="sr-only">, cited as {spoken}</span>
    </>
  );
}
