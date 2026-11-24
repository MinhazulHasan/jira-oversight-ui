
export const BRIEFING_GRID =
  "grid gap-x-12 gap-y-10 [grid-template-areas:'narrative'_'candidates'] xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:[grid-template-areas:'narrative_candidates']";

export const BRIEFING_AREAS = {
  narrative: "[grid-area:narrative]",
  candidates: "[grid-area:candidates]",
} as const;
