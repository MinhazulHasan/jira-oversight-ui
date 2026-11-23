/**
 * The sample project's team: eight fictional people, the names the backend's
 * own demo gives its made-up accounts acc-01 to acc-08 (oversight/demo.py),
 * and three members of the board who hold none of its work (acc-09 to
 * acc-11), so a person has the same id in both demos. The account ids stay in the
 * sample's world, as they stay in the service's database: a response carries
 * a person as the contract names one, an id derived from the account, the
 * display name and the version of their picture (two of them have one,
 * pictures.ts), and never the account itself.
 */

import { createHash } from "node:crypto";

import type { Person } from "@/lib/api/schemas";

import { pictureOf, type SamplePicture } from "./pictures";
import type { Issue } from "./world";

export interface Member {
  /** A made-up Jira account id. */
  accountId: string;
  /** The display name Jira would give. */
  name: string;
  /** How much of the team's work they hold, relative to the others. */
  share: number;
}

export const TEAM: readonly Member[] = [
  { accountId: "acc-01", name: "Ada Brooks", share: 5 },
  { accountId: "acc-02", name: "Ben Okafor", share: 5 },
  { accountId: "acc-03", name: "Carmen Ruiz", share: 4 },
  { accountId: "acc-04", name: "Dev Malhotra", share: 4 },
  { accountId: "acc-05", name: "Elif Aydin", share: 3 },
  { accountId: "acc-06", name: "Finn Gallagher", share: 3 },
  { accountId: "acc-07", name: "Grace Lindqvist", share: 2 },
  { accountId: "acc-08", name: "Hana Mori", share: 2 },
];

/**
 * The board's members who hold none of its tickets (JO-10): people Jira lets
 * you assign DEMO's tickets to whom the work never reached, as the service's
 * own demo stores them (acc-09 to acc-11, no pictures), as a member fetch
 * would. They are in the @ list's "No tickets" group, and Ask says they have
 * no tickets on this board; GET /people and everything built on it (the
 * Overview, the Findings filter, the ticket page) leave them out.
 */
export const MEMBERS: readonly Pick<Member, "accountId" | "name">[] = [
  { accountId: "acc-09", name: "Noor Haddad" },
  { accountId: "acc-10", name: "Tomás Ferreira" },
  { accountId: "acc-11", name: "Yuki Tanabe" },
];

/** Everyone on the board: the team who hold its work, then the members who hold none. */
export const EVERYONE: readonly Pick<Member, "accountId" | "name">[] = [...TEAM, ...MEMBERS];

/** "p" and the first 12 hex characters of sha256 of the account id (UTF-8), as the service derives it. */
export function personIdFor(accountId: string): string {
  return `p${createHash("sha256").update(accountId, "utf8").digest("hex").slice(0, 12)}`;
}

const PEOPLE: ReadonlyMap<string, Person> = new Map(
  EVERYONE.map((member) => [
    member.accountId,
    { id: personIdFor(member.accountId), name: member.name, avatar: pictureOf(member.accountId)?.version ?? null },
  ]),
);

/** The account behind each person id, which only the sample's own world may know. */
const ACCOUNTS: ReadonlyMap<string, string> = new Map(EVERYONE.map((member) => [personIdFor(member.accountId), member.accountId]));

/** A person's picture by their id, or null when they have none (or the id is nobody's on the team). */
export function pictureOfPerson(personId: string): SamplePicture | null {
  const accountId = ACCOUNTS.get(personId);
  return accountId === undefined ? null : pictureOf(accountId);
}

/** The board's members who hold none of its tickets, as a response names them, in the order MEMBERS lists them. */
export function memberPeople(): Person[] {
  return MEMBERS.map((member) => ({ ...PEOPLE.get(member.accountId)! }));
}

/** Who the issue is assigned to now, as a response names them; null when nobody is. */
export function personOf(issue: Pick<Issue, "assigneeAccountId">): Person | null {
  if (issue.assigneeAccountId === null) return null;
  const person = PEOPLE.get(issue.assigneeAccountId);
  if (!person) throw new Error("an issue is assigned to an account outside the team");
  return { ...person };
}
