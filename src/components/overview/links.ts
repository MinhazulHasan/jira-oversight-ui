import { NO_EPIC } from "@/lib/api/params";
import { UNASSIGNED, type HotSpot, type Person, type RuleSummary } from "@/lib/api/schemas";

/*
 * Where each figure on the Overview leads. Every headline number and every
 * bar opens the rows behind it, in the query form the Findings page reads
 * (docs/API_CONTRACT.md 4.3), so the count on the tile is the count in the
 * list it opens.
 */

/** The findings behind each headline tile. */
export const TILE_HREF = {
  /** Breach findings open now. */
  open_breaches: "/findings?severity=breach&state=open",
  /** Warning findings open now. */
  open_warnings: "/findings?severity=warning&state=open",
  /** First seen in the last 7 days, whether or not they have been resolved since. */
  new_7d: "/findings?state=all&first_seen=7d",
  /**
   * Resolved findings, most recently resolved first. The contract has no
   * "resolved in the last 7 days" filter, so the week's resolutions lead the list.
   */
  resolved_7d: "/findings?state=resolved&sort=resolved_at",
  /** A rule that cannot be measured has no findings to list; the process map says what Jira lacks. */
  rules_not_measurable: "/process",
} as const;

/** The open findings in one hot spot: its epic, or "none" for work outside every epic. */
export function hotSpotHref(spot: Pick<HotSpot, "epic_key">): string {
  return `/findings?state=open&epic=${encodeURIComponent(spot.epic_key ?? NO_EPIC)}`;
}

/**
 * The open findings on one person's work now, or (null) on the tickets nobody
 * is assigned to: exactly the row's breaches and warnings (docs/API_CONTRACT.md 4.12).
 */
export function personHref(person: Pick<Person, "id"> | null): string {
  return `/findings?state=open&person=${encodeURIComponent(person?.id ?? UNASSIGNED)}`;
}

/** Everyone's open findings, with the Person menu open on their counts. */
export const PEOPLE_HREF = "/findings?state=open&menu=person";

/**
 * A rule's open findings. A rule Jira cannot evaluate has none, so it leads
 * to the process map, which names the evidence it would need.
 */
export function ruleHref(rule: Pick<RuleSummary, "rule_id" | "measurable">): string {
  return rule.measurable ? `/findings?rule=${encodeURIComponent(rule.rule_id)}` : "/process";
}

/** Coverage of estimates: the work that started without one. */
export const ESTIMATE_FINDINGS_HREF = "/findings?rule=R-EST-01";
/** The ground-truth report breaks coverage down further. */
export const BASELINE_HREF = "/baseline";
export const OPEN_FINDINGS_HREF = "/findings?state=open";
export const PROCESS_HREF = "/process";
export const INSIGHTS_HREF = "/insights";
