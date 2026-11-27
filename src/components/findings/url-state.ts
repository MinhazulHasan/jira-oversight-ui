"use client";

import {
  createParser,
  debounce,
  parseAsInteger,
  parseAsNativeArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  useQueryStates,
  type Options,
} from "nuqs";
import { useEffect, useState } from "react";

import {
  FINDING_STATES,
  FINDINGS_SORTS,
  FIRST_SEEN_WINDOWS,
  NO_EPIC,
  TICKET_STATES,
  type FindingsQueryInput,
} from "@/lib/api/params";
import { canonicalIgnoreQuery, type IgnoreQuery } from "@/lib/api/ignores";
import { FINDING_ID_PATTERN, ISSUE_KEY_PATTERN, PERSON_ID_PATTERN, RULE_ID_PATTERN, UNASSIGNED } from "@/lib/api/schemas";

export const SEVERITY_FILTERS = ["breach", "warning"] as const;
export type SeverityFilter = (typeof SEVERITY_FILTERS)[number];
export type StateFilter = (typeof FINDING_STATES)[number];
export type FirstSeenFilter = (typeof FIRST_SEEN_WINDOWS)[number];
export type TicketFilter = (typeof TICKET_STATES)[number];
export type FindingsSort = (typeof FINDINGS_SORTS)[number];

const ORDERS = ["asc", "desc"] as const;

/** What the API accepts (src/lib/api/params.ts); more is trimmed, never sent. */
export const SEARCH_MAX = 100;
const MAX_RULES = 24;
const MAX_EPICS = 50;
const MAX_PEOPLE = 50;
const MAX_PAGE = 10_000;
/** Typing settles for this long before the list is asked again. */
export const SEARCH_DEBOUNCE_MS = 300;

const ruleIdParser = createParser({
  parse: (value: string) => {
    const id = value.trim().toUpperCase();
    return RULE_ID_PATTERN.test(id) ? id : null;
  },
  serialize: (value: string) => value,
});

/** An epic key, any case, or "none" for findings outside every epic. */
const epicParser = createParser({
  parse: (value: string) => {
    const text = value.trim();
    if (text.toLowerCase() === NO_EPIC) return NO_EPIC;
    const key = text.toUpperCase();
    return ISSUE_KEY_PATTERN.test(key) ? key : null;
  },
  serialize: (value: string) => value,
});

/** A person id ("p" and 12 hex digits, any case), or "unassigned" for tickets nobody is assigned to. */
const personParser = createParser({
  parse: (value: string) => {
    const text = value.trim().toLowerCase();
    return text === UNASSIGNED || PERSON_ID_PATTERN.test(text) ? text : null;
  },
  serialize: (value: string) => value,
});

export const FILTER_MENUS = ["person"] as const;

export function useFilterMenu() {
  return useQueryState("menu", parseAsStringLiteral(FILTER_MENUS).withOptions({ history: "replace" }));
}

export const findingsUrlParsers = {
  q: parseAsString.withDefault(""),
  severity: parseAsStringLiteral(SEVERITY_FILTERS),
  state: parseAsStringLiteral(FINDING_STATES).withDefault("open"),
  rule: parseAsNativeArrayOf(ruleIdParser),
  epic: parseAsNativeArrayOf(epicParser),
  person: parseAsNativeArrayOf(personParser),
  first_seen: parseAsStringLiteral(FIRST_SEEN_WINDOWS).withDefault("all"),
  ticket: parseAsStringLiteral(TICKET_STATES),
  sort: parseAsStringLiteral(FINDINGS_SORTS).withDefault("first_seen_at"),
  order: parseAsStringLiteral(ORDERS).withDefault("desc"),
  page: parseAsInteger.withDefault(1),
};

export interface FindingsFilters {
  q: string;
  severity: SeverityFilter | null;
  state: StateFilter;
  rule: string[];
  epic: string[];
  /** Person ids and "unassigned", by the issue's assignee now. */
  person: string[];
  first_seen: FirstSeenFilter;
  /** Findings on open or on finished tickets, by the ticket's status now; null (or left out) for any. */
  ticket?: TicketFilter | null;
  sort: FindingsSort;
  order: "asc" | "desc";
  page: number;
}

/** Every change is a step in the browser's history, so Back and Forward walk the views. */
const PUSH: Options = { history: "push" };
/** Search writes once typing pauses: one history step per search, not per key. */
export const SEARCH_UPDATE: Options = { history: "push", limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) };

export function useFindingsUrl() {
  return useQueryStates(findingsUrlParsers, PUSH);
}

export type SetFindingsUrl = ReturnType<typeof useFindingsUrl>[1];

/** The filter keys reset to their defaults, the sort kept. */
export const CLEARED_FILTERS = {
  q: null,
  severity: null,
  state: null,
  rule: null,
  epic: null,
  person: null,
  first_seen: null,
  ticket: null,
  page: null,
} as const;

/** True when anything narrows the list beyond the default (open findings, any age). */
export function hasActiveFilters(filters: FindingsFilters): boolean {
  return (
    filters.q.trim() !== "" ||
    filters.severity !== null ||
    filters.state !== "open" ||
    filters.rule.length > 0 ||
    filters.epic.length > 0 ||
    filters.person.length > 0 ||
    filters.first_seen !== "all" ||
    (filters.ticket ?? null) !== null
  );
}

/** The API query for the URL's filters, clamped to what the API accepts. */
export function toFindingsQuery(filters: FindingsFilters, search: string = filters.q): FindingsQueryInput {
  const q = search.trim().slice(0, SEARCH_MAX);
  return {
    rule: filters.rule.slice(0, MAX_RULES),
    epic: filters.epic.slice(0, MAX_EPICS),
    person: filters.person.slice(0, MAX_PEOPLE),
    severity: filters.severity ?? undefined,
    state: filters.state,
    q: q === "" ? undefined : q,
    first_seen: filters.first_seen,
    ticket: filters.ticket ?? undefined,
    sort: filters.sort,
    order: filters.order,
    page: Math.min(MAX_PAGE, Math.max(1, Math.trunc(filters.page) || 1)),
  };
}

/** Every open finding the filters match, as an ignore's target names them (the service resolves them as it ignores). */
export function ignoreQueryOf(filters: FindingsFilters, search: string = filters.q): IgnoreQuery {
  const query = toFindingsQuery(filters, search);
  return canonicalIgnoreQuery({
    rule: query.rule,
    severity: query.severity,
    epic: query.epic,
    person: query.person,
    q: query.q,
    first_seen: query.first_seen,
    ticket: query.ticket,
  });
}

export function useOpenFinding() {
  return useQueryState("finding", parseAsString.withOptions({ history: "push" }));
}

/** A finding id as the API writes it, or null when the text cannot be one. */
export function normaliseFindingId(value: string | null): string | null {
  if (value === null) return null;
  const id = value.trim().toLowerCase();
  return FINDING_ID_PATTERN.test(id) ? id : null;
}

/** The value, once it has stopped changing for `delay` ms. */
export function useSettledValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
