"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { invalidateAfterSync, isApiError, syncUnderWay, useBoardSync, type BoardSync, type Refresh } from "@/lib/api/hooks";
import { notify } from "@/lib/notify";

import { useCurrentBoard } from "./current-board";

/* Sync syncs the board on screen. */

/** Each end said once: a press answered "just finished" and the follower can both see the same one. */
const announced = new Set<string>();

/** Says how a board's sync ended, once; a sync that succeeded reloads every figure on screen first. */
export async function announceSync(queryClient: QueryClient, state: Refresh, name: string): Promise<void> {
  if (state.state !== "succeeded" && state.state !== "failed") return;
  const id = `${state.project}|${state.state}|${state.finished_at ?? ""}`;
  if (announced.has(id)) return;
  announced.add(id);
  if (state.state === "succeeded") {
    // Every figure on every page was worked out from the snapshot before it (governance aside): read them again.
    await invalidateAfterSync(queryClient);
    notify.ok(`${name} synced`, { id: `sync-${state.project}` });
  } else {
    notify.warn(`${name} didn't sync`, { id: `sync-${state.project}`, description: state.message ?? "Try again in a few minutes." });
  }
}

/** What a press that never reached the service is told: plain words, never an HTTP status. */
export const SYNC_UNREACHABLE = "Couldn't reach the service. Try again.";

/** Why a press failed, in words fit for the toast. */
export function pressFailure(error: unknown): string {
  return isApiError(error) && error.status >= 400 && error.status < 500 && error.code !== "http_error" ? error.message : SYNC_UNREACHABLE;
}

/** For tests: forget which ends were said. */
export function forgetAnnouncedSyncs(): void {
  announced.clear();
}

export interface SyncPress extends Omit<BoardSync, "start"> {
  /** Syncs the board, or joins its sync under way; says so when it is queued, failed to start, or had just ended. */
  press: () => Promise<void>;
  /** The board's sync is queued, running, or a press is on its way. */
  underWay: boolean;
  /** The last press for this board failed before the service took it: Sync says so until a press gets through. */
  failedToStart: boolean;
}

/** Sync for the board on screen, `key` and `name` as the top bar shows them. */
export function useSyncPress(key: string | null, name: string | null): SyncPress {
  const queryClient = useQueryClient();
  const sync = useBoardSync(key);
  const underWay = sync.starting || syncUnderWay(sync.state);
  const { start } = sync;
  const label = name ?? key ?? "This board";
  // The board whose last press never reached the service: the toast goes, so Sync keeps saying so.
  const [failedFor, setFailedFor] = useState<string | null>(null);

  const press = useCallback(async () => {
    if (key === null || underWay) return;
    try {
      const state = await start();
      setFailedFor(null);
      if (state.state === "queued") {
        notify.info(`${label} is queued`, { id: `sync-${state.project}`, description: "It starts when the sync before it ends." });
      } else if (!syncUnderWay(state)) {
        await announceSync(queryClient, state, label);
      }
    } catch (error) {
      setFailedFor(key);
      notify.warn(`Couldn't sync ${label}`, { id: `sync-${key}`, description: pressFailure(error) });
    }
  }, [key, underWay, start, queryClient, label]);

  return { state: sync.state, starting: sync.starting, press, underWay, failedToStart: key !== null && failedFor === key };
}

/** Mounted once, in the (app) layout. */
export function SyncFollower() {
  const queryClient = useQueryClient();
  const { key, name } = useCurrentBoard();
  const { state } = useBoardSync(key);
  const before = useRef<Refresh | undefined>(undefined);

  useEffect(() => {
    const previous = before.current;
    before.current = state;
    if (!state || !previous || state.project !== previous.project) return;
    if (syncUnderWay(previous) && !syncUnderWay(state)) void announceSync(queryClient, state, name ?? state.project);
  }, [state, name, queryClient]);

  return null;
}
