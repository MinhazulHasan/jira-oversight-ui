"use client";

import { Check, EyeOff, Minus, MoreHorizontal, RotateCcw } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { createContext, useContext } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { iconButtonVariants } from "@/components/ui/button";
import type { Finding } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/** What is selected: rows picked on this page, or every open finding the filters match. */
export type Selection = { kind: "rows"; ids: ReadonlySet<string> } | { kind: "matching" };

export const NO_SELECTION: Selection = { kind: "rows", ids: new Set() };

/** A row an admin can act on: an open finding on a ticket (to ignore) or an ignored one (to restore). A sprint's is on no ticket. */
export function actionable(finding: Finding): boolean {
  return finding.issue_key !== null && (finding.state === "open" || finding.state === "ignored");
}

export interface RowActions {
  ignore: (finding: Finding, scope: "finding" | "ticket") => void;
  restore: (finding: Finding) => void;
}

export interface SelectionState {
  enabled: boolean;
  selection: Selection;
  rows: readonly Finding[];
  toggle: (finding: Finding) => void;
  setPage: (on: boolean) => void;
  /** The row whose actions menu is open, by finding id. */
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  actions: RowActions;
}

const NONE: SelectionState = {
  enabled: false,
  selection: NO_SELECTION,
  rows: [],
  toggle: () => undefined,
  setPage: () => undefined,
  menuFor: null,
  setMenuFor: () => undefined,
  actions: { ignore: () => undefined, restore: () => undefined },
};

const SelectionContext = createContext<SelectionState>(NONE);

export const SelectionProvider = SelectionContext.Provider;

export function useFindingSelection(): SelectionState {
  return useContext(SelectionContext);
}

export function isSelected(selection: Selection, finding: Finding): boolean {
  return selection.kind === "matching" ? actionable(finding) : selection.ids.has(finding.finding_id);
}

/** Whether the page's own rows are all, some or none of them selected. */
export function pageState(selection: Selection, rows: readonly Finding[]): "all" | "some" | "none" {
  const candidates = rows.filter(actionable);
  if (candidates.length === 0) return "none";
  const picked = candidates.filter((finding) => isSelected(selection, finding)).length;
  return picked === 0 ? "none" : picked === candidates.length ? "all" : "some";
}

const BOX =
  "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-rule-control bg-sheet transition-colors duration-150 group-hover:border-ink-low group-data-[state=checked]:border-ink group-data-[state=checked]:bg-ink group-data-[state=indeterminate]:border-ink group-data-[state=indeterminate]:bg-ink motion-reduce:transition-none";

/** A 28 px target around the 14 px box, so the press lands at any density (WCAG 2.2 target size). */
const TARGET = "group pressable -m-1.5 inline-flex size-7 items-center justify-center rounded-md hover:bg-hover";

function Box() {
  return (
    <span aria-hidden className={BOX}>
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-sheet">
        <Check size={10} strokeWidth={3} className="group-data-[state=indeterminate]:hidden" />
        <Minus size={10} strokeWidth={3} className="hidden group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </span>
  );
}

function rowName(finding: Finding): string {
  return `${finding.issue_key ?? finding.sprint?.name ?? "Sprint"}, ${finding.rule_title}`;
}

/** The page's own checkbox: every row on this page that can be acted on. */
export function PageCheckbox() {
  const { enabled, selection, rows, setPage } = useFindingSelection();
  if (!enabled) return null;
  const state = pageState(selection, rows);
  const candidates = rows.filter(actionable).length;
  return (
    <CheckboxPrimitive.Root
      checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
      onCheckedChange={(next) => setPage(next === true)}
      disabled={candidates === 0}
      aria-label="Select every finding on this page"
      data-select-page=""
      className={cn(TARGET, "disabled:pointer-events-none disabled:opacity-45")}
    >
      <Box />
    </CheckboxPrimitive.Root>
  );
}

/** A row's own checkbox. In the table the row keeps the keyboard (x or Space), so the box is no tab stop; in the list it is. */
export function RowCheckbox({ finding, tabbable = false }: { finding: Finding; tabbable?: boolean }) {
  const { enabled, selection, toggle } = useFindingSelection();
  if (!enabled || !actionable(finding)) return null;
  return (
    <CheckboxPrimitive.Root
      checked={isSelected(selection, finding)}
      onCheckedChange={() => toggle(finding)}
      tabIndex={tabbable ? undefined : -1}
      aria-label={`Select ${rowName(finding)}`}
      data-select-finding={finding.finding_id}
      className={TARGET}
    >
      <Box />
    </CheckboxPrimitive.Root>
  );
}

/** A row's actions: Ignore, Ignore every rule on this ticket, or Restore. Shift+F10 on a focused row opens it. */
export function RowMenu({ finding }: { finding: Finding }) {
  const { enabled, menuFor, setMenuFor, actions } = useFindingSelection();
  if (!enabled || !actionable(finding)) return null;
  const open = menuFor === finding.finding_id;
  return (
    <DropdownMenu open={open} onOpenChange={(next) => setMenuFor(next ? finding.finding_id : null)}>
      <DropdownMenuTrigger
        tabIndex={-1}
        aria-label={`Actions for ${rowName(finding)}`}
        aria-keyshortcuts="Shift+F10"
        data-row-menu={finding.finding_id}
        className={cn(iconButtonVariants({ variant: "ghost", size: "sm" }), "jo-row-affordance -my-1 data-[state=open]:opacity-100")}
      >
        <MoreHorizontal aria-hidden strokeWidth={1.75} />
      </DropdownMenuTrigger>
      {/* React carries a press in the menu to the row behind it: the row must not open for it. */}
      <DropdownMenuContent className="min-w-[248px]" data-row-ignore="">
        <DropdownMenuLabel className="mono normal-case tracking-normal">{finding.issue_key}</DropdownMenuLabel>
        {finding.state === "open" ? (
          <>
            <DropdownMenuItem icon={EyeOff} onSelect={() => actions.ignore(finding, "finding")} data-menu-ignore="">
              Ignore
            </DropdownMenuItem>
            <DropdownMenuItem icon={EyeOff} onSelect={() => actions.ignore(finding, "ticket")} data-menu-ignore-ticket="">
              Ignore every rule on this ticket
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem icon={RotateCcw} onSelect={() => actions.restore(finding)} data-menu-restore="">
            Restore
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** x or Space on a focused row of `table` picks it; Shift+F10 or the menu key opens its actions. The row keeps j, k and Enter. */
export function rowKeys(event: KeyboardEvent, state: SelectionState, table: Element | null): void {
  if (!state.enabled || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const row = event.target instanceof HTMLTableRowElement && table?.contains(event.target) ? event.target : null;
  if (!row) return;
  const box = row.querySelector<HTMLElement>("[data-select-finding]");
  const id = box?.dataset.selectFinding ?? row.querySelector<HTMLElement>("[data-row-menu]")?.dataset.rowMenu;
  const finding = id ? state.rows.find((candidate) => candidate.finding_id === id) : undefined;
  if (!finding) return;
  const key = event.key;
  if ((key === "x" || key === " ") && !event.shiftKey) {
    event.preventDefault();
    state.toggle(finding);
  } else if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
    event.preventDefault();
    state.setMenuFor(finding.finding_id);
  }
}
