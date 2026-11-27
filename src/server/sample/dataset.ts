import type { Meta } from "@/lib/api/schemas";

import { boardRules, NO_OVERRIDES, settingsKey, type BoardOverrides, type BoardRule } from "./board-rules";
import type { CustomRuleRecord } from "./custom-rules";
import { DEFAULT_BOARD, SAMPLE_BOARDS, type SampleBoard } from "./boards";
import { REPORT_TIMEZONE, PROCESS_VERSION, RULES_VERSION } from "./catalogue";
import { lastRun, runEngine, type Engine, type FindingRecord } from "./engine";
import { activeIgnores, ignoresGeneration, NO_IGNORES, withIgnores, type Ignores } from "./ignores";
import { recheck, type RecheckOutcome } from "./recheck";
import { boardSettings, revisionOf, settingsGeneration, type BoardSettings } from "./settings-store";
import { floorToMinute, iso } from "./time";
import { buildWorld, type World } from "./world";

/** One of the sample's boards (boards.ts) for one "now" and one revision of */
export interface Dataset {
  /** The board this is: DEMO, unless another was asked for. */
  board: SampleBoard;
  now: number;
  world: World;
  /** The findings every view reads: the board's ignores resolve theirs as ignored. */
  engine: Engine;
  /** The findings as the rules alone leave them, before any ignore: what a rule settings re-check starts from. */
  baseEngine: Engine;
  /** The board's ignores as they stand. */
  ignores: Ignores;
  memo: Map<string, unknown>;
  /** Every catalogue rule as the board's settings make it, in catalogue order, then its own rules that stand. */
  rules: readonly BoardRule[];
  /** The board's settings revision the findings reflect: 0 while it runs the catalogue's. */
  revision: number;
}

/** What a board's settings are at a revision: what differs from the catalogue, and its own rules, deleted ones too. */
export interface BoardState {
  overrides: BoardOverrides;
  custom: readonly CustomRuleRecord[];
}

/** No settings: every rule as the catalogue has it, and none of the board's own. */
export const CATALOGUE_STATE: BoardState = { overrides: NO_OVERRIDES, custom: [] };

/** A board's settings revision by revision, oldest first: what each made, and when it was saved. */
export interface SettingsHistory {
  revisions: readonly { state: BoardState; at: number }[];
}

/** No settings: every rule as the catalogue has it. */
export const CATALOGUE_SETTINGS: SettingsHistory = { revisions: [] };

/* The caches: each keyed by the board, the minute "now" falls in, and the settings' generation (settings-store.ts). */
const worlds = new Map<string, World>();
/** The engine over a world under one board's settings: equal settings share one, an undo back to the catalogue too. */
const engines = new Map<string, Engine>();
/** The board's findings after each revision's re-check, so the next save starts where the last left off. */
const chains = new Map<string, { engine: Engine; rules: readonly BoardRule[] }>();
const datasets = new Map<string, Dataset>();
/** The current anchor and the one before it, so a request in flight across a resync (or a save) still resolves. */
const KEEP = 3;
/** Each board keeps its own: DEMO's are never pushed out by another board's. */
const SAMPLE_BOARD_COUNT = SAMPLE_BOARDS.length;

function remember<K, V>(cache: Map<K, V>, key: K, value: V, keep: number): V {
  cache.set(key, value);
  while (cache.size > keep) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/** Caching on (the server's datasets) or off (a fresh dataset, as the tests build one). */
interface Build {
  board: SampleBoard;
  minute: number;
  world: World;
  cached: boolean;
  generation: number;
}

function engineFor(build: Build, state: BoardState): Engine {
  const key = `${build.board.key}|${build.minute}|${settingsKey(state.overrides, state.custom)}`;
  const known = build.cached ? engines.get(key) : undefined;
  if (known) return known;
  const engine = runEngine(build.world, boardRules(state.overrides, state.custom));
  return build.cached ? remember(engines, key, engine, 8 * SAMPLE_BOARD_COUNT) : engine;
}

/** When a revision's re-check ran, in the world's time: the save's moment, but */
function recheckTime(world: World, now: number, savedAt: number): number {
  return Math.min(Math.max(savedAt, lastRun(world)), now);
}

/** The board's findings after every revision's re-check in turn, from the catalogue's. */
function settle(build: Build, now: number, history: SettingsHistory): { engine: Engine; rules: readonly BoardRule[] } {
  const chainKey = (step: number) => `${build.board.key}|${build.minute}|${build.generation}|${step}`;
  let step = history.revisions.length;
  let reached = build.cached ? chains.get(chainKey(step)) : undefined;
  while (!reached && step > 0) {
    step -= 1;
    reached = build.cached ? chains.get(chainKey(step)) : undefined;
  }
  let { engine, rules } = reached ?? { engine: engineFor(build, CATALOGUE_STATE), rules: boardRules() };
  for (const [index, revision] of history.revisions.entries()) {
    if (index < step) continue;
    const next = boardRules(revision.state.overrides, revision.state.custom);
    engine = recheck(engine, engineFor(build, revision.state), next, recheckTime(build.world, now, revision.at)).engine;
    rules = next;
    if (build.cached) remember(chains, chainKey(index + 1), { engine, rules }, 16 * SAMPLE_BOARD_COUNT);
  }
  return { engine, rules };
}

function assemble(board: SampleBoard, now: number, history: SettingsHistory, cached: boolean, ignores: Ignores): Dataset {
  const minute = floorToMinute(now);
  const worldKey = `${board.key}|${minute}`;
  const world = cached
    ? (worlds.get(worldKey) ?? remember(worlds, worldKey, buildWorld(minute, board), 2 * SAMPLE_BOARD_COUNT))
    : buildWorld(minute, board);
  const { engine: baseEngine, rules } = settle({ board, minute, world, cached, generation: settingsGeneration() }, minute, history);
  // An ignore holds from when it was made, read as a re-check reads a save: never before the last rules run.
  const engine = withIgnores(baseEngine, ignores, (at) => recheckTime(world, minute, at));
  return { board, now: minute, world, engine, baseEngine, ignores, memo: new Map(), rules, revision: history.revisions.length };
}

export function buildDataset(
  now: number,
  history: SettingsHistory = CATALOGUE_SETTINGS,
  board: SampleBoard = DEFAULT_BOARD,
  ignores: Ignores = NO_IGNORES,
): Dataset {
  return assemble(board, now, history, false, ignores);
}

export function historyOf(settings: BoardSettings): SettingsHistory {
  return { revisions: settings.history.map((change) => ({ state: { overrides: change.overrides, custom: change.custom }, at: change.at })) };
}

/** A sample board (DEMO unless another is named) at `now`, under its rule settings as they stand (settings-store.ts). */
export function sampleDataset(now: number, board: SampleBoard = DEFAULT_BOARD): Dataset {
  const settings = boardSettings(board.key);
  const key = `${board.key}|${floorToMinute(now)}|${settingsGeneration()}|${revisionOf(settings)}|${ignoresGeneration()}`;
  return (
    datasets.get(key) ??
    remember(datasets, key, assemble(board, now, historyOf(settings), true, activeIgnores(board.key)), KEEP * SAMPLE_BOARD_COUNT)
  );
}

/** What a re-check under `overrides` would do to the dataset's findings at `at`, */
export function simulateRecheck(dataset: Dataset, state: BoardState, at: number): RecheckOutcome & { rules: BoardRule[] } {
  const build: Build = { board: dataset.board, minute: dataset.now, world: dataset.world, cached: true, generation: settingsGeneration() };
  const rules = boardRules(state.overrides, state.custom);
  const outcome = recheck(dataset.baseEngine, engineFor(build, state), rules, recheckTime(dataset.world, dataset.now, at));
  // An ignored ticket and rule stays ignored whatever the settings: its findings neither open nor close with them.
  const judged = (finding: FindingRecord) => finding.issue === null || dataset.ignores.covers(finding.issue.key, [finding.rule.id]) === null;
  return { ...outcome, opened: outcome.opened.filter(judged), closed: outcome.closed.filter(judged), rules };
}

/** A view computed once per dataset. */
export function memo<T>(dataset: Dataset, key: string, compute: () => T): T {
  if (dataset.memo.has(key)) return dataset.memo.get(key) as T;
  const value = compute();
  dataset.memo.set(key, value);
  return value;
}

export function meta(dataset: Dataset): Meta {
  return {
    data_mode: "sample",
    last_synced_at: iso(dataset.world.syncAt),
    projects: [dataset.board.key],
    rules_version: RULES_VERSION,
    process_version: PROCESS_VERSION,
    generated_at: iso(dataset.now),
    report_timezone: REPORT_TIMEZONE,
  };
}
