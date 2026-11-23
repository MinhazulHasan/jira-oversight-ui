"use client";

import { NAME_TRIGGER, PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { Badge, SeverityBadge, SeverityMark, StateDot } from "@/components/ui/badge";
import { dataTableColumns, type DataTableColumn, type SortingState } from "@/components/ui/data-table";
import { PersonName } from "@/components/ui/person-name";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Finding } from "@/lib/api/schemas";
import { formatDateTime } from "@/lib/format";

import { usePageFindingClock } from "./clock";
import { findingAgeMs, findingStatus, formatAge, NO_ONES_LABEL, noOnesReason, SETTINGS_CHANGED_TITLE, STATUS_LABEL } from "./model";
import type { FindingsFilters, FindingsSort } from "./url-state";

/*
 * The API sorts and pages the findings, so the table must never reorder a
 * page itself: every sortable column compares rows as equal (the table then
 * keeps the order it was given) and leaves empty values where the API put
 * them. A header click only changes the sort in the URL, and the API answers.
 */
const keepServerOrder = () => 0;
const SERVER_SORTED = { sortFn: keepServerOrder, sortUndefined: false } as const;

/**
 * The rule's title, with the column's whole width, then its id and why it
 * fired on this issue in the finding's own words ("Logged 11.0 h against an
 * estimate of 4.0 h"), so a row answers "why is this a breach?" without a
 * click. The evidence behind it is in the drawer. (SQA: with the id before
 * it on one line, a title read "Effort b…" at a MacBook's width.)
 */
function RuleCell({ finding }: { finding: Finding }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5" title={`${finding.rule_id} · ${finding.rule_title}\n${finding.message}`}>
      {/* Two lines before it is cut short, like the epic's title; the whole of it is in the tooltip. */}
      <span className="line-clamp-2 min-w-0 whitespace-normal break-words text-ink" data-rule-title>
        {finding.rule_title}
      </span>{" "}
      <span className="min-w-0 truncate text-xs text-ink-low">
        <span className="mono">{finding.rule_id}</span>
        <span aria-hidden> · </span>
        <span className="sr-only">: </span>
        <span data-finding-reason>{finding.message}</span>
      </span>
    </span>
  );
}

function IssueCell({ finding }: { finding: Finding }) {
  if (finding.issue_key === null) {
    const name = finding.sprint?.name ?? "Sprint";
    return (
      <span className="flex min-w-0 items-center gap-2" title={name}>
        <Badge tone="muted" size="sm">
          Sprint
        </Badge>
        <span className="min-w-0 truncate text-ink">{name}</span>
      </span>
    );
  }
  // The key over its summary, as the rule over its reason: the summary gets the column's whole width.
  return (
    <span className="flex min-w-0 flex-col gap-0.5" title={finding.issue_summary ?? undefined}>
      {/* The space keeps the text "DEMO-1098 Load test…" for a reader and a copy; the column drops it from the layout. */}
      <span className="mono text-ink">{finding.issue_key}</span>{" "}
      <span className="min-w-0 truncate text-xs text-ink-mid">{finding.issue_summary}</span>
    </span>
  );
}

function EpicCell({ finding }: { finding: Finding }) {
  if (finding.epic_key === null) return <span className="text-ink-low">No epic</span>;
  const title = finding.epic_title ?? finding.epic_key;
  // Two lines before it is cut short, like the rule and the issue beside it; the whole title is in its tooltip.
  // A word longer than the column is hyphenated where the language allows ("Perfor-mance"), broken only otherwise.
  return (
    <span
      className="line-clamp-2 whitespace-normal break-words hyphens-auto text-ink-mid"
      title={`${finding.epic_key} · ${title}`}
    >
      {title}
    </span>
  );
}

/**
 * Who the issue is assigned to now. A sprint finding, and one whose ticket has
 * left the synced data, belong to no one, so they say nothing rather than
 * "Unassigned" (which the Unassigned filter would not find). At people level
 * the name opens the person's card (JO-13): the pointer's way in, the row
 * keeping its one tab stop; the drawer's assignee is the keyboard's.
 */
function AssigneeCell({ finding }: { finding: Finding }) {
  const reason = noOnesReason(finding);
  if (reason !== null) {
    return (
      <span className="text-ink-low" title={NO_ONES_LABEL[reason]}>
        <span aria-hidden>—</span>
        <span className="sr-only">{NO_ONES_LABEL[reason]}</span>
      </span>
    );
  }
  if (finding.assignee === null) return <PersonName person={null} className="text-ink-mid" />;
  return (
    <PersonCardTrigger person={finding.assignee} inRow tabbable={false} className={NAME_TRIGGER}>
      <PersonName person={finding.assignee} className="text-ink-mid" />
    </PersonCardTrigger>
  );
}

/** How long it has been open, on the page's one clock: to now beside "First seen 4 h ago", or to a stale last sync. */
function AgeCell({ finding }: { finding: Finding }) {
  const locale = useFigureLocale();
  const clock = usePageFindingClock();
  return <span className="text-ink-mid">{formatAge(findingAgeMs(finding, clock.now), locale)}</span>;
}

/**
 * "Open for", and under it "at last sync" once the board's data is stale: an
 * open finding's age then stops at that sync, while "First seen 9 d ago"
 * beside it reads the reader's clock, so the two never seem to disagree.
 */
function OpenForHeader() {
  const clock = usePageFindingClock();
  if (!clock.stale || clock.syncedAt === null) return <>Open for</>;
  return (
    <span className="flex flex-col items-end gap-px" title={`As at the last sync, ${formatDateTime(clock.syncedAt)}`} data-open-for="at-last-sync">
      <span>Open for</span>{" "}
      <span className="tracking-normal normal-case">at last sync</span>
    </span>
  );
}

function StateCell({ finding }: { finding: Finding }) {
  const status = findingStatus(finding);
  if (status === "resolved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-mid">
        <SeverityMark severity="resolved" size={9} />
        {STATUS_LABEL.resolved}
      </span>
    );
  }
  if (status === "settings_changed") {
    // Two short lines in the column: "Closed", then why, read whole as "Closed: rule settings changed" (JO-15). The
    // column holds "settings changed" under the word, never cut short; "rule" is heard, and the tooltip says it all.
    return (
      <span className="flex flex-col leading-tight" title={SETTINGS_CHANGED_TITLE} data-state="settings_changed">
        <StateDot tone="neutral" size="sm" label={<span className="text-ink-mid">Closed<span className="sr-only">:</span></span>} />{" "}
        <span className="pl-3.5 text-xs whitespace-nowrap text-ink-low">
          <span className="sr-only">rule </span>settings changed
        </span>
      </span>
    );
  }
  return (
    <span title={status === "superseded" ? "A newer rules version replaced this finding" : undefined}>
      <StateDot tone="neutral" size="sm" label={STATUS_LABEL[status]} className="text-ink-mid" />
    </span>
  );
}

const col = dataTableColumns<Finding>();

/**
 * Severity, rule, issue, epic, assignee, first seen, open for and state;
 * every sortable header is an API sort. The API cannot sort by assignee, so
 * that header does not offer to.
 */
export const FINDING_COLUMNS: DataTableColumn<Finding>[] = col.columns([
  col.accessor("severity", {
    header: "Severity",
    cell: ({ row }) => <SeverityBadge severity={row.original.severity} size="sm" />,
    sortDescFirst: true,
    ...SERVER_SORTED,
    // A sortable header keeps 28 px for its sort arrow: these widths hold the whole label.
    meta: { width: "6.5rem" },
  }),
  col.accessor("rule_id", {
    // "Rule": the reason under it needs no word of its own, and "Rule and reason" was cut short at 1440 px.
    header: "Rule",
    cell: ({ row }) => <RuleCell finding={row.original} />,
    sortDescFirst: false,
    ...SERVER_SORTED,
    // No width: the rule takes what the others leave, so its title reads whole, on two lines at most, at a MacBook's
    // width (about 11rem at 1280 px with the rail open, 18rem at 1440 px; SQA).
  }),
  col.accessor((finding) => finding.issue_key ?? undefined, {
    id: "issue_key",
    header: "Issue",
    cell: ({ row }) => <IssueCell finding={row.original} />,
    sortDescFirst: false,
    ...SERVER_SORTED,
    // The key whole at the table's narrowest, the summary under it cut short (whole in its tooltip and the drawer).
    meta: { width: "12%" },
  }),
  col.accessor((finding) => finding.epic_key ?? undefined, {
    id: "epic_key",
    header: "Epic",
    cell: ({ row }) => <EpicCell finding={row.original} />,
    sortDescFirst: false,
    ...SERVER_SORTED,
    // Wide enough for a long word of a title ("Performance", "Integrations") on one of its two lines.
    meta: { width: "9%" },
  }),
  col.accessor((finding) => finding.assignee?.name, {
    id: "assignee",
    header: "Assignee",
    cell: ({ row }) => <AssigneeCell finding={row.original} />,
    enableSorting: false,
    // The picture (20 px and its gap) and about 10 characters of a name at 1440 px; a longer one is cut short,
    // whole in its tooltip. A plain share: a column's width that mixes a share and a length (calc) is ignored, and
    // the column then split what was left with the rule (SQA: the rule's title read "Effort b…").
    meta: { width: "9%" },
  }),
  col.accessor("first_seen_at", {
    header: "First seen",
    cell: ({ row }) => <Timestamp value={row.original.first_seen_at} mode="relative" className="text-ink-mid" />,
    sortDescFirst: true,
    ...SERVER_SORTED,
    meta: { width: "6.5rem", numeric: true },
  }),
  col.accessor((finding) => findingAgeMs(finding), {
    id: "age",
    header: () => <OpenForHeader />,
    cell: ({ row }) => <AgeCell finding={row.original} />,
    enableSorting: false,
    meta: { width: "5.5rem", numeric: true, label: "Open for" },
  }),
  col.accessor((finding) => finding.resolved_at ?? undefined, {
    id: "resolved_at",
    header: "State",
    cell: ({ row }) => <StateCell finding={row.original} />,
    sortDescFirst: true,
    ...SERVER_SORTED,
    // The header and its sort arrow, and a finding closed by a settings change (JO-15): "settings changed" under its
    // dot's word, whole, in WebKit as in Chromium.
    meta: { width: "8.5rem" },
  }),
]);

/** The columns the API can sort by share the sort's name, so the URL maps straight onto the headers. */
const SORTABLE = new Set<string>(["severity", "rule_id", "issue_key", "epic_key", "first_seen_at", "resolved_at"]);

/** The URL's sort as the table's state; a sort with no column of its own (last seen) marks no header. */
export function sortingFromUrl(filters: Pick<FindingsFilters, "sort" | "order">): SortingState {
  return SORTABLE.has(filters.sort) ? [{ id: filters.sort, desc: filters.order === "desc" }] : [];
}

/** A header click as URL values: a cleared sort goes back to the default (newest first). */
export function sortToUrl(sorting: SortingState): { sort: FindingsSort | null; order: "asc" | "desc" | null } {
  const [first] = sorting;
  if (!first || !SORTABLE.has(first.id)) return { sort: null, order: null };
  return { sort: first.id as FindingsSort, order: first.desc ? "desc" : "asc" };
}
