import { SAMPLE_BOARDS, type SampleBoard } from "./boards";
import { buildDataset, CATALOGUE_SETTINGS, memo, sampleDataset, type Dataset } from "./dataset";
import { boardSynced } from "./sync";

/*
 * The sample's boards as one request sees them (JO-17): which have synced, and
 * each synced board's dataset at the request's "now". What answers for more
 * than one board reads them through this: the board list, the Portfolio, and
 * the other boards a person card names.
 */

export interface ServedBoards {
  /** Whether the board has synced at least once. */
  synced(board: SampleBoard): boolean;
  /** The board's dataset (only asked for a synced board). */
  dataset(board: SampleBoard): Dataset;
}

/** As the server serves them: the cached datasets at `now`, and the sync state of this process (sync.ts). */
export function sampleBoardsAt(now: number, wallClock: number = Date.now()): ServedBoards {
  return {
    synced: (board) => boardSynced(board.key, wallClock),
    dataset: (board) => sampleDataset(now, board),
  };
}

/**
 * Around a dataset the tests built: the other boards fresh at its "now", each
 * built once and kept with it, and synced as the server starts (HELP not).
 */
export function boardsAround(dataset: Dataset): ServedBoards {
  return {
    synced: (board) => board.key === dataset.board.key || board.syncedAtStart,
    dataset: (board) =>
      board.key === dataset.board.key ? dataset : memo(dataset, `board:${board.key}`, () => buildDataset(dataset.now, CATALOGUE_SETTINGS, board)),
  };
}

/**
 * Every board in the order GET /projects lists them (the service's order): the default first, then the synced
 * boards by name, then the boards not synced yet by name.
 */
export function boardsInOrder(boards: ServedBoards): SampleBoard[] {
  const [first, ...rest] = SAMPLE_BOARDS;
  const byName = (a: SampleBoard, b: SampleBoard) => a.name.localeCompare(b.name, "en");
  return [
    first,
    ...rest.filter((board) => boards.synced(board)).sort(byName),
    ...rest.filter((board) => !boards.synced(board)).sort(byName),
  ];
}
