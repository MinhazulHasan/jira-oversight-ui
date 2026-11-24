"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useHealth, useProjects, type ProjectSummary } from "@/lib/api/hooks";
import { boardFromCookieHeader } from "@/lib/board";
import { useHydrated } from "@/lib/use-hydrated";

/* The board every page reads. */

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
