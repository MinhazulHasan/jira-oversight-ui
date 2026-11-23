"use client";

import Link from "next/link";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useMemo } from "react";

import { Badge, SEVERITY_LABEL, SeverityBadge, SeverityMark } from "@/components/ui/badge";
import { DataTable, dataTableColumns, type SortingState } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ProcessStage, Rule } from "@/lib/api/schemas";
import { formatCount, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  findingsHref,
  inSentence,
  KIND_LABEL,
  missingEvidenceText,
  OFF_ON_BOARD,
  openFindings,
  RULE_CSV_COLUMNS,
  stageLabel,
} from "./labels";

/* ------------------------------------------------------------ sorting --- */

export const SORT_COLUMNS = ["rule_id", "title", "kind", "severity", "threshold", "measurable", "open"] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

const sortParsers = {
  sort: parseAsStringLiteral(SORT_COLUMNS),
  order: parseAsStringLiteral(["asc", "desc"] as const),
};

/** The sort lives in the URL (?sort=open&order=desc), so a shared link opens the same order. */
export function useCatalogueSort(): [SortingState, (next: SortingState) => void] {
  const [{ sort, order }, setSort] = useQueryStates(sortParsers, { history: "replace" });
  const sorting = useMemo<SortingState>(() => (sort ? [{ id: sort, desc: order === "desc" }] : []), [sort, order]);
  const setSorting = (next: SortingState) => {
    const first = next[0];
    const id = SORT_COLUMNS.find((column) => column === first?.id);
    void setSort(first && id ? { sort: id, order: first.desc ? "desc" : "asc" } : { sort: null, order: null });
  };
  return [sorting, setSorting];
}

/** How each order reads after "sorted by": ascending, then descending. */
const ORDER_WORDS: Record<SortColumn, [string, string]> = {
  rule_id: ["rule, A to Z", "rule, Z to A"],
  title: ["title, A to Z", "title, Z to A"],
  kind: ["kind, rules first", "kind, early warnings first"],
  severity: ["severity, breaches first", "severity, warnings first"],
  threshold: ["threshold, A to Z", "threshold, Z to A"],
  measurable: ["measurability, gaps first", "measurability, measurable first"],
  open: ["open findings, fewest first", "open findings, most first"],
};

export function sortSummary(sorting: SortingState): string {
  const current = sorting[0];
  const words = current ? ORDER_WORDS[current.id as SortColumn] : undefined;
  return current && words ? `sorted by ${words[current.desc ? 1 : 0]}` : "in catalogue order";
}

/* ------------------------------------------------------------ columns --- */

/**
 * A rule an admin turned off on the board (JO-15) reads muted across its row, not in its title alone: its kind,
 * severity, threshold and measurability in the quiet ink, so no one scanning a column takes it for one in force.
 */
const inkFor = (rule: Rule, ink: string) => (rule.enabled ? ink : "text-ink-low");

/**
 * A rule's title, and how the board runs it where that is not the catalogue's way (JO-15): muted, "Off on this
 * board", for a rule an admin turned off there; "Customised" (the neutral badge, as the rule settings page marks it)
 * for one whose settings they changed; and (JO-20) "Custom" with its check's label for a rule an admin added.
 */
function TitleCell({ rule }: { rule: Rule }) {
  // The title as it always was, a line of text in the cell; the badges, when there are any, a block of their own under it.
  const title = <span className={rule.enabled ? "text-ink" : "text-ink-low"}>{rule.title}</span>;
  if (rule.enabled && !rule.customised && !rule.custom) return title;
  return (
    <>
      {title}
      <span className="mt-1 flex flex-wrap items-center gap-1.5">
        {!rule.enabled ? (
          <Badge tone="muted" size="sm" data-rule-off="">
            {OFF_ON_BOARD}
          </Badge>
        ) : null}
        {rule.custom ? (
          <>
            <Badge size="sm" data-rule-custom="">
              Custom
            </Badge>
            {rule.check_label ? <span className="text-xs text-ink-low">{rule.check_label}</span> : null}
          </>
        ) : rule.customised ? (
          <Badge size="sm" data-rule-customised="">
            Customised
          </Badge>
        ) : null}
      </span>
    </>
  );
}

/** The severity it reports at: its badge while it runs; muted, its shape in the quiet ink, while it is off. */
function SeverityCell({ rule }: { rule: Rule }) {
  if (rule.enabled) return <SeverityBadge severity={rule.severity} size="sm" />;
  return (
    <Badge tone="muted" size="sm" data-severity-off="">
      <SeverityMark severity={rule.severity} size={8} muted />
      {SEVERITY_LABEL[rule.severity]}
    </Badge>
  );
}

function MeasurableCell({ rule, stages }: { rule: Rule; stages: readonly ProcessStage[] }) {
  if (rule.measurable) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", inkFor(rule, "text-ink-mid"))}>
        <SeverityMark severity="resolved" size={10} muted={!rule.enabled} />
        Yes
      </span>
    );
  }
  const missing = missingEvidenceText(rule, stages);
  // Each kind of evidence kept on one line ("code review" never split), so a long list breaks between them.
  const list = rule.missing_evidence.map((key) => inSentence(stageLabel(key, stages)).replace(/ /g, " ")).join(", ");
  // What Jira lacks reads whole: a long list wraps under its first line, the mark centred on that line (JO-14: an
  // ellipsis cut "testing" short at 1440 px, with no title).
  return (
    <span className="flex items-start gap-1.5">
      <span className="flex h-[1lh] shrink-0 items-center">
        <SeverityMark severity="not-measurable" size={10} muted={!rule.enabled} />
      </span>
      <span className="min-w-0 text-pretty">
        <span className={inkFor(rule, "text-ink")}>No</span>
        <span className="sr-only">, not measurable{missing ? `: Jira holds no ${missing} evidence` : ""}</span>
        {list ? <span aria-hidden className="text-ink-low"> · {list}</span> : null}
      </span>
    </span>
  );
}

function OpenCell({ rule }: { rule: Rule }) {
  const locale = useFigureLocale();
  const open = openFindings(rule);
  if (open === undefined) {
    return (
      <span className="text-ink-low">
        {MISSING}
        <span className="sr-only">{rule.enabled ? "not measured" : OFF_ON_BOARD.toLowerCase()}</span>
      </span>
    );
  }
  if (open === 0) return <span className="text-ink-low">{formatCount(0, { locale })}</span>;
  const figure = formatCount(open, { locale });
  return (
    <Link
      href={findingsHref(rule.rule_id)}
      aria-label={`${figure} open findings for ${rule.rule_id}`}
      className="text-cite underline-offset-2 hover:underline"
    >
      {figure}
    </Link>
  );
}

const col = dataTableColumns<Rule>();

function catalogueColumns(stages: readonly ProcessStage[]) {
  return col.columns([
    col.accessor("rule_id", {
      header: "Rule",
      cell: (info) => <span className="mono font-medium text-ink">{info.getValue()}</span>,
      meta: { width: "6rem" },
    }),
    col.accessor("title", {
      header: "Title",
      cell: (info) => <TitleCell rule={info.row.original} />,
      // A rule's name is read whole, as its threshold is: a long one wraps, and a word longer than the column (the
      // table at its narrowest, scrolled sideways on a phone) is hyphenated where the language allows, never clipped.
      meta: { cellClassName: "whitespace-normal break-words hyphens-auto py-2 leading-snug" },
    }),
    col.accessor("kind", {
      header: "Kind",
      cell: (info) => <span className={inkFor(info.row.original, "text-ink-mid")}>{KIND_LABEL[info.getValue()]}</span>,
      meta: { width: "7rem" },
    }),
    col.accessor("severity", {
      header: "Severity",
      cell: (info) => <SeverityCell rule={info.row.original} />,
      // A sortable header keeps 28 px for its sort arrow: these widths hold the whole label.
      meta: { width: "7.25rem" },
    }),
    col.accessor((rule) => rule.threshold ?? undefined, {
      id: "threshold",
      header: "Threshold",
      cell: (info) => {
        const threshold = info.getValue();
        if (threshold === undefined) {
          return (
            <span className="text-ink-low">
              {MISSING}
              <span className="sr-only">no threshold</span>
            </span>
          );
        }
        return <span className={inkFor(info.row.original, "text-ink-mid")}>{threshold}</span>;
      },
      // A threshold is a judgement worth reading whole, so a long one wraps rather than truncates.
      meta: { width: "9rem", cellClassName: "whitespace-normal py-2 leading-snug" },
    }),
    col.accessor((rule) => (rule.measurable ? 1 : 0), {
      id: "measurable",
      header: "Measurable",
      cell: (info) => <MeasurableCell rule={info.row.original} stages={stages} />,
      // As the threshold: what is missing wraps rather than truncates.
      meta: { width: "12rem", cellClassName: "whitespace-normal py-2 leading-snug" },
    }),
    col.accessor((rule) => openFindings(rule), {
      id: "open",
      header: "Open",
      cell: (info) => <OpenCell rule={info.row.original} />,
      meta: { numeric: true, width: "5.5rem", label: "Open findings" },
    }),
    // No version column (SQA): every rule carries the catalogue's one version, which tells a reader nothing. The
    // rule's drawer and the CSV still say it.
  ]);
}

/* ------------------------------------------------------------ toolbar --- */

function CatalogueSummary({
  rows,
  sorting,
  onOrderChange,
}: {
  rows: readonly Rule[];
  sorting: SortingState;
  onOrderChange?: (order: string[]) => void;
}) {
  const locale = useFigureLocale();
  const rules = rows.filter((rule) => rule.kind === "rule").length;
  const warnings = rows.length - rules;
  const off = rows.filter((rule) => !rule.enabled).length;
  // The drawer steps through the rows in the order shown, so it hears the order from here.
  const order = rows.map((rule) => rule.rule_id).join(" ");
  useEffect(() => {
    onOrderChange?.(order ? order.split(" ") : []);
  }, [order, onOrderChange]);

  return (
    <>
      <span className="mono text-ink-mid">{formatCount(rules, { locale })}</span> {rules === 1 ? "rule" : "rules"} and{" "}
      <span className="mono text-ink-mid">{formatCount(warnings, { locale })}</span> early{" "}
      {warnings === 1 ? "warning" : "warnings"}
      {off > 0 ? (
        <>
          {" "}(<span className="mono text-ink-mid">{formatCount(off, { locale })}</span> off on this board)
        </>
      ) : null}
      , {sortSummary(sorting)}
    </>
  );
}

/* -------------------------------------------------------------- table --- */

const NO_RULES: Rule[] = [];

export interface RuleCatalogueProps {
  /** The catalogue from GET rules; undefined while it loads. */
  rules: Rule[] | undefined;
  stages: readonly ProcessStage[];
  openRuleId: string | null;
  onOpenRule: (ruleId: string) => void;
  /** The rule ids in the order shown, for the drawer's previous and next. */
  onOrderChange?: (order: string[]) => void;
}

/** Every rule and early warning, what it needs from Jira, and how many findings it holds open. */
export function RuleCatalogue({ rules, stages, openRuleId, onOpenRule, onOrderChange }: RuleCatalogueProps) {
  const [sorting, setSorting] = useCatalogueSort();
  const columns = useMemo(() => catalogueColumns(stages), [stages]);

  return (
    <DataTable
      caption="Rules"
      data={rules ?? NO_RULES}
      columns={columns}
      getRowId={(rule) => rule.rule_id}
      loading={!rules}
      loadingRows={8}
      sorting={sorting}
      onSortingChange={setSorting}
      selectedRowId={openRuleId}
      onRowOpen={(rule) => onOpenRule(rule.rule_id)}
      keyboardScope="page"
      minWidth="62rem"
      // Scrolled sideways on a phone anyway: the titles get room to read in a line or two, rather than the 80 px left
      // at 62rem, where they ran to five lines and split a word with no hyphen (JO-14).
      scrollWidth="68rem"
      empty={
        <EmptyState
          size="compact"
          title="No rules in the catalogue"
          description={"No rules yet."}
        />
      }
      toolbar={({ rows }) =>
        rules ? (
          <CatalogueSummary rows={rows} sorting={sorting} onOrderChange={onOrderChange} />
        ) : (
          <Skeleton className="h-3 w-56" />
        )
      }
      actions={({ rows }) => (
        <ExportCsvButton rows={rows} columns={RULE_CSV_COLUMNS} fileName="rule-catalogue" rowNoun="rule" size="sm" />
      )}
    />
  );
}
