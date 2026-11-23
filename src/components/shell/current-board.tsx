"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useHealth, useProjects, type ProjectSummary } from "@/lib/api/hooks";
import { boardFromCookieHeader } from "@/lib/board";
import { useHydrated } from "@/lib/use-hydrated";

/*
 * The board every page reads (JO-17): the one the service says it served
 * (health), else the pick in the jo-board cookie when the board list holds it,
 * else the list's default. The top bar's picker and Sync, and the state every
 * page shows for a board that has not synced yet, all read it from here, so
 * they never disagree about which board is on screen.
 *
 * The pick is the cookie's: the server's reading of it for the page it
 * rendered (BoardPickProvider, from the (app) layout) until the page has
 * hydrated, the browser's after. A switch always ends in a whole page load,
 * so the two are the same; reading the server's first means the first render
 * already knows the board, and never shows another board's page for a moment.
 */

const BoardPickContext = createContext<string | null>(null);

export function BoardPickProvider({ board, children }: { board: string | null; children: ReactNode }) {
  return <BoardPickContext.Provider value={board}>{children}</BoardPickContext.Provider>;
}

export interface CurrentBoard {
  /** Its key as soon as anything says it; null while nothing does yet. */
  key: string | null;
  /** The board as the board list has it; null while the list loads, cannot be read, or does not hold the key. */
  board: ProjectSummary | null;
  /** The board's name for a sentence or a button: the list's, else its key. */
  name: string | null;
  /** The pick in the cookie, checked; null for none (the service's default is read). */
  picked: string | null;
}

export function useCurrentBoard(): CurrentBoard {
  const projects = useProjects();
  const health = useHealth();
  const hydrated = useHydrated();
  const served = useContext(BoardPickContext);
  const picked = hydrated ? boardFromCookieHeader(document.cookie) : served;

  const list = projects.data?.projects;
  const listed = picked !== null && list !== undefined ? list.some((board) => board.key === picked) : picked !== null;
  const key = health.data?.projects[0] ?? (listed ? picked : null) ?? projects.data?.default ?? null;
  const board = list?.find((candidate) => candidate.key === key) ?? null;
  return { key, board, name: board?.name ?? key, picked };
}
