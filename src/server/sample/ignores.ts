import { randomUUID } from "node:crypto";

import type { FindingIgnore, IgnoreScope } from "@/lib/api/schemas";

import { PROJECT_KEY } from "./catalogue";
import { assembleEngine, type Engine } from "./engine";
import { iso } from "./time";

/** Who did something, as the access log names a reader: a keyed hash and a display name. */
export interface IgnoreActor {
  hash: string;
  name: string;
}

/** One ignore, kept per server process and board as the service keeps them; restored ones stay as history. */
export interface StoredIgnore {
  id: string;
  issueKey: string;
  /** The rule it covers; null for every rule on the ticket. */
  ruleId: string | null;
  reason: string | null;
  by: IgnoreActor;
  at: number;
  restored: { by: IgnoreActor; at: number } | null;
}

/** What an ignore says wherever it holds a finding or leaves a ticket out of a measure. */
export interface IgnoreInfo {
  id: string;
  scope: IgnoreScope;
  ruleId: string | null;
  reason: string | null;
  /** The admin's display name. */
  by: string;
  at: number;
}

/** A board's active ignores: whole tickets, and single rules on a ticket. */
export interface Ignores {
  /** The ignore covering any of these rules on the ticket: the ticket's own first. */
  covers(issueKey: string, ruleIds: Iterable<string>): IgnoreInfo | null;
  /** The ticket's own ignore, which covers every rule on it. */
  ticket(issueKey: string): IgnoreInfo | null;
}

/** A ticket and rule, or a whole ticket (rule null): what an ignore is kept by. */
export interface IgnorePair {
  issueKey: string;
  ruleId: string | null;
}

/** A board with nothing ignored. */
export const NO_IGNORES: Ignores = { covers: () => null, ticket: () => null };

const boards = new Map<string, StoredIgnore[]>();
/** Moves on with every change, so a dataset built before it is never served again. */
let generation = 0;
const views = new Map<string, Ignores>();

const pairKey = (issueKey: string, ruleId: string | null) => `${issueKey}\u001f${ruleId ?? "*"}`;

function infoOf(stored: StoredIgnore): IgnoreInfo {
  return { id: stored.id, scope: stored.ruleId === null ? "ticket" : "finding", ruleId: stored.ruleId, reason: stored.reason, by: stored.by.name, at: stored.at };
}

export function ignoresGeneration(): number {
  return generation;
}

/** Every ignore of the board, oldest first, restored ones too. */
export function storedIgnores(board: string = PROJECT_KEY): readonly StoredIgnore[] {
  return boards.get(board) ?? [];
}

export function activeIgnores(board: string = PROJECT_KEY): Ignores {
  const key = `${board}|${generation}`;
  const known = views.get(key);
  if (known) return known;
  const tickets = new Map<string, IgnoreInfo>();
  const rules = new Map<string, IgnoreInfo>();
  for (const stored of storedIgnores(board)) {
    if (stored.restored !== null) continue;
    if (stored.ruleId === null) tickets.set(stored.issueKey, infoOf(stored));
    else rules.set(pairKey(stored.issueKey, stored.ruleId), infoOf(stored));
  }
  const ignores: Ignores = {
    ticket: (issueKey) => tickets.get(issueKey) ?? null,
    covers: (issueKey, ruleIds) => {
      const whole = tickets.get(issueKey);
      if (whole) return whole;
      for (const ruleId of ruleIds) {
        const found = rules.get(pairKey(issueKey, ruleId));
        if (found) return found;
      }
      return null;
    },
  };
  if (views.size > 16) views.clear();
  views.set(key, ignores);
  return ignores;
}

/** The ignore as the API sends it; `by` only at the people level. */
export function ignoreBody(info: IgnoreInfo, peopleLevel = true): FindingIgnore {
  return { scope: info.scope, rule_id: info.ruleId, reason: info.reason, by: peopleLevel ? info.by : null, at: iso(info.at), ignore_id: info.id };
}

/** Records an ignore for each pair, giving back the one already standing for a pair rather than a second. */
export function recordIgnores(board: string, pairs: readonly IgnorePair[], reason: string | null, by: IgnoreActor, at: number): string[] {
  const stored = [...storedIgnores(board)];
  const standing = new Map(stored.filter((entry) => entry.restored === null).map((entry) => [pairKey(entry.issueKey, entry.ruleId), entry]));
  const ids: string[] = [];
  for (const pair of pairs) {
    const key = pairKey(pair.issueKey, pair.ruleId);
    let entry = standing.get(key);
    if (!entry) {
      entry = { id: randomUUID().replace(/-/g, ""), issueKey: pair.issueKey, ruleId: pair.ruleId, reason, by, at, restored: null };
      stored.push(entry);
      standing.set(key, entry);
    }
    if (!ids.includes(entry.id)) ids.push(entry.id);
  }
  if (stored.length !== storedIgnores(board).length) {
    boards.set(board, stored);
    generation += 1;
  }
  return ids;
}

/** Restores the board's standing ignores among `ids`; the ones restored, each once. */
export function restoreIgnores(board: string, ids: readonly string[], by: IgnoreActor, at: number): StoredIgnore[] {
  const wanted = new Set(ids);
  const restored: StoredIgnore[] = [];
  const stored = storedIgnores(board).map((entry) => {
    if (entry.restored !== null || !wanted.has(entry.id)) return entry;
    const next = { ...entry, restored: { by, at } };
    restored.push(next);
    return next;
  });
  if (restored.length > 0) {
    boards.set(board, stored);
    generation += 1;
  }
  return restored;
}

/** The findings as the board's ignores leave them: one its ignore found open, or that opened after, resolved as ignored. */
export function withIgnores(engine: Engine, ignores: Ignores, when: (at: number) => number): Engine {
  let changed = false;
  const findings = engine.findings.map((finding) => {
    if (finding.issue === null) return finding;
    const info = ignores.covers(finding.issue.key, [finding.rule.id]);
    if (info === null) return finding;
    const at = when(info.at);
    if (finding.resolvedAt !== null && finding.resolvedAt <= at) return finding;
    changed = true;
    const resolvedAt = Math.max(at, finding.firstSeenAt);
    return { ...finding, resolvedAt, resolvedWhy: "ignored" as const, lastSeenAt: Math.min(finding.lastSeenAt, resolvedAt), ignore: info };
  });
  return changed ? assembleEngine(findings, engine.thresholds) : engine;
}

/** For tests: no ignores on any board, as a fresh server starts. */
export function resetSampleIgnores(): void {
  boards.clear();
  views.clear();
  generation += 1;
}
