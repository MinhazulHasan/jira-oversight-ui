"use client";

import { createContext, Fragment, useContext, type ReactNode } from "react";

import { NAME_TRIGGER, PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { NameText } from "@/components/ui/person-name";
import { PERSON_ID_PATTERN, UNASSIGNED_LABEL, type AskResponse, type DirectoryEntry, type FactSet, type Person } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/** A person id as it stands in text: a query's WHERE clause, a list of ids. */
const ID_IN_TEXT = /\bp[0-9a-f]{12}\b/g;

export type ResolvePerson = (id: string) => Person | null;

const AskPeopleContext = createContext<ResolvePerson>(() => null);

export function AskPeopleProvider({ resolve, children }: { resolve: ResolvePerson; children: ReactNode }) {
  return <AskPeopleContext.Provider value={resolve}>{children}</AskPeopleContext.Provider>;
}

export function useResolvePerson(): ResolvePerson {
  return useContext(AskPeopleContext);
}

/** The id columns facts carry, each beside the column that names the same person. */
export const PERSON_ID_COLUMNS: Readonly<Record<string, string>> = { person_id: "name", assignee_id: "assignee" };

export function peopleIndex(response: Pick<AskResponse, "facts" | "people"> | null, directory: readonly DirectoryEntry[] | undefined): Map<string, Person> {
  const index = new Map<string, Person>();
  for (const entry of directory ?? []) index.set(entry.person.id, entry.person);
  for (const person of response?.people ?? []) if (!index.has(person.id)) index.set(person.id, person);
  for (const fact of response?.facts ?? []) {
    for (const row of fact.rows) {
      for (const [idColumn, nameColumn] of Object.entries(PERSON_ID_COLUMNS)) {
        const id = row[idColumn];
        const name = row[nameColumn];
        if (typeof id === "string" && PERSON_ID_PATTERN.test(id) && typeof name === "string" && name && !index.has(id)) {
          index.set(id, { id, name, avatar: null });
        }
      }
    }
  }
  return index;
}

/** Ids in a text written as names, for a line that holds only text (a tooltip, a copied call): "@Ada Brooks". */
export function namesForIds(text: string, resolve: ResolvePerson): string {
  return text.replace(ID_IN_TEXT, (id) => {
    const person = resolve(id);
    return person ? `@${person.name}` : "someone on the board";
  });
}

/** A person where an id stood: the 20 px picture and the name, as a line of text shows them. */
export function PersonInline({ person, className }: { person: Person | null; className?: string }) {
  if (person === null) return <span className={cn("text-ink-low", className)}>someone on the board</span>;
  return (
    <span className={cn("inline-flex max-w-[14rem] items-center gap-1.5 align-middle", className)}>
      <PersonAvatar person={person} />
      <NameText name={person.name} className="min-w-0 truncate font-sans text-ink normal-nums" />
    </span>
  );
}

/** Text with every person id in it shown as the person, picture and name: a query's WHERE clause, say. */
export function WithPeople({ text }: { text: string }) {
  const resolve = useResolvePerson();
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(ID_IN_TEXT)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<PersonInline key={`${match.index}`} person={resolve(match[0])} />);
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

export function PersonCell({ id, name }: { id: unknown; name: unknown }) {
  const resolve = useResolvePerson();
  if (typeof id === "string" && PERSON_ID_PATTERN.test(id)) {
    const person = resolve(id) ?? (typeof name === "string" && name ? { id, name, avatar: null } : null);
    if (person === null) return <PersonInline person={null} />;
    return (
      <PersonCardTrigger person={person} inRow tabbable={false} className={cn(NAME_TRIGGER, "max-w-[14rem]")}>
        <PersonInline person={person} />
      </PersonCardTrigger>
    );
  }
  if (name === UNASSIGNED_LABEL) {
    return (
      <span className="inline-flex items-center gap-1.5 align-middle">
        <PersonAvatar person={null} />
        <span className="text-ink-low">{UNASSIGNED_LABEL}</span>
      </span>
    );
  }
  // A row of no one's that is not the unassigned tickets: the whole board, say. Its name as written.
  return <span className="text-ink-mid">{typeof name === "string" && name ? name : "—"}</span>;
}

/** Which columns of a fact set name people: shown columns to the id column beside them, and the id columns to hide. */
export function personColumnsOf(fact: Pick<FactSet, "columns">): { named: Map<string, string>; hidden: Set<string> } {
  const keys = new Set(fact.columns.map((column) => column.key));
  const named = new Map<string, string>();
  const hidden = new Set<string>();
  for (const [idColumn, nameColumn] of Object.entries(PERSON_ID_COLUMNS)) {
    if (!keys.has(idColumn)) continue;
    if (keys.has(nameColumn)) {
      // The name column shows the person; the id beside it never shows.
      named.set(nameColumn, idColumn);
      hidden.add(idColumn);
    } else {
      // An id with no name beside it shows as the person it is.
      named.set(idColumn, idColumn);
    }
  }
  return { named, hidden };
}
