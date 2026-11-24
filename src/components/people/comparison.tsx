"use client";

import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { NAME_TRIGGER, PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { NameText } from "@/components/ui/person-name";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { PeopleScorecard, ScorecardMeasure, ScorecardPerson } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  directionText,
  figureText,
  firstOrder,
  markOf,
  MEASURE_DEFINITIONS,
  orderLabel,
  shownMeasures,
  sortPeople,
  standingOf,
  type SortKey,
  type SortOrder,
} from "./model";
import { Figure, MarkLabel } from "./scorecard";

/** A measure's column: the ratio's wider, so its counts ("9 findings on 10 open tickets") stay whole on two lines. */
const columnWidth = (measure: ScorecardMeasure) => (measure.kind === "ratio" ? 10 : 7.75);

export interface ComparisonProps {
  data: PeopleScorecard;
  selectedId: string | null;
  onSelect: (row: ScorecardPerson) => void;
  sort: SortKey;
  order: SortOrder;
  onSort: (sort: SortKey, order: SortOrder) => void;
  /** Another period is loading: the figures shown are the last period's. */
  stale?: boolean;
}

const MOVES: Record<string, -1 | 1 | "first" | "last"> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1, Home: "first", End: "last" };

/** Rows move with the arrow keys (and j, k), Enter or Space chooses. */
function useRowKeys<T extends HTMLElement>(count: number) {
  const body = useRef<T>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number, choose: () => void) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose();
      return;
    }
    const move = MOVES[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = move === "first" ? 0 : move === "last" ? count - 1 : Math.min(count - 1, Math.max(0, index + move));
    body.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus();
  };
  return { body, onKeyDown };
}

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  const Icon = !active ? ChevronsUpDown : order === "asc" ? ArrowUp : ArrowDown;
  return (
    <Icon
      aria-hidden
      size={12}
      strokeWidth={2}
      className={cn("shrink-0 transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70")}
    />
  );
}

function HeaderButton({ measure, active, order, onSort }: { measure: ScorecardMeasure; active: boolean; order: SortOrder; onSort: () => void }) {
  const direction = directionText(measure);
  return (
    <Tooltip
      content={
        <span className="block max-w-[18rem] whitespace-normal">
          {MEASURE_DEFINITIONS[measure.key]}
          {direction ? ` ${direction}` : ""}
        </span>
      }
      side="top"
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "group pressable -mx-1.5 inline-flex max-w-full flex-row-reverse items-end gap-1 rounded-[5px] px-1.5 py-1 text-right text-xs leading-tight font-medium hover:bg-hover hover:text-ink-mid",
          active ? "text-ink" : "text-ink-low",
        )}
      >
        <span className="line-clamp-4 whitespace-normal">{measure.label}</span>
        <SortIcon active={active} order={order} />
      </button>
    </Tooltip>
  );
}

/** The wide table: the person held at the left, a column per measure, the whole board as its last row. */
function ComparisonTable({ data, selectedId, onSelect, sort, order, onSort, stale }: ComparisonProps) {
  const locale = useFigureLocale();
  const measures = shownMeasures(data.measures);
  const rows = sortPeople(data.people, sort, order);
  const { body, onKeyDown } = useRowKeys<HTMLTableSectionElement>(rows.length);
  const selectedIndex = rows.findIndex((row) => row.person.id === selectedId);
  const tabbable = selectedIndex >= 0 ? selectedIndex : 0;
  const toggle = (key: SortKey) => onSort(key, sort === key ? (order === "asc" ? "desc" : "asc") : firstOrder(key));
  const ariaSort = (key: SortKey) => (sort === key ? (order === "asc" ? "ascending" : "descending") : undefined);

  return (
    <ScrollArea axis="x" frameClassName="overflow-hidden rounded-md border border-rule-weak bg-sheet">
      <table
        className={cn("jo-table jo-people-table", stale && "opacity-60 transition-opacity")}
        data-sticky="false"
        aria-busy={stale || undefined}
        style={{ minWidth: `${13.5 + measures.reduce((sum, measure) => sum + columnWidth(measure), 0)}rem` }}
      >
        <caption className="sr-only">
          Everyone with tickets on the board, last {data.period.days} days, next to the whole board. Choose a row to see that
          person&apos;s scorecard.
        </caption>
        <colgroup>
          <col style={{ width: "13.5rem" }} />
          {measures.map((measure) => (
            <col key={measure.key} style={{ width: `${columnWidth(measure)}rem` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" data-sticky aria-sort={ariaSort("name")} className="!h-auto py-2 align-bottom">
              <button
                type="button"
                onClick={() => toggle("name")}
                className={cn(
                  "group pressable -mx-1.5 inline-flex items-center gap-1 rounded-[5px] px-1.5 py-1 text-xs font-medium hover:bg-hover hover:text-ink-mid",
                  sort === "name" ? "text-ink" : "text-ink-low",
                )}
              >
                Person
                <SortIcon active={sort === "name"} order={order} />
              </button>
            </th>
            {measures.map((measure) => (
              <th key={measure.key} scope="col" data-numeric aria-sort={ariaSort(measure.key)} className="!h-auto py-2 align-bottom">
                <HeaderButton measure={measure} active={sort === measure.key} order={order} onSort={() => toggle(measure.key)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((row, index) => {
            const selected = row.person.id === selectedId;
            return (
              <tr
                key={row.person.id}
                data-row={index}
                data-person={row.person.id}
                data-interactive="true"
                tabIndex={index === tabbable ? 0 : -1}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => onKeyDown(event, index, () => onSelect(row))}
              >
                <td data-sticky>
                  <span className="flex min-w-0 items-center gap-2">
                    <PersonCardTrigger person={row.person} days={data.period.days} inRow tabbable={false} className={cn(NAME_TRIGGER, "gap-2")}>
                      <PersonAvatar person={row.person} />
                      <span className="flex min-w-0 flex-col">
                        <NameText name={row.person.name} className="truncate text-sm text-ink normal-nums" />
                        <span className="text-[11px] leading-4 text-ink-low">
                          <span className="mono">{formatCount(row.tickets, { locale })}</span> {row.tickets === 1 ? "ticket" : "tickets"}
                        </span>
                      </span>
                    </PersonCardTrigger>
                    <ChevronRight aria-hidden size={13} strokeWidth={1.75} className={cn("ml-auto shrink-0 text-ink-low", selected ? "opacity-100" : "opacity-0")} />
                  </span>
                </td>
                {measures.map((measure) => {
                  const value = row.values[measure.key];
                  const mark = markOf(measure, value);
                  return (
                    <td key={measure.key} data-numeric>
                      <span className="flex min-w-0 items-center justify-end gap-2">
                        {mark ? <MarkLabel mark={mark} compact /> : null}
                        <span className="min-w-0">
                          <Figure measure={measure} value={value} strong lines={measure.kind === "ratio"} />
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr data-board>
            <th scope="row" data-sticky className="text-left font-normal">
              <span className="flex flex-col">
                <span className="text-sm text-ink-mid">Whole board</span>
                <span className="text-[11px] leading-4 text-ink-low">
                  <span className="mono">{formatCount(data.board.tickets, { locale })}</span> tickets, assigned or not
                </span>
              </span>
            </th>
            {measures.map((measure) => (
              <td key={measure.key} data-numeric>
                <Figure measure={measure} value={data.board.values[measure.key]} lines={measure.kind === "ratio"} />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </ScrollArea>
  );
}

/** The narrow list: the sort above it, one row a person with the figure it is sorted by. */
function ComparisonList({ data, selectedId, onSelect, sort, order, onSort, stale }: ComparisonProps) {
  const locale = useFigureLocale();
  const measures = shownMeasures(data.measures);
  const rows = sortPeople(data.people, sort, order);
  const { body, onKeyDown } = useRowKeys<HTMLUListElement>(rows.length);
  const measure = sort === "name" ? null : (measures.find((candidate) => candidate.key === sort) ?? null);
  const first = firstOrder(sort);
  const other: SortOrder = first === "asc" ? "desc" : "asc";
  const boardText = measure ? figureText(measure, data.board.values[measure.key], locale) : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select<SortKey>
          label="Sort by"
          labelPlacement="inline"
          options={[{ value: "name", label: "Name" }, ...measures.map((candidate) => ({ value: candidate.key as SortKey, label: candidate.label }))]}
          value={sort}
          onValueChange={(key) => onSort(key, firstOrder(key))}
          size="sm"
          triggerClassName="max-w-[15rem]"
        />
        <SegmentedControl<SortOrder>
          label="Order"
          size="sm"
          options={[
            { value: first, label: orderLabel(sort, first) },
            { value: other, label: orderLabel(sort, other) },
          ]}
          value={order}
          onValueChange={(next) => onSort(sort, next)}
        />
      </div>
      {measure && boardText ? (
        <p className="text-xs text-ink-low">
          Whole board: <span className="mono text-ink-mid">{boardText.value}</span>
          {boardText.detail ? <span className="mono"> · {boardText.detail}</span> : null}.
          {directionText(measure) ? ` ${directionText(measure)}` : ""}
        </p>
      ) : null}
      <ul ref={body} aria-label="Everyone with tickets" className={cn("flex flex-col border-t border-rule-weak", stale && "opacity-60")}>
        {rows.map((row, index) => {
          const selected = row.person.id === selectedId;
          const value = measure ? row.values[measure.key] : null;
          const mark = measure && value ? markOf(measure, value) : null;
          const standing = standingOf(data.measures, row.values);
          return (
            <li key={row.person.id} className="border-b border-rule-weak">
              <button
                type="button"
                data-row={index}
                data-person={row.person.id}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => onKeyDown(event, index, () => onSelect(row))}
                className={cn(
                  "pressable flex min-h-14 w-full min-w-0 items-center gap-3 px-1 py-2 text-left hover:bg-hover",
                  selected && "bg-cite-tint shadow-[inset_2px_0_0_var(--cite)]",
                )}
              >
                <PersonAvatar person={row.person} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-ink" title={row.person.name}>
                    {row.person.name}
                  </span>
                  <span className="truncate text-[11px] leading-4 text-ink-low">
                    {measure && mark ? (
                      <MarkLabel mark={mark} className="text-[11px]" />
                    ) : standing.compared === 0 ? (
                      // Compared on no measure (a part-timer, a new joiner): said so, never "0 of 0".
                      <MarkLabel mark="too_few" className="text-[11px]" />
                    ) : (
                      `Closer on ${standing.closer} of ${standing.compared} compared`
                    )}
                  </span>
                </span>
                {measure && value ? (
                  <span className="shrink-0 text-right">
                    <Figure measure={measure} value={value} strong />
                  </span>
                ) : (
                  <span className="mono shrink-0 text-xs text-ink-low">
                    {formatCount(row.tickets, { locale })} {row.tickets === 1 ? "ticket" : "tickets"}
                  </span>
                )}
                <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The everyone table where there is room for it, the list where there is not: both read the same order. */
export function Comparison(props: ComparisonProps) {
  return (
    <div className="@container min-w-0">
      <div className="hidden @min-[42rem]:block" data-comparison="table">
        <ComparisonTable {...props} />
      </div>
      <div className="@min-[42rem]:hidden" data-comparison="list">
        <ComparisonList {...props} />
      </div>
    </div>
  );
}

export function ComparisonSkeleton() {
  return (
    <SkeletonGroup label="Loading everyone's figures" className="@container min-w-0">
      <div className="hidden overflow-hidden rounded-md border border-rule-weak bg-sheet @min-[42rem]:block" data-skeleton="table">
        <div className="flex h-[5.3125rem] items-end gap-6 border-b border-rule-weak bg-rail px-4 pb-2">
          <Skeleton className="h-2.5 w-14" />
          <span className="ml-auto flex items-end gap-10">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-2.5 w-16" />
            ))}
          </span>
        </div>
        {Array.from({ length: 8 }, (_, row) => (
          <div key={row} className="flex h-[3.25rem] items-center gap-3 border-b border-rule-weak px-4">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className={cn("h-3", row % 2 ? "w-28" : "w-36")} />
            <span className="ml-auto flex items-center gap-10">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-3 w-12" />
              ))}
            </span>
          </div>
        ))}
        <div className="flex h-[3.25rem] items-center gap-3 bg-rail px-4 shadow-[inset_0_1px_0_var(--rule)]" data-board>
          <Skeleton className="h-3 w-24" />
          <span className="ml-auto flex items-center gap-10">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-3 w-12" />
            ))}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3 @min-[42rem]:hidden" data-skeleton="list">
        <div className="flex h-[1.875rem] items-end gap-2">
          <Skeleton className="h-7 w-40 rounded-[6px]" />
          <Skeleton className="h-7 w-32 rounded-[6px]" />
        </div>
        <div className="flex flex-col border-t border-rule-weak">
          {Array.from({ length: 8 }, (_, row) => (
            <div key={row} className="flex h-[calc(3.5rem+1px)] items-center gap-3 border-b border-rule-weak px-1">
              <Skeleton className="size-5 rounded-full" />
              <span className="flex flex-col gap-1.5">
                <Skeleton className={cn("h-3", row % 2 ? "w-28" : "w-36")} />
                <Skeleton className="h-2.5 w-24" />
              </span>
              <Skeleton className="ml-auto h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
