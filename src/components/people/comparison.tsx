"use client";

import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

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

import { useCredit } from "./credit/context";
import {
  directionText,
  figureText,
  firstOrder,
  markOf,
  measureDefinition,
  orderLabel,
  shownMeasures,
  sortPeople,
  standingOf,
  type SortKey,
  type SortOrder,
} from "./model";
import { cellName, hasTicketsBehind } from "./proof/model";
import { ProofButton, useProof } from "./proof/proof-provider";
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

const figuresIn = (row: Element) => [...row.querySelectorAll<HTMLElement>("[data-proof-col]")];
const columnOf = (figure: HTMLElement) => Number(figure.dataset.proofCol);

/** The figures as a grid for the arrow keys: along a row (back to the row itself past its first), and down the same column. */
function moveAmongFigures(event: KeyboardEvent<HTMLElement>, table: HTMLTableElement | null): void {
  const figure = event.target instanceof HTMLElement && event.target.dataset.proofCol !== undefined ? event.target : null;
  const row = figure?.closest("tr");
  if (!figure || !row || !table || event.altKey || event.metaKey || event.ctrlKey) return;
  const column = columnOf(figure);
  const along = figuresIn(row);
  let next: HTMLElement | null | undefined;
  if (event.key === "ArrowRight") next = along.find((other) => columnOf(other) > column);
  else if (event.key === "ArrowLeft") next = along.findLast((other) => columnOf(other) < column) ?? (row.dataset.row !== undefined ? row : null);
  else if (event.key === "Home") next = along[0];
  else if (event.key === "End") next = along.at(-1);
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const rows = [...table.querySelectorAll("tbody tr[data-row], tfoot tr")];
    const step = event.key === "ArrowDown" ? 1 : -1;
    for (let at = rows.indexOf(row) + step; at >= 0 && at < rows.length && !next; at += step) {
      // The same column, or the nearest figure where that one has nothing behind it.
      next = figuresIn(rows[at]).sort((a, b) => Math.abs(columnOf(a) - column) - Math.abs(columnOf(b) - column))[0];
    }
  } else return;
  event.preventDefault();
  event.stopPropagation();
  next?.focus();
}

/** "142 tickets" under a name: the figure opens the tickets behind it where the proof is offered; its name holds what it shows. */
function TicketsFigure({
  tickets,
  who,
  person,
  tabIndex,
  locale,
  proof,
  className,
}: {
  tickets: number;
  who: string;
  person: string | null;
  tabIndex?: number;
  locale: string | undefined;
  proof: boolean;
  className?: string;
}) {
  const figure = formatCount(tickets, { locale });
  const noun = tickets === 1 ? "ticket" : "tickets";
  if (!proof || tickets === 0) {
    return (
      <span className={className}>
        <span className="mono">{figure}</span> {noun}
      </span>
    );
  }
  return (
    <span className={className}>
      <ProofButton target={{ measure: "tickets", person }} label={cellName(who, "tickets", figure)} column={0} tabIndex={tabIndex} className="text-left">
        <span className="mono" data-figure-value>
          {figure}
        </span>
      </ProofButton>{" "}
      {noun}
    </span>
  );
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
  // What it counts, which way is closer, and whom each ticket counts for under the board's credit setting.
  const definition = measureDefinition(measure, useCredit());
  return (
    <Tooltip
      content={<span className="block max-w-[18rem] whitespace-normal">{definition}</span>}
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
  const proof = useProof();
  // One tab stop among the rows (the last one used, else the chosen one), with that row's figures after it.
  const [usedId, setUsedId] = useState<string | null>(null);
  const usedIndex = rows.findIndex((row) => row.person.id === usedId);
  const selectedIndex = rows.findIndex((row) => row.person.id === selectedId);
  const tabbable = usedIndex >= 0 ? usedIndex : selectedIndex >= 0 ? selectedIndex : 0;
  const table = () => body.current?.closest("table") ?? null;
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
            const reach = index === tabbable ? 0 : -1;
            return (
              <tr
                key={row.person.id}
                data-row={index}
                data-person={row.person.id}
                data-interactive="true"
                tabIndex={reach}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(row)}
                onFocus={() => setUsedId(row.person.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return moveAmongFigures(event, table());
                  const first = event.key === "ArrowRight" && !event.altKey && !event.metaKey && !event.ctrlKey ? figuresIn(event.currentTarget)[0] : undefined;
                  if (first) {
                    event.preventDefault();
                    first.focus();
                    return;
                  }
                  onKeyDown(event, index, () => onSelect(row));
                }}
              >
                <td data-sticky>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex min-w-0 flex-col items-start">
                      <PersonCardTrigger person={row.person} days={data.period.days} inRow tabbable={false} className={cn(NAME_TRIGGER, "max-w-full gap-2")}>
                        <PersonAvatar person={row.person} />
                        <NameText name={row.person.name} className="truncate text-sm text-ink normal-nums" />
                      </PersonCardTrigger>
                      <span className="max-w-full pl-7 text-[11px] leading-4 text-ink-low">
                        <TicketsFigure
                          tickets={row.tickets}
                          who={row.person.name}
                          person={row.person.id}
                          tabIndex={reach}
                          locale={locale}
                          proof={proof !== null}
                        />
                      </span>
                    </span>
                    <ChevronRight aria-hidden size={13} strokeWidth={1.75} className={cn("ml-auto shrink-0 text-ink-low", selected ? "opacity-100" : "opacity-0")} />
                  </span>
                </td>
                {measures.map((measure, column) => {
                  const value = row.values[measure.key];
                  const mark = markOf(measure, value);
                  const figure = <Figure measure={measure} value={value} strong lines={measure.kind === "ratio"} />;
                  return (
                    <td key={measure.key} data-numeric>
                      <span className="flex min-w-0 items-center justify-end gap-2">
                        {mark ? <MarkLabel mark={mark} compact /> : null}
                        <span className="min-w-0">
                          {proof && hasTicketsBehind(measure, value) ? (
                            <ProofButton
                              target={{ measure: measure.key, person: row.person.id }}
                              label={cellName(row.person.name, measure.key, figureText(measure, value, locale).spoken)}
                              column={column + 1}
                              tabIndex={reach}
                            >
                              {figure}
                            </ProofButton>
                          ) : (
                            figure
                          )}
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
          <tr data-board onKeyDown={(event) => moveAmongFigures(event, table())}>
            <th scope="row" data-sticky className="text-left font-normal">
              <span className="flex flex-col items-start">
                <span className="text-sm text-ink-mid">Whole board</span>
                <span className="text-[11px] leading-4 text-ink-low">
                  <TicketsFigure tickets={data.board.tickets} who="Whole board" person={null} locale={locale} proof={proof !== null} />, assigned or not
                </span>
              </span>
            </th>
            {measures.map((measure, column) => {
              const value = data.board.values[measure.key];
              const figure = <Figure measure={measure} value={value} lines={measure.kind === "ratio"} />;
              return (
                <td key={measure.key} data-numeric>
                  {proof && hasTicketsBehind(measure, value) ? (
                    <ProofButton
                      target={{ measure: measure.key, person: null }}
                      label={cellName("Whole board", measure.key, figureText(measure, value, locale).spoken)}
                      column={column + 1}
                    >
                      {figure}
                    </ProofButton>
                  ) : (
                    figure
                  )}
                </td>
              );
            })}
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
  const proof = useProof();
  const measure = sort === "name" ? null : (measures.find((candidate) => candidate.key === sort) ?? null);
  const first = firstOrder(sort);
  const other: SortOrder = first === "asc" ? "desc" : "asc";
  const boardText = measure ? figureText(measure, data.board.values[measure.key], locale) : null;
  const boardFigure = boardText ? (
    <span data-figure-value>
      <span className="mono text-ink-mid">{boardText.value}</span>
      {boardText.detail ? <span className="mono"> · {boardText.detail}</span> : null}
    </span>
  ) : null;

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
          Whole board:{" "}
          {proof && hasTicketsBehind(measure, data.board.values[measure.key]) ? (
            <ProofButton
              target={{ measure: measure.key, person: null }}
              label={cellName("Whole board", measure.key, boardText.spoken)}
              className="-my-0.5 py-0.5 text-left"
            >
              {boardFigure}
            </ProofButton>
          ) : (
            boardFigure
          )}
          .{directionText(measure) ? ` ${directionText(measure)}` : ""}
        </p>
      ) : null}
      <ul ref={body} aria-label="Everyone with tickets" className={cn("flex flex-col border-t border-rule-weak", stale && "opacity-60")}>
        {rows.map((row, index) => {
          const selected = row.person.id === selectedId;
          const value = measure ? row.values[measure.key] : null;
          const mark = measure && value ? markOf(measure, value) : null;
          const standing = standingOf(data.measures, row.values);
          const figure =
            measure && value ? (
              <Figure measure={measure} value={value} strong />
            ) : (
              <span className="mono text-xs text-ink-low" data-figure-value>
                {formatCount(row.tickets, { locale })} {row.tickets === 1 ? "ticket" : "tickets"}
              </span>
            );
          const proven = measure && value ? hasTicketsBehind(measure, value) : row.tickets > 0;
          // The figure's own button, laid over its place in the row, so the row keeps its look and its press.
          const over = proof !== null && proven;
          return (
            <li key={row.person.id} className="relative border-b border-rule-weak">
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
                <span className={cn("shrink-0 text-right", over && "invisible")} aria-hidden={over || undefined}>
                  {figure}
                </span>
                <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
              </button>
              {over ? (
                <span className="absolute top-1/2 right-[1.875rem] -translate-y-1/2 text-right">
                  {measure && value ? (
                    <ProofButton
                      target={{ measure: measure.key, person: row.person.id }}
                      label={cellName(row.person.name, measure.key, figureText(measure, value, locale).spoken)}
                    >
                      {figure}
                    </ProofButton>
                  ) : (
                    <TicketsFigure
                      tickets={row.tickets}
                      who={row.person.name}
                      person={row.person.id}
                      locale={locale}
                      proof
                      className="mono text-xs text-ink-low"
                    />
                  )}
                </span>
              ) : null}
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
