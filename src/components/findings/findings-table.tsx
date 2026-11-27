"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, EyeOff, Link2 } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, type ReactNode } from "react";

import { useElementWidth } from "@/components/charts/use-element-width";
import { SeverityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { Pagination, pageCount } from "@/components/ui/pagination";
import { PersonName } from "@/components/ui/person-name";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ApiError } from "@/lib/api/client";
import type { Finding, FindingsPage } from "@/lib/api/schemas";
import { copyCurrentLink } from "@/lib/copy-link";
import { formatCount } from "@/lib/format";
import { isTypingTarget } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { BulkBar } from "./bulk-bar";
import { FindingClockProvider } from "./clock";
import { FINDING_COLUMNS, SELECTABLE_COLUMNS, sortToUrl, sortingFromUrl } from "./columns";
import { clearFilters } from "./filter-bar";
import { IgnoredChip } from "./ignored-chip";
import { FINDINGS_CSV, describeFilters, noOnesReason, resultSummary } from "./model";
import { RowCheckbox, rowKeys, useFindingSelection, type Selection } from "./selection";
import { hasActiveFilters, type FindingsFilters, type SetFindingsUrl } from "./url-state";

const EMPTY: Finding[] = [];
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const LIST_BELOW_PX = 640;
const SHOW_AGE_FROM_PX = 1000;

/** What a selection does, at the people level. */
export interface BulkActions {
  selection: Selection;
  onSelectMatching: () => void;
  onClear: () => void;
  onIgnore: () => void;
  onRestore: () => void;
}

export interface FindingsTableProps {
  findings: UseQueryResult<FindingsPage, ApiError>;
  filters: FindingsFilters;
  setFilters: SetFindingsUrl;
  /** The finding open in the drawer, marked as the current row. */
  openId: string | null;
  onOpen: (finding: Finding) => void;
  /** At the people level: the selection's bar and what it does. Anyone else sees no selection. */
  bulk?: BulkActions;
  /** At the people level: "Ignore findings on finished tickets…". */
  onIgnoreFinished?: () => void;
}

/** "809 open findings · 523 breaches", said politely to screen readers when it changes. */
function ResultLine({
  data,
  filters,
  updating,
  failed,
}: {
  data: FindingsPage | undefined;
  filters: FindingsFilters;
  updating: boolean;
  failed: boolean;
}) {
  const locale = useFigureLocale();
  if (!data) {
    return failed ? <span className="text-sm text-ink-low">No figures to show</span> : <Skeleton className="h-3 w-60" />;
  }
  const summary = resultSummary(data, filters);
  const figure = (value: number) => (
    <span className="mono font-medium text-ink" data-figure>
      {formatCount(value, { locale })}
    </span>
  );
  return (
    // Where the focus waits once an action takes its own control away (a selection's bar after an ignore).
    <p tabIndex={-1} data-findings-result="" className="flex flex-wrap items-baseline gap-x-2 rounded-xs text-sm text-ink-mid outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      <span role="status" aria-atomic="true">
        {figure(summary.total)} {summary.noun}
        {summary.breaches !== null ? (
          <>
            <span aria-hidden className="px-1.5 text-ink-low">
              ·
            </span>
            <span className="sr-only">, </span>
            {figure(summary.breaches)} {summary.breaches === 1 ? "breach" : "breaches"}
          </>
        ) : null}
      </span>
      {updating ? (
        <span aria-hidden className="text-xs text-ink-low">
          Updating…
        </span>
      ) : null}
    </p>
  );
}

function FindingList({
  rows,
  loading,
  empty,
  openId,
  onOpen,
}: {
  rows: readonly Finding[];
  loading: boolean;
  empty: ReactNode;
  openId: string | null;
  onOpen: (finding: Finding) => void;
}) {
  const { enabled } = useFindingSelection();
  if (loading) {
    return (
      <SkeletonGroup label="Loading the findings" className="flex flex-col divide-y divide-rule-weak rounded-lg border border-rule-weak">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className="flex h-[5.25rem] flex-col justify-center gap-2 px-3.5">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </span>
        ))}
      </SkeletonGroup>
    );
  }
  if (rows.length === 0) return <div className="rounded-lg border border-rule-weak">{empty}</div>;
  return (
    <ul aria-label="Findings" className="flex flex-col divide-y divide-rule-weak rounded-lg border border-rule-weak" data-findings-list>
      {rows.map((finding) => (
        <li key={finding.finding_id} className="flex items-stretch">
          {enabled ? (
            // The box beside the row, never inside its button: one control is not nested in another.
            <span className="flex w-10 shrink-0 justify-center pt-3">
              <RowCheckbox finding={finding} tabbable />
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onOpen(finding)}
            aria-current={finding.finding_id === openId || undefined}
            // Hover and the open one as the table's rows show them: the paper's step, and the accent's tint and bar.
            className={cn(
              "pressable flex min-w-0 flex-1 items-center gap-3 py-3 pr-3.5 text-left hover:bg-[var(--paper-100)] aria-[current=true]:bg-cite-tint aria-[current=true]:shadow-[inset_2px_0_0_var(--cite)]",
              enabled ? "pl-0" : "pl-3.5",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-sm font-medium text-ink" data-rule-title>
                  {finding.rule_title}
                </span>
                {finding.state === "ignored" ? (
                  <IgnoredChip ignore={finding.ignore} />
                ) : (
                  <SeverityBadge severity={finding.severity} size="sm" />
                )}
              </span>
              <span className="flex min-w-0 items-baseline gap-2 text-xs">
                <span className="mono shrink-0 text-ink">{finding.issue_key ?? finding.sprint?.name ?? "Sprint"}</span>
                {finding.issue_summary ? <span className="min-w-0 truncate text-ink-mid">{finding.issue_summary}</span> : null}
              </span>
              <span className="text-xs text-ink-low">{finding.message}</span>
              {/* Who has it now; a sprint's finding, and one whose ticket has left the data, belong to no one. */}
              {noOnesReason(finding) === null ? (
                <span className="flex min-w-0 text-xs" data-assignee>
                  <PersonName person={finding.assignee} className="text-ink-mid" />
                </span>
              ) : null}
            </span>
            <ChevronRight aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FindingsTable({ findings, filters, setFilters, openId, onOpen, bulk, onIgnoreFinished }: FindingsTableProps) {
  const locale = useFigureLocale();
  const top = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const selectionState = useFindingSelection();
  // The width the list has: zero until laid out (and on the server), when the table is drawn.
  const width = useElementWidth(top);
  const asList = width > 0 && width < LIST_BELOW_PX;
  // Below this width the rule, the assignee and the dates keep their room: how long a finding has been open is in its drawer.
  const visibility = useMemo(() => ({ age: width === 0 || width >= SHOW_AGE_FROM_PX }), [width]);
  const { data, error, isPending, isPlaceholderData, isFetching, refetch } = findings;
  const rows = data?.items ?? EMPTY;
  const active = hasActiveFilters(filters);

  let empty: ReactNode = null;
  if (error && !data) {
    empty = (
      <ErrorState
        size="compact"
        title="Couldn't load the findings"
        description="Your filters are kept. Try again."
        detail={`${error.status > 0 ? `HTTP ${error.status} · ` : ""}${error.code}`}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  } else if (data && data.total > 0) {
    const last = pageCount(data.total, data.page_size);
    empty = (
      <EmptyState
        size="compact"
        title={`Nothing on page ${formatCount(data.page, { locale })}`}
        description={`${formatCount(data.total, { locale })} findings, ${formatCount(last, { locale })} ${last === 1 ? "page" : "pages"}.`}
        action={
          <Button size="sm" onClick={() => void setFilters({ page: last === 1 ? null : last })}>
            Go to page {formatCount(last, { locale })}
          </Button>
        }
      />
    );
  } else if (data && !active) {
    empty = (
      <EmptyState
        size="compact"
        icon={CircleCheck}
        title="No open findings"
        description={"Nothing is open at the last sync."}
      />
    );
  } else if (data && filters.state === "ignored" && !hasActiveFilters({ ...filters, state: "open" })) {
    empty = (
      <EmptyState
        size="compact"
        icon={EyeOff}
        title="Nothing is ignored"
        description="Findings an admin ignores are listed here, with who ignored them and why."
      />
    );
  } else if (data) {
    empty = (
      <EmptyState
        size="compact"
        title="No findings match these filters"
        description={`${capitalised(describeFilters(filters, data.meta.projects, data.facets))}.`}
        action={
          <Button size="sm" onClick={() => clearFilters(setFilters)}>
            Clear filters
          </Button>
        }
      />
    );
  }

  const onPageChange = (page: number) => {
    void setFilters({ page: page === 1 ? null : page });
    const frame = top.current;
    if (!frame) return;
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 56;
    if (frame.getBoundingClientRect().top < bar) frame.scrollIntoView({ block: "start" });
  };

  const picked = bulk ? bulk.selection.kind === "matching" || bulk.selection.ids.size > 0 : false;
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    rowKeys(event, selectionState, frame.current);
    // Escape lets go of the selection, but never one a menu, a dialog or a field takes first.
    if (event.key === "Escape" && !event.defaultPrevented && picked && !isTypingTarget(event.target)) {
      event.preventDefault();
      bulk?.onClear();
    }
  });
  const selecting = bulk !== undefined;
  useEffect(() => {
    if (!selecting) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting]);

  return (
    <div ref={top} className="flex scroll-mt-[calc(var(--topbar-h)+1rem)] flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ResultLine data={data} filters={filters} updating={isPlaceholderData} failed={Boolean(error)} />
        <div data-print="hide" className="flex min-w-0 flex-wrap items-center gap-1.5">
          {onIgnoreFinished && filters.state !== "ignored" ? (
            <Button
              size="sm"
              variant="ghost"
              icon={EyeOff}
              onClick={(event) => {
                // Safari does not focus a button on click; the dialog hands the focus back to what held it.
                event.currentTarget.focus();
                onIgnoreFinished();
              }}
              data-ignore-finished=""
            >
              Ignore findings on finished tickets…
            </Button>
          ) : null}
          <ExportCsvButton rows={rows} columns={FINDINGS_CSV} fileName="findings" rowNoun="finding" size="sm" />
          <Button size="sm" icon={Link2} onClick={() => void copyCurrentLink()}>
            Copy link
          </Button>
        </div>
      </div>

      <div
        ref={frame}
        aria-busy={isPlaceholderData || undefined}
        className={cn("transition-opacity duration-150 motion-reduce:transition-none", isPlaceholderData && "opacity-60")}
      >
        {bulk ? (
          <p className="sr-only">X or Space selects the row in focus, Shift+F10 opens its actions, and Escape lets go of the selection.</p>
        ) : null}
        {/* First seen and Open for on one clock: now while the board's data is fresh, else as at its last sync. */}
        <FindingClockProvider lastSyncedAt={data?.meta.last_synced_at}>
          {asList ? (
            <FindingList rows={rows} loading={isPending} empty={empty} openId={openId} onOpen={onOpen} />
          ) : (
            <DataTable
              caption="Findings"
              data={rows}
              columns={bulk ? SELECTABLE_COLUMNS : FINDING_COLUMNS}
              getRowId={(finding) => finding.finding_id}
              onRowOpen={onOpen}
              selectedRowId={openId}
              sorting={sortingFromUrl(filters)}
              onSortingChange={(sorting) => void setFilters({ ...sortToUrl(sorting), page: null })}
              loading={isPending}
              loadingRows={12}
              empty={empty}
              keyboardScope="page"
              columnVisibility={visibility}
              minWidth={bulk ? "57rem" : "56rem"}
            />
          )}
        </FindingClockProvider>
      </div>

      {data && data.total > 0 ? (
        <Pagination
          page={filters.page}
          pageSize={data.page_size}
          total={data.total}
          onPageChange={onPageChange}
          noun={data.total === 1 ? "finding" : "findings"}
        />
      ) : null}

      {bulk ? (
        <BulkBar
          selection={bulk.selection}
          rows={rows}
          total={data?.total ?? 0}
          matchState={filters.state}
          onSelectMatching={bulk.onSelectMatching}
          onClear={bulk.onClear}
          onIgnore={bulk.onIgnore}
          onRestore={bulk.onRestore}
        />
      ) : null}
    </div>
  );
}
