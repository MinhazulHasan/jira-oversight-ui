"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { scorecardHref } from "@/components/people/links";
import { PersonCardHover } from "@/components/person-card/person-card-trigger";
import { usePeopleLevel } from "@/components/shell/people-level";

import { SeverityMark } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DATE_RANGE_PRESETS, DateRange } from "@/components/ui/date-range";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { SearchInput } from "@/components/ui/search-input";
import { useFigureLocale } from "@/components/ui/use-figures";
import { usePeopleDirectory } from "@/lib/api/hooks";
import { NO_EPIC } from "@/lib/api/params";
import { UNASSIGNED, UNASSIGNED_LABEL, UNNAMED_ACCOUNT, type FindingsPage } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { notify } from "@/lib/notify";

import { FacetSegments, type FacetSegment } from "./facet-segments";
import { NO_EPIC_LABEL, personFilterName } from "./model";
import {
  CLEARED_FILTERS,
  SEARCH_MAX,
  SEARCH_UPDATE,
  hasActiveFilters,
  useFilterMenu,
  type FindingsFilters,
  type SetFindingsUrl,
  type SeverityFilter,
  type StateFilter,
} from "./url-state";

type Facets = FindingsPage["facets"];

/** One toast for the filters, replaced as they change rather than stacked. */
const FILTER_TOAST = "findings-filters";

/**
 * A trigger that shows a chosen name (an epic's title, a person's name) stops
 * at a fixed width and cuts the name short. A fixed width, not a share of the
 * row: Chromium sizes the wrapping row by the whole name and ignores a
 * percentage, so a long name would widen the page on a phone. 17rem fits the
 * narrowest screen (390 px less its gutters).
 */
const NAMED_TRIGGER = "max-w-[17rem]";

function acknowledge(description: string) {
  notify.info("Filter applied", { description, id: FILTER_TOAST });
}

/**
 * Every filter back to its default (the sort is kept), and said so. The
 * control that asked goes away with the filters, so focus moves to the page
 * search, where a fresh view starts, rather than falling to the page.
 */
export function clearFilters(setFilters: SetFindingsUrl) {
  void setFilters(CLEARED_FILTERS);
  notify.info("Filters cleared", { description: "Showing every open finding.", id: FILTER_TOAST });
  document.querySelector<HTMLInputElement>("input[data-page-search]")?.focus();
}

const countOf = (entries: Facets["severity"] | undefined, value: string) =>
  entries?.find((entry) => entry.value === value)?.count;

const sum = (...values: (number | undefined)[]) =>
  values.some((value) => value === undefined) ? undefined : values.reduce<number>((total, value) => total + (value ?? 0), 0);

/**
 * The Person menu's choices: everyone assigned a ticket on the board now, by
 * name with their Jira picture (or initials), with what each would show,
 * then Unassigned last. A person in the URL whom the board does not list (a
 * link from another board) stays choosable, named plainly rather than by
 * their id, and drawn as an account with no name.
 */
export function personOptions(entries: Facets["people"] | undefined, chosen: readonly string[], locale?: string): ComboboxOption[] {
  const people = (entries ?? []).filter((entry) => entry.value !== UNASSIGNED);
  const unassigned = entries?.find((entry) => entry.value === UNASSIGNED);
  const listed = new Set((entries ?? []).map((entry) => entry.value));
  const missing = chosen.filter((value) => !listed.has(value) && value !== UNASSIGNED);
  return [
    ...people.map((entry) => ({
      value: entry.value,
      label: entry.label,
      hint: formatCount(entry.count, { locale }),
      leading: <PersonAvatar person={{ id: entry.value, name: entry.label, avatar: entry.avatar }} />,
    })),
    ...missing.map((value) => ({
      value,
      label: entries === undefined ? "Loading" : "Not on this board",
      description: entries === undefined ? undefined : "Assigned nothing on this board",
      hint: entries === undefined ? undefined : formatCount(0, { locale }),
      leading: <PersonAvatar person={{ id: value, name: UNNAMED_ACCOUNT, avatar: null }} />,
    })),
    ...(unassigned || chosen.includes(UNASSIGNED)
      ? [
          {
            value: UNASSIGNED,
            label: UNASSIGNED_LABEL,
            // No second line: the word says it, and one line a row keeps a board's people in view without scrolling.
            hint: unassigned ? formatCount(unassigned.count, { locale }) : undefined,
            keywords: ["nobody", "no assignee"],
            leading: <PersonAvatar person={null} />,
          },
        ]
      : []),
  ];
}

export interface FilterBarProps {
  filters: FindingsFilters;
  setFilters: SetFindingsUrl;
  /** The facet counts of the list on screen; undefined until it first loads. */
  facets: Facets | undefined;
}

/**
 * The one filter row above the list: the page search (`/` focuses it), then
 * severity and state with the number each would show, then rule, epic,
 * person and first seen, and Clear once anything is set. Every change goes to the URL
 * and resets to the first page.
 */
export function FilterBar({ filters, setFilters, facets }: FilterBarProps) {
  const locale = useFigureLocale();
  const pending = facets === undefined;
  // ?menu=person (the Overview's "All people") opens the Person menu on arrival.
  const [menu, setMenu] = useFilterMenu();
  // Null until the menu is opened or closed by hand; until then the address decides.
  const [personMenu, setPersonMenu] = useState<boolean | null>(null);
  const personMenuOpen = personMenu ?? menu === "person";
  // At people level, one person (not the unassigned tickets) chosen: the way to their scorecard.
  const peopleLevel = usePeopleLevel();
  const scorecardFor = peopleLevel && filters.person.length === 1 && filters.person[0] !== UNASSIGNED ? filters.person[0] : null;
  // Whose scorecard the link opens, by name: the board's directory knows everyone on it (members with no tickets too),
  // whether or not the findings have loaded; until it answers, the link names no one rather than someone wrongly.
  const directory = usePeopleDirectory({ enabled: scorecardFor !== null });
  const scorecardName = scorecardFor
    ? (directory.data?.people.find((entry) => entry.person.id === scorecardFor)?.person.name ??
      facets?.people?.find((entry) => entry.value === scorecardFor)?.label ??
      null)
    : null;
  // The one person chosen, as the board names them: resting on their name in the Person filter opens their card (JO-13).
  const chosenFacet = scorecardFor ? facets?.people?.find((entry) => entry.value === scorecardFor) : undefined;
  const chosenPerson = scorecardFor
    ? (directory.data?.people.find((entry) => entry.person.id === scorecardFor)?.person ??
      (chosenFacet ? { id: chosenFacet.value, name: chosenFacet.label, avatar: chosenFacet.avatar } : null))
    : null;

  const ruleOptions = useMemo<ComboboxOption[]>(
    () =>
      (facets?.rules ?? []).map((entry) => ({
        value: entry.value,
        label: entry.value,
        description: entry.label,
        hint: formatCount(entry.count, { locale }),
        keywords: [entry.label],
        mono: true,
      })),
    [facets?.rules, locale],
  );

  const epicOptions = useMemo<ComboboxOption[]>(
    () =>
      (facets?.epics ?? []).map((entry) =>
        entry.value === NO_EPIC
          ? {
              value: NO_EPIC,
              label: NO_EPIC_LABEL,
              description: "Work outside every epic, and sprint findings",
              hint: formatCount(entry.count, { locale }),
              keywords: ["none", "no epic"],
            }
          : {
              value: entry.value,
              label: entry.label,
              description: entry.value,
              hint: formatCount(entry.count, { locale }),
              keywords: [entry.value],
            },
      ),
    [facets?.epics, locale],
  );

  const peopleOptions = useMemo(
    () => personOptions(facets?.people, filters.person, locale),
    [facets?.people, filters.person, locale],
  );

  const breaches = countOf(facets?.severity, "breach");
  const warnings = countOf(facets?.severity, "warning");
  const open = countOf(facets?.state, "open");
  const resolved = countOf(facets?.state, "resolved");

  const severityOptions: FacetSegment<"all" | SeverityFilter>[] = [
    { value: "all", label: "All", count: sum(breaches, warnings) },
    { value: "breach", label: "Breach", count: breaches, mark: <SeverityMark severity="breach" size={8} /> },
    { value: "warning", label: "Warning", count: warnings, mark: <SeverityMark severity="warning" size={8} /> },
  ];
  const stateOptions: FacetSegment<StateFilter>[] = [
    { value: "open", label: "Open", count: open },
    { value: "resolved", label: "Resolved", count: resolved },
    { value: "all", label: "All", count: sum(open, resolved) },
  ];

  const epicName = (value: string) => epicOptions.find((option) => option.value === value)?.label ?? value;
  const active = hasActiveFilters(filters);

  return (
    <div role="search" aria-label="Filter findings" data-print="hide" className="flex flex-wrap items-center gap-2">
      <SearchInput
        label="Search findings"
        placeholder="Search key or summary"
        value={filters.q}
        maxLength={SEARCH_MAX}
        onValueChange={(value) => void setFilters({ q: value === "" ? null : value, page: null }, SEARCH_UPDATE)}
        className="min-w-[13rem] flex-1 sm:max-w-[28rem]"
      />

      <div className="flex flex-wrap items-center gap-2">
        <FacetSegments
          label="Severity"
          options={severityOptions}
          value={filters.severity ?? "all"}
          pending={pending}
          onValueChange={(next) => {
            void setFilters({ severity: next === "all" ? null : next, page: null });
            acknowledge(`Severity: ${severityOptions.find((option) => option.value === next)?.label ?? next}`);
          }}
        />
        <FacetSegments
          label="State"
          options={stateOptions}
          value={filters.state}
          pending={pending}
          onValueChange={(next) => {
            void setFilters({ state: next === "open" ? null : next, page: null });
            acknowledge(next === "all" ? "State: open and resolved" : `State: ${next}`);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          label="Rule"
          options={ruleOptions}
          value={filters.rule}
          searchPlaceholder="Search rule id or title"
          emptyText={pending ? "Loading the rules…" : "No rule matches that."}
          onValueChange={(next) => {
            void setFilters({ rule: next.length > 0 ? next : null, page: null });
            acknowledge(next.length > 0 ? `Rule: ${next.join(", ")}` : "Rule: any");
          }}
        />
        <Combobox
          label="Epic"
          options={epicOptions}
          value={filters.epic}
          searchPlaceholder="Search epic name or key"
          emptyText={pending ? "Loading the epics…" : "No epic matches that."}
          onValueChange={(next) => {
            void setFilters({ epic: next.length > 0 ? next : null, page: null });
            acknowledge(next.length > 0 ? `Epic: ${next.map(epicName).join(", ")}` : "Epic: any");
          }}
          className={NAMED_TRIGGER}
        />
        <Combobox
          label="Person"
          options={peopleOptions}
          value={filters.person}
          searchPlaceholder="Search people"
          emptyText={pending ? "Loading the people…" : "No one by that name has work on this board."}
          open={personMenuOpen}
          onOpenChange={(next) => {
            setPersonMenu(next);
            // Once closed, the address stops asking for it, so a copied link opens no menu.
            if (!next && menu !== null) void setMenu(null);
          }}
          onValueChange={(next) => {
            void setFilters({ person: next.length > 0 ? next : null, page: null });
            const names = next.map((value) => personFilterName(value, facets?.people));
            acknowledge(next.length > 0 ? `Person: ${names.join(", ")}` : "Person: any");
          }}
          renderValue={
            chosenPerson
              ? (text) => (
                  // The press is the filter's (it opens the Person menu); resting on the name shows their card,
                  // but never over the open menu.
                  <PersonCardHover person={chosenPerson} disabled={personMenuOpen}>
                    <span data-person-filter-name>{text}</span>
                  </PersonCardHover>
                )
              : undefined
          }
          className={NAMED_TRIGGER}
        />
        {scorecardFor ? (
          // People level, one person chosen: their scorecard is a step away (JO-11).
          <Button asChild variant="ghost" size="sm" className="-ml-1">
            <Link href={scorecardHref(scorecardFor)} data-print="hide">
              {"View scorecard "}
              {/* The name from the board's directory, which knows everyone on it: never "someone not on this board"
                  while the findings load, or when they fail. */}
              <span className="sr-only">{scorecardName ? `of ${scorecardName}` : ""}</span>
              <ArrowRight aria-hidden strokeWidth={1.75} />
            </Link>
          </Button>
        ) : null}
        <DateRange
          label="First seen"
          value={filters.first_seen}
          onValueChange={(next) => {
            void setFilters({ first_seen: next === "all" ? null : next, page: null });
            const preset = DATE_RANGE_PRESETS.find((option) => option.value === next);
            acknowledge(`First seen: ${preset?.label.toLowerCase() ?? next}`);
          }}
        />
        {active ? (
          <Button
            variant="ghost"
            icon={X}
            aria-label="Clear filters"
            onClick={() => clearFilters(setFilters)}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
