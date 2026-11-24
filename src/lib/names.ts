/** A letter, a mark, a digit or an underscore: what a name may not run into. */
const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}_]";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface NameAt {
  name: string;
  start: number;
  end: number;
}

export function findNames(text: string, names: readonly string[]): NameAt[] {
  const unique = [...new Set(names.filter((name) => name.trim().length > 0))].sort((a, b) => b.length - a.length);
  if (unique.length === 0 || text.length === 0) return [];
  const pattern = new RegExp(`(?<!${WORD_CHAR})(?:${unique.map(escapeRegExp).join("|")})(?!${WORD_CHAR})`, "gu");
  return [...text.matchAll(pattern)].map((match) => ({ name: match[0], start: match.index, end: match.index + match[0].length }));
}

/** Letters that keep their own shape when the accents come off. */
const UNFOLDED: Record<string, string> = { ı: "i", ł: "l", ø: "o", đ: "d", ð: "d", þ: "th", ß: "ss", æ: "ae", œ: "oe" };

/** Lower case with the accents taken off, as a typed search compares names: "Élif Aydın" reads "elif aydin". */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ıłøđðþßæœ]/g, (letter) => UNFOLDED[letter] ?? letter);
}

/** Code point by code point, as the service's Python compares strings (not UTF-16 unit by unit). */
function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    const difference = left[at].codePointAt(0)! - right[at].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function compareByFoldedName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return compareCodePoints(foldText(a.name), foldText(b.name)) || compareCodePoints(a.id, b.id);
}
