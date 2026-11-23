import { SCORECARD_DEFAULT_DAYS } from "@/lib/api/schemas";

/*
 * The ways into the People page (JO-11), for people level only: Findings'
 * Person filter, the Overview's open findings by person, and Ask's scorecard
 * and comparison answers. The address is the page's own state
 * (people-view.tsx): the period, the person whose scorecard is open and the
 * table's sort, so a link opens the very figures it came from.
 */

/** Everyone's figures, the table first. */
export const PEOPLE_PAGE = "/people";

/** The page's period in its address: left out at the 90 days it opens at. */
function withDays(params: URLSearchParams, days: number | undefined): URLSearchParams {
  if (days !== undefined && days !== SCORECARD_DEFAULT_DAYS) params.set("days", String(days));
  return params;
}

/** One person's scorecard on the People page, over the period the link comes from (90 days unless said). */
export function scorecardHref(personId: string, options: { days?: number } = {}): string {
  return `${PEOPLE_PAGE}?${withDays(new URLSearchParams(), options.days).toString()}${options.days !== undefined && options.days !== SCORECARD_DEFAULT_DAYS ? "&" : ""}${new URLSearchParams({ person: personId }).toString()}`;
}

/**
 * Everyone on the People page, over a period and sorted by a measure, as an answer orders them: the column's own
 * first order (closer to the process first; a count most first) unless `order` says otherwise, as an answer in the
 * order its question asked does (JO-14: "who could take more work?" is a count fewest first, "who has the most
 * reopened tickets?" a rate highest first).
 */
export function peopleHref(options: { days?: number; sort?: string; order?: "asc" | "desc" } = {}): string {
  const params = withDays(new URLSearchParams(), options.days);
  if (options.sort && options.sort !== "name") params.set("sort", options.sort);
  if (options.sort && options.sort !== "name" && options.order) params.set("order", options.order);
  const query = params.toString();
  return query ? `${PEOPLE_PAGE}?${query}` : PEOPLE_PAGE;
}
