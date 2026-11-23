"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { FactSet } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { cellId, rowLink, targetKey, toolLabel, valueKey, type RowLink } from "./describe";
import { FactValue, isNumericKind } from "./fact-value";
import { Markers, shownColumns, useTraceTarget, type CitationIndex, type ShownColumn } from "./ledger-parts";
import { PersonCell, personColumnsOf } from "./people-in-facts";
import { useActiveCitation, useTrace } from "./trace";

type Move = "next" | "previous" | "first" | "last";

interface RowProps {
  fact: FactSet;
  shown: readonly ShownColumn[];
  rowIndex: number;
  link: RowLink | null;
  index: CitationIndex;
  tabbable: boolean;
  onFocusRow: (rowIndex: number) => void;
  onMove: (from: number, where: Move) => void;
}

const MOVES: Record<string, Move> = { ArrowDown: "next", j: "next", ArrowUp: "previous", k: "previous", Home: "first", End: "last" };

function FactRow({ fact, shown, rowIndex, link, index, tabbable, onFocusRow, onMove }: RowProps) {
  const router = useRouter();
  const trace = useTrace();
  const active = useActiveCitation();
  const key = targetKey({ fact_ref: fact.ref, row_index: rowIndex, column: "" });
  const ref = useTraceTarget(key);
  const row = fact.rows[rowIndex];
  const { named } = personColumnsOf(fact);
  const first = index.byTarget.get(key)?.[0]?.marker ?? null;
  const interactive = link !== null || first !== null;
  const traced = active !== null && active.fact_ref === fact.ref && active.row_index === rowIndex;

  const open = (event: MouseEvent | KeyboardEvent) => {
    if (link) {
      if (event.metaKey || event.ctrlKey) window.open(link.href, "_blank", "noopener");
      else router.push(link.href);
    } else if (first !== null) {
      // Nothing to open, so go to where the answer quotes it.
      trace?.node(valueKey(first))?.focus();
    }
  };

  return (
    <tr
      ref={ref}
      data-row={rowIndex}
      data-traced={traced || undefined}
      tabIndex={interactive ? (tabbable ? 0 : -1) : undefined}
      onClick={
        interactive
          ? (event) => {
              if (link) open(event);
              else if (first !== null) trace?.hold(first, "user");
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (event) => {
              const move = MOVES[event.key];
              if (event.key === "Enter") {
                event.preventDefault();
                open(event);
              } else if (move && !event.altKey && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                onMove(rowIndex, move);
              }
            }
          : undefined
      }
      onFocus={() => {
        onFocusRow(rowIndex);
        if (first !== null) trace?.hold(first, "user");
      }}
      onMouseEnter={first !== null ? () => trace?.point(first) : undefined}
      onMouseLeave={first !== null ? () => trace?.point(null) : undefined}
      className={cn(
        "group/row outline-none",
        interactive && "cursor-pointer",
        // Drawn on the cells: WebKit paints no outline on a table row.
        "focus-visible:[&>td]:shadow-[inset_0_2px_0_var(--focus),inset_0_-2px_0_var(--focus)]",
      )}
    >
      {shown.map(({ column, companion }, position) => {
        const id = cellId(fact.ref, rowIndex, column.key);
        const citations = index.byCell.get(id) ?? [];
        const hot = traced && active?.column === column.key;
        const numeric = isNumericKind(column.kind);
        const raw = row[column.key] ?? null;
        const idColumn = named.get(column.key);
        // A person by name and picture, never by id (the id column beside it is not shown).
        const value = idColumn ? <PersonCell id={row[idColumn]} name={raw} /> : <FactValue value={raw} kind={column.kind} />;
        const described = companion ? row[companion.key] : undefined;
        return (
          <td
            key={column.key}
            data-cell={id}
            onMouseEnter={citations.length > 0 ? () => trace?.point(citations[0].marker) : undefined}
            onMouseLeave={citations.length > 0 ? () => trace?.point(first) : undefined}
            className={cn(
              "border-b border-rule-weak px-1 align-middle text-xs whitespace-nowrap transition-colors duration-100 first:pl-2",
              companion ? "py-1.5" : "h-8",
              numeric || column.kind === "issue_key" || column.key === "rule_id" ? "mono" : "text-ink",
              numeric && "text-right",
              traced ? "bg-cite-tint" : interactive && "group-hover/row:bg-hover",
              hot && "bg-cite-tint-strong text-cite-hot",
              position === 0 && traced && "shadow-[inset_2px_0_0_var(--cite)]",
            )}
          >
            <span className={cn("flex max-w-[13rem] items-baseline", numeric && "justify-end")}>
              <span
                className={cn(
                  "min-w-0 truncate",
                  // A cited value carries the same teal underline as its twin in the prose.
                  citations.length > 0 &&
                    "bg-[linear-gradient(var(--cite-line),var(--cite-line))] bg-[length:100%_1px] bg-[position:0_100%] bg-no-repeat",
                )}
                title={column.kind === "text" && typeof raw === "string" && !idColumn ? raw : undefined}
              >
                {value}
              </span>
              {citations.length > 0 ? <Markers citations={citations} hot={hot} /> : null}
            </span>
            {companion ? (
              <span
                className="mt-0.5 block max-w-[11rem] truncate font-sans text-[11px] [font-feature-settings:normal] text-ink-low"
                title={typeof described === "string" ? described : undefined}
              >
                <FactValue value={described ?? null} kind={companion.kind} />
              </span>
            ) : null}
          </td>
        );
      })}
      <td
        className={cn(
          "w-4 border-b border-rule-weak pr-0.5 text-right transition-colors duration-100",
          traced ? "bg-cite-tint" : interactive && "group-hover/row:bg-hover",
        )}
      >
        {link ? (
          <>
            <ChevronRight
              aria-hidden
              size={13}
              strokeWidth={1.75}
              className="ml-auto text-ink-low opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
            />
            <span className="sr-only">{link.label}</span>
          </>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * One fact set's rows as a compact table: typed columns, figures right-aligned
 * in mono, cited cells underlined with their markers, the traced row tinted
 * with the accent bar. A row opens where it leads (a finding's evidence, an
 * issue, an epic's findings); a wide set scrolls sideways inside the ledger.
 */
export function FactTable({ fact, index, captionId }: { fact: FactSet; index: CitationIndex; captionId: string }) {
  const body = useRef<HTMLTableSectionElement>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const shown = shownColumns(fact, index);
  const links = fact.rows.map((row) => rowLink(fact, row));
  const interactive = fact.rows.flatMap((_, row) =>
    links[row] !== null || index.byTarget.has(targetKey({ fact_ref: fact.ref, row_index: row, column: "" })) ? [row] : [],
  );
  const tabbable = focused !== null && interactive.includes(focused) ? focused : interactive[0];

  const move = (from: number, where: Move) => {
    const at = interactive.indexOf(from);
    const next =
      where === "first"
        ? interactive[0]
        : where === "last"
          ? interactive[interactive.length - 1]
          : interactive[Math.min(interactive.length - 1, Math.max(0, at + (where === "next" ? 1 : -1)))];
    body.current?.querySelector<HTMLElement>(`tr[data-row="${next}"]`)?.focus();
  };

  return (
    <ScrollArea
      axis="x"
      fade="var(--paper-100)"
      // With no row to focus, the table itself must be reachable to scroll by keyboard.
      label={interactive.length === 0 ? `${toolLabel(fact.tool)} rows (${fact.ref})` : undefined}
    >
      <table aria-labelledby={captionId} className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            {shown.map(({ column, companion }) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "border-b border-rule px-1 pb-1.5 align-bottom text-[11px] leading-tight font-medium text-ink-low first:pl-2",
                  isNumericKind(column.kind) ? "text-right" : "text-left",
                )}
              >
                {column.label}
                {companion ? <span className="sr-only"> and {companion.label}</span> : null}
              </th>
            ))}
            <th scope="col" className="w-4 border-b border-rule">
              <span className="sr-only">Opens</span>
            </th>
          </tr>
        </thead>
        <tbody ref={body}>
          {fact.rows.length === 0 ? (
            <tr>
              <td colSpan={shown.length + 1} className="h-10 px-2 text-xs text-ink-low">
                No rows: nothing matched this lookup.
              </td>
            </tr>
          ) : (
            fact.rows.map((_, rowIndex) => (
              <FactRow
                key={rowIndex}
                fact={fact}
                shown={shown}
                rowIndex={rowIndex}
                link={links[rowIndex]}
                index={index}
                tabbable={rowIndex === tabbable}
                onFocusRow={setFocused}
                onMove={move}
              />
            ))
          )}
        </tbody>
      </table>
    </ScrollArea>
  );
}
