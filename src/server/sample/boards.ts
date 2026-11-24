import { PROJECT_KEY, PROJECT_NAME } from "./catalogue";

export interface SampleBoard {
  key: string;
  /** The board's name as people know it. */
  name: string;
  /** Jira's project type, as GET /projects says it. */
  type: "software" | "business" | "service_desk";
  /** The generator's seed for this board's world. */
  seed: number;
  /** Issues in its world, epics included. */
  issues: number;
  /** Its sprints' ids start after this, so no two boards share a sprint id. */
  sprintBase: number;
  /** Its changelog ids start after this, as each Jira project's own do. */
  changelogBase: number;
  /** Synced when the server starts; false for a board whose first sync is still to come. */
  syncedAtStart: boolean;
}

export const SAMPLE_BOARDS: readonly SampleBoard[] = [
  {
    key: PROJECT_KEY,
    name: PROJECT_NAME,
    type: "software",
    seed: 20261104,
    issues: 1150,
    sprintBase: 4400,
    changelogBase: 310_000,
    syncedAtStart: true,
  },
  {
    key: "MOB",
    name: "Mobile app",
    type: "software",
    seed: 20261117,
    issues: 180,
    sprintBase: 5200,
    changelogBase: 520_000,
    syncedAtStart: true,
  },
  {
    key: "HELP",
    name: "Help desk",
    type: "service_desk",
    seed: 20261118,
    issues: 90,
    sprintBase: 6100,
    changelogBase: 640_000,
    syncedAtStart: false,
  },
];

/** The board served when none is picked: DEMO. */
export const DEFAULT_BOARD: SampleBoard = SAMPLE_BOARDS[0];

/** The sample's board with this key, or null when the sample serves none by it. */
export function sampleBoard(key: string | null | undefined): SampleBoard | null {
  return SAMPLE_BOARDS.find((board) => board.key === key) ?? null;
}
