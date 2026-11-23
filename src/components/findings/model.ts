import type { CsvColumn } from "@/components/ui/csv";
import { DATE_RANGE_PRESETS } from "@/components/ui/date-range";
import { NO_EPIC } from "@/lib/api/params";
import { UNASSIGNED, UNASSIGNED_LABEL, type FacetEntry, type Finding, type FindingsPage } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { isStale } from "@/lib/sync";

import type { FindingsFilters } from "./url-state";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NBSP = " ";

/** What the epic filter calls findings outside every epic. */
export const NO_EPIC_LABEL = "(no epic)";

/* ----------------------------------------------------------------- age -- */

type Seen = Pick<Finding, "first_seen_at" | "last_seen_at" | "resolved_at">;

/**
 * The clock an open finding's age is read on, one for the page (JO-13m):
 * now, the clock "First seen 4 h ago" beside it reads, while the board's
 * last sync is fresh; once that sync is stale (older than the top bar's two
 * hours), what is open is known only as of it, so the age stops at the last
 * rules run that saw the finding, and the page says "at last sync". Without
 * a sync time or the reader's clock, the age is by the rules runs alone.
 */
export interface FindingClock {
  /** What an open finding's age runs to: now, or null for the last run that saw it. */
  now: number | null;
  /** The board's last sync is stale: an open finding's age is as at that sync. */
  stale: boolean;
  /** When the board last synced, for the words that say so. */
  syncedAt: string | null;
}

/** Ages by the rules runs alone: no clock is read. */
export const RULES_CLOCK: FindingClock = { now: null, stale: false, syncedAt: null };

export function findingClock(lastSyncedAt: string | null | undefined, now: number | null): FindingClock {
  if (now === null || !lastSyncedAt) return { ...RULES_CLOCK, syncedAt: lastSyncedAt ?? null };
  const stale = isStale(lastSyncedAt, now);
  return { now: stale ? null : now, stale, syncedAt: lastSyncedAt };
}

/**
 * How long a finding has been open: from the rules run that first saw it to
 * the run that no longer saw it, once resolved. While it is open, to `now`
 * where the page reads ages on that clock (the board's data is fresh), never
 * short of the last run that saw it; else to that last run, so the figure
 * can be checked against the two timestamps beside it.
 */
export function findingAgeMs(finding: Seen, now: number | null = null): number {
  const start = Date.parse(finding.first_seen_at);
  const lastRun = Date.parse(finding.resolved_at ?? finding.last_seen_at);
  const end = finding.resolved_at === null && now !== null ? Math.max(now, lastRun) : lastRun;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

/**
 * "<1 h", "5 h", "47 h", "2 d", "38 d": the nearest whole hour under two
 * days, the nearest whole day after, rounded as "First seen 5 h ago" beside
 * it is (under 45 minutes it says minutes, where this says "<1 h"), so the
 * two never read the same span apart.
 */
export function formatAge(ms: number, locale?: string): string {
  if (ms < 45 * MINUTE) return `<1${NBSP}h`;
  const hours = Math.max(1, Math.round(ms / HOUR));
  if (hours < 48) return `${formatCount(hours, { locale })}${NBSP}h`;
  return `${formatCount(Math.round(ms / DAY), { locale })}${NBSP}d`;
}

/* -------------------------------------------------------------- status -- */

export type FindingStatus = "open" | "resolved" | "superseded" | "settings_changed";

/**
 * Resolved because the condition stopped, because a newer rules version replaced it, or (JO-15) because the board's
 * rule settings changed, so the rule no longer holds it: never read as fixed.
 */
export function findingStatus(finding: Pick<Finding, "state" | "resolved_why">): FindingStatus {
  if (finding.state === "open") return "open";
  if (finding.resolved_why === "superseded") return "superseded";
  return finding.resolved_why === "settings_changed" ? "settings_changed" : "resolved";
}

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  superseded: "Superseded",
  settings_changed: "Closed: rule settings changed",
};

/** What a closed finding's state says beyond its label, for a tooltip. */
export const SETTINGS_CHANGED_TITLE = "Closed because the rule settings changed";

/* ------------------------------------------------------------ assignee -- */

export type NoOnesReason = "sprint" | "gone";

/**
 * Why a finding belongs to no one, or null when it belongs to its issue's
 * assignee (or to Unassigned). A sprint finding has no issue. A finding whose
 * issue has left the synced snapshot (deleted or moved in Jira since the rules
 * last ran) keeps its key but comes with neither the issue's summary nor its
 * type, which Jira gives every live ticket; no person filter matches it,
 * Unassigned included (API_CONTRACT.md, `assignee`), so it must not read
 * "Unassigned" either.
 */
export function noOnesReason(finding: Pick<Finding, "scope" | "issue_type" | "issue_summary">): NoOnesReason | null {
  if (finding.scope === "sprint") return "sprint";
  return finding.issue_type === null && finding.issue_summary === null ? "gone" : null;
}

export const NO_ONES_LABEL: Record<NoOnesReason, string> = {
  sprint: "No one: a sprint finding",
  gone: "No one: the ticket is no longer in the synced data",
};

/* -------------------------------------------------------- result line -- */

export interface ResultSummary {
  total: number;
  /** "open findings", "resolved breaches", "findings". */
  noun: string;
  /** Breaches among them, when both severities are shown. */
  breaches: number | null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function resultSummary(page: FindingsPage, filters: Pick<FindingsFilters, "state" | "severity">): ResultSummary {
  const total = page.total;
  const kind =
    filters.severity === "breach"
      ? plural(total, "breach", "breaches")
      : filters.severity === "warning"
        ? plural(total, "warning", "warnings")
        : plural(total, "finding", "findings");
  const noun = filters.state === "all" ? kind : `${filters.state} ${kind}`;
  // "0 open findings · 0 breaches" says nothing twice: the breaches are counted only among some findings.
  const breaches =
    filters.severity === null && total > 0
      ? (page.facets.severity.find((entry) => entry.value === "breach")?.count ?? 0)
      : null;
  return { total, noun, breaches };
}

/** The result line as one sentence: "809 open findings · 523 breaches". */
export function resultSentence(summary: ResultSummary, locale?: string): string {
  const head = `${formatCount(summary.total, { locale })} ${summary.noun}`;
  if (summary.breaches === null) return head;
  return `${head} · ${formatCount(summary.breaches, { locale })} ${plural(summary.breaches, "breach", "breaches")}`;
}

/* -------------------------------------------------- what was looked at -- */

export interface FacetNames {
  rules: readonly FacetEntry[];
  epics: readonly FacetEntry[];
  people?: readonly FacetEntry[];
}

/** A person filter value by name: the facet's label, "Unassigned", or (not on this board) a plain stand-in, never the id. */
export function personFilterName(value: string, people?: readonly FacetEntry[]): string {
  if (value === UNASSIGNED) return UNASSIGNED_LABEL;
  return people?.find((entry) => entry.value === value)?.label ?? "someone not on this board";
}

function listed(ids: readonly string[], name: (id: string) => string, one: string, many: string): string {
  if (ids.length === 1) return `${one} ${name(ids[0])}`;
  if (ids.length <= 3) return `${many} ${ids.map(name).join(", ")}`;
  return `${ids.length} ${many}`;
}

/**
 * The filters in words, so an empty list (or a printed one) says exactly
 * what was looked at: "open breaches in DEMO, rule R-EST-01, assigned to
 * Ada Brooks, first seen in the last 7 days, matching “webhook”".
 */
export function describeFilters(filters: FindingsFilters, projects: readonly string[], names?: FacetNames): string {
  const severity = filters.severity === "breach" ? "breaches" : filters.severity === "warning" ? "warnings" : "findings";
  const subject = filters.state === "all" ? `${severity}, open or resolved` : `${filters.state} ${severity}`;
  const parts = [projects.length > 0 ? `${subject} in ${projects.join(", ")}` : subject];

  if (filters.rule.length > 0) parts.push(listed(filters.rule, (id) => id, "rule", "rules"));
  if (filters.epic.length > 0) {
    const epicName = (value: string) =>
      value === NO_EPIC ? NO_EPIC_LABEL : (names?.epics.find((entry) => entry.value === value)?.label ?? value);
    parts.push(
      filters.epic.length === 1 && filters.epic[0] === NO_EPIC
        ? "outside every epic"
        : listed(filters.epic, epicName, "epic", "epics"),
    );
  }
  if (filters.person.length > 0) {
    // Among several people, the unassigned tickets read as nobody's: "assigned to Ada Brooks or nobody".
    const name = (value: string) => (value === UNASSIGNED ? "nobody" : personFilterName(value, names?.people));
    parts.push(
      filters.person.length === 1 && filters.person[0] === UNASSIGNED
        ? "on unassigned tickets"
        : filters.person.length <= 3
          ? `assigned to ${filters.person.map(name).join(" or ")}`
          : `assigned to any of ${filters.person.length} people`,
    );
  }
  if (filters.first_seen !== "all") {
    const preset = DATE_RANGE_PRESETS.find((option) => option.value === filters.first_seen);
    parts.push(`first seen in the ${preset?.label.toLowerCase() ?? filters.first_seen}`);
  }
  const q = filters.q.trim();
  if (q !== "") parts.push(`matching “${q}”`);
  return parts.join(", ");
}

/* ----------------------------------------------------------------- CSV -- */

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The rows as shown, with every value as the API gave it (timestamps in UTC, figures as numbers). */
export const FINDINGS_CSV: readonly CsvColumn<Finding>[] = [
  { header: "Finding id", value: (finding) => finding.finding_id },
  { header: "Severity", value: (finding) => finding.severity },
  { header: "Rule", value: (finding) => finding.rule_id },
  { header: "Rule title", value: (finding) => finding.rule_title },
  { header: "Issue", value: (finding) => finding.issue_key },
  { header: "Summary", value: (finding) => finding.issue_summary },
  { header: "Sprint", value: (finding) => finding.sprint?.name },
  { header: "Epic", value: (finding) => finding.epic_key },
  { header: "Epic title", value: (finding) => finding.epic_title },
  // The display name only, as on screen; empty for an unassigned issue and for a sprint finding.
  { header: "Assignee", value: (finding) => finding.assignee?.name },
  { header: "First seen (UTC)", value: (finding) => finding.first_seen_at },
  { header: "Last seen (UTC)", value: (finding) => finding.last_seen_at },
  // By the rules runs alone (first seen to last seen, or to resolved), so the export checks against its own two columns.
  { header: "Open for (hours)", value: (finding) => round1(findingAgeMs(finding) / HOUR) },
  { header: "State", value: (finding) => STATUS_LABEL[findingStatus(finding)] },
  { header: "Resolved (UTC)", value: (finding) => finding.resolved_at },
  { header: "Threshold", value: (finding) => finding.threshold },
  { header: "Message", value: (finding) => finding.message },
];
