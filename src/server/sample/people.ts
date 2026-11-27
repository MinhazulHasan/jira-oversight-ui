import { UNASSIGNED, UNASSIGNED_LABEL, type People, type PeopleDirectory, type Person, type PersonSummary } from "@/lib/api/schemas";
import { compareByFoldedName } from "@/lib/names";

import { STATUS, isWork } from "./catalogue";
import { creditMemo, creditsOf, fieldPeople, ticketsByPerson } from "./credit";
import { memo, meta, type Dataset } from "./dataset";
import type { SamplePicture } from "./pictures";
import { memberPeople, personById, personOf, pictureOfPerson } from "./team";
import type { Issue } from "./world";

/** The board's people, as GET /people and the findings' people facet list */

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** By name, case-insensitive, then by id: the order every list of people takes. */
export function compareByName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.id, b.id);
}

/** Everyone assigned at least one ticket on the board now, of any status or type, by name. */
export function boardPeople(dataset: Dataset): Person[] {
  return memo(dataset, "people:board", () => {
    const people = new Map<string, Person>();
    for (const issue of dataset.world.issues) {
      const person = personOf(issue);
      if (person) people.set(person.id, person);
    }
    return [...people.values()].sort(compareByName);
  });
}

/** Everyone with a ticket on the board: someone its work (Epics left out) counts for, as the credit rule says. */
export function workPeople(dataset: Dataset): Person[] {
  return creditMemo(dataset, "people:work", () =>
    [...ticketsByPerson(dataset).byPerson.keys()].flatMap((id) => personById(id) ?? []).sort(compareByName),
  );
}

/** Everyone on the board: whoever is assigned a ticket now or named in one of its people fields, and its members. */
export function directoryPeople(dataset: Dataset): Person[] {
  return memo(dataset, "people:directory", () => {
    const people = new Map<string, Person>(boardPeople(dataset).map((person) => [person.id, person]));
    for (const id of fieldPeople(dataset)) {
      const person = people.has(id) ? null : personById(id);
      if (person) people.set(id, person);
    }
    for (const member of memberPeople()) if (!people.has(member.id)) people.set(member.id, member);
    return [...people.values()].sort(compareByFoldedName);
  });
}

export function directoryView(dataset: Dataset): PeopleDirectory {
  return creditMemo(dataset, "people:directory:view", () => {
    const tickets = new Map(peopleView(dataset).people.flatMap((row) => (row.person ? [[row.person.id, row.tickets] as const] : [])));
    return {
      meta: meta(dataset),
      people: directoryPeople(dataset).map((person) => ({ person: { ...person }, tickets: tickets.get(person.id) ?? 0 })),
    };
  });
}

/** A person's picture as GET /people/{id}/avatar serves it: only for someone */
export function boardPicture(dataset: Dataset, personId: string): SamplePicture | null {
  return directoryPeople(dataset).some((person) => person.id === personId) ? pictureOfPerson(personId) : null;
}

/** How a row sorts by name: the unassigned row reads "Unassigned", and its id is its filter value. */
const nameOf = (row: PersonSummary) => row.person ?? { id: UNASSIGNED, name: UNASSIGNED_LABEL };

const isOpen = (issue: Issue) => STATUS[issue.status].category !== "done";

/** Whose open findings a row counts: the ticket's assignee now (GET /people, as Findings lists them), or whom the ticket counts for. */
export type FindingsBy = "assignee" | "credit";

/** The board's people and their figures, in GET /people's order: tickets by the credit rule, open findings as `findingsBy` says. */
export function peopleRows(dataset: Dataset, findingsBy: FindingsBy): PersonSummary[] {
  return creditMemo(dataset, `people:rows:${findingsBy}`, () => {
    const rows = new Map<string, PersonSummary>();
    const blank = (person: Person | null, tickets: readonly Issue[] = []): PersonSummary => ({
      person,
      tickets: tickets.length,
      open_tickets: tickets.filter(isOpen).length,
      open_breaches: 0,
      open_warnings: 0,
      tickets_with_findings: 0,
    });
    const tickets = ticketsByPerson(dataset);
    const credits = creditsOf(dataset);
    for (const person of workPeople(dataset)) rows.set(person.id, blank({ ...person }, tickets.byPerson.get(person.id)));
    if (tickets.byNobody.length > 0) rows.set(UNASSIGNED, blank(null, tickets.byNobody));
    for (const issue of dataset.world.issues) {
      if (!isWork(issue)) continue;
      const open = (dataset.engine.byIssue.get(issue.key) ?? []).filter((finding) => finding.resolvedAt === null);
      if (open.length === 0) continue;
      const holder = personOf(issue);
      const credited = (credits.get(issue.key) ?? []).map((credit) => credit.personId);
      const whom = findingsBy === "assignee" ? [holder?.id ?? UNASSIGNED] : credited.length > 0 ? credited : [UNASSIGNED];
      for (const id of whom) {
        // Someone assigned work that counts for others still has its findings here, beside no tickets.
        const row = rows.get(id) ?? blank(holder);
        rows.set(id, row);
        for (const finding of open) {
          if (finding.rule.severity === "breach") row.open_breaches += 1;
          else row.open_warnings += 1;
        }
        row.tickets_with_findings += 1;
      }
    }
    // Most open breaches first, then open warnings, then open tickets; then by name.
    return [...rows.values()].sort(
      (a, b) =>
        b.open_breaches - a.open_breaches ||
        b.open_warnings - a.open_warnings ||
        b.open_tickets - a.open_tickets ||
        compareByName(nameOf(a), nameOf(b)),
    );
  });
}

/** GET /people: open findings stay with the ticket's assignee now, so a row clicks through to Findings exactly. */
export function peopleView(dataset: Dataset): People {
  return creditMemo(dataset, "people", () => ({ meta: meta(dataset), people: peopleRows(dataset, "assignee") }));
}
