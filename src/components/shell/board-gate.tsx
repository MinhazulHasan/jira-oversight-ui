"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CloudDownload, RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { oversightKeys } from "@/lib/api/hooks";
import { formatTime } from "@/lib/format";
import { ISSUE_PAGE, pageForPath, type PageKey } from "@/lib/nav";
import { useHydrated } from "@/lib/use-hydrated";

import { useCurrentBoard } from "./current-board";
import { PageBody, PageHeader, PageSheet } from "./page";
import { usePeopleLevel } from "./people-level";
import { useSyncPress } from "./sync-follower";

/* A board that has never synced has nothing to show yet. */

/** The pages that read no one board: shown whatever board is picked. */
const BOARDLESS_PAGES: ReadonlySet<PageKey> = new Set(["portfolio", "access_log", "usage"]);

/** Whether the page at `pathname` reads the board picked in the top bar. Unknown addresses (a not-found page) do not. */
export function readsOneBoard(pathname: string, peopleLevel: boolean): boolean {
  if (pathname.startsWith("/issues/")) return true;
  const page = pageForPath(pathname);
  if (!page || BOARDLESS_PAGES.has(page.key)) return false;
  // A people-level page is not found for anyone else, whatever the board.
  return page.level !== "people" || peopleLevel;
}

function useNotSyncedAnswer(board: string | null, listed: boolean): boolean {
  const queryClient = useQueryClient();
  const [seen, setSeen] = useState<string | null>(null);
  const reread = useRef(new Set<string>());
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error" || board === null) return;
        const error = event.action.error as { code?: unknown } | null;
        if (error?.code !== "board_not_synced") return;
        setSeen(board);
        if (listed && !reread.current.has(board)) {
          reread.current.add(board);
          void queryClient.invalidateQueries({ queryKey: oversightKeys.projects(), exact: true });
        }
      }),
    [queryClient, board, listed],
  );
  return seen !== null && seen === board;
}

/** The (app) layout's content column: the page, or for a board not synced yet, the state that offers its first sync. */
export function BoardGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const peopleLevel = usePeopleLevel();
  const { key, board, name } = useCurrentBoard();
  const answered = useNotSyncedAnswer(key, board !== null);

  if (key === null || !readsOneBoard(pathname, peopleLevel)) return children;
  // The board list decides; until it has said, a request that met the service's answer does.
  const notSynced = board !== null ? !board.synced : answered;
  if (!notSynced) return children;
  return <NotSyncedPage boardKey={key} name={name ?? key} />;
}

function NotSyncedPage({ boardKey, name }: { boardKey: string; name: string }) {
  const pathname = usePathname();
  const page = pageForPath(pathname);
  return (
    <PageSheet>
      <PageHeader title={page?.label ?? ISSUE_PAGE.label} purpose={page?.purpose ?? ISSUE_PAGE.purpose} />
      <PageBody>
        <NotSyncedState boardKey={boardKey} name={name} />
      </PageBody>
    </PageSheet>
  );
}

/** The board's first sync, offered. */
export function NotSyncedState({ boardKey, name }: { boardKey: string; name: string }) {
  const { state, press, underWay } = useSyncPress(boardKey, name);
  const hydrated = useHydrated();
  const queued = underWay && state?.state === "queued";
  const failed = !underWay && state?.state === "failed";

  return (
    <section aria-labelledby="not-synced-title" data-not-synced={boardKey} className="flex flex-col items-center gap-4 px-2 py-10 text-center md:py-16">
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-md border-[1.5px] border-dashed border-rule-strong text-ink-low"
      >
        <CloudDownload size={18} strokeWidth={1.75} />
      </span>
      <div className="flex max-w-[52ch] flex-col gap-1.5">
        <h2 id="not-synced-title" className="text-md font-medium text-ink">
          {name} hasn&rsquo;t been synced yet.
        </h2>
        <p className="text-sm text-ink-mid">The first sync of a large board can take a few minutes.</p>
      </div>

      <div className="flex w-full max-w-[320px] flex-col items-center gap-3">
        {failed ? (
          <p role="alert" className="text-sm text-warn-ink">
            {/* The service's own words when it gave some (they say the sync failed, and why): said once. */}
            {state?.message ?? "The last sync didn’t finish. Try again in a few minutes."}
          </p>
        ) : null}
        <Button variant="primary" size="lg" icon={RefreshCw} loading={underWay} onClick={() => void press()} data-sync-board={boardKey}>
          {queued ? "Queued" : underWay ? `Syncing ${name}…` : `Sync ${name}`}
        </Button>
        {underWay ? (
          <>
            <div
              role="progressbar"
              aria-label={queued ? `${name} is queued` : `Syncing ${name}`}
              aria-valuetext={queued ? "Queued" : "Syncing"}
              className="relative h-1 w-full overflow-hidden rounded-pill bg-hover"
            >
              {queued ? null : (
                <span className="absolute inset-y-0 w-[40%] rounded-pill bg-ink-mid motion-safe:[animation:jo-sweep_1400ms_var(--ease-in-out)_infinite] motion-reduce:left-0 motion-reduce:w-full motion-reduce:opacity-40" />
              )}
            </div>
            <p role="status" className="text-sm text-ink-mid">
              {queued
                ? "It starts when the sync before it ends."
                : hydrated && state?.started_at
                  ? `Started ${formatTime(state.started_at)}.`
                  : null}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
