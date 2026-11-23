import type { Refresh } from "@/lib/api/schemas";

import { SAMPLE_BOARDS, type SampleBoard } from "./boards";
import { iso } from "./time";

/*
 * "Sync" in the sample (JO-17, JO-18): the sample's stand-in for the
 * service's POST /refresh?project=KEY, kept in memory per server process, as
 * the service keeps its own. There is no Jira behind the sample, so a sync
 * copies nothing; it takes a moment all the same, and follows the service's
 * rules, so every state can be seen and tested:
 *
 * - one sync runs at a time: a second board's sync is queued behind it, never
 *   refused and never run beside it;
 * - pressing Sync again on a board whose sync is queued or running reports
 *   that sync, and so does a press within the cooldown after it finished;
 * - a board's first sync (HELP's) takes twice as long, and once it has
 *   finished the board serves its own small world, like the others.
 *
 * Durations are on the server's own clock (SAMPLE_LATENCY decides them); the
 * times a sync reports are on the sample's clock, as everything it serves is.
 * A restart forgets every sync, and HELP is unsynced again, as a demo should.
 */

/** Never quicker than this, so "Syncing" is seen even with SAMPLE_LATENCY at 0. */
export const SAMPLE_SYNC_MIN_MS = 1_500;
/** A sync takes eight reads' latency, at least SAMPLE_SYNC_MIN_MS; a board's first sync twice that. */
const SYNC_READS = 8;
const FIRST_SYNC_FACTOR = 2;
/** As the service's: a press this soon after a board's sync finished reports it rather than starting another. */
export const SAMPLE_SYNC_COOLDOWN_MS = 30_000;

interface Job {
  board: string;
  /** The sample's clock when it was asked for: what its reported times count from. */
  at: number;
  /** The server's clock: when it was asked for, when it starts (after the sync before it), when it ends. */
  askedAt: number;
  startsAt: number;
  endsAt: number;
  first: boolean;
}

/** Each board's latest sync. */
const jobs = new Map<string, Job>();
const synced = new Set<string>();
/** When the one sync the sample runs at a time is free again (the server's clock). */
let freeAt = 0;

function startOver(): void {
  jobs.clear();
  synced.clear();
  for (const board of SAMPLE_BOARDS) if (board.syncedAtStart) synced.add(board.key);
  freeAt = 0;
}
startOver();

/** A board's first sync counts once it has finished. */
function settle(wallClock: number): void {
  for (const job of jobs.values()) if (job.first && wallClock >= job.endsAt) synced.add(job.board);
}

/** Whether the board has synced at least once (by `wallClock`, the server's own clock). */
export function boardSynced(key: string, wallClock: number = Date.now()): boolean {
  settle(wallClock);
  return synced.has(key);
}

function stateOf(board: SampleBoard, job: Job | undefined, wallClock: number): Refresh {
  if (!job) return { project: board.key, state: "idle", started_at: null, finished_at: null, message: null };
  const started = iso(job.at + (job.startsAt - job.askedAt));
  if (wallClock < job.startsAt) return { project: board.key, state: "queued", started_at: null, finished_at: null, message: null };
  if (wallClock < job.endsAt) return { project: board.key, state: "running", started_at: started, finished_at: null, message: null };
  return { project: board.key, state: "succeeded", started_at: started, finished_at: iso(job.at + (job.endsAt - job.askedAt)), message: null };
}

/** GET /refresh: the board's latest sync, as it stands. */
export function syncState(board: SampleBoard, wallClock: number = Date.now()): Refresh {
  settle(wallClock);
  return stateOf(board, jobs.get(board.key), wallClock);
}

/**
 * POST /refresh: the board's sync, started (queued behind another board's when
 * one is under way) unless it is under way already or has just finished; its
 * state either way. `at` is the sample's clock; `readMs`, a read's latency.
 */
export function startSync(board: SampleBoard, at: number, readMs: number, wallClock: number = Date.now()): Refresh {
  settle(wallClock);
  const current = jobs.get(board.key);
  if (current && (wallClock < current.endsAt || wallClock - current.endsAt < SAMPLE_SYNC_COOLDOWN_MS)) {
    return stateOf(board, current, wallClock);
  }
  const first = !synced.has(board.key);
  const takes = Math.max(SAMPLE_SYNC_MIN_MS, SYNC_READS * readMs) * (first ? FIRST_SYNC_FACTOR : 1);
  const startsAt = Math.max(wallClock, freeAt);
  const job: Job = { board: board.key, at, askedAt: wallClock, startsAt, endsAt: startsAt + takes, first };
  jobs.set(board.key, job);
  freeAt = job.endsAt;
  return stateOf(board, job, wallClock);
}

/** For tests: every board as the server starts, no sync asked for, HELP never synced. */
export function resetSampleSync(): void {
  startOver();
}
