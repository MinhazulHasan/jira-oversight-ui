import type { Citation } from "./schemas";

/**
 * An answer, split into prose and the values its citations bind: what the Ask
 * page renders, with a marker and a tick-and-tie line on each cited value.
 */
export type AnswerSegment = { kind: "text"; text: string } | { kind: "cite"; text: string; citation: Citation };

/**
 * Where `token` next stands on its own in `text`, at or after `from`: not inside
 * a rule id ("02" in R-FLOW-02), a key or a longer number ("1" in "1.5"). These
 * are the boundaries the validator reads values by, so a citation lands on the
 * occurrence it was bound to.
 */
function findToken(text: string, token: string, from: number): number {
  for (let at = text.indexOf(token, from); at >= 0; at = text.indexOf(token, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + token.length);
    const next = text.charAt(at + token.length + 1);
    const joinedBefore = /[\w-]/.test(before);
    const joinedAfter = /\w/.test(after) || (/[.,]/.test(after) && /\d/.test(next));
    if (!joinedBefore && !joinedAfter) return at;
  }
  return -1;
}

/**
 * Citations arrive in text order, and the contract finds each by searching from
 * the end of the one before, so a value written twice binds to the right
 * occurrence. One that cannot be found is left out rather than drawn in the
 * wrong place.
 */
export function segmentAnswer(answer: string, citations: readonly Citation[]): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let from = 0;
  for (const citation of [...citations].sort((a, b) => a.marker - b.marker)) {
    const at = findToken(answer, citation.text, from);
    if (at < 0) continue;
    if (at > from) segments.push({ kind: "text", text: answer.slice(from, at) });
    segments.push({ kind: "cite", text: citation.text, citation });
    from = at + citation.text.length;
  }
  if (from < answer.length) segments.push({ kind: "text", text: answer.slice(from) });
  return segments;
}
