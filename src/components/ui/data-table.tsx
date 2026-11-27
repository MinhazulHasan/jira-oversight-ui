"use client";

import {
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  functionalUpdate,
  metaHelper,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type RowData,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Columns3 } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { isTypingTarget } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { IconButton } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ScrollArea } from "./scroll-area";
import { Skeleton } from "./skeleton";

/* ------------------------------------------------------------- features */

/** What a column says about itself, beyond TanStack's own options. */
export interface DataTableColumnMeta {
  /** Figures: right-aligned, Plex Mono, sorted largest first on the first click. */
  numeric?: boolean;
  /** A width for the column, e.g. "7.5rem" or "18%". Others share what is left. */
  width?: string;
  /** The column's name in words, for the column menu when its header is not plain text. */
  label?: string;
  /** Extra classes for this column's cells. */
  cellClassName?: string;
}

/** The features every table in the product uses. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, datetime: sortFn_datetime, text: sortFn_text },
  columnVisibilityFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;

/** A column definition for a DataTable of TRow. */
export type DataTableColumn<TRow extends RowData> = ColumnDef<DataTableFeatures, TRow, unknown>;

/** The typed column helper for a DataTable. */
export function dataTableColumns<TRow extends RowData>() {
  return createColumnHelper<DataTableFeatures, TRow>();
}

export type { ColumnVisibilityState, SortingState };

/** What the bar above the table can read: the rows exactly as shown, filtered and sorted. */
export interface DataTableView<TRow> {
  rows: TRow[];
}

type ToolbarSlot<TRow> = ReactNode | ((view: DataTableView<TRow>) => ReactNode);

/* ---------------------------------------------------------------- props */

/** The table's least width. */
export function tableMinWidth(minWidth: string, scrollWidth?: string): string {
  if (!scrollWidth) return minWidth;
  return `clamp(${minWidth}, calc(${minWidth} + (${minWidth} - 100cqw) * 1000), ${scrollWidth})`;
}

export interface DataTableProps<TRow extends RowData> {
  /** The rows, already filtered. Keep the array stable between renders (useMemo or query data). */
  data: TRow[];
  columns: DataTableColumn<TRow>[];
  /** A stable id per row (a finding id, an issue key), so focus and selection survive sorting. */
  getRowId: (row: TRow) => string;
  /** The table's name, for assistive technology: "Findings". */
  caption: string;
  /** Open a row (click, Enter): usually sets the drawer's id in the URL. */
  onRowOpen?: (row: TRow) => void;
  /** Whether this row opens (every row does when omitted). */
  canOpenRow?: (row: TRow) => boolean;
  /** The tooltip of a row that cannot open: why it does not. */
  closedRowTitle?: (row: TRow) => string | undefined;
  /** The row whose detail is open; marked as current. */
  selectedRowId?: string | null;
  /** Controlled sorting (the URL is the state). Omit both to let the table keep its own. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  defaultSorting?: SortingState;
  columnVisibility?: ColumnVisibilityState;
  onColumnVisibilityChange?: (visibility: ColumnVisibilityState) => void;
  defaultColumnVisibility?: ColumnVisibilityState;
  /** Show placeholder rows in the final shape while the data loads. */
  loading?: boolean;
  loadingRows?: number;
  /** What to say when there are no rows (an EmptyState that says what was looked at). */
  empty?: ReactNode;
  /** Where j and k work. */
  keyboardScope?: "table" | "page";
  /** Scroll inside the table under a sticky head, e.g. "28rem". Without it the page scrolls. */
  maxHeight?: string;
  /** Below this width the table scrolls sideways rather than squeezing, e.g. "56rem". */
  minWidth?: string;
  scrollWidth?: string;
  density?: "regular" | "compact";
  /** Left of the bar above the table: a count, a sort summary. A function receives the rows as shown. */
  toolbar?: ToolbarSlot<TRow>;
  /** Right of that bar, before the column menu: an export of the rows as shown, a copy action. */
  actions?: ToolbarSlot<TRow>;
  /** Offer a menu to show and hide columns. */
  columnMenu?: boolean;
  className?: string;
}

const EMPTY_SORT: SortingState = [];
const EMPTY_VISIBILITY: ColumnVisibilityState = {};
const PAGE_STEP = 10;
const SKELETON_WIDTHS = ["w-16", "w-3/4", "w-20", "w-14", "w-24", "w-12", "w-2/3", "w-10"];

function ignoresRowClick(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, input, select, textarea, [role='button'], [role='link'], [data-row-ignore]") !== null
  );
}

/** The product's table. */
export function DataTable<TRow extends RowData>({
  data,
  columns,
  getRowId,
  caption,
  onRowOpen,
  canOpenRow,
  closedRowTitle,
  selectedRowId = null,
  sorting,
  onSortingChange,
  defaultSorting = EMPTY_SORT,
  columnVisibility,
  onColumnVisibilityChange,
  defaultColumnVisibility = EMPTY_VISIBILITY,
  loading = false,
  loadingRows = 8,
  empty,
  keyboardScope = "table",
  maxHeight,
  minWidth,
  scrollWidth,
  density = "regular",
  toolbar,
  actions,
  columnMenu = false,
  className,
}: DataTableProps<TRow>) {
  const hintId = useId();
  const [ownSorting, setOwnSorting] = useState<SortingState>(defaultSorting);
  const [ownVisibility, setOwnVisibility] = useState<ColumnVisibilityState>(defaultColumnVisibility);
  const sortingState = sorting ?? ownSorting;
  const visibilityState = columnVisibility ?? ownVisibility;

  const resolvedColumns = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        sortDescFirst: column.sortDescFirst ?? (column.meta?.numeric ? true : undefined),
        sortUndefined: column.sortUndefined ?? ("last" as const),
      })),
    [columns],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns: resolvedColumns,
    data,
    getRowId,
    enableMultiSort: false,
    state: { sorting: sortingState, columnVisibility: visibilityState },
    onSortingChange: (updater: Updater<SortingState>) => {
      const next = functionalUpdate(updater, sortingState);
      if (sorting === undefined) setOwnSorting(next);
      onSortingChange?.(next);
    },
    onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) => {
      const next = functionalUpdate(updater, visibilityState);
      if (columnVisibility === undefined) setOwnVisibility(next);
      onColumnVisibilityChange?.(next);
    },
  });

  const rows = table.getRowModel().rows;
  const view: DataTableView<TRow> = { rows: rows.map((row) => row.original) };
  const slot = (content: ToolbarSlot<TRow>) => (typeof content === "function" ? content(view) : content);
  const visibleColumns = table.getVisibleLeafColumns();
  const interactive = Boolean(onRowOpen);
  const opens = (original: TRow) => interactive && (canOpenRow?.(original) ?? true);
  const showRows = !loading && rows.length > 0;
  const emptyShown = !loading && rows.length === 0;

  /* ---------------------------------------------------- roving focus --- */

  const [activeId, setActiveId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const resolvedActive =
    rows.find((row) => row.id === activeId)?.id ?? rows.find((row) => row.id === selectedRowId)?.id ?? rows[0]?.id;

  const focusIndex = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setActiveId(row.id);
    const element = rowRefs.current.get(row.id);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: "nearest" });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number, original: TRow) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    let next: number | null = null;
    if (key === "j" || key === "ArrowDown") next = index + 1;
    else if (key === "k" || key === "ArrowUp") next = index - 1;
    else if (key === "Home") next = 0;
    else if (key === "End") next = rows.length - 1;
    else if (key === "PageDown") next = index + PAGE_STEP;
    else if (key === "PageUp") next = index - PAGE_STEP;
    else if (key === "Enter" && onRowOpen) {
      event.preventDefault();
      if (opens(original)) onRowOpen(original);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    focusIndex(next);
  };

  const onPageKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "j" && event.key !== "k") return;
    if (isTypingTarget(event.target) || !showRows) return;
    const current = rows.findIndex((row) => row.id === resolvedActive);
    event.preventDefault();
    focusIndex(Math.max(0, current));
  });

  useEffect(() => {
    if (keyboardScope !== "page") return;
    window.addEventListener("keydown", onPageKeyDown);
    return () => window.removeEventListener("keydown", onPageKeyDown);
  }, [keyboardScope]);

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string, original: TRow) => {
    if (!onRowOpen || ignoresRowClick(event.target)) return;
    setActiveId(id);
    if (opens(original)) onRowOpen(original);
  };

  /* ------------------------------------------------------------ render --- */

  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const columnName = (columnId: string): string => {
    const column = table.getColumn(columnId);
    const header = column?.columnDef.header;
    return column?.columnDef.meta?.label ?? (typeof header === "string" ? header : columnId);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {toolbar || actions || columnMenu ? (
        <div data-print="hide" className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 text-xs text-ink-low">{toolbar ? slot(toolbar) : null}</div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions ? slot(actions) : null}
            {columnMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="Show or hide columns" icon={Columns3} variant="secondary" size="sm" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-[220px]">
                  <DropdownMenuLabel>Columns</DropdownMenuLabel>
                  {hideableColumns.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      // Keep the menu open: several columns are usually changed at once.
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) => column.toggleVisibility(checked === true)}
                    >
                      {columnName(column.id)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      ) : null}

      <ScrollArea
        axis="x"
        label={showRows ? undefined : caption}
        frameClassName="overflow-hidden rounded-md border border-rule-weak bg-sheet"
        className={cn(maxHeight && "overflow-y-auto", (emptyShown || (minWidth && scrollWidth)) && "@container")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table
          className="jo-table"
          data-density={density}
          data-sticky={maxHeight ? "true" : "false"}
          aria-busy={loading || undefined}
          aria-describedby={interactive ? hintId : undefined}
          style={minWidth ? { minWidth: tableMinWidth(minWidth, scrollWidth) } : undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            {visibleColumns.map((column) => (
              <col key={column.id} style={column.columnDef.meta?.width ? { width: column.columnDef.meta.width } : undefined} />
            ))}
            {interactive ? <col style={{ width: "2.75rem" }} /> : null}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      data-numeric={meta?.numeric || undefined}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            // The button reaches into the cell's padding (-mx-1.5), so its label may use that width too.
                            "group pressable -mx-1.5 inline-flex h-7 max-w-[calc(100%+0.75rem)] items-center gap-0.5 rounded-[5px] px-1.5 text-ink-low hover:bg-hover hover:text-ink-mid",
                            meta?.numeric && "flex-row-reverse",
                            sorted && "text-ink",
                          )}
                        >
                          <span className="micro truncate">
                            <table.FlexRender header={header} />
                          </span>
                          <SortIcon
                            aria-hidden
                            size={12}
                            strokeWidth={2}
                            className={cn(
                              "shrink-0 transition-opacity",
                              sorted ? "opacity-100" : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70",
                            )}
                          />
                        </button>
                      ) : (
                        // The sort buttons' box, so a header that cannot sort sits on the same line as those that can.
                        <span className="micro inline-flex h-7 items-center text-ink-low">
                          <table.FlexRender header={header} />
                        </span>
                      )}
                    </th>
                  );
                })}
                {interactive ? (
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                ) : null}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRows }, (_, rowIndex) => (
                  <tr key={`loading-${rowIndex}`} aria-hidden>
                    {visibleColumns.map((column, columnIndex) => (
                      <td key={column.id} data-numeric={column.columnDef.meta?.numeric || undefined}>
                        <Skeleton
                          className={cn(
                            "h-2.5",
                            SKELETON_WIDTHS[(rowIndex + columnIndex) % SKELETON_WIDTHS.length],
                            column.columnDef.meta?.numeric && "ml-auto w-12",
                          )}
                        />
                      </td>
                    ))}
                    {interactive ? <td /> : null}
                  </tr>
                ))
              : null}

            {emptyShown ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (interactive ? 1 : 0)}
                  className="!h-auto !overflow-visible !px-0 whitespace-normal"
                >
                  <div className="sticky left-0 w-[100cqi] max-w-full" data-empty-state>
                    {empty}
                  </div>
                </td>
              </tr>
            ) : null}

            {showRows
              ? rows.map((row, index) => (
                  <tr
                    key={row.id}
                    ref={(element) => {
                      if (element) rowRefs.current.set(row.id, element);
                      else rowRefs.current.delete(row.id);
                    }}
                    tabIndex={row.id === resolvedActive ? 0 : -1}
                    data-interactive={opens(row.original) || undefined}
                    title={interactive && !opens(row.original) ? closedRowTitle?.(row.original) : undefined}
                    aria-current={row.id === selectedRowId ? "true" : undefined}
                    onFocus={() => {
                      if (row.id !== activeId) setActiveId(row.id);
                    }}
                    onClick={(event) => onRowClick(event, row.id, row.original)}
                    onKeyDown={(event) => onRowKeyDown(event, index, row.original)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td key={cell.id} data-numeric={meta?.numeric || undefined} className={meta?.cellClassName}>
                          <table.FlexRender cell={cell} />
                        </td>
                      );
                    })}
                    {interactive ? (
                      <td className="text-right">
                        {opens(row.original) ? (
                          <ChevronRight aria-hidden size={15} strokeWidth={1.75} className="jo-row-affordance ml-auto text-ink-low" />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </ScrollArea>

      {interactive ? (
        <p id={hintId} className="sr-only">
          Press Enter to open a row. J and K, or the arrow keys, move between rows.
        </p>
      ) : null}
      <p role="status" className="sr-only">
        {loading ? `Loading ${caption.toLowerCase()}` : ""}
      </p>
    </div>
  );
}
