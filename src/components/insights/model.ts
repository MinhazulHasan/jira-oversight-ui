import { FALLBACK_LOCALE, formatNumber } from "@/lib/format";
import {
  ISSUE_KEY_PATTERN,
  RULE_ID_PATTERN,
  type Candidate,
  type InsightSentence,
} from "@/lib/api/schemas";

export type Tone = InsightSentence["tone"];
export type CandidateKind = Candidate["kind"];
export type CandidateSeverity = Candidate["severity"];
export type CandidateDetail = Candidate["detail"][number];

export const TONES: Record<Tone, { mark: "breach" | "warning" | "neutral"; label: string }> = {
  blatantly_bad: { mark: "breach", label: "Serious" },
  trending_bad: { mark: "warning", label: "Getting worse" },
  neutral: { mark: "neutral", label: "For information" },
};

export const TONE_ORDER: readonly Tone[] = ["blatantly_bad", "trending_bad", "neutral"];

/** weekly.py's candidate kinds, in the reader's words. */
export const KIND_LABELS: Record<CandidateKind, string> = {
  breach_hot_spot: "Breach hot spot",
  rising_rule: "Rising rule",
  wow_change: "Week-on-week change",
  outlier: "Outlier",
  coverage: "Coverage",
};

const AFFECTED_UNITS: Record<CandidateKind, [one: string, many: string]> = {
  breach_hot_spot: ["open breach", "open breaches"],
  rising_rule: ["new finding", "new findings"],
  wow_change: ["closed interval", "closed intervals"],
  outlier: ["issue", "issues"],
  coverage: ["uncovered issue", "uncovered issues"],
};

export function affectedUnit(kind: CandidateKind, affected: number): string {
  const [one, many] = AFFECTED_UNITS[kind];
  return affected === 1 ? one : many;
}

/* ------------------------------------------------------------- findings -- */

export interface FindingsTarget {
  href: string;
  /** How many findings stand behind the candidate. */
  count: number;
  /** What the count counts: singular, plural. */
  noun: readonly [string, string];
  /** True when the link shows exactly these findings; false when it opens the first of them. */
  exact: boolean;
}

const FINDINGS: readonly [string, string] = ["finding", "findings"];

export function findingsUrl(params: Record<string, string>): string {
  return `/findings?${new URLSearchParams(params).toString()}`;
}

/** A hot spot's epic: named in its id (`hot-spot-demo-704`), and its first issue key. */
export function epicKeyOf(candidate: Candidate): string | null {
  const fromId = /^hot-spot-(.+)$/i.exec(candidate.id)?.[1]?.toUpperCase();
  if (fromId && ISSUE_KEY_PATTERN.test(fromId)) return fromId;
  return candidate.issue_keys[0] ?? null;
}

/** A rising rule's id: the first word of its title ("R-EST-01 is rising"), or its own id. */
export function ruleIdOf(candidate: Candidate): string | null {
  for (const word of candidate.title.split(/\s+/)) {
    const bare = word.replace(/[^\w-]+$/, "");
    if (RULE_ID_PATTERN.test(bare)) return bare;
  }
  const fromId = /^rising-rule-(.+)$/i.exec(candidate.id)?.[1]?.toUpperCase();
  return fromId && RULE_ID_PATTERN.test(fromId) ? fromId : null;
}

export function findingsTarget(candidate: Candidate, ruleHint?: string | null): FindingsTarget | null {
  const ids = candidate.finding_ids;
  const count = ids.length;
  if (count === 0) return null;

  if (candidate.kind === "breach_hot_spot") {
    const epic = epicKeyOf(candidate);
    const severity = candidate.severity === "info" ? null : candidate.severity;
    if (epic && severity) {
      const noun: readonly [string, string] = severity === "breach" ? ["open breach", "open breaches"] : ["open warning", "open warnings"];
      return { href: findingsUrl({ epic, severity }), count, noun, exact: true };
    }
  }
  if (candidate.kind === "rising_rule") {
    const rule = ruleIdOf(candidate);
    if (rule) {
      return {
        href: findingsUrl({ rule, state: "all", first_seen: "7d" }),
        count,
        noun: ["finding this week", "findings this week"],
        exact: true,
      };
    }
  }
  if (count > 1 && ruleHint && RULE_ID_PATTERN.test(ruleHint)) {
    return { href: findingsUrl({ rule: ruleHint }), count, noun: FINDINGS, exact: true };
  }
  return { href: findingsUrl({ finding: ids[0] }), count, noun: FINDINGS, exact: count === 1 };
}

/** True when the link can only be made exact by reading the rule off the first finding. */
export function needsRuleHint(candidate: Candidate): boolean {
  const target = findingsTarget(candidate);
  return target !== null && !target.exact;
}

/** Where a candidate's row leads: its findings, else its first issue. */
export function primaryHref(candidate: Candidate, target: FindingsTarget | null): string | null {
  if (target) return target.href;
  const key = candidate.issue_keys[0];
  return key ? `/issues/${key}` : null;
}

/* ---------------------------------------------------------------- trend -- */

function shown(value: number, decimals: number): number {
  return Number(formatNumber(value, { locale: FALLBACK_LOCALE, decimals }).replace(/,/g, ""));
}

/** "rising", "steady", "easing": how this week compares with the one before (the trend, this week over last). */
export function trendWord(trend: number): string {
  const rounded = shown(trend, 2);
  if (rounded > 1) return "rising";
  if (rounded < 1) return "easing";
  return "steady";
}

/* ------------------------------------------------------------- briefing -- */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** What a briefing from a week that is over says beside its date: its figures are that week's, not today's. */
export const EARLIER_WEEK = "From an earlier week. Figures may have changed since.";

export function fromEarlierWeek(weekOf: string, now: number): boolean {
  const monday = Date.parse(`${weekOf}T00:00:00Z`);
  return Number.isFinite(monday) && now >= monday + WEEK_MS;
}

/** The details that are words (an epic's title, a sprint's name) rather than figures. */
export function isTextDetail(detail: CandidateDetail): boolean {
  return detail.unit === null && typeof detail.value === "string";
}

/** The candidates a sentence was written from, in rank order. */
export function candidatesOf(sentence: InsightSentence, candidates: readonly Candidate[]): Candidate[] {
  const wanted = new Set(sentence.candidate_ids);
  return candidates.filter((candidate) => wanted.has(candidate.id));
}

export function sentenceSource(sentence: InsightSentence): Candidate | null {
  if (sentence.finding_ids.length === 0 && sentence.issue_keys.length === 0) return null;
  return {
    id: `${sentence.id}-sources`,
    kind: "coverage",
    title: sentence.text,
    score: 0,
    affected: 0,
    severity: "info",
    trend: 1,
    detail: [],
    issue_keys: sentence.issue_keys,
    finding_ids: sentence.finding_ids,
  };
}

/** Tones present in the briefing, in a fixed order, for its legend. */
export function tonesIn(sentences: readonly InsightSentence[]): Tone[] {
  const present = new Set(sentences.map((sentence) => sentence.tone));
  return TONE_ORDER.filter((tone) => present.has(tone));
}
