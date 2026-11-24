import { randomUUID } from "node:crypto";

import type { RuleSettingsFieldChange } from "@/lib/api/schemas";

import { NO_OVERRIDES, type BoardOverrides } from "./board-rules";
import { PROJECT_KEY } from "./catalogue";
import { customRuleNumber, type CustomRuleRecord } from "./custom-rules";

/** One change to a board's settings, never purged: the audit trail, and what an undo sets back. */
export interface StoredChange {
  changeId: string;
  /** When it was saved: the sample's clock when "now" is pinned, else the server's. */
  at: number;
  /** The board's settings revision this change made: 1, 2, 3 ... */
  revision: number;
  viewer: { hash: string; name: string };
  reason: string | null;
  undoOf: string | null;
  changes: RuleSettingsFieldChange[];
  /** The board's settings once it was made: only what differs from the catalogue. */
  overrides: BoardOverrides;
  /** Its own rules once it was made, deleted ones too, oldest first. */
  custom: readonly CustomRuleRecord[];
}

/** The re-check a save starts: the sample's stand-in for the service's `rules --project KEY`, which takes a moment. */
export interface Recheck {
  revision: number;
  startedAt: number;
  /** When it ends, on the server's own clock (SAMPLE_LATENCY decides how long it takes). */
  endsAt: number;
  result: { opened: number; closed: number };
}

export interface BoardSettings {
  /** Oldest first. */
  history: readonly StoredChange[];
  recheck: Recheck | null;
}

const EMPTY: BoardSettings = { history: [], recheck: null };
const boards = new Map<string, BoardSettings>();
/** Moves on with every reset, so nothing built from settings since forgotten is ever served again. */
let generation = 0;

export function boardSettings(board: string = PROJECT_KEY): BoardSettings {
  return boards.get(board) ?? EMPTY;
}

/** The board's settings revision: 0 until it is first changed. */
export function revisionOf(settings: BoardSettings): number {
  return settings.history.at(-1)?.revision ?? 0;
}

export function overridesOf(settings: BoardSettings): BoardOverrides {
  return settings.history.at(-1)?.overrides ?? NO_OVERRIDES;
}

/** The board's own rules as they stand, deleted ones too. */
export function customOf(settings: BoardSettings): readonly CustomRuleRecord[] {
  return settings.history.at(-1)?.custom ?? [];
}

export function nextCustomNumber(letter: "R" | "W"): number {
  let highest = 0;
  for (const settings of boards.values()) {
    for (const record of customOf(settings)) {
      const number = customRuleNumber(record.id);
      if (number && number[0] === letter) highest = Math.max(highest, number[1]);
    }
  }
  return highest + 1;
}

export function settingsGeneration(): number {
  return generation;
}

/** Records a change as the board's next revision, with a fresh id. */
export function recordChange(board: string, change: Omit<StoredChange, "changeId" | "revision">): StoredChange {
  const settings = boardSettings(board);
  const stored: StoredChange = { ...change, changeId: randomUUID().replace(/-/g, ""), revision: revisionOf(settings) + 1 };
  boards.set(board, { history: [...settings.history, stored], recheck: settings.recheck });
  return stored;
}

export function startRecheck(board: string, recheck: Recheck): void {
  boards.set(board, { ...boardSettings(board), recheck });
}

/** For tests: back to the catalogue on every board, with no history and no rules of their own, as a fresh server starts. */
export function resetSampleRuleSettings(): void {
  boards.clear();
  generation += 1;
}
