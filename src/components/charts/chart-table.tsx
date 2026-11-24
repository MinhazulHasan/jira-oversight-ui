import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

export interface ChartTableColumn {
  header: string;
  /** Figures align right and set in Plex Mono. */
  numeric?: boolean;
}

/** The figures behind a chart, already formatted, one row per mark or point. */
export interface ChartTableData {
  columns: readonly ChartTableColumn[];
  rows: readonly (readonly ReactNode[])[];
}

export function ChartTable({ data, caption }: { data: ChartTableData; caption: string }) {
  return (
    <ScrollArea axis="x" label={caption} frameClassName="overflow-hidden rounded-md border border-rule-weak">
      <table className="jo-table" data-sticky="false" data-density="compact" data-layout="auto">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {data.columns.map((column) => (
              <th key={column.header} scope="col" data-numeric={column.numeric || undefined}>
                <span className="micro text-ink-low">{column.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} data-numeric={data.columns[cellIndex]?.numeric || undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
