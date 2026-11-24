import { FALLBACK_LOCALE, formatCount, formatNumber, formatShare } from "@/lib/format";
import { RULE_ID_IN_TEXT, type Candidate, type InsightSentence } from "@/lib/api/schemas";

import type { CandidateDetail } from "./model";
import type { TraceTarget } from "./use-trace";

export type SentencePart =
  | { kind: "text"; text: string }
  | { kind: "figure"; text: string; candidateId: string; detailKey: string }
  | { kind: "key"; text: string; issueKey: string };

const ISSUE_KEY_IN_TEXT = /\b[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,8}\b/g;

interface Span {
  start: number;
  end: number;
  part: SentencePart;
}

/** The ways a detail's value can be written in the briefing. */
export function writtenForms(detail: CandidateDetail): string[] {
  const { value, unit } = detail;
  if (typeof value !== "number" || !Number.isFinite(value)) return [];
  const locale = FALLBACK_LOCALE;
  const whole = Number.isInteger(value);
  switch (unit) {
    case "share":
      return [formatShare(value, { locale })];
    case "hours":
    case "days":
      return [formatNumber(value, { locale, decimals: 1 })];
    case "ratio":
      return [formatNumber(value, { locale, decimals: 2 })];
    case "count":
    case "points":
    case null:
    default: {
      if (!whole) return [formatNumber(value, { locale, decimals: 1 }), formatNumber(value, { locale, decimals: 2 })];
      const grouped = formatCount(value, { locale });
      return grouped === String(value) ? [grouped] : [grouped, String(value)];
    }
  }
}

function standsAlone(text: string, at: number, token: string): boolean {
  const before = text.charAt(at - 1);
  const after = text.charAt(at + token.length);
  const next = text.charAt(at + token.length + 1);
  const joinedBefore = /[\w-]/.test(before) || (/[.,]/.test(before) && /\d/.test(text.charAt(at - 2)));
  const joinedAfter =
    /\w/.test(after) || (/[.,]/.test(after) && /\d/.test(next)) || (after === "%" && !token.endsWith("%"));
  return !joinedBefore && !joinedAfter;
}

function overlaps(ranges: readonly { start: number; end: number }[], start: number, end: number): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

export function bindSentence(
  text: string,
  candidates: readonly Candidate[],
  issueKeys: readonly string[] = [],
): SentencePart[] {
  const spans: Span[] = [];
  // Words that are not figures, however they read: an epic's title, a sprint's name, a rule id.
  const masked: { start: number; end: number }[] = [];

  const known = new Set([...issueKeys, ...candidates.flatMap((candidate) => candidate.issue_keys)]);
  for (const match of text.matchAll(ISSUE_KEY_IN_TEXT)) {
    const start = match.index;
    const end = start + match[0].length;
    if (known.has(match[0])) spans.push({ start, end, part: { kind: "key", text: match[0], issueKey: match[0] } });
    else masked.push({ start, end });
  }
  for (const match of text.matchAll(RULE_ID_IN_TEXT)) masked.push({ start: match.index, end: match.index + match[0].length });

  const lower = text.toLowerCase();
  for (const candidate of candidates) {
    for (const detail of candidate.detail) {
      if (typeof detail.value !== "string" || detail.value.length < 2) continue;
      const needle = detail.value.toLowerCase();
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
        masked.push({ start: at, end: at + needle.length });
      }
    }
  }

  // Each detail binds once, at its first free occurrence, in the candidate's own order.
  for (const candidate of candidates) {
    for (const detail of candidate.detail) {
      bind: for (const form of writtenForms(detail)) {
        for (let at = text.indexOf(form); at >= 0; at = text.indexOf(form, at + 1)) {
          const end = at + form.length;
          if (!standsAlone(text, at, form) || overlaps(masked, at, end) || overlaps(spans, at, end)) continue;
          spans.push({ start: at, end, part: { kind: "figure", text: form, candidateId: candidate.id, detailKey: detail.key } });
          break bind;
        }
      }
    }
  }

  spans.sort((a, b) => a.start - b.start);
  const parts: SentencePart[] = [];
  let from = 0;
  for (const span of spans) {
    if (span.start > from) parts.push({ kind: "text", text: text.slice(from, span.start) });
    parts.push(span.part);
    from = span.end;
  }
  if (from < text.length) parts.push({ kind: "text", text: text.slice(from) });
  return parts;
}

/** The detail keys a sentence quotes, by candidate. */
export function quotedDetails(parts: readonly SentencePart[]): Map<string, Set<string>> {
  const quoted = new Map<string, Set<string>>();
  for (const part of parts) {
    if (part.kind !== "figure") continue;
    const keys = quoted.get(part.candidateId) ?? new Set<string>();
    keys.add(part.detailKey);
    quoted.set(part.candidateId, keys);
  }
  return quoted;
}

export interface TraceFocus {
  /** Candidates the sentence in focus was written from. */
  linkedCandidates: ReadonlySet<string>;
  /** Sentences that quote the candidate in focus. */
  linkedSentences: ReadonlySet<string>;
  /** The detail rows those sentences quote, by candidate. */
  litDetails: ReadonlyMap<string, ReadonlySet<string>>;
  /** Whether a sentence's figure from this candidate is part of what is in focus. */
  figureLit: (sentenceId: string, candidateId: string) => boolean;
}

export function traceFocus(
  trace: TraceTarget,
  sentences: readonly InsightSentence[],
  bound: ReadonlyMap<string, readonly SentencePart[]>,
): TraceFocus {
  const linkedCandidates = new Set<string>();
  const linkedSentences = new Set<string>();
  const litDetails = new Map<string, Set<string>>();
  const light = (candidateId: string, keys: ReadonlySet<string>) => {
    const lit = litDetails.get(candidateId) ?? new Set<string>();
    for (const key of keys) lit.add(key);
    litDetails.set(candidateId, lit);
  };

  if (trace?.kind === "sentence") {
    const sentence = sentences.find((each) => each.id === trace.id);
    for (const id of sentence?.candidate_ids ?? []) linkedCandidates.add(id);
    for (const [candidateId, keys] of quotedDetails(bound.get(trace.id) ?? [])) light(candidateId, keys);
  } else if (trace?.kind === "candidate") {
    for (const sentence of sentences) {
      if (!sentence.candidate_ids.includes(trace.id)) continue;
      linkedSentences.add(sentence.id);
      const keys = quotedDetails(bound.get(sentence.id) ?? []).get(trace.id);
      if (keys) light(trace.id, keys);
    }
  }

  return {
    linkedCandidates,
    linkedSentences,
    litDetails,
    figureLit: (sentenceId, candidateId) =>
      (trace?.kind === "sentence" && trace.id === sentenceId) ||
      (trace?.kind === "candidate" && trace.id === candidateId && linkedSentences.has(sentenceId)),
  };
}
