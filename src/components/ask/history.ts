import { useSyncExternalStore } from "react";
import { z } from "zod";

import { ASK_MAX_MENTIONS, askResponseSchema, personId, type AskResponse } from "@/lib/api/schemas";

import { sameQuestion } from "./describe";

/**
 * This tab's questions, newest first, so a reader can go back to an answer
 * without asking again. Client state only: kept in sessionStorage (one tab,
 * gone when the tab closes), never sent anywhere. Storage can be missing or
 * refuse (a private window, blocked site data); the list then lives in memory
 * for as long as the page is open.
 */

export const HISTORY_KEY = "jo-ask-history";
export const HISTORY_LIMIT = 20;
/** Jira is synced every 30 minutes; an answer kept for less than that is still the answer. */
export const FRESH_MS = 30 * 60_000;

export interface HistoryEntry {
  response: AskResponse;
  /** When this tab received it (the reader's clock, ms). */
  keptAt: number;
  /** The people the question mentioned, by id (never their names), so asking it again asks about them again. */
  mentions: readonly string[];
}

const entrySchema = z.object({
  response: askResponseSchema,
  keptAt: z.number(),
  mentions: z.array(personId).max(ASK_MAX_MENTIONS).default([]),
});
const EMPTY: readonly HistoryEntry[] = [];
const listeners = new Set<() => void>();
let entries: readonly HistoryEntry[] | null = null;

function load(): readonly HistoryEntry[] {
  try {
    const raw = window.sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    // What is stored is read through the contract again: a stale or edited entry is dropped, never trusted.
    return parsed.flatMap((item) => {
      const result = entrySchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return EMPTY;
  }
}

/** The list as it stands. Call it from effects and handlers; render through useAskHistory. */
export function readHistory(): readonly HistoryEntry[] {
  entries ??= load();
  return entries;
}

function save(next: readonly HistoryEntry[]): void {
  entries = next;
  try {
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage refused: the list lives in memory until the page closes.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keep an answer. Asking the same question again replaces the older answer rather than listing it twice. */
export function remember(response: AskResponse, now = Date.now(), mentions: readonly string[] = []): void {
  const rest = readHistory().filter((entry) => !sameQuestion(entry.response.question, response.question));
  save([{ response, keptAt: now, mentions: [...mentions] }, ...rest].slice(0, HISTORY_LIMIT));
}

export function forgetAll(): void {
  save(EMPTY);
}

/** The kept answer to this question, if this tab received it within the last half hour. */
export function freshAnswer(question: string, now = Date.now()): AskResponse | null {
  const entry = readHistory().find((candidate) => sameQuestion(candidate.response.question, question));
  return entry && now - entry.keptAt < FRESH_MS ? entry.response : null;
}

/** For tests: drop the in-memory copy so the next read comes from storage. */
export function resetHistoryCache(): void {
  entries = null;
}

/** The list, empty on the server and during hydration so both renders agree. */
export function useAskHistory(): readonly HistoryEntry[] {
  return useSyncExternalStore(subscribe, readHistory, () => EMPTY);
}
