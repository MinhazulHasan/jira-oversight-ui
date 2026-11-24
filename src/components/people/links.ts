import { SCORECARD_DEFAULT_DAYS } from "@/lib/api/schemas";

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

export function peopleHref(options: { days?: number; sort?: string; order?: "asc" | "desc" } = {}): string {
  const params = withDays(new URLSearchParams(), options.days);
  if (options.sort && options.sort !== "name") params.set("sort", options.sort);
  if (options.sort && options.sort !== "name" && options.order) params.set("order", options.order);
  const query = params.toString();
  return query ? `${PEOPLE_PAGE}?${query}` : PEOPLE_PAGE;
}
