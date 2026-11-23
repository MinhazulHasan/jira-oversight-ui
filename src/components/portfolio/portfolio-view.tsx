"use client";

import { ChevronRight, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useMemo, type MouseEvent, type ReactNode } from "react";

import { Sparkline } from "@/components/charts/sparkline";
import { openOnBoard, pickBoard } from "@/components/shell/board-switcher";
import { Badge, SeverityMark, StateDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DataTable, dataTableColumns, type SortingState } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/timestamp";

import { useFigureLocale } from "@/components/ui/use-figures";
import { usePortfolio, type ApiError } from "@/lib/api/hooks";
import { attentionKey, type AttentionItem, type Portfolio, type PortfolioBoard } from "@/lib/api/schemas";
import { formatLocalDayMonth } from "@/components/charts/dates";
import { formatAge } from "@/components/findings/model";
import { formatCount, formatDelta } from "@/lib/format";
import { STALE_AFTER_MS } from "@/lib/sync";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

import {
  attentionAge,
  DEFAULT_SORT,
  firstOrder,
  firstTrackedWeek,
  hasFigures,
  NO_RISK_FLAGGED,
  onReadersClock,
  PORTFOLIO_CSV_COLUMNS,
  PORTFOLIO_SORTS,
  portfolioTotals,
  SORT_CHOICES,
  sortBoards,
  sortSentence,
  sortValues,
  trendLabels,
  weekChange,
  type PortfolioSort,
  type SortOrder,
} from "./model";
import { NotSyncedLine } from "./not-synced-line";

const HOUR = 60 * 60 * 1000;

/** Why a board that has never synced does not open. */
const NOT_SYNCED_YET = "Not synced yet: no Overview to open";

/*
 * The Portfolio (JO-12): every board the reader may open, one row each, with
 * the Overview's own figures for it, so the two never disagree; and under it
 * the oldest open breaches across them. A row opens its board's Overview,
 * switching the board picker as the top bar does; a breach opens its ticket
 * on its board. The sort lives in the address, so Copy link shares the view.
 * Below 48rem of width the table becomes a card per board, with the sort
 * above them.
 */

const sortParsers = {
  sort: parseAsStringLiteral(PORTFOLIO_SORTS),
  order: parseAsStringLiteral(["asc", "desc"] as const),
};

function usePortfolioSort(): [{ sort: PortfolioSort; order: SortOrder }, (sort: PortfolioSort, order: SortOrder) => void] {
  const [state, setState] = useQueryStates(sortParsers, { history: "replace", scroll: false });
  const current = state.sort ? { sort: state.sort, order: state.order ?? firstOrder(state.sort) } : DEFAULT_SORT;
  const set = (sort: PortfolioSort, order: SortOrder) => {
    const fallback = sort === DEFAULT_SORT.sort && order === DEFAULT_SORT.order;
    void setState(fallback ? { sort: null, order: null } : { sort, order });
  };
  return [current, set];
}

function errorDetail(error: ApiError): string {
  return error.status > 0 ? `HTTP ${error.status} · ${error.code}` : error.code;
}

/* -------------------------------------------------------------- cells --- */

/**
 * The board: its name (or, on a card, the link that is its name), and under it its key and when it last synced,
 * plainly when that is more than a day ago (or never), in the warning ink with its mark. Open and in-progress work
 * go in the export; the row keeps to what an executive scans.
 */
function BoardCell({ board, name }: { board: PortfolioBoard; name?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
      {name ?? (
        <span className="truncate font-medium text-ink" title={board.project.name}>
          {board.project.name}
        </span>
      )}
      <span className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-ink-low">
        <span className="mono">{board.project.key}</span>
        <span aria-hidden>·</span>
        <SyncState board={board} />
      </span>
    </span>
  );
}

/**
 * Whether the board has an Overview to open: not before its first sync, when the service has no figures for it (its
 * Overview answers without a sync time), as the board picker offers it only once synced.
 */
const opensOverview = hasFigures;

/** A figure a board does not have yet (it has never synced): a dash, read out as what it means. */
function NoFigure({ label = "No figures yet" }: { label?: string }) {
  // In the sans face even in a figure column, so every dash in a row is the same width.
  return (
    <span className="font-sans text-ink-low">
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** "27 Oct", the day the rules first saw the board, in the reader's locale. */
function TrackedFrom({ board }: { board: PortfolioBoard }) {
  const locale = useFigureLocale();
  return <>{board.tracking_since ? formatLocalDayMonth(Date.parse(board.tracking_since), locale) : null}</>;
}

/**
 * When the board last synced: "synced 4 min ago"; "Stale, synced 2 d ago" once it is stale, by the top bar's own rule
 * on the reader's clock (the boards are read on it before they reach here, JO-14); "Never synced".
 */
function SyncState({ board }: { board: PortfolioBoard }) {
  if (board.last_sync_at === null) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-warn-ink">
        <SeverityMark severity="warning" size={9} />
        Never synced
      </span>
    );
  }
  const when = <Timestamp value={board.last_sync_at} mode="relative" />;
  if (!board.stale) return <span className="truncate">synced {when}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-warn-ink">
      <SeverityMark severity="warning" size={9} />
      <span className="truncate">
        <span className="font-medium">Stale</span>, synced {when}
      </span>
    </span>
  );
}

function CountCell({ board, value, severity }: { board: PortfolioBoard; value: number; severity: "breach" | "warning" }) {
  const locale = useFigureLocale();
  if (!hasFigures(board)) return <NoFigure />;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {value > 0 ? <SeverityMark severity={severity} size={9} /> : null}
      <span className={value > 0 ? "text-ink" : "text-ink-low"}>{formatCount(value, { locale })}</span>
    </span>
  );
}

/**
 * This week: the net change as the figure, and what it is made of under it. In the board's first tracked week
 * every finding is new only because tracking began, so it says that instead, as the Overview's tiles do.
 */
function WeekCell({ board, now }: { board: PortfolioBoard; now: number }) {
  const locale = useFigureLocale();
  if (!hasFigures(board)) return <NoFigure />;
  if (firstTrackedWeek(board, now)) {
    return (
      <span className="flex flex-col items-end gap-0.5 py-0.5 font-sans" title="No earlier week to compare">
        <span className="text-ink-mid">Tracking since</span>
        <span className="text-xs whitespace-nowrap text-ink-low">
          <TrackedFrom board={board} />
        </span>
      </span>
    );
  }
  const change = weekChange(board);
  return (
    <span className="flex flex-col items-end gap-0.5 py-0.5">
      <span className={change === 0 ? "text-ink-low" : "text-ink"}>{formatDelta(change, { locale })}</span>
      <span className="font-sans text-xs whitespace-nowrap text-ink-low">
        <span className="mono">{formatCount(board.new_findings_7d, { locale })}</span> new,{" "}
        <span className="mono">{formatCount(board.resolved_findings_7d, { locale })}</span> resolved
      </span>
    </span>
  );
}

/** The 8-week line; none before the first sync, or in the first tracked week, when there are no earlier weeks. */
function TrendCell({ board, now, interactive = true, className }: { board: PortfolioBoard; now: number; interactive?: boolean; className?: string }) {
  const labels = useMemo(() => trendLabels(board.open_findings_trend.length), [board.open_findings_trend.length]);
  if (!hasFigures(board)) return <NoFigure />;
  if (firstTrackedWeek(board, now)) return <NoFigure label="No earlier week to show" />;
  return (
    <Sparkline
      values={board.open_findings_trend}
      labels={labels}
      label={`Open findings on ${board.project.name}`}
      period="last 8 weeks"
      height={26}
      interactive={interactive}
      className={className}
    />
  );
}

/**
 * The active sprint: at risk, or no risk flagged, and its work with no estimate. "No active sprint" alone when there
 * is none; what cannot be measured says so, never a 0.
 */
function SprintCell({ board }: { board: PortfolioBoard }) {
  const locale = useFigureLocale();
  const unestimated = board.unestimated_in_active_sprint;
  if (!hasFigures(board)) return <NoFigure />;
  if (!board.active_sprint) return <span className="text-ink-low">No active sprint</span>;
  return (
    <span className="flex flex-col gap-0.5 py-0.5">
      {board.sprint_at_risk === null ? (
        <span className="text-ink-low">Risk not measured</span>
      ) : board.sprint_at_risk ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-warn-ink">
          <SeverityMark severity="warning" size={10} />
          At risk
        </span>
      ) : (
        <StateDot tone="hollow" size="sm" label={<span className="text-ink-mid">{NO_RISK_FLAGGED}</span>} />
      )}
      <span className="text-xs text-ink-low">
        {unestimated === null ? (
          "Estimates not measured"
        ) : (
          <>
            <span className="mono">{formatCount(unestimated, { locale })}</span> unestimated
          </>
        )}
      </span>
    </span>
  );
}

function TopRuleCell({ board }: { board: PortfolioBoard }) {
  const locale = useFigureLocale();
  const rule = board.top_rule;
  if (!hasFigures(board)) return <NoFigure />;
  if (!rule) return <span className="text-ink-low">Nothing open</span>;
  return (
    // The rule's title has up to two lines to itself, so a typical title reads whole; its id and open findings go
    // under it.
    <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
      <span className="line-clamp-2 text-ink [overflow-wrap:anywhere] whitespace-normal" title={rule.title}>
        {rule.title}
      </span>
      <span className="truncate text-xs text-ink-low">
        <span className="mono">{rule.id}</span>
        <span aria-hidden> · </span>
        <span className="mono">{formatCount(rule.open, { locale })}</span> open
      </span>
    </span>
  );
}

/* -------------------------------------------------------------- table --- */

const col = dataTableColumns<PortfolioBoard>();

/** The table's columns at `now` (the response's generated_at), which the first tracked week is read against. */
function portfolioColumns(now: number) {
  const value = sortValues(now);
  return col.columns([
    col.accessor(value.board, {
      id: "board",
      header: "Board",
      // Names A to Z on the first press (model.ts firstOrder).
      sortDescFirst: false,
      cell: (info) => <BoardCell board={info.row.original} />,
      meta: { width: "13.5rem" },
    }),
    col.accessor(value.breaches, {
      id: "breaches",
      header: "Breaches",
      cell: (info) => <CountCell board={info.row.original} value={info.row.original.open_breaches} severity="breach" />,
      sortUndefined: "last",
      meta: { numeric: true, width: "7.75rem", label: "Open breaches" },
    }),
    col.accessor(value.warnings, {
      id: "warnings",
      header: "Warnings",
      cell: (info) => <CountCell board={info.row.original} value={info.row.original.open_warnings} severity="warning" />,
      sortUndefined: "last",
      meta: { numeric: true, width: "8rem", label: "Open warnings" },
    }),
    col.accessor(value.week, {
      id: "week",
      header: "This week",
      cell: (info) => <WeekCell board={info.row.original} now={now} />,
      sortUndefined: "last",
      meta: { numeric: true, width: "8.5rem", label: "Change this week" },
    }),
    col.display({
      id: "trend",
      header: "8 weeks",
      cell: (info) => <TrendCell board={info.row.original} now={now} className="w-full" />,
      meta: { width: "6rem", label: "Open findings, last 8 weeks" },
    }),
    col.accessor(value.sprint, {
      id: "sprint",
      header: "Sprint",
      cell: (info) => <SprintCell board={info.row.original} />,
      sortUndefined: "last",
      meta: { width: "8rem", label: "Active sprint" },
    }),
    col.accessor(value.top_rule, {
      id: "top_rule",
      header: "Top rule",
      cell: (info) => <TopRuleCell board={info.row.original} />,
      sortUndefined: "last",
      meta: { label: "Top rule by open findings" },
    }),
  ]);
}

function BoardsTable({ boards, sort, order, onSort, now }: BoardsProps) {
  const sorting = useMemo<SortingState>(() => [{ id: sort, desc: order === "desc" }], [sort, order]);
  const columns = useMemo(() => portfolioColumns(now), [now]);
  return (
    <DataTable
      caption="Boards"
      data={boards ?? NO_BOARDS}
      columns={columns}
      getRowId={(board) => board.project.key}
      loading={!boards}
      loadingRows={3}
      sorting={sorting}
      onSortingChange={(next) => {
        const first = next[0];
        const id = PORTFOLIO_SORTS.find((key) => key === first?.id);
        if (first && id) onSort(id, first.desc ? "desc" : "asc");
        else onSort(DEFAULT_SORT.sort, DEFAULT_SORT.order);
      }}
      onRowOpen={(board) => openOnBoard(board.project.key, "/")}
      // A board that has never synced has no Overview yet: its row does not press, and says why.
      canOpenRow={opensOverview}
      closedRowTitle={() => NOT_SYNCED_YET}
      keyboardScope="page"
      minWidth="66rem"
      empty={<NoBoards />}
      // The order alone: the summary above already counts the boards (SQA: two lines said much the same).
      toolbar={() => (boards ? sortSentence(sort, order) : <Skeleton className="h-3 w-48" />)}
      actions={({ rows }) => (
        <ExportCsvButton rows={rows} columns={PORTFOLIO_CSV_COLUMNS} fileName="portfolio" rowNoun="board" size="sm" />
      )}
    />
  );
}

/* -------------------------------------------------------------- cards --- */

interface BoardsProps {
  /** Sorted; undefined while they load. */
  boards: PortfolioBoard[] | undefined;
  sort: PortfolioSort;
  order: SortOrder;
  onSort: (sort: PortfolioSort, order: SortOrder) => void;
  /** When the figures were worked out (meta.generated_at), which a board's first tracked week is read against. */
  now: number;
}

const NO_BOARDS: PortfolioBoard[] = [];

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="micro text-ink-low">{label}</dt>
      <dd className="mono text-base text-ink">{children}</dd>
    </div>
  );
}

/**
 * A board on a phone: its name and sync, the figures that matter, the trend, the sprint and the top rule. The
 * board's name is the card's link, its press area stretched over the whole card, so the link is named by the
 * words it shows and the card still opens from anywhere on it.
 */
function BoardCard({ board, now }: { board: PortfolioBoard; now: number }) {
  const locale = useFigureLocale();
  const openable = opensOverview(board);
  const firstWeek = firstTrackedWeek(board, now);
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      pickBoard(board.project.key);
      return;
    }
    event.preventDefault();
    openOnBoard(board.project.key, "/");
  };
  // A board that has never synced has no Overview yet: its name is plain text, and the card does not press.
  const name = openable ? (
    <Link
      href="/"
      prefetch={false}
      onClick={open}
      title={board.project.name}
      className="truncate font-medium text-ink outline-none after:absolute after:inset-0 after:z-[1] after:rounded-lg after:content-['']"
    >
      {board.project.name}
    </Link>
  ) : undefined;
  return (
    <li
      className={cn(
        "group relative flex flex-col gap-3 rounded-lg border border-rule-weak bg-sheet px-4 py-3.5 has-[a:focus-visible]:outline-[length:var(--focus-width)] has-[a:focus-visible]:outline-offset-[var(--focus-offset)] has-[a:focus-visible]:outline-[color:var(--focus)] has-[a:focus-visible]:outline-solid",
        openable && "hover:border-rule hover:bg-hover",
      )}
    >
      <span className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <BoardCell board={board} name={name} />
        </span>
        {openable ? (
          <ChevronRight aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-low group-hover:text-ink-mid" />
        ) : null}
      </span>
      <dl className="grid grid-cols-3 gap-3 border-t border-rule-weak pt-3">
        <Figure label="Breaches">{openable ? formatCount(board.open_breaches, { locale }) : <NoFigure />}</Figure>
        <Figure label="Warnings">{openable ? formatCount(board.open_warnings, { locale }) : <NoFigure />}</Figure>
        <Figure label="This week">
          {openable && !firstWeek ? formatDelta(weekChange(board), { locale }) : <NoFigure label={openable ? "No earlier week to compare" : undefined} />}
        </Figure>
      </dl>
      {!openable ? (
        <p className="text-sm text-ink-low">No figures yet: the board has not synced.</p>
      ) : firstWeek ? (
        <p className="text-sm text-ink-low">
          Tracking since <TrackedFrom board={board} />: no earlier week to compare.
        </p>
      ) : (
        <TrendCell board={board} now={now} interactive={false} className="w-full" />
      )}
      <span className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-x-4 gap-y-2 border-t border-rule-weak pt-3 text-sm">
        <span className="micro pt-0.5 text-ink-low">Sprint</span>
        <SprintCell board={board} />
        <span className="micro pt-0.5 text-ink-low">Top rule</span>
        <TopRuleCell board={board} />
      </span>
    </li>
  );
}

function BoardCards({ boards, sort, onSort, now }: BoardsProps) {
  return (
    <div className="flex flex-col gap-3">
      <Select<PortfolioSort>
        label="Sort by"
        labelPlacement="inline"
        options={SORT_CHOICES}
        value={sort}
        onValueChange={(next) => onSort(next, firstOrder(next))}
        size="sm"
        triggerClassName="w-full"
      />
      {boards === undefined ? (
        <SkeletonGroup label="Loading the boards" className="flex flex-col gap-3">
          {[0, 1].map((index) => (
            <span key={index} className="flex h-[19.5rem] flex-col gap-3 rounded-lg border border-rule-weak px-4 py-3.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="mt-3 h-10 w-full" />
              <Skeleton className="h-7 w-full" />
            </span>
          ))}
        </SkeletonGroup>
      ) : boards.length === 0 ? (
        <NoBoards />
      ) : (
        <ul aria-label="Boards" className="flex flex-col gap-3">
          {boards.map((board) => (
            <BoardCard key={board.project.key} board={board} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoBoards() {
  return (
    <EmptyState
      size="compact"
      title="No boards yet"
    />
  );
}

/* ---------------------------------------------------------- attention --- */

/** "140 d" as Findings' "Open for" reads it: the figure in Plex Mono, its unit set back. */
function AgeText({ ms }: { ms: number }) {
  const locale = useFigureLocale();
  const [figure, unit] = formatAge(ms, locale).split("\u00a0");
  return (
    <>
      <span className="mono">{figure}</span>
      {unit ? <span className="text-ink-low">{`\u00a0${unit}`}</span> : null}
    </>
  );
}

/**
 * "2 findings": a ticket holding more than one open finding of the row's rule (R-FLOW-02 opens one for each
 * transition that skipped a stage), which the list shows as one row, dated from the oldest. A plain fact, so the
 * neutral badge, 16 px tall to sit inside the line without making the row taller than its neighbours.
 */
function FindingsCount({ count, issueKey }: { count: number; issueKey: string }) {
  const locale = useFigureLocale();
  return (
    <Badge
      size="sm"
      className="h-4 px-1.5"
      title={`${formatCount(count, { locale })} open findings of this rule on ${issueKey}.`}
      data-attention-findings={count}
    >
      <span>
        <span className="mono">{formatCount(count, { locale })}</span> findings
      </span>
    </Badge>
  );
}

/**
 * One of the oldest open breaches, one row for each ticket and rule: its ticket, on its board, opened with a click (the
 * board picked first), with how many open findings of the rule it holds when more than one. Its age is read on the
 * clock Findings reads "Open for" on (attentionAge): as at the last sync once the board's sync is stale.
 */
function AttentionRow({ item, board, syncedAt, readerNow }: { item: AttentionItem; board: string; syncedAt: string | null; readerNow: number | null }) {
  const age = attentionAge(item, syncedAt, readerNow);
  const href = `/issues/${encodeURIComponent(item.issue_key)}`;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      // A new tab or window: it opens on this ticket's board; this page stays as it is.
      pickBoard(item.project);
      return;
    }
    event.preventDefault();
    openOnBoard(item.project, href);
  };
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        onClick={open}
        className="pressable group grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 rounded-md px-3 py-2.5 hover:bg-hover @min-[44rem]:grid-cols-[8.5rem_minmax(0,1fr)_11rem_6.5rem_4.5rem] @min-[44rem]:py-2"
      >
        <span className="inline-flex items-center gap-2">
          <SeverityMark severity="breach" size={9} />
          <span className="mono text-sm text-cite underline-offset-2 group-hover:underline">{item.issue_key}</span>
        </span>
        {/* The title gives way, never the count: it is cut short first, and the row keeps its height either way. */}
        <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 text-sm text-ink @min-[44rem]:col-span-1 @min-[44rem]:row-start-auto">
          <span className="min-w-0 truncate" title={item.title}>
            {item.title}
          </span>
          {item.findings > 1 ? <FindingsCount count={item.findings} issueKey={item.issue_key} /> : null}
        </span>
        <span className="col-span-2 row-start-3 min-w-0 truncate text-xs text-ink-low @min-[44rem]:col-span-1 @min-[44rem]:row-start-auto" title={board}>
          {board}
          <span className="@min-[44rem]:hidden">
            {" · first seen "}
            <Timestamp value={item.opened_at} />
          </span>
        </span>
        <span className="hidden text-xs text-ink-low @min-[44rem]:inline">
          <Timestamp value={item.opened_at} />
        </span>
        <span
          className="col-start-3 row-start-1 text-right text-sm whitespace-nowrap text-ink @min-[44rem]:col-start-auto @min-[44rem]:row-start-auto"
          data-attention-age
        >
          <AgeText ms={age.ms} />
          {age.atLastSync ? <span className="block text-xs text-ink-low">at last sync</span> : null}
        </span>
      </Link>
    </li>
  );
}

/**
 * What an empty "Needs attention" says, true to the boards above it: none synced yet; no open breach anywhere; or
 * open breaches, but all on sprints, which have no ticket to open.
 */
function NoAttention({ data, now }: { data: Portfolio | undefined; now: number }) {
  const locale = useFigureLocale();
  const totals = portfolioTotals(data?.boards ?? [], now);
  if (!data || data.boards.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No boards yet"
      />
    );
  }
  if (totals.boards === 0) {
    return (
      <EmptyState
        size="compact"
        title="No board has synced yet"
      />
    );
  }
  if (totals.breaches === 0) {
    return (
      <EmptyState
        size="compact"
        icon={ShieldCheck}
        title="No open breaches on any board"
      />
    );
  }
  return (
    <EmptyState
      size="compact"
      title="No open breach is on a ticket"
      description={`${formatCount(totals.breaches, { locale })} open ${totals.breaches === 1 ? "breach is" : "breaches are"} on sprints. See each board's Overview.`}
    />
  );
}

function Attention({ data, now, readerNow }: { data: Portfolio | undefined; now: number; readerNow: number | null }) {
  const locale = useFigureLocale();
  const names = useMemo(() => new Map(data?.boards.map((board) => [board.project.key, board.project.name])), [data]);
  const synced = useMemo(() => new Map(data?.boards.map((board) => [board.project.key, board.last_sync_at])), [data]);
  const items = data?.attention;
  return (
    <Section
      id="attention"
      title="Needs attention"
      count={items ? formatCount(items.length, { locale }) : undefined}
      description="The oldest open breaches across the boards."
    >
      <div className="@container">
        {items === undefined ? (
          <SkeletonGroup label="Loading the oldest open breaches" className="flex flex-col">
            {[0, 1, 2, 3, 4].map((index) => (
              <span key={index} className="flex h-10 items-center gap-4 px-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-12" />
              </span>
            ))}
          </SkeletonGroup>
        ) : items.length === 0 ? (
          <NoAttention data={data} now={now} />
        ) : (
          <>
            <div
              aria-hidden
              className="hidden grid-cols-[8.5rem_minmax(0,1fr)_11rem_6.5rem_4.5rem] gap-x-3 border-b border-rule-weak px-3 pb-1.5 @min-[44rem]:grid"
            >
              {["Ticket", "Rule", "Board", "First seen", "Seen for"].map((heading, index) => (
                <span key={heading} className={cn("micro text-ink-low", index === 4 && "text-right")}>
                  {heading}
                </span>
              ))}
            </div>
            <ol aria-label="The oldest open breaches" className="flex flex-col divide-y divide-rule-weak">
              {items.map((item) => (
                <AttentionRow
                  key={attentionKey(item)}
                  item={item}
                  board={names.get(item.project) ?? item.project}
                  syncedAt={synced.get(item.project) ?? null}
                  readerNow={readerNow}
                />
              ))}
            </ol>
          </>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------- summary --- */

/**
 * One sentence across every board: what is open, and what changed this week. A board with no figures yet is said
 * apart, never added as zeros; a board in its first tracked week is left out of the week's new and resolved, whose
 * every finding is new only because tracking began.
 */
function Summary({ data, now }: { data: Portfolio | undefined; now: number }) {
  const locale = useFigureLocale();
  if (!data) {
    return (
      <p aria-hidden className="flex h-6 items-center">
        <Skeleton className="h-3.5 w-[min(36rem,90%)]" />
      </p>
    );
  }
  const totals = portfolioTotals(data.boards, now);
  if (totals.boards === 0 && totals.neverSynced === 0) return null;
  const n = (value: number) => <span className="mono text-ink">{formatCount(value, { locale })}</span>;
  const notYet =
    totals.neverSynced > 0 ? (
      <span className="text-warn-ink">
        {n(totals.neverSynced)} {totals.neverSynced === 1 ? "board has" : "boards have"} not synced yet.
      </span>
    ) : null;
  if (totals.boards === 0) {
    return (
      <p className="max-w-[90ch] text-base leading-relaxed text-ink-mid" data-portfolio-summary>
        No figures yet. {notYet}
      </p>
    );
  }
  const first = totals.firstWeek;
  return (
    <p className="max-w-[90ch] text-base leading-relaxed text-ink-mid" data-portfolio-summary>
      Across {n(totals.boards)} {totals.boards === 1 ? "board" : "boards"}: {n(totals.breaches)} open{" "}
      {totals.breaches === 1 ? "breach" : "breaches"} and {n(totals.warnings)} open {totals.warnings === 1 ? "warning" : "warnings"};{" "}
      {n(totals.newFindings)} new and {n(totals.resolved)} resolved in the last 7 days
      {first.length === 0
        ? "."
        : first.length === 1
          ? `, leaving out ${first[0]}, first tracked this week.`
          : `, leaving out ${formatCount(first.length, { locale })} boards first tracked this week.`}
      {totals.stale > 0 ? (
        <>
          {" "}
          <span className="text-warn-ink">
            {n(totals.stale)} {totals.stale === 1 ? "board has" : "boards have"} not synced in the last {formatCount(STALE_AFTER_MS / HOUR, { locale })}{" "}
            hours.
          </span>
        </>
      ) : null}
      {notYet ? <> {notYet}</> : null}
    </p>
  );
}

/* ---------------------------------------------------------------- page --- */

export function PortfolioView() {
  const { data: served, error, refetch, isFetching } = usePortfolio();
  const [{ sort, order }, setSort] = usePortfolioSort();
  // The reader's clock, the top bar's: each board's staleness is read on it, by the top bar's rule (JO-14).
  const readerNow = useNow();
  const data = useMemo(() => (served ? { ...served, boards: onReadersClock(served.boards, readerNow) } : undefined), [served, readerNow]);
  // The figures' own moment, which a board's first tracked week is read against (as the Overview reads its tiles').
  const now = data ? Date.parse(data.meta.generated_at) : 0;
  const boards = useMemo(() => (data ? sortBoards(data.boards, sort, order, now) : undefined), [data, sort, order, now]);
  const retry = () => void refetch();

  if (!data && error) {
    return (
      <ErrorState
        title="The portfolio could not be loaded"
        description={`${error.message}`}
        detail={errorDetail(error)}
        onRetry={retry}
        retrying={isFetching}
      />
    );
  }

  return (
    <div className="flex flex-col gap-9">
      {data && error ? (
        <Callout
          tone="warn"
          title="The portfolio could not be refreshed"
          action={
            <Button size="sm" icon={RotateCcw} loading={isFetching} onClick={retry}>
              {isFetching ? "Retrying" : "Try again"}
            </Button>
          }
        >
          These figures are as of <Timestamp value={data.meta.generated_at} mode="datetime" />. {error.message}
        </Callout>
      ) : null}

      <div className="flex flex-col gap-5">
        <Summary data={data} now={now} />
        <div className="@container">
          <div className="hidden @min-[48rem]:block">
            <BoardsTable boards={boards} sort={sort} order={order} onSort={setSort} now={now} />
          </div>
          <div className="@min-[48rem]:hidden">
            <BoardCards boards={boards} sort={sort} order={order} onSort={setSort} now={now} />
          </div>
        </div>
        {/* The boards in Jira not synced yet have no row (JO-17): counted here, with the way to sync one. */}
        <NotSyncedLine count={data?.boards_not_synced} synced={data?.boards.length ?? 0} />
      </div>

      <Attention data={data} now={now} readerNow={readerNow} />
    </div>
  );
}

/** While the address is read: the summary line, the table's frame and the attention list, in their final places. */
export function PortfolioViewFallback() {
  return (
    <div aria-hidden className="flex flex-col gap-9">
      <Skeleton className="h-3.5 w-[min(36rem,90%)]" still />
      <div className="h-[15rem] rounded-lg border border-rule-weak" />
      <div className="h-[18rem]" />
    </div>
  );
}

