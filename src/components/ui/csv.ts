/**
 * CSV for exports, written in the browser from the rows on screen.
 *
 * RFC 4180: comma separated, CRLF line ends, a field quoted when it holds a
 * comma, a quote or a line break, quotes doubled. A byte order mark makes
 * Excel read it as UTF-8 (en dashes, ×, accented project names).
 *
 * Ticket text is untrusted (anyone who can edit a ticket writes it), and a
 * spreadsheet runs a cell that starts with = + - @ as a formula. Text cells
 * that start that way are prefixed with an apostrophe so they open as text;
 * numbers are written as numbers and are never prefixed.
 */

export type CsvValue = string | number | boolean | null | undefined | Date;

export interface CsvColumn<TRow> {
  /** The column heading in the file. */
  header: string;
  value: (row: TRow) => CsvValue;
}

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = value instanceof Date ? value.toISOString() : value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<TRow>(rows: readonly TRow[], columns: readonly CsvColumn<TRow>[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** "findings-2026-11-04.csv": a name that sorts by date and never needs renaming. */
export function csvFileName(base: string, at: Date = new Date()): string {
  const day = [at.getFullYear(), at.getMonth() + 1, at.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "export"}-${day}.csv`;
}

/** Save CSV text through the browser's download, without a server round trip. */
export function downloadCsv(text: string, fileName: string): void {
  const blob = new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next turn: Safari starts the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
