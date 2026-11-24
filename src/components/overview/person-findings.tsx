"use client";

import type { ReactNode } from "react";

import { ChartFrame, type ChartState } from "@/components/charts/chart-frame";
import type { ChartTableData } from "@/components/charts/chart-table";
import { Legend } from "@/components/charts/legend";
import { PEOPLE_PAGE } from "@/components/people/links";
import { usePeopleLevel } from "@/components/shell/people-level";
import { StackedBarList, stackedBarTable, type StackedBarItem } from "@/components/charts/stacked-bar-list";
import { NAME_TRIGGER, PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { NameText } from "@/components/ui/person-name";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ApiError } from "@/lib/api/client";
import { UNASSIGNED, UNASSIGNED_LABEL, type People, type PersonSummary } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { counted } from "./copy";
import { PEOPLE_HREF, personHref } from "./links";
import { SectionLink } from "./section-link";

/** One 32 px line per person where the panel is wide; where it is narrow the name sits over its bar and rows grow. */
const ROW_HEIGHT = 32;
/** The panel shows the first eight as the API ranks them; the Person menu on Findings lists everyone. */
export const MAX_PEOPLE = 8;

const LEGEND = [
  { id: "breach", label: "Breaches", severity: "breach" as const },
  { id: "warning", label: "Warnings", severity: "warning" as const },
];

/** A row's name: the person's Jira display name, or "Unassigned" for the tickets nobody has. */
export function personName(row: Pick<PersonSummary, "person">): string {
  return row.person?.name ?? UNASSIGNED_LABEL;
}

const open = (row: PersonSummary) => row.open_breaches + row.open_warnings;

export function topPeople(rows: readonly PersonSummary[], max = MAX_PEOPLE): PersonSummary[] {
  // Only people with something open: a row of 0 breaches and 0 warnings informs no one (SQA: four of eight rows did).
  const holding = rows.filter((row) => open(row) > 0);
  const top = holding.slice(0, max);
  const unassigned = holding.slice(max).find((row) => row.person === null);
  return unassigned ? [...top, unassigned] : top;
}

export function personItems(rows: readonly PersonSummary[], { cards = false }: { cards?: boolean } = {}): StackedBarItem[] {
  return rows.map((row) => {
    const person = row.person;
    return {
      id: person?.id ?? UNASSIGNED,
      label: personName(row),
      // Their Jira picture or initials; the unassigned tickets' row a generic figure, so the names stay in line.
      leading: <PersonAvatar person={person} />,
      muted: person === null,
      values: { breach: row.open_breaches, warning: row.open_warnings },
      href: personHref(person),
      // At people level a person's picture and name open their card; the rest of the row, their open findings.
      wrapLabel:
        cards && person
          ? (label) => (
              <PersonCardTrigger
                person={person}
                className={cn(NAME_TRIGGER, "relative z-[1] -my-0.5 min-h-6 items-center gap-2")}
                // The row's tooltip (its breaches and warnings) is the bar's: over the name, the card speaks instead.
                onPointerMove={(event) => event.stopPropagation()}
              >
                {label}
              </PersonCardTrigger>
            )
          : undefined,
    };
  });
}

function personCell(person: NonNullable<PersonSummary["person"]>): ReactNode {
  return (
    <PersonCardTrigger person={person} className={cn(NAME_TRIGGER, "-my-0.5 min-h-6 gap-2")}>
      <PersonAvatar person={person} />
      <NameText name={person.name} className="normal-nums" />
    </PersonCardTrigger>
  );
}

function personTable(rows: readonly PersonSummary[], locale: string | undefined, { cards = false }: { cards?: boolean } = {}): ChartTableData {
  const base = stackedBarTable(personItems(rows), { category: "Person", locale });
  return {
    // "Not done" and "open findings" say what each counts: a done ticket can still carry an open finding.
    columns: [
      ...base.columns,
      { header: "Tickets not done", numeric: true },
      { header: "Tickets with open findings", numeric: true },
    ],
    rows: base.rows.map(([category, ...cells], index) => {
      const person = rows[index].person;
      return [
        cards && person ? personCell(person) : category,
        ...cells,
        formatCount(rows[index].open_tickets, { locale }),
        formatCount(rows[index].tickets_with_findings, { locale }),
      ];
    }),
  };
}

function summarise(rows: readonly PersonSummary[], locale: string | undefined): string {
  const lead = rows[0];
  const who = lead.person ? lead.person.name : "The unassigned tickets";
  const verb = lead.person ? "leads" : "lead";
  return `${who} ${verb}, with ${counted(lead.open_breaches, "open breach", "open breaches", locale)} and ${counted(lead.open_warnings, "open warning", "open warnings", locale)} on ${counted(lead.tickets_with_findings, "ticket", "tickets", locale)}.`;
}

export interface PersonFindingsProps {
  /** GET /people; undefined until it first answers. */
  data?: People;
  error?: ApiError | null;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function PersonFindings({ data, error, onRetry, retrying, className }: PersonFindingsProps) {
  const locale = useFigureLocale();
  // People level (an admin, or sign-in off): each person's scorecard is a step away, on the People page.
  const peopleLevel = usePeopleLevel();
  const rows = data?.people ?? [];
  const shown = topPeople(rows);
  const projects = data?.meta.projects.join(", ") ?? "";
  const state: ChartState = !data
    ? error
      ? "error"
      : "loading"
    : rows.some((row) => open(row) > 0)
      ? "ready"
      : "empty";

  const named = rows.filter((row) => row.person !== null && open(row) > 0).length;
  const namedShown = shown.filter((row) => row.person !== null).length;
  const appended = shown.length > MAX_PEOPLE;

  // "Top eight" only when someone is left out; the unassigned row is never the one.
  const truncated = namedShown < named;
  const description = truncated
    ? `Top eight, most breaches first${appended ? ", then unassigned" : ""}`
    : "Most breaches first";

  const footnote =
    state === "ready"
      ? `${truncated ? `Showing ${formatCount(namedShown, { locale })} of ${formatCount(named, { locale })} people. ` : ""}Issue findings only.`
      : undefined;

  return (
    <Section
      id="people"
      title="People"
      actions={
        <>
          {peopleLevel ? <SectionLink href={PEOPLE_PAGE}>View scorecards</SectionLink> : null}
          <SectionLink href={PEOPLE_HREF}>All people</SectionLink>
        </>
      }
      className={className}
    >
      <ChartFrame
        title="Open findings by person"
        description={description}
        summary={
          state === "ready"
            ? summarise(shown, locale)
            : state === "empty"
              ? `No open findings on anyone's tickets in ${projects}.`
              : state === "error"
                ? "The people could not be loaded."
                : "Loading the people."
        }
        legend={<Legend items={LEGEND} />}
        table={state === "ready" ? personTable(shown, locale, { cards: peopleLevel }) : undefined}
        state={state}
        loadingShape="bars"
        height={ROW_HEIGHT * (state === "ready" ? shown.length : MAX_PEOPLE)}
        emptyTitle={rows.length === 0 ? "No tickets are assigned" : "No open findings on anyone's work"}
        errorTitle="Couldn't load the people"
        errorDetail={error ? `${error.status > 0 ? `HTTP ${error.status} · ` : ""}${error.code}` : undefined}
        onRetry={onRetry}
        retrying={retrying}
        footnote={footnote}
      >
        <StackedBarList items={personItems(shown, { cards: peopleLevel })} title="Open findings by person" />
      </ChartFrame>
    </Section>
  );
}
