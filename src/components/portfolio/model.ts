import { findingAgeMs, findingClock } from "@/components/findings/model";
import type { CsvColumn } from "@/components/ui/csv";
import type { AttentionItem, PortfolioBoard } from "@/lib/api/schemas";
import { isStale } from "@/lib/sync";

/*
 * The Portfolio's arithmetic, kept apart from the page so the table, the
 * cards that stand for it on a phone, the export and the tests all read the
 * same order and the same totals.
 */

/** What the boards can be sorted by; each a column of the table. */
export const PORTFOLIO_SORTS = ["board", "breaches", "warnings", "week", "sprint", "top_rule"] as const;
export type PortfolioSort = (typeof PORTFOLIO_SORTS)[number];
export type SortOrder = "asc" | "desc";

/** The order the page opens in: most open breaches first, where an executive looks first. */
export const DEFAULT_SORT: { sort: PortfolioSort; order: SortOrder } = { sort: "breaches", order: "desc" };

const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** A board's net change this week: findings first seen in the last 7 days, less those resolved. */
export function weekChange(board: PortfolioBoard): number {
  return board.new_findings_7d - board.resolved_findings_7d;
}

/** Whether the board has figures: not before its first sync, when the service has none for it (it sends zeros). */
export function hasFigures(board: PortfolioBoard): boolean {
  return board.last_sync_at !== null;
}

/**
 * The boards as the reader's clock reads them (JO-14): stale by the one rule
 * the top bar, Findings and the person card use (src/lib/sync.ts), on the
 * clock the top bar reads, so the Portfolio never says "Stale" beside a top
 * bar that does not, or the other way round. The service's own `stale` is
 * the same rule on its clock: it stands while the reader's clock is not yet
 * known, and for a board that has never synced (stale, having no sync).
 */
export function onReadersClock(boards: readonly PortfolioBoard[], readerNow: number | null): PortfolioBoard[] {
  if (readerNow === null) return [...boards];
  return boards.map((board) => (hasFigures(board) ? { ...board, stale: isStale(board.last_sync_at, readerNow) } : board));
}

/**
 * How long a breach in "Needs attention" has been seen, on the one clock
 * Findings reads its "Open for" on (JO-14): to the reader's now while its
 * board's last sync is fresh, else as at that sync, to the last rules run
 * that saw it, which the page says ("at last sync"). The same breach reads
 * the same age on both pages.
 */
export function attentionAge(item: AttentionItem, syncedAt: string | null, readerNow: number | null): { ms: number; atLastSync: boolean } {
  const clock = findingClock(syncedAt, readerNow);
  const ms = findingAgeMs({ first_seen_at: item.opened_at, last_seen_at: item.last_seen_at, resolved_at: null }, clock.now);
  return { ms, atLastSync: clock.stale };
}

/**
 * The board's first tracked week, as the Overview's tiles read it: the rules
 * first saw it within the 7 days to `now` (the response's generated_at), so
 * every finding is new only because tracking began and there is no change
 * or trend to show yet.
 */
export function firstTrackedWeek(board: PortfolioBoard, now: number): boolean {
  if (!hasFigures(board) || board.tracking_since === null) return false;
  const since = Date.parse(board.tracking_since);
  return !Number.isNaN(since) && since > now - WEEK_MS;
}

/**
 * The Sprint column's order: a sprint at risk above one on track, then by its
 * unestimated work. None where the board has no active sprint, or nothing
 * about it is measured.
 */
function sprintRank(board: PortfolioBoard): number | undefined {
  if (!hasFigures(board) || !board.active_sprint) return undefined;
  if (board.sprint_at_risk === null && board.unestimated_in_active_sprint === null) return undefined;
  return (board.sprint_at_risk ? 1_000_000_000 : 0) + (board.unestimated_in_active_sprint ?? 0);
}

/**
 * Each sort's value for a board at `now`; undefined where the board has none
 * (no figures yet, its first tracked week, no active sprint, nothing open),
 * which sorts last whichever way. The board's name always sorts.
 */
export function sortValues(now: number): Record<PortfolioSort, (board: PortfolioBoard) => string | number | undefined> {
  return {
    board: (board) => folded(board.project.name),
    breaches: (board) => (hasFigures(board) ? board.open_breaches : undefined),
    warnings: (board) => (hasFigures(board) ? board.open_warnings : undefined),
    week: (board) => (hasFigures(board) && !firstTrackedWeek(board, now) ? weekChange(board) : undefined),
    sprint: sprintRank,
    top_rule: (board) => board.top_rule?.open,
  };
}

/** The way a column sorts on its first press: names A to Z, every figure largest first. */
export function firstOrder(sort: PortfolioSort): SortOrder {
  return sort === "board" ? "asc" : "desc";
}

/**
 * The boards in the order asked for, at `now` (the response's generated_at): a board with no value for it last,
 * ties in the service's own order.
 */
export function sortBoards(boards: readonly PortfolioBoard[], sort: PortfolioSort, order: SortOrder, now: number): PortfolioBoard[] {
  const value = sortValues(now)[sort];
  const sign = order === "asc" ? 1 : -1;
  return boards
    .map((board, index) => ({ board, index, key: value(board) }))
    .sort((a, b) => {
      if (a.key === undefined || b.key === undefined) {
        if (a.key === b.key) return a.index - b.index;
        return a.key === undefined ? 1 : -1;
      }
      const compared = typeof a.key === "string" ? a.key.localeCompare(String(b.key), "en") : a.key - Number(b.key);
      return compared !== 0 ? compared * sign : a.index - b.index;
    })
    .map((entry) => entry.board);
}

/** How each order reads after "sorted by": ascending, then descending. */
const ORDER_WORDS: Record<PortfolioSort, [string, string]> = {
  board: ["board, A to Z", "board, Z to A"],
  breaches: ["open breaches, fewest first", "open breaches, most first"],
  warnings: ["open warnings, fewest first", "open warnings, most first"],
  week: ["this week's change, biggest fall first", "this week's change, biggest rise first"],
  sprint: ["sprint, on track and least unestimated first", "sprint, at risk and most unestimated first"],
  top_rule: ["top rule's open findings, fewest first", "top rule's open findings, most first"],
};

export function sortSummary(sort: PortfolioSort, order: SortOrder): string {
  return `sorted by ${ORDER_WORDS[sort][order === "asc" ? 0 : 1]}`;
}

/** The boards table's one line: its order, as a sentence ("Sorted by open breaches, most first."). */
export function sortSentence(sort: PortfolioSort, order: SortOrder): string {
  const words = sortSummary(sort, order);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

/** The sort control's choices on a phone, where there are no column headers to press: one per column, its first order. */
export const SORT_CHOICES: readonly { value: PortfolioSort; label: string }[] = PORTFOLIO_SORTS.map((sort) => {
  const words = ORDER_WORDS[sort][firstOrder(sort) === "asc" ? 0 : 1];
  return { value: sort, label: words.charAt(0).toUpperCase() + words.slice(1) };
});

export interface PortfolioTotals {
  /** The boards with figures (synced at least once); the figures below are theirs. */
  boards: number;
  /** Synced boards whose last sync is stale (older than the top bar's two hours). */
  stale: number;
  /** Boards in the list that have never synced, so have no figures yet. */
  neverSynced: number;
  breaches: number;
  warnings: number;
  /** New and resolved in the last 7 days, on the boards tracked before this week. */
  newFindings: number;
  resolved: number;
  /** The names of the boards in their first tracked week, whose findings are all new only because tracking began. */
  firstWeek: string[];
}

/** The figures across the boards at `now`: a board with no figures yet is counted apart, never as zeros. */
export function portfolioTotals(boards: readonly PortfolioBoard[], now: number): PortfolioTotals {
  return boards.reduce<PortfolioTotals>(
    (sum, board) => {
      if (!hasFigures(board)) return { ...sum, neverSynced: sum.neverSynced + 1 };
      const first = firstTrackedWeek(board, now);
      return {
        ...sum,
        boards: sum.boards + 1,
        stale: sum.stale + (board.stale ? 1 : 0),
        breaches: sum.breaches + board.open_breaches,
        warnings: sum.warnings + board.open_warnings,
        newFindings: sum.newFindings + (first ? 0 : board.new_findings_7d),
        resolved: sum.resolved + (first ? 0 : board.resolved_findings_7d),
        firstWeek: first ? [...sum.firstWeek, board.project.name] : sum.firstWeek,
      };
    },
    { boards: 0, stale: 0, neverSynced: 0, breaches: 0, warnings: 0, newFindings: 0, resolved: 0, firstWeek: [] },
  );
}

/**
 * The word for an active sprint with no open sprint-risk finding (W-SPR-01). Not "On track": the rule looks only at
 * the days left and the work not started, so it cannot vouch for a sprint (SQA: a sprint past its end date with work
 * not done read "On track").
 */
export const NO_RISK_FLAGGED = "No risk flagged";

/** What the sprint column says: the risk in words. */
export function sprintWords(board: PortfolioBoard): string {
  if (!hasFigures(board)) return "No figures yet";
  if (!board.active_sprint) return "No active sprint";
  if (board.sprint_at_risk === null) return "Risk not measured";
  return board.sprint_at_risk ? "At risk" : NO_RISK_FLAGGED;
}

/** The hover readout's label for each of the 8 weekly points, oldest first: the span is the same for every board. */
export function trendLabels(points: number): string[] {
  return Array.from({ length: points }, (_, index) => {
    const ago = points - 1 - index;
    return ago === 0 ? "This week" : ago === 1 ? "Last week" : `${ago} weeks ago`;
  });
}

/** A figure as the export writes it: blank for a board with no figures yet, never a 0 that was not measured. */
const figure = (pick: (board: PortfolioBoard) => number | null) => (board: PortfolioBoard) => (hasFigures(board) ? pick(board) : null);

/** The boards as the export writes them: every figure the row shows, in the order shown. */
export const PORTFOLIO_CSV_COLUMNS: readonly CsvColumn<PortfolioBoard>[] = [
  { header: "Board", value: (board) => board.project.key },
  { header: "Name", value: (board) => board.project.name },
  { header: "Last sync (UTC)", value: (board) => board.last_sync_at },
  { header: "Stale", value: (board) => board.stale },
  { header: "Tracking since (UTC)", value: (board) => board.tracking_since },
  { header: "Open tickets", value: figure((board) => board.open_tickets) },
  { header: "In progress", value: figure((board) => board.in_progress) },
  { header: "Open breaches", value: figure((board) => board.open_breaches) },
  { header: "Open warnings", value: figure((board) => board.open_warnings) },
  { header: "New findings, last 7 days", value: figure((board) => board.new_findings_7d) },
  { header: "Resolved findings, last 7 days", value: figure((board) => board.resolved_findings_7d) },
  {
    header: "Open findings, last 8 weeks (oldest first)",
    value: (board) => (hasFigures(board) ? board.open_findings_trend.join(" ") : null),
  },
  { header: "Unestimated in the active sprint", value: (board) => board.unestimated_in_active_sprint },
  { header: "Sprint", value: sprintWords },
  { header: "Top rule", value: (board) => board.top_rule?.id ?? null },
  { header: "Top rule title", value: (board) => board.top_rule?.title ?? null },
  { header: "Top rule open findings", value: (board) => board.top_rule?.open ?? null },
];
