import type { CreditSource } from "@/lib/api/schemas";

/** A board's choice of whom its tickets count for: its source, and the field's key when the source is a field. */
export interface CreditChoice {
  source: CreditSource;
  field: string | null;
}

/** A board's saved setting, kept until the server restarts. */
export interface StoredCreditSetting {
  choice: CreditChoice;
  revision: number;
  /** The reader's name, as the access log keeps it. */
  by: string;
  at: number;
}

/** Each board's starting choice, as process.yaml's `credit` sets it: MOB credits the assignee (as AILED does); the rest are Automatic. */
const FILE_CHOICES: Readonly<Record<string, CreditChoice>> = {
  MOB: { source: "assignee", field: null },
};

const AUTOMATIC: CreditChoice = { source: "auto", field: null };

const boards = new Map<string, StoredCreditSetting>();

export function fileChoice(board: string): CreditChoice {
  return FILE_CHOICES[board] ?? AUTOMATIC;
}

/** The board's saved setting: none while the file's choice stands. */
export function savedCreditOf(board: string): StoredCreditSetting | undefined {
  return boards.get(board);
}

/** The choice the board follows now: the saved one, or the file's. */
export function creditChoiceOf(board: string): CreditChoice {
  return savedCreditOf(board)?.choice ?? fileChoice(board);
}

/** The board's credit revision: 0 while the file's choice stands, then 1, 2, 3 ... */
export function creditRevisionOf(board: string): number {
  return savedCreditOf(board)?.revision ?? 0;
}

export function sameChoice(a: CreditChoice, b: CreditChoice): boolean {
  return a.source === b.source && (a.field ?? null) === (b.field ?? null);
}

/** Records a change as the board's next revision. */
export function recordCreditChange(board: string, to: CreditChoice, by: string, at: number): void {
  boards.set(board, { choice: { ...to }, revision: creditRevisionOf(board) + 1, by, at });
}

/** For tests: every board back to its file's choice, as a fresh server starts. */
export function resetSampleCredit(): void {
  boards.clear();
}
