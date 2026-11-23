import type { Citation, FactCell } from "@/lib/api/schemas";

import { fixed } from "../verify";

/**
 * Sample answers are written from the facts by code, standing in for the
 * model. Each figure, key and date is a cited piece bound to the cell it came
 * from, so the tick-and-tie lines point at the right row even when two cells
 * hold the same value; the validator then checks the finished text the same
 * way it checks a live answer.
 */

/** Anything with rows to cite from: an Ask fact set, or a weekly-insight candidate read as one. */
export interface Citable {
  ref: string;
  rows: Record<string, FactCell>[];
  note?: string | null;
}

interface Cited {
  text: string;
  fact: Citable;
  row: number;
  column: string;
}

export type Piece = string | Cited;

function cell(fact: Citable, row: number, column: string): FactCell {
  const value = fact.rows[row]?.[column];
  if (value === undefined) throw new Error(`${fact.ref} has no cell ${row}/${column}`);
  return value;
}

function numberAt(fact: Citable, row: number, column: string): number {
  const value = cell(fact, row, column);
  if (typeof value !== "number") throw new Error(`${fact.ref} ${row}/${column} is not a number`);
  return value;
}

function textAt(fact: Citable, row: number, column: string): string {
  const value = cell(fact, row, column);
  if (typeof value !== "string") throw new Error(`${fact.ref} ${row}/${column} is not text`);
  return value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-26" or a full timestamp, as "26 Oct 2026". */
function spelled(isoText: string): string {
  const [year, month, day] = isoText.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Figures, written the way the interface writes them: the cited part is exactly what the validator reads. */
export const cite = {
  /** A count with thousands separators: "1,136". */
  count: (fact: Citable, row: number, column: string): Cited => ({
    text: grouped(numberAt(fact, row, column)),
    fact,
    row,
    column,
  }),
  /** Hours to one place; the caller writes the unit: "41.2" + " h". */
  hours: (fact: Citable, row: number, column: string): Cited => ({
    text: fixed(numberAt(fact, row, column), 1),
    fact,
    row,
    column,
  }),
  /** A ratio to two places; the caller writes the sign: "1.42" + "×". */
  ratio: (fact: Citable, row: number, column: string): Cited => ({
    text: fixed(numberAt(fact, row, column), 2),
    fact,
    row,
    column,
  }),
  /** A share as a whole percentage: "16%". */
  share: (fact: Citable, row: number, column: string): Cited => ({
    text: `${fixed(numberAt(fact, row, column) * 100, 0)}%`,
    fact,
    row,
    column,
  }),
  /** A date cell, spelled: "26 Oct 2026". */
  day: (fact: Citable, row: number, column: string): Cited => ({
    text: spelled(textAt(fact, row, column)),
    fact,
    row,
    column,
  }),
  /** An issue key, as it is in the cell. */
  key: (fact: Citable, row: number, column: string): Cited => ({ text: textAt(fact, row, column), fact, row, column }),
  /** How many rows a fact set returned. */
  rows: (fact: Citable): Cited => ({ text: grouped(fact.rows.length), fact, row: -1, column: "row_count" }),
  /** A figure quoted from the fact set's note, such as the 90 in "the last 90 days". */
  note: (fact: Citable, text: string): Cited => {
    if (!fact.note?.includes(text)) throw new Error(`${fact.ref} note does not say ${text}`);
    return { text, fact, row: -1, column: "note" };
  },
};

export interface Composed {
  answer: string;
  citations: Citation[];
}

export function compose(pieces: readonly Piece[]): Composed {
  let answer = "";
  const citations: Citation[] = [];
  for (const piece of pieces) {
    if (typeof piece === "string") {
      answer += piece;
      continue;
    }
    citations.push({
      marker: citations.length + 1,
      text: piece.text,
      fact_ref: piece.fact.ref,
      row_index: piece.row,
      column: piece.column,
    });
    answer += piece.text;
  }
  return { answer, citations };
}

/** "A, B and C". */
export function listed(pieces: readonly Piece[][]): Piece[] {
  return pieces.flatMap((part, index) => {
    if (index === 0) return part;
    return [index === pieces.length - 1 ? " and " : ", ", ...part];
  });
}
