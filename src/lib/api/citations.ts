import type { Citation } from "./schemas";

export type AnswerSegment = { kind: "text"; text: string } | { kind: "cite"; text: string; citation: Citation };

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
