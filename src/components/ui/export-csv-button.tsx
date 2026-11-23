"use client";

import { Download } from "lucide-react";

import { formatCount } from "@/lib/format";
import { notify } from "@/lib/notify";

import { Button } from "./button";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "./csv";
import { Tooltip } from "./tooltip";

export interface ExportCsvButtonProps<TRow> {
  /** The rows as shown: filtered and sorted the way the reader sees them. */
  rows: readonly TRow[];
  columns: readonly CsvColumn<TRow>[];
  /** The file's base name; the date is added: "findings" -> findings-2026-11-04.csv. */
  fileName: string;
  /** What a row is, for the acknowledgement: "finding", "rule". */
  rowNoun?: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Export the rows on screen as CSV, built in the browser (nothing leaves the
 * page), then say what was saved and where.
 */
export function ExportCsvButton<TRow>({
  rows,
  columns,
  fileName,
  rowNoun = "row",
  label = "Export CSV",
  size = "md",
  className,
}: ExportCsvButtonProps<TRow>) {
  const empty = rows.length === 0;

  const onExport = () => {
    const name = csvFileName(fileName);
    downloadCsv(toCsv(rows, columns), name);
    const noun = rows.length === 1 ? rowNoun : `${rowNoun}s`;
    notify.ok("Export ready", { description: `${formatCount(rows.length)} ${noun} saved as ${name}.` });
  };

  const button = (
    <Button
      icon={Download}
      size={size}
      // aria-disabled rather than disabled, so the reason stays reachable on hover and focus.
      onClick={empty ? undefined : onExport}
      aria-disabled={empty || undefined}
      className={className}
    >
      {label}
    </Button>
  );

  return empty ? <Tooltip content={`No ${rowNoun}s to export`}>{button}</Tooltip> : button;
}
