import "server-only";

import { projectsSchema, type PersonCard, type Projects } from "@/lib/api/schemas";

import type { ServerConfig } from "./env";
import { forward } from "./live";
import { sampleResponse } from "./sample";
import { sampleNow } from "./sample/clock";
import { sampleDataset } from "./sample/dataset";
import { sampleBoardsAt } from "./sample/served";

/** The boards this dashboard serves, and one person's share of them */

/** The served boards' keys, the service's default first; or null when the service cannot say. */
export async function servedBoards(config: ServerConfig): Promise<string[] | null> {
  let body: unknown;
  if (config.mode === "sample") {
    const now = sampleNow(config.sample.now);
    const answer = sampleResponse(sampleDataset(now), { name: "projects" }, 0, { peopleComparison: config.sample.peopleComparison, boards: sampleBoardsAt(now) });
    if (!answer.found) return null;
    body = answer.body;
  } else {
    // The same request the top bar's board list makes, so the same checks apply to the answer.
    const response = await forward(config.live, { route: { name: "projects" }, upstream: "projects" });
    if (!response.ok) return null;
    body = await response.json();
  }
  const parsed = projectsSchema.safeParse(body);
  if (!parsed.success) return null;
  // Each board once, even if the service lists one twice: a session with a repeated key would never open.
  return [...new Set([parsed.data.default, ...parsed.data.projects.map((project) => project.key)])];
}

export function cardForBoards(card: PersonCard, allowed: readonly string[] | null): PersonCard {
  if (allowed === null) return card;
  return { ...card, other_boards: card.other_boards.filter((board) => allowed.includes(board.key)) };
}

/** The board list cut down to the boards a person may read, in the service's */
export function projectsFor(projects: Projects, allowed: readonly string[]): Projects | null {
  const mine = projects.projects.filter((project) => allowed.includes(project.key));
  if (mine.length === 0) return null;
  if (mine.some((project) => project.key === projects.default)) return { default: projects.default, projects: mine };
  const first = allowed.find((key) => mine.some((project) => project.key === key)) ?? mine[0].key;
  return { default: first, projects: mine };
}
