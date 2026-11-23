import { createHash } from "node:crypto";

import type { AccessLogQuery } from "@/lib/api/params";
import {
  ACCESS_LOG_DEFAULT_LIMIT,
  accessDetail,
  FORMER_MEMBER,
  LOCAL_VIEWER,
  LOCAL_VIEWER_NAME,
  SIGNED_IN_USER,
  type AccessAction,
  type AccessLog,
  type AccessLogEntry,
  type AskLevel,
  type Person,
} from "@/lib/api/schemas";

import { PROJECT_KEY, REPORT_TIMEZONE } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import { directoryPeople } from "./people";
import { createRng } from "./random";
import { DAY, HOUR, MINUTE, addDays, iso, zonedMidnight } from "./time";
import { personIdFor, TEAM } from "./team";

/*
 * GET /access-log (JO-12) for the sample: who read person-level figures, and
 * when, as the service's access log records them. A fixed history of the last
 * 60 days, made up as the rest of the sample is: fictional viewers (two
 * admins, a user who filtered Findings by a person, a session from before
 * names were kept, and the local reader with sign-in off), the sample's own
 * people as the subjects, and one former member, on no board any more. It
 * does not record the reads made against the sample itself: that is the
 * service's work, and a demo would otherwise fill it with its own clicks.
 * Person cards (JO-13) are among the designed reads at the top, so the first
 * page shows one.
 */

const SEED = 20261112;
const HISTORY_DAYS = 60;
const ENTRIES = 150;

interface SampleViewer {
  hash: string;
  name: string;
  level: AskLevel;
  weight: number;
}

/** A fictional viewer's hash, made as the dashboard makes one (32 hex characters), from a label rather than an account. */
function viewerHash(label: string): string {
  return createHash("sha256").update(`sample-viewer:${label}`, "utf8").digest("hex").slice(0, 32);
}

/** The people who read the sample's figures: made up, like every name in the sample. */
export const SAMPLE_VIEWERS: readonly SampleViewer[] = [
  { hash: viewerHash("Morgan Ellis"), name: "Morgan Ellis", level: "people", weight: 6 },
  { hash: viewerHash("Priya Raman"), name: "Priya Raman", level: "people", weight: 3 },
  // A user: at team level, only the Findings Person filter reads someone's figures.
  { hash: viewerHash("Tobias Wren"), name: "Tobias Wren", level: "team", weight: 2 },
  // A session sealed before sessions kept the display name.
  { hash: viewerHash("older session"), name: SIGNED_IN_USER, level: "people", weight: 1 },
  { hash: LOCAL_VIEWER, name: LOCAL_VIEWER_NAME, level: "people", weight: 1 },
];

const [MORGAN, PRIYA, TOBIAS] = SAMPLE_VIEWERS;

/** Someone whose figures were read and who has since left every board: named so, with no picture. */
export const FORMER: Person = { id: personIdFor("acc-12"), name: FORMER_MEMBER, avatar: null };

const PEOPLE_LEVEL_ACTIONS: readonly (readonly [AccessAction, number])[] = [
  ["scorecard_view", 5],
  ["people_compare_view", 3],
  ["person_findings_view", 3],
  ["person_ask", 3],
  ["access_log_view", 1.2],
  ["access_log_export", 0.3],
];

const idOf = (label: string) => createHash("sha256").update(`sample-access:${label}`, "utf8").digest("hex").slice(0, 32);
const qaIdOf = (label: string) => createHash("sha256").update(`sample-qa:${label}`, "utf8").digest("hex").slice(0, 32);

interface Draft {
  at: number;
  viewer: SampleViewer;
  action: AccessAction;
  subjects: readonly Person[];
  days?: number;
  /** How many entries a read of the access log returned. */
  entries?: number;
}

/** An entry's detail as the service writes it for each action (the page reads days, qa_id and entries alone). */
function detailOf(draft: Draft, label: string): Record<string, unknown> {
  switch (draft.action) {
    case "scorecard_view":
    case "people_compare_view":
    case "person_card_view":
      return { days: draft.days ?? 90 };
    case "person_findings_view":
      return { state: "open", page: 1 };
    case "person_ask":
      return { qa_id: qaIdOf(label), outcome: "answered" };
    case "access_log_view":
    case "access_log_export":
      return { from: null, to: null, actions: [], viewer: null, entries: draft.entries ?? ACCESS_LOG_DEFAULT_LIMIT };
  }
}

function entry(draft: Draft, label: string): AccessLogEntry {
  const ownLog = draft.action === "access_log_view" || draft.action === "access_log_export";
  return {
    id: idOf(label),
    at: iso(draft.at),
    viewer: { hash: draft.viewer.hash, name: draft.viewer.name },
    level: draft.viewer.level,
    project: ownLog ? null : PROJECT_KEY,
    action: draft.action,
    subjects: draft.subjects.map((person) => ({ ...person })),
    // Read as the contract reads it (schemas.ts accessDetail), as the service's body is.
    detail: accessDetail(detailOf(draft, label)),
  };
}

/** The whole history, newest first: a few designed reads at the top, so every kind shows on the first page. */
function history(dataset: Dataset): AccessLogEntry[] {
  return memo(dataset, "access-log", () => {
    const people = directoryPeople(dataset);
    const team = TEAM.map((member) => people.find((person) => person.id === personIdFor(member.accountId))!);
    const [ada, ben, carmen, dev] = team;
    const noor = people.find((person) => person.name === "Noor Haddad")!;
    const now = dataset.now;
    const ago = (minutes: number) => now - minutes * MINUTE;

    const designed: Draft[] = [
      { at: ago(12), viewer: MORGAN, action: "access_log_view", subjects: [] },
      { at: ago(26), viewer: MORGAN, action: "scorecard_view", subjects: [ada], days: 90 },
      { at: ago(33), viewer: MORGAN, action: "person_card_view", subjects: [carmen], days: 90 },
      { at: ago(41), viewer: PRIYA, action: "person_ask", subjects: [carmen, ada] },
      { at: ago(58), viewer: MORGAN, action: "people_compare_view", subjects: team, days: 90 },
      { at: ago(95), viewer: TOBIAS, action: "person_findings_view", subjects: [ben] },
      { at: ago(130), viewer: PRIYA, action: "access_log_export", subjects: [], entries: 214 },
      { at: ago(150), viewer: PRIYA, action: "person_card_view", subjects: [noor], days: 90 },
      { at: ago(190), viewer: SAMPLE_VIEWERS[4], action: "people_compare_view", subjects: [carmen, dev, noor], days: 30 },
      { at: ago(260), viewer: SAMPLE_VIEWERS[3], action: "scorecard_view", subjects: [FORMER], days: 180 },
    ];

    const rng = createRng(SEED, "access-log");
    const weightedViewers = SAMPLE_VIEWERS.map((viewer) => [viewer, viewer.weight] as const);
    const drafts: Draft[] = [...designed];
    let at = ago(300);
    const oldest = now - HISTORY_DAYS * DAY;
    while (drafts.length < ENTRIES && at > oldest) {
      // Readers read in working hours, a few times a day: gaps of 40 minutes to most of a day.
      at -= Math.round(rng.range(40, 14 * 60)) * MINUTE;
      const hour = new Date(at).getUTCHours();
      if (hour < 7 || hour > 18) at -= 10 * HOUR;
      const viewer = rng.weighted(weightedViewers);
      const action: AccessAction = viewer.level === "team" ? "person_findings_view" : rng.weighted(PEOPLE_LEVEL_ACTIONS);
      const pick = () => rng.pick(team);
      const several = () => {
        const chosen = new Map<string, Person>();
        const count = rng.int(2, 3);
        while (chosen.size < count) {
          const person = pick();
          chosen.set(person.id, person);
        }
        return [...chosen.values()];
      };
      // Long ago, one of the people read has since left every board.
      const one = () => (at < now - 40 * DAY && rng.chance(0.08) ? FORMER : pick());
      switch (action) {
        case "scorecard_view":
          drafts.push({ at, viewer, action, subjects: [one()], days: rng.pick([30, 90, 90, 180]) });
          break;
        case "people_compare_view":
          drafts.push(rng.chance(0.5) ? { at, viewer, action, subjects: team, days: 90 } : { at, viewer, action, subjects: several(), days: rng.pick([30, 90, 180]) });
          break;
        case "person_findings_view":
          drafts.push({ at, viewer, action, subjects: [one()] });
          break;
        case "person_ask":
          drafts.push({ at, viewer, action, subjects: rng.chance(0.6) ? [pick()] : several() });
          break;
        case "access_log_view":
          drafts.push({ at, viewer, action, subjects: [] });
          break;
        case "access_log_export":
          drafts.push({ at, viewer, action, subjects: [], entries: rng.int(40, 260) });
          break;
      }
    }
    return drafts
      .map((draft, index) => entry(draft, String(index)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  });
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");

/**
 * Everyone the whole history holds, as the service's first page offers them to the filters: every viewer by the
 * name of their latest read, and every person read, by name folded, then id, a former member after everyone else.
 */
function facetsOf(dataset: Dataset): NonNullable<AccessLog["facets"]> {
  return memo(dataset, "access-log-facets", () => {
    const viewers = new Map<string, string>();
    const subjects = new Map<string, Person>();
    for (const item of history(dataset)) {
      if (!viewers.has(item.viewer.hash)) viewers.set(item.viewer.hash, item.viewer.name);
      for (const person of item.subjects) if (!subjects.has(person.id)) subjects.set(person.id, person);
    }
    const byName = (a: { name: string; key: string }, b: { name: string; key: string }) =>
      fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    return {
      viewers: [...viewers]
        .map(([hash, name]) => ({ hash, name, key: hash }))
        .sort(byName)
        .map(({ hash, name }) => ({ hash, name })),
      subjects: [...subjects.values()]
        .map((person) => ({ person, name: person.name, key: person.id }))
        .sort((a, b) => Number(a.person.id === FORMER.id) - Number(b.person.id === FORMER.id) || byName(a, b))
        .map(({ person }) => ({ ...person })),
    };
  });
}

/** Where a page ends, for the next to start after: the last entry's time and id, opaque to the page. */
function cursorOf(item: AccessLogEntry): string {
  return `${Date.parse(item.at)}.${item.id}`;
}

const CURSOR = /^(\d{1,15})\.([0-9a-f]{32})$/;

/** Entries the filters keep: the days in the report zone (both included), the actions, the person read, the viewer. */
function matches(item: AccessLogEntry, query: AccessLogQuery): boolean {
  const at = Date.parse(item.at);
  if (query.from && at < zonedMidnight(query.from, REPORT_TIMEZONE)) return false;
  if (query.to && at >= zonedMidnight(addDays(query.to, 1), REPORT_TIMEZONE)) return false;
  if (query.action.length > 0 && !query.action.includes(item.action)) return false;
  if (query.viewer && item.viewer.hash !== query.viewer) return false;
  if (query.person && !item.subjects.some((subject) => subject.id === query.person)) return false;
  return true;
}

/** One page of the access log, newest first, or why the cursor cannot be read. */
export function accessLogView(dataset: Dataset, query: AccessLogQuery): { ok: true; body: AccessLog } | { ok: false; message: string } {
  let after: { at: number; id: string } | null = null;
  if (query.cursor !== undefined) {
    const parsed = CURSOR.exec(query.cursor);
    if (!parsed) return { ok: false, message: "That cursor is not one this access log gave." };
    after = { at: Number(parsed[1]), id: parsed[2] };
  }
  const kept = history(dataset).filter((item) => {
    if (!matches(item, query)) return false;
    if (after === null) return true;
    const at = Date.parse(item.at);
    return at < after.at || (at === after.at && item.id < after.id);
  });
  const page = kept.slice(0, query.limit);
  const more = kept.length > page.length;
  return {
    ok: true,
    body: {
      meta: meta(dataset),
      entries: page.map((item) => ({ ...item, subjects: item.subjects.map((person) => ({ ...person })), detail: { ...item.detail } })),
      next_cursor: more && page.length > 0 ? cursorOf(page[page.length - 1]) : null,
      // The filters' menus come with a first page, never with the pages after it or an export.
      facets: after === null && !query.export ? facetsOf(dataset) : null,
    },
  };
}
