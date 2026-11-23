/*
 * The sheet's grid. On a wide screen the narrative sits in the reading column
 * and the problems it was written from beside it, so a sentence and the rows
 * it lights are seen together. Narrower, and on paper (A4 and Letter print
 * below every breakpoint), it reads top to bottom: briefing, then problems.
 */

export const BRIEFING_GRID =
  "grid gap-x-12 gap-y-10 [grid-template-areas:'narrative'_'candidates'] xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:[grid-template-areas:'narrative_candidates']";

export const BRIEFING_AREAS = {
  narrative: "[grid-area:narrative]",
  candidates: "[grid-area:candidates]",
} as const;
