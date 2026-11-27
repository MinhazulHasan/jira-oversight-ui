import type { CreditBasis, CreditField, CreditSource } from "@/lib/api/schemas";
import { foldText } from "@/lib/names";

import { isWork } from "./catalogue";
import { creditChoiceOf, type CreditChoice } from "./credit-store";
import { memo, type Dataset } from "./dataset";
import { createRng } from "./random";
import { personIdFor, TEAM } from "./team";
import type { Issue, World } from "./world";

/** Whom a ticket counts for, and why: `field` is the Jira field's name exactly when the basis is "field". */
export interface Credit {
  personId: string;
  basis: CreditBasis;
  field: string | null;
}

/** The people-type fields the sample's site has, as config/fields.yaml lists the real site's. */
export const SITE_PEOPLE_FIELDS: readonly CreditField[] = [
  { key: "programmer", name: "Programmer" },
  { key: "code_reviewers", name: "Code Reviewers" },
  { key: "testers", name: "Testers" },
  { key: "test_reviewers", name: "Test Reviewers" },
];

/** The field Automatic reads first, where the site has it. */
export const PROGRAMMER = "programmer";

/** The people field a choice reads, or null when it reads none (Assignee; Automatic on a site without Programmer). */
export function stepOneField(choice: { source: CreditSource; field: string | null }, site: readonly CreditField[] = SITE_PEOPLE_FIELDS): CreditField | null {
  if (choice.source === "assignee") return null;
  const key = choice.source === "auto" ? PROGRAMMER : choice.field;
  return site.find((field) => field.key === key) ?? null;
}

/* ------------------------------------------------------------ the rule -- */

/** A ticket as the credit rule reads it: its assignee now, and its people fields now. */
export interface CreditTicket {
  assignee: string | null;
  /** Person ids in each people field filled now, by the field's key. */
  fields: Readonly<Record<string, readonly string[]>>;
}

/** Whom the ticket counts for: everyone in the chosen field, the assignee, or Automatic's Programmer where it is filled and the assignee otherwise; [] is no one. */
export function countsFor(ticket: CreditTicket, choice: CreditChoice, site: readonly CreditField[] = SITE_PEOPLE_FIELDS): Credit[] {
  const field = stepOneField(choice, site);
  if (field !== null) {
    const people = [...new Set(ticket.fields[field.key] ?? [])];
    if (people.length > 0) return people.map((personId) => ({ personId, basis: "field", field: field.name }));
  }
  if (choice.source === "field" || ticket.assignee === null) return [];
  return [{ personId: ticket.assignee, basis: "assignee_now", field: null }];
}

/* -------------------------------------------------------- the sample's -- */

/** The share of a board's work each people field is filled on: MOB fills Programmer and Testers; DEMO and HELP none, as AILED. */
const FILLED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  MOB: { programmer: 0.62, testers: 0.45 },
};

const ids = new Map<string, string>();
const idOf = (accountId: string) => ids.get(accountId) ?? ids.set(accountId, personIdFor(accountId)).get(accountId)!;

/** Who tests: two of the team test most of MOB's work, as a team's testers do. */
const TESTERS = TEAM.map((member) => [member.accountId, member.accountId === "acc-05" || member.accountId === "acc-08" ? 6 : 1] as const);

const fieldsByWorld = new WeakMap<World, ReadonlyMap<string, Readonly<Record<string, readonly string[]>>>>();

/** The people fields filled on each of the board's work tickets now, by key: each drawn from its own stream, so nothing else moves. */
export function peopleFields(world: World): ReadonlyMap<string, Readonly<Record<string, readonly string[]>>> {
  const known = fieldsByWorld.get(world);
  if (known) return known;
  const rates = FILLED[world.board.key] ?? {};
  const filled = new Map<string, Record<string, string[]>>();
  const team = TEAM.map((member) => member.accountId);
  for (const issue of world.issues) {
    if (!isWork(issue)) continue;
    const fields: Record<string, string[]> = {};
    const owner = issue.assigneeAccountId;
    if (rates.programmer !== undefined && issue.startedAt !== null) {
      const rng = createRng(world.board.seed, `programmer:${issue.num}`);
      if (rng.chance(rates.programmer)) {
        const other = rng.pick(team.filter((account) => account !== owner));
        const roll = rng.next();
        // Mostly whoever holds it; sometimes a pair, sometimes the one who wrote it before handing it on.
        fields.programmer = owner === null || roll < 0.1 ? [other] : roll < 0.3 ? [owner, other] : [owner];
      }
    }
    if (rates.testers !== undefined && issue.doneAt !== null) {
      const rng = createRng(world.board.seed, `testers:${issue.num}`);
      if (rng.chance(rates.testers)) {
        const pool = TESTERS.filter(([account]) => account !== owner);
        fields.testers = [rng.weighted(pool)];
      }
    }
    if (Object.keys(fields).length > 0) filled.set(issue.key, Object.fromEntries(Object.entries(fields).map(([key, accounts]) => [key, accounts.map(idOf)])));
  }
  fieldsByWorld.set(world, filled);
  return filled;
}

const NO_FIELDS: Readonly<Record<string, readonly string[]>> = {};

/** A sample ticket as the rule reads it. */
export function creditTicket(issue: Issue, fields: Readonly<Record<string, readonly string[]>> = NO_FIELDS): CreditTicket {
  return { assignee: issue.assigneeAccountId === null ? null : idOf(issue.assigneeAccountId), fields };
}

/** The choice the board's credit follows now (its file's, or an admin's since). */
export function creditChoice(dataset: Dataset): CreditChoice {
  return creditChoiceOf(dataset.board.key);
}

const choiceKey = (choice: CreditChoice) => `${choice.source}:${choice.field ?? ""}`;

/** A view that follows the board's credit setting: worked out once per choice, so a change shows at once. */
export function creditMemo<T>(dataset: Dataset, key: string, compute: () => T): T {
  return memo(dataset, `${key}@credit:${choiceKey(creditChoice(dataset))}`, compute);
}

/** Whom each of the board's work tickets counts for under a choice (the board's own by default), by key. */
export function creditsOf(dataset: Dataset, choice: CreditChoice = creditChoice(dataset)): ReadonlyMap<string, readonly Credit[]> {
  const compute = () => {
    const fields = peopleFields(dataset.world);
    const credits = new Map<string, readonly Credit[]>();
    for (const issue of dataset.world.issues) {
      if (isWork(issue)) credits.set(issue.key, countsFor(creditTicket(issue, fields.get(issue.key)), choice));
    }
    return credits;
  };
  return memo(dataset, `credits:${choiceKey(choice)}`, compute);
}

/** Each person's tickets (the board's work that counts for them), by person id, and the work that counts for no one. */
export interface TicketsByPerson {
  byPerson: ReadonlyMap<string, readonly Issue[]>;
  byNobody: readonly Issue[];
}

export function ticketsByPerson(dataset: Dataset): TicketsByPerson {
  return creditMemo(dataset, "credit:tickets", () => {
    const credits = creditsOf(dataset);
    const byPerson = new Map<string, Issue[]>();
    const byNobody: Issue[] = [];
    for (const issue of dataset.world.issues) {
      const credited = credits.get(issue.key);
      if (!credited) continue;
      if (credited.length === 0) byNobody.push(issue);
      // One ticket can count for several people: it counts once for each.
      for (const { personId } of credited) {
        const list = byPerson.get(personId);
        if (list) list.push(issue);
        else byPerson.set(personId, [issue]);
      }
    }
    return { byPerson, byNobody };
  });
}

/** A person's tickets: the board's work that counts for them (one meaning everywhere: GET /people's, the directory's, the scorecard's). */
export function ticketsOf(dataset: Dataset, personId: string): readonly Issue[] {
  return ticketsByPerson(dataset).byPerson.get(personId) ?? [];
}

/** The site's people fields filled on at least one of the board's work tickets: the fields the board's credit may read. */
export function eligibleFields(dataset: Dataset): CreditField[] {
  const filled = new Set<string>();
  for (const fields of peopleFields(dataset.world).values()) for (const [key, people] of Object.entries(fields)) if (people.length > 0) filled.add(key);
  // By name folded for case and accents, then key, as the service lists them.
  const order = (field: CreditField) => foldText(field.name);
  return SITE_PEOPLE_FIELDS.filter((field) => filled.has(field.key)).sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : a.key < b.key ? -1 : 1));
}

/** Everyone a people field names on the board's work, whatever the setting: they are on the board too. */
export function fieldPeople(dataset: Dataset): Set<string> {
  const people = new Set<string>();
  for (const fields of peopleFields(dataset.world).values()) for (const named of Object.values(fields)) for (const id of named) people.add(id);
  return people;
}
