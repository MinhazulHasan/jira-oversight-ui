import type { Stage } from "@/lib/api/schemas";

import { DEFAULT_BOARD, type SampleBoard } from "./boards";
import { HOURS_PER_POINT, ORDERED_STAGES, STATUS, type StatusName } from "./catalogue";
import { createRng, type Rng } from "./random";
import { TEAM } from "./team";
import { DAY, HOUR, MINUTE, WEEK, floorToMinute, mondayUtc } from "./time";
import { EPICS, UNPLANNED_OBJECTS, summaryFor, type IssueType } from "./vocabulary";

export const HALF_HOUR = 30 * MINUTE;
/** How long the oversight rules have been running when the sample starts. */
export const ENGINE_DAYS = 140;
/** When the team changed its process, and the two epics started to drift. */
export const PROCESS_CHANGE_DAYS = 35;
/** Share of work raised a sprint or two before anyone picks it up: what keeps a backlog in To Do. */
const PLANNED_AHEAD = 0.44;
/** Share of the usual sizing rate the two pressured epics keep up. */
const UNSIZED_UNDER_PRESSURE = 0.75;
/** No reopen in this recent window, so "reopened this week" has a true empty answer. */
const QUIET_REOPEN_DAYS = 8;

export type WorkType = Exclude<IssueType, "Epic">;

export interface StatusChange {
  id: string;
  at: number;
  from: StatusName;
  to: StatusName;
}

export interface FieldChange {
  id: string;
  at: number;
  field: "story_points" | "assignee";
  from: string | null;
  to: string | null;
}

export interface Worklog {
  at: number;
  seconds: number;
}

export interface IssueInterval {
  status: StatusName;
  enteredAt: number;
  leftAt: number | null;
  /** The change that entered this status; null for the status an issue was created in. */
  enteredBy: StatusChange | null;
}

export interface Skip {
  change: StatusChange;
  skipped: Stage[];
}

export interface Issue {
  key: string;
  num: number;
  type: IssueType;
  summary: string;
  epicIndex: number | null;
  epicKey: string | null;
  parentKey: string | null;
  createdAt: number;
  parked: boolean;
  statusChanges: StatusChange[];
  fieldChanges: FieldChange[];
  worklogs: Worklog[];
  storyPoints: number | null;
  estimateSetAt: number | null;
  /** While In Progress with nobody assigned; `to` null means still unassigned. */
  unassigned: { from: number; to: number | null }[];
  /** The account it is assigned to now (made up, team.ts); null when nobody is. Responses carry the person, never this. */
  assigneeAccountId: string | null;
  sprintIds: number[];
  /** One link title per linked issue ("blocks", "relates to", ...). */
  links: string[];

  /* derived at the sync, as derive/metrics.py would */
  status: StatusName;
  intervals: IssueInterval[];
  startedAt: number | null;
  doneAt: number | null;
  resolvedAt: number | null;
  cycleTimeH: number | null;
  reopenCount: number;
  skips: Skip[];
  timeSpentS: number;
  aggregateTimeSpentS: number;
  effortRatio: number | null;
  statusAgeH: number;
}

export interface Sprint {
  id: number;
  number: number;
  name: string;
  start: number;
  end: number;
  memberKeys: string[];
}

export interface World {
  /** The board this world is (boards.ts): DEMO's story, or a smaller one from a seed of its own. */
  board: SampleBoard;
  now: number;
  syncAt: number;
  rulesAt: number;
  engineStart: number;
  processChangeAt: number;
  weekBase: number;
  issues: Issue[];
  byKey: Map<string, Issue>;
  epics: Issue[];
  sprints: Sprint[];
  activeSprint: Sprint;
}

/* --------------------------------------------------------------- helpers -- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Moves a moment into working hours (08:00 to 18:00 UTC, Monday to Friday). */
function toWorkingHours(time: number): number {
  let day = Math.floor(time / DAY) * DAY;
  let minutes = (time - day) / MINUTE;
  if (minutes < 8 * 60) {
    minutes = 8 * 60 + (minutes % 60);
  } else if (minutes >= 18 * 60) {
    day += DAY;
    minutes = 8 * 60 + (minutes % 60);
  }
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  if (weekday >= 5) day += (7 - weekday) * DAY;
  return day + Math.round(minutes) * MINUTE;
}

/** The next event in a history: in working hours, and never before the one it follows. */
function after(previous: number, time: number, gap = 7 * MINUTE): number {
  return Math.max(toWorkingHours(time), previous + gap);
}

const LINK_TITLES: readonly (readonly [string, number])[] = [
  ["relates to", 0.45],
  ["blocks", 0.22],
  ["is blocked by", 0.16],
  ["duplicates", 0.05],
  ["is duplicated by", 0.04],
  ["clones", 0.04],
  ["is cloned by", 0.04],
];

const FIBONACCI: readonly (readonly [number, number])[] = [
  [1, 0.1],
  [2, 0.22],
  [3, 0.28],
  [5, 0.24],
  [8, 0.12],
  [13, 0.04],
];

interface TypeProfile {
  share: number;
  wait: number;
  unpointedEffort: number;
  skip: number;
  points: number;
}

const PROFILES: Record<WorkType, TypeProfile> = {
  Task: { share: 0.61, wait: 1.0, unpointedEffort: 10, skip: 0.8, points: 0.9 },
  Bug: { share: 0.2, wait: 0.55, unpointedEffort: 6, skip: 1.1, points: 0.55 },
  Subtask: { share: 0.13, wait: 0.5, unpointedEffort: 4, skip: 1.7, points: 0.4 },
  Test: { share: 0.06, wait: 0.8, unpointedEffort: 5, skip: 1.5, points: 0.5 },
};

/* ------------------------------------------------------------- creation -- */

interface Slot {
  at: number;
  epicIndex: number | null;
}

/** When each piece of work was raised: weekdays in working hours, a little busier lately. */
function workCreationTimes(rng: Rng, count: number, historyStart: number, syncAt: number): number[] {
  const days: number[] = [];
  for (let day = historyStart; day <= syncAt; day += DAY) {
    if ((new Date(day).getUTCDay() + 6) % 7 < 5) days.push(day);
  }
  const cumulative: number[] = [];
  let total = 0;
  days.forEach((_, index) => {
    total += 0.75 + (0.5 * index) / days.length;
    cumulative.push(total);
  });

  const times: number[] = [];
  while (times.length < count) {
    const point = rng.next() * total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle] < point) low = middle + 1;
      else high = middle;
    }
    const at = days[low] + Math.floor(rng.range(8 * 60, 18 * 60)) * MINUTE;
    if (at <= syncAt - 10 * MINUTE) times.push(at);
  }
  times.sort((a, b) => a - b);
  // The first ticket in the project opens its first week, so DEMO-1 is real work.
  times[0] = historyStart + 9 * HOUR + 12 * MINUTE;
  return times;
}

/* ------------------------------------------------------------ lifecycles -- */

interface Context {
  syncAt: number;
  processChangeAt: number;
  usedSummaries: Set<string>;
}

interface Draft {
  issue: Issue;
  rng: Rng;
  /** Planned moments, which may lie beyond the sync (not yet happened). */
  startAt: number | null;
  firstDoneAt: number | null;
  reopenAt: number | null;
  redoneAt: number | null;
  calendarHours: number;
  /** Hours the work takes in full, after any drift. */
  effortHours: number;
  logsTime: boolean;
}

function skipProbability(at: number, context: Context): number {
  return at >= context.processChangeAt ? 0.045 : 0.18;
}

/** Spread logged hours over a span as worklogs of the time-tracking account. */
function spreadWorklogs(hours: number, from: number, to: number, syncAt: number): Worklog[] {
  const totalSeconds = Math.max(900, Math.round((hours * 3600) / 900) * 900);
  const entries = Math.max(1, Math.ceil(hours / 4.5));
  const span = Math.max(to - from, HOUR);
  const logs: Worklog[] = [];
  let remaining = totalSeconds;
  for (let index = 0; index < entries; index += 1) {
    const at = Math.min(toWorkingHours(from + ((index + 0.5) / entries) * span), to, syncAt);
    const share = index === entries - 1 ? remaining : Math.max(900, Math.round(totalSeconds / entries / 900) * 900);
    const seconds = Math.min(share, remaining);
    if (seconds <= 0) break;
    logs.push({ at, seconds });
    remaining -= seconds;
  }
  logs.sort((a, b) => a.at - b.at);
  return logs;
}

function planWork(draft: Draft, parent: Draft | null, epicDrifts: boolean, context: Context, showcase: boolean): void {
  const { issue, rng } = draft;
  const { syncAt } = context;
  const type = issue.type as WorkType;
  const profile = PROFILES[type];

  // Every draw happens in the same order whatever the branch, so the stream stays stable.
  const waitRoll = rng.next();
  const waitZ = rng.normal();
  const plannedWait = rng.range(80, 600);
  const parkedWait = rng.range(900, 3500);
  const pointsRoll = rng.next();
  let pointsValue = rng.weighted(FIBONACCI);
  const ratioZ = rng.normal();
  const backfillZ = rng.normal();
  const unpointedZ = rng.normal();
  // In a three-status workflow, In Progress also holds review and testing time.
  let spread = clamp(5 * Math.exp(0.45 * rng.normal()), 1.6, 16);
  const skipRoll = rng.next();
  const reopenRoll = rng.next();
  const reopenWaitZ = rng.normal();
  const reworkZ = rng.normal();
  const timingRoll = rng.next();
  const groomingAt = rng.range(0.15, 0.85);
  let lateAt = rng.range(0.2, 1.25);
  const logRoll = rng.next();
  const unassignedRoll = rng.next();
  const unassignedZ = rng.normal();
  const linkRoll = rng.next();
  const linkCount = rng.int(1, 3);
  const linkTitles = [rng.weighted(LINK_TITLES), rng.weighted(LINK_TITLES), rng.weighted(LINK_TITLES)];

  // Most work is picked up within days; some is raised a sprint or two ahead; a little is parked.
  issue.parked = !showcase && waitRoll < 0.04;
  let waitHours = clamp(40 * profile.wait * Math.exp(waitZ), 0.4, 700);
  if (waitRoll >= 0.04 && waitRoll < PLANNED_AHEAD) waitHours = plannedWait;
  if (issue.parked) waitHours = parkedWait;

  // Work in the two pressured epics is picked up before it is sized more often than elsewhere.
  const hasPoints = showcase || pointsRoll < profile.points * (epicDrifts ? UNSIZED_UNDER_PRESSURE : 1);
  let timing: "creation" | "grooming" | "late" | null = null;
  if (hasPoints) timing = timingRoll < 0.45 ? "creation" : timingRoll < 0.75 ? "grooming" : "late";
  let ratio = clamp(Math.exp(0.36 * ratioZ), 0.2, 3.4);
  // Points sized after the fact match the time already logged.
  if (timing === "late") ratio = clamp(1 + 0.07 * backfillZ, 0.8, 1.25);

  if (showcase) {
    // DEMO-1 shows most of what an issue page can: points set late, a reopen, an overrun.
    waitHours = 50;
    pointsValue = 3;
    timing = "late";
    lateAt = 0.6;
    ratio = 1.83;
    spread = 2.2;
  }

  const baseEffort = hasPoints
    ? pointsValue * HOURS_PER_POINT * ratio
    : clamp(profile.unpointedEffort * Math.exp(0.75 * unpointedZ), 0.5, 80);
  draft.calendarHours = Math.max(2, baseEffort * spread);

  let startAt = after(issue.createdAt, issue.createdAt + waitHours * HOUR, 20 * MINUTE);
  // A subtask never starts before the task it belongs to.
  if (parent?.startAt != null) startAt = Math.max(startAt, after(parent.startAt, parent.startAt, 20 * MINUTE));
  const plannedDoneAt = after(startAt, startAt + draft.calendarHours * HOUR, 30 * MINUTE);

  const skipped = !showcase && skipRoll < skipProbability(plannedDoneAt, context) * profile.skip;
  // A skipped ticket was worked on, but nobody moved it until it was closed.
  draft.startAt = skipped ? null : startAt;
  const firstDoneAt = skipped
    ? after(issue.createdAt, issue.createdAt + (waitHours + draft.calendarHours * 0.5) * HOUR, 30 * MINUTE)
    : plannedDoneAt;
  draft.firstDoneAt = firstDoneAt;

  const reopenChance = skipped ? 0.015 : 0.055;
  if (showcase || reopenRoll < reopenChance) {
    const reopenAt = after(firstDoneAt, firstDoneAt + clamp(36 * Math.exp(0.9 * reopenWaitZ), 2, 400) * HOUR);
    if (reopenAt <= syncAt - QUIET_REOPEN_DAYS * DAY) {
      draft.reopenAt = reopenAt;
      draft.redoneAt = after(reopenAt, reopenAt + clamp(14 * Math.exp(0.8 * reworkZ), 1, 200) * HOUR, 30 * MINUTE);
    }
  }

  // The two drifting epics log more against the same estimates as the weeks go on.
  const finishedAt = draft.redoneAt ?? firstDoneAt;
  const measuredAt = finishedAt <= syncAt ? finishedAt : syncAt;
  let drift = 1;
  if (epicDrifts && measuredAt >= context.processChangeAt) {
    drift = 1 + 1.1 * clamp((measuredAt - context.processChangeAt) / (syncAt - context.processChangeAt), 0, 1);
  }
  draft.effortHours = baseEffort * drift;

  /* status history, up to the sync */
  const start = draft.startAt;
  const changes: Omit<StatusChange, "id">[] = [];
  if (start !== null && start <= syncAt) changes.push({ at: start, from: "To Do", to: "In Progress" });
  if (firstDoneAt <= syncAt) changes.push({ at: firstDoneAt, from: start === null ? "To Do" : "In Progress", to: "Done" });
  if (draft.reopenAt !== null && draft.reopenAt <= syncAt) changes.push({ at: draft.reopenAt, from: "Done", to: "In Progress" });
  if (draft.redoneAt !== null && draft.redoneAt <= syncAt) changes.push({ at: draft.redoneAt, from: "In Progress", to: "Done" });
  issue.statusChanges = changes.map((change) => ({ ...change, id: "" }));

  /* story points */
  if (timing !== null) {
    let setAt: number;
    if (timing === "creation") {
      setAt = issue.createdAt;
    } else if (timing === "grooming") {
      const anchor = start ?? firstDoneAt;
      setAt = Math.max(issue.createdAt + 10 * MINUTE, issue.createdAt + groomingAt * (anchor - issue.createdAt));
    } else if (start !== null) {
      setAt = after(start, start + Math.max(1.5 * HOUR, lateAt * (firstDoneAt - start)));
    } else {
      setAt = after(firstDoneAt, firstDoneAt + lateAt * 3 * HOUR);
    }
    if (setAt <= syncAt) {
      issue.storyPoints = pointsValue;
      issue.estimateSetAt = setAt;
      if (timing !== "creation") {
        issue.fieldChanges.push({ id: "", at: setAt, field: "story_points", from: null, to: String(pointsValue) });
      }
    }
  }

  /* whether anyone was assigned when it was picked up (who, the world decides last: assignees) */
  if (start !== null && start <= syncAt) {
    const leavesProgressAt = firstDoneAt <= syncAt ? firstDoneAt : null;
    if (!showcase && unassignedRoll < 0.055) {
      const assignedAt = after(start, start + clamp(26 * Math.exp(unassignedZ), 1, 600) * HOUR);
      const end = leavesProgressAt !== null ? Math.min(assignedAt, leavesProgressAt) : assignedAt;
      issue.unassigned.push({ from: start, to: end <= syncAt ? end : null });
      if (assignedAt <= syncAt && (leavesProgressAt === null || assignedAt < leavesProgressAt)) {
        issue.fieldChanges.push({ id: "", at: assignedAt, field: "assignee", from: "Unassigned", to: "Assigned" });
      }
    } else {
      issue.fieldChanges.push({ id: "", at: start, field: "assignee", from: "Unassigned", to: "Assigned" });
    }
  }

  // Teams that size their work tend to log against it; skipped tickets were rarely tracked at all.
  draft.logsTime = showcase || logRoll < (skipped ? 0.65 : hasPoints ? 0.93 : 0.78);
  issue.links = linkRoll < 0.62 ? linkTitles.slice(0, linkCount) : [];
}

/** Worklogs once the history is known: full effort for finished work, a share of it for work in flight. */
function logWork(draft: Draft, syncAt: number): void {
  const { issue } = draft;
  if (!draft.logsTime || issue.status === "To Do") return;
  const effort = draft.effortHours;

  const firstDoneAt = draft.firstDoneAt!;
  // Skipped tickets were never moved to In Progress: their work ran up to the close.
  const workFrom = draft.startAt ?? firstDoneAt - draft.calendarHours * 0.5 * HOUR;

  if (issue.status === "Done") {
    if (draft.reopenAt !== null && draft.redoneAt !== null && draft.redoneAt <= syncAt) {
      issue.worklogs = [
        ...spreadWorklogs(effort * 0.85, workFrom, firstDoneAt, syncAt),
        ...spreadWorklogs(effort * 0.15, draft.reopenAt, draft.redoneAt, syncAt),
      ];
    } else {
      issue.worklogs = spreadWorklogs(effort, workFrom, firstDoneAt, syncAt);
    }
    return;
  }

  // In progress: the share of the planned calendar time that has passed.
  if (draft.reopenAt !== null && draft.reopenAt <= syncAt) {
    const reworkSpan = draft.redoneAt !== null ? draft.redoneAt - draft.reopenAt : HOUR;
    const rework = clamp((syncAt - draft.reopenAt) / reworkSpan, 0, 0.97);
    issue.worklogs = [
      ...spreadWorklogs(effort * 0.85, workFrom, firstDoneAt, syncAt),
      ...(rework > 0.05 ? spreadWorklogs(effort * 0.15 * rework, draft.reopenAt, syncAt, syncAt) : []),
    ];
    return;
  }
  const startAt = draft.startAt!;
  const elapsed = clamp((syncAt - startAt) / (draft.calendarHours * HOUR), 0, 0.97);
  if (elapsed * effort >= 0.25) issue.worklogs = spreadWorklogs(effort * elapsed, startAt, syncAt, syncAt);
}

/* ---------------------------------------------------------- derivations -- */

function deriveIssue(issue: Issue, syncAt: number): void {
  const changes = [...issue.statusChanges].sort((a, b) => a.at - b.at);
  const intervals: IssueInterval[] = [];
  let status: StatusName = changes[0]?.from ?? "To Do";
  let enteredAt = issue.createdAt;
  let enteredBy: StatusChange | null = null;
  for (const change of changes) {
    intervals.push({ status, enteredAt, leftAt: change.at, enteredBy });
    status = change.to;
    enteredAt = change.at;
    enteredBy = change;
  }
  intervals.push({ status, enteredAt, leftAt: null, enteredBy });
  issue.intervals = intervals;
  issue.status = status;

  issue.startedAt = intervals.find((interval) => interval.status === "In Progress")?.enteredAt ?? null;
  let doneAt: number | null = null;
  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    if (intervals[index].status !== "Done") break;
    doneAt = intervals[index].enteredAt;
  }
  issue.doneAt = doneAt;
  issue.resolvedAt = doneAt;
  issue.cycleTimeH =
    issue.startedAt !== null && doneAt !== null && doneAt >= issue.startedAt ? (doneAt - issue.startedAt) / HOUR : null;
  issue.reopenCount = changes.filter((change) => change.from === "Done" && change.to !== "Done").length;

  const position = new Map(ORDERED_STAGES.map((stage, index) => [stage, index]));
  issue.skips = changes.flatMap((change) => {
    const from = position.get(STATUS[change.from].stage)!;
    const to = position.get(STATUS[change.to].stage)!;
    return to - from > 1 ? [{ change, skipped: ORDERED_STAGES.slice(from + 1, to) }] : [];
  });

  issue.timeSpentS = issue.worklogs.reduce((sum, log) => sum + log.seconds, 0);
  issue.effortRatio =
    issue.storyPoints !== null && issue.storyPoints > 0
      ? issue.timeSpentS / 3600 / (issue.storyPoints * HOURS_PER_POINT)
      : null;
  issue.statusAgeH = Math.max(0, (syncAt - intervals[intervals.length - 1].enteredAt) / HOUR);
}

function assignedNow(issue: Issue, activeSprint: Sprint): boolean {
  const open = issue.unassigned[issue.unassigned.length - 1];
  if (open && open.to === null) return false;
  const latest = issue.fieldChanges.findLast((change) => change.field === "assignee");
  if (latest) return latest.to === "Assigned";
  if (issue.unassigned.length > 0) return false;
  return issue.type === "Epic" || issue.status !== "To Do" || issue.sprintIds.includes(activeSprint.id);
}

/* ---------------------------------------------------------------- build -- */

function blankIssue(project: string, num: number, at: number, type: IssueType): Issue {
  return {
    key: `${project}-${num}`,
    num,
    type,
    summary: "",
    epicIndex: null,
    epicKey: null,
    parentKey: null,
    createdAt: at,
    parked: false,
    statusChanges: [],
    fieldChanges: [],
    worklogs: [],
    storyPoints: null,
    estimateSetAt: null,
    unassigned: [],
    assigneeAccountId: null,
    sprintIds: [],
    links: [],
    status: "To Do",
    intervals: [],
    startedAt: null,
    doneAt: null,
    resolvedAt: null,
    cycleTimeH: null,
    reopenCount: 0,
    skips: [],
    timeSpentS: 0,
    aggregateTimeSpentS: 0,
    effortRatio: null,
    statusAgeH: 0,
  };
}

/** One board's world at `now` (DEMO's unless another is named), the same on every run. */
export function buildWorld(now: number, board: SampleBoard = DEFAULT_BOARD): World {
  const { seed, issues: issueCount } = board;
  const syncAt = floorToMinute(now) - 2 * MINUTE;
  const rulesAt = syncAt + MINUTE;
  const engineStart = syncAt - ENGINE_DAYS * DAY;
  const processChangeAt = syncAt - PROCESS_CHANGE_DAYS * DAY;
  const weekBase = mondayUtc(now);
  const historyStart = weekBase - 51 * WEEK;
  const context: Context = { syncAt, processChangeAt, usedSummaries: new Set() };

  /* 1. who was created when */
  const epicStarts = EPICS.map((epic, index) => {
    const rng = createRng(seed, `epic:${index}`);
    return weekBase - epic.startWeeksAgo * WEEK + DAY + 9 * HOUR + Math.floor(rng.range(0, 90)) * MINUTE;
  });
  const epicWindows = EPICS.map((epic, index) => ({
    from: epicStarts[index] - 3 * DAY,
    to: epic.endWeeksAgo === null ? Number.POSITIVE_INFINITY : weekBase - epic.endWeeksAgo * WEEK + 4 * DAY,
  }));
  const slots: Slot[] = [
    ...workCreationTimes(createRng(seed, "creation"), issueCount - EPICS.length, historyStart, syncAt).map((at) => ({
      at,
      epicIndex: null,
    })),
    ...epicStarts.map((at, epicIndex) => ({ at, epicIndex })),
  ].sort((a, b) => a.at - b.at || (a.epicIndex === null ? -1 : 1));

  /* 2. types, epics, parents and summaries, in creation order */
  const typeRng = createRng(seed, "types");
  const issues: Issue[] = [];
  const epicIssues: Issue[] = new Array(EPICS.length);
  const recentTasks: Issue[] = [];
  const drafts = new Map<string, Draft>();

  slots.forEach((slot, index) => {
    const num = index + 1;
    if (slot.epicIndex !== null) {
      const epic = blankIssue(board.key, num, slot.at, "Epic");
      epic.summary = EPICS[slot.epicIndex].title;
      epic.epicIndex = slot.epicIndex;
      context.usedSummaries.add(epic.summary);
      epicIssues[slot.epicIndex] = epic;
      issues.push(epic);
      return;
    }

    const rng = createRng(seed, `issue:${num}`);
    let type: WorkType =
      num === 1
        ? "Task"
        : typeRng.weighted((Object.keys(PROFILES) as WorkType[]).map((name) => [name, PROFILES[name].share] as const));
    const issue = blankIssue(board.key, num, slot.at, type);

    let parent: Issue | null = null;
    if (type === "Subtask") {
      while (recentTasks.length > 0 && recentTasks[0].createdAt < slot.at - 21 * DAY) recentTasks.shift();
      parent = recentTasks.length > 0 ? recentTasks[recentTasks.length - 1 - typeRng.int(0, Math.min(7, recentTasks.length - 1))] : null;
      if (parent === null) type = "Task";
    }
    issue.type = type;

    if (parent !== null) {
      issue.parentKey = parent.key;
      issue.epicIndex = parent.epicIndex;
    } else if (num === 1) {
      issue.epicIndex = 0;
    } else {
      const open = EPICS.map((epic, epicIndex) => ({ epic, epicIndex })).filter(
        ({ epicIndex }) => slot.at >= epicWindows[epicIndex].from && slot.at <= epicWindows[epicIndex].to,
      );
      issue.epicIndex =
        open.length === 0 || typeRng.chance(0.06)
          ? null
          : typeRng.weighted(open.map(({ epic, epicIndex }) => [epicIndex, epic.weight] as const));
    }

    const objects = issue.epicIndex === null ? UNPLANNED_OBJECTS : EPICS[issue.epicIndex].objects;
    issue.summary = summaryFor(rng, type, objects, context.usedSummaries);
    if (type === "Task") recentTasks.push(issue);

    const draft: Draft = {
      issue,
      rng,
      startAt: null,
      firstDoneAt: null,
      reopenAt: null,
      redoneAt: null,
      calendarHours: 0,
      effortHours: 0,
      logsTime: false,
    };
    drafts.set(issue.key, draft);
    issues.push(issue);
    const parentDraft = parent ? drafts.get(parent.key) ?? null : null;
    planWork(draft, parentDraft, issue.epicIndex !== null && EPICS[issue.epicIndex].drifting, context, num === 1);
  });

  for (const issue of issues) {
    if (issue.epicIndex !== null && issue.type !== "Epic") issue.epicKey = epicIssues[issue.epicIndex].key;
  }

  /* 3. a few pieces of work picked up with nobody assigned, still in flight */
  for (const issue of issues) deriveIssue(issue, syncAt);
  const hygieneRng = createRng(seed, "hygiene");
  const inFlight = issues.filter(
    (issue) =>
      issue.status === "In Progress" &&
      issue.reopenCount === 0 &&
      issue.unassigned.length === 0 &&
      issue.startedAt !== null &&
      issue.startedAt <= syncAt - 6 * HOUR,
  );
  for (let picked = 0; picked < 3 && inFlight.length > 0; picked += 1) {
    const issue = inFlight.splice(hygieneRng.int(0, inFlight.length - 1), 1)[0];
    issue.unassigned = [{ from: issue.startedAt!, to: null }];
    issue.fieldChanges = issue.fieldChanges.filter((change) => change.field !== "assignee");
  }

  /* 4. time logged, then the facts derive/metrics.py would compute */
  for (const issue of issues) {
    const draft = drafts.get(issue.key);
    if (draft) logWork(draft, syncAt);
  }

  /* 5. epics follow their work */
  for (const epic of epicIssues) {
    const children = issues.filter((issue) => issue.type !== "Epic" && issue.epicIndex === epic.epicIndex);
    const started = children.map((child) => child.startedAt ?? child.doneAt).filter((at): at is number => at !== null);
    const changes: StatusChange[] = [];
    if (started.length > 0) {
      const startAt = after(epic.createdAt, Math.min(...started), 5 * MINUTE);
      if (startAt <= syncAt) changes.push({ id: "", at: startAt, from: "To Do", to: "In Progress" });
    }
    const closed = EPICS[epic.epicIndex!].endWeeksAgo !== null && children.every((child) => child.status === "Done");
    if (closed && changes.length > 0 && children.length > 0) {
      const lastDone = Math.max(...children.map((child) => child.doneAt ?? 0));
      const doneAt = after(changes[0].at, lastDone + DAY);
      if (doneAt <= syncAt) changes.push({ id: "", at: doneAt, from: "In Progress", to: "Done" });
    }
    epic.statusChanges = changes;
  }

  /* 6. changelog ids, increasing with time across the project as Jira's are */
  const allChanges: { at: number; num: number; order: number; target: StatusChange | FieldChange }[] = [];
  for (const issue of issues) {
    issue.statusChanges.forEach((change) => allChanges.push({ at: change.at, num: issue.num, order: 0, target: change }));
    issue.fieldChanges.forEach((change) => allChanges.push({ at: change.at, num: issue.num, order: 1, target: change }));
  }
  allChanges.sort((a, b) => a.at - b.at || a.num - b.num || a.order - b.order);
  const idRng = createRng(seed, "changelog");
  let nextId = board.changelogBase;
  for (const entry of allChanges) {
    nextId += idRng.int(1, 4);
    entry.target.id = String(nextId);
  }

  for (const issue of issues) {
    issue.fieldChanges.sort((a, b) => a.at - b.at);
    deriveIssue(issue, syncAt);
  }
  // Time logged on subtasks also counts towards their parent's aggregate.
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  for (const issue of issues) issue.aggregateTimeSpentS = issue.timeSpentS;
  for (const issue of issues) {
    if (issue.parentKey) byKey.get(issue.parentKey)!.aggregateTimeSpentS += issue.timeSpentS;
  }

  /* 7. sprints: two weeks each, the current one ending about two days from now */
  const activeEnd = Math.round((now + 1.9 * DAY) / HOUR) * HOUR;
  const sprints: Sprint[] = [];
  for (let number = 1; number <= 26; number += 1) {
    const end = activeEnd - (26 - number) * 14 * DAY;
    sprints.push({ id: board.sprintBase + number, number, name: `Sprint ${number}`, start: end - 14 * DAY, end, memberKeys: [] });
  }
  const activeSprint = sprints[sprints.length - 1];
  const sprintRng = createRng(seed, "sprints");
  const sprintAt = (time: number) => sprints.find((sprint) => time >= sprint.start && time < sprint.end) ?? null;

  for (const issue of issues) {
    if (issue.type === "Epic") continue;
    const members = new Set<Sprint>();
    if (issue.startedAt !== null) {
      const until = issue.doneAt ?? syncAt;
      for (const sprint of sprints) if (sprint.start < until && sprint.end > issue.startedAt) members.add(sprint);
      // Planned a sprint early, but not started in it: rolled over.
      const first = sprintAt(issue.startedAt);
      if (first && sprintRng.chance(0.2)) {
        const previous = sprints.find((sprint) => sprint.number === first.number - 1);
        if (previous && issue.createdAt < previous.end - 3 * DAY) members.add(previous);
      }
    } else if (issue.doneAt !== null) {
      const sprint = sprintAt(issue.doneAt);
      if (sprint) members.add(sprint);
    }
    for (const sprint of members) sprint.memberKeys.push(issue.key);
  }

  // Plan unstarted work into the current sprint until about a third of it is unstarted.
  const startedInActive = activeSprint.memberKeys.length;
  const wanted = Math.round((startedInActive * 0.35) / 0.65);
  const backlog = issues.filter(
    (issue) => issue.type !== "Epic" && issue.status === "To Do" && issue.createdAt < syncAt - 4 * HOUR,
  );
  // Fresh backlog first; long-parked work only when the plan still needs filling.
  const queues = [backlog.filter((issue) => !issue.parked), backlog.filter((issue) => issue.parked)];
  for (let planned = 0; planned < wanted; planned += 1) {
    const queue = queues.find((candidates) => candidates.length > 0);
    if (!queue) break;
    activeSprint.memberKeys.push(queue.splice(sprintRng.int(0, queue.length - 1), 1)[0].key);
  }
  for (const sprint of sprints) {
    sprint.memberKeys.sort((a, b) => byKey.get(a)!.num - byKey.get(b)!.num);
    for (const key of sprint.memberKeys) byKey.get(key)!.sprintIds.push(sprint.id);
  }

  /* 8. who has each ticket now, from its own stream, so no other part of the story moves */
  const shares = TEAM.map((member) => [member.accountId, member.share] as const);
  for (const issue of issues) {
    const accountId = createRng(seed, `assignee:${issue.num}`).weighted(shares);
    issue.assigneeAccountId = assignedNow(issue, activeSprint) ? accountId : null;
  }

  return {
    board,
    now,
    syncAt,
    rulesAt,
    engineStart,
    processChangeAt,
    weekBase,
    issues,
    byKey,
    epics: epicIssues,
    sprints,
    activeSprint,
  };
}

/** Work the rules look at: everything but the epics that hold it. */
export function workItems(world: World): Issue[] {
  return world.issues.filter((issue) => issue.type !== "Epic");
}

/** Hours logged on an issue up to a moment. */
export function loggedHoursAt(issue: Issue, time: number): number {
  let seconds = 0;
  for (const log of issue.worklogs) if (log.at <= time) seconds += log.seconds;
  return seconds / 3600;
}

