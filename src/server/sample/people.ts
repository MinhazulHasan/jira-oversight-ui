import { UNASSIGNED, UNASSIGNED_LABEL, type People, type PeopleDirectory, type Person, type PersonSummary } from "@/lib/api/schemas";
import { compareByFoldedName } from "@/lib/names";

import { STATUS, isWork } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import type { SamplePicture } from "./pictures";
import { memberPeople, personOf, pictureOfPerson } from "./team";

/*
 * The board's people, as GET /people and the findings' people facet list
 * them: everyone assigned at least one ticket now, by the name Jira gives
 * them, and the tickets nobody is assigned to. A finding counts for the
 * person its issue is assigned to now; a sprint finding counts for no one.
 * GET /people counts the board's work only (JO-12, G5): an Epic is a
 * container, so someone who holds only Epics holds none of its tickets, as
 * the scorecard and every Ask ranking count them.
 */

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

/** Everyone assigned at least one of the board's work tickets now (Epics left out), by name: GET /people's people. */
export function workPeople(dataset: Dataset): Person[] {
  return memo(dataset, "people:work", () => {
    const people = new Map<string, Person>();
    for (const issue of dataset.world.issues) {
      const person = isWork(issue) ? personOf(issue) : null;
      if (person) people.set(person.id, person);
    }
    return [...people.values()].sort(compareByName);
  });
}

/**
 * Everyone on the board (JO-10): the people assigned at least one of its
 * tickets now and the members of its last member fetch who hold none, each
 * once, by folded name. "On the board" for a picture and for Ask's mentions.
 */
export function directoryPeople(dataset: Dataset): Person[] {
  return memo(dataset, "people:directory", () => {
    const people = new Map<string, Person>(boardPeople(dataset).map((person) => [person.id, person]));
    for (const member of memberPeople()) if (!people.has(member.id)) people.set(member.id, member);
    return [...people.values()].sort(compareByFoldedName);
  });
}

/**
 * GET /people/directory: everyone on the board with the tickets assigned to
 * them now (GET /people's `tickets` for the same person, Epics left out; 0
 * for a member who holds none, and for someone who holds only Epics). No
 * Unassigned entry. What Ask's @ list offers.
 */
export function directoryView(dataset: Dataset): PeopleDirectory {
  return memo(dataset, "people:directory:view", () => {
    const tickets = new Map(peopleView(dataset).people.flatMap((row) => (row.person ? [[row.person.id, row.tickets] as const] : [])));
    return {
      meta: meta(dataset),
      people: directoryPeople(dataset).map((person) => ({ person: { ...person }, tickets: tickets.get(person.id) ?? 0 })),
    };
  });
}

/**
 * A person's picture as GET /people/{id}/avatar serves it: only for someone
 * on the board (assigned one of its tickets now, or one of its members), and
 * only when they have one.
 */
export function boardPicture(dataset: Dataset, personId: string): SamplePicture | null {
  return directoryPeople(dataset).some((person) => person.id === personId) ? pictureOfPerson(personId) : null;
}

/** How a row sorts by name: the unassigned row reads "Unassigned", and its id is its filter value. */
const nameOf = (row: PersonSummary) => row.person ?? { id: UNASSIGNED, name: UNASSIGNED_LABEL };

export function peopleView(dataset: Dataset): People {
  return memo(dataset, "people", () => {
    const rows = new Map<string, PersonSummary>();
    for (const issue of dataset.world.issues) {
      if (!isWork(issue)) continue;
      const person = personOf(issue);
      const id = person?.id ?? UNASSIGNED;
      const row = rows.get(id) ?? {
        person,
        tickets: 0,
        open_tickets: 0,
        open_breaches: 0,
        open_warnings: 0,
        tickets_with_findings: 0,
      };
      rows.set(id, row);
      row.tickets += 1;
      if (STATUS[issue.status].category !== "done") row.open_tickets += 1;
      const open = (dataset.engine.byIssue.get(issue.key) ?? []).filter((finding) => finding.resolvedAt === null);
      for (const finding of open) {
        if (finding.rule.severity === "breach") row.open_breaches += 1;
        else row.open_warnings += 1;
      }
      if (open.length > 0) row.tickets_with_findings += 1;
    }
    // Most open breaches first, then open warnings, then open tickets; then by name.
    const people = [...rows.values()].sort(
      (a, b) =>
        b.open_breaches - a.open_breaches ||
        b.open_warnings - a.open_warnings ||
        b.open_tickets - a.open_tickets ||
        compareByName(nameOf(a), nameOf(b)),
    );
    return { meta: meta(dataset), people };
  });
}
