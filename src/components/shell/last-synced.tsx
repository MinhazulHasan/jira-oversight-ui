"use client";

import { Clock, RefreshCw, TriangleExclamationPoint } from "lucide-react";
import { Tooltip } from "radix-ui";
import { useId, type ReactNode } from "react";

import { useHealth } from "@/lib/api/hooks";
import { formatDate, formatDateTime, formatRelative, formatTime } from "@/lib/format";
import { failedSinceLastSync, isStale } from "@/lib/sync";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

import { useCurrentBoard } from "./current-board";
import { useSyncPress } from "./sync-follower";

/** "Last synced" is always visible, so nobody mistakes stale data for live data. */

const PILL = "pressable inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap hover:bg-hover";

/** The state the button's description says, in words: beside the button, never drawn. */
function Status({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} hidden>
      {children}
    </span>
  );
}

function Tip({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Tooltip.Portal>
      <Tooltip.Content
        align="end"
        sideOffset={8}
        className="z-[var(--z-overlay)] max-w-[300px] rounded-md bg-sheet px-3 py-2 text-xs text-ink-mid shadow-pop"
      >
        <span className="block text-ink">{title}</span>
        {children ? <span className="mt-1 block">{children}</span> : null}
      </Tooltip.Content>
    </Tooltip.Portal>
  );
}

export function LastSynced({ className }: { className?: string }) {
  const health = useHealth();
  const now = useNow();
  const { key, board, name } = useCurrentBoard();
  const { state, press, underWay, failedToStart } = useSyncPress(key, name);
  const statusId = useId();

  // A board that has never synced: the board list says so, or the service answers so for this board.
  const notSynced =
    board?.synced === false || health.error?.code === "board_not_synced" || (health.data !== undefined && health.data.last_synced_at === null);
  const label = `Sync ${name ?? "this board"}`;

  if ((health.isPending && !notSynced) || now === null || key === null) {
    return (
      <span className={cn("inline-flex", className)}>
        <span aria-hidden className="skeleton h-4 w-[120px] lg:w-[150px] xl:w-[188px]" />
        <span className="sr-only">Checking when the data was last synced</span>
      </span>
    );
  }

  // The data-source pill beside this already raises the alarm; one warning is enough.
  if (health.isError && !notSynced) {
    return (
      <button
        type="button"
        onClick={() => void health.refetch()}
        aria-label="Sync time unknown. Check again"
        className={cn(PILL, "text-ink-low", className)}
      >
        Sync time unknown
      </button>
    );
  }

  const onPress = () => void press();

  if (underWay) {
    const queued = state?.state === "queued";
    return (
      <SyncPill
        label={label}
        statusId={statusId}
        state={queued ? "queued" : "running"}
        busy
        onPress={onPress}
        icon={
          queued ? (
            <Clock aria-hidden size={13} className="shrink-0 text-ink-low" />
          ) : (
            <RefreshCw aria-hidden size={13} className="shrink-0 text-ink-low motion-safe:animate-spin" />
          )
        }
        status={queued ? "Queued" : "Syncing"}
        tip={
          queued ? (
            <Tip title={`${name ?? "This board"} is queued`}>It starts when the sync before it ends.</Tip>
          ) : (
            <Tip title={`Syncing ${name ?? "this board"}`}>{state?.started_at ? `Started ${formatTime(state.started_at)}.` : null}</Tip>
          )
        }
        className={cn("text-ink-mid", className)}
      >
        <span>{queued ? "Queued" : "Syncing…"}</span>
      </SyncPill>
    );
  }

  if (notSynced) {
    return (
      <SyncPill
        label={label}
        statusId={statusId}
        state="not-synced"
        onPress={onPress}
        icon={<RefreshCw aria-hidden size={12} className="shrink-0" />}
        status="Not synced yet"
        tip={<Tip title={label}>The first sync of a large board can take a few minutes.</Tip>}
        className={cn("text-ink-mid", className)}
      >
        <span className="max-lg:hidden">Not synced yet</span>
      </SyncPill>
    );
  }

  const synced = health.data?.last_synced_at ?? board?.last_synced_at ?? null;
  if (synced === null) return null;
  const failedRun = failedSinceLastSync(state, synced);
  const failed = failedToStart || failedRun;
  const stale = isStale(synced, now);
  const sameDay = formatDate(synced) === formatDate(now);
  const absolute = sameDay ? formatTime(synced) : formatDateTime(synced);
  const relative = formatRelative(synced, { now });
  const warn = stale || failed;

  return (
    <SyncPill
      label={label}
      statusId={statusId}
      state={failed ? "failed" : "synced"}
      onPress={onPress}
      icon={
        warn ? (
          <TriangleExclamationPoint aria-hidden size={13} className="shrink-0 text-warn" />
        ) : (
          <RefreshCw aria-hidden size={12} className="shrink-0" />
        )
      }
      // The state and the sync time, said once, after the name.
      status={
        <>
          {failed ? "Sync failed. " : stale ? "Stale. " : null}Last synced {formatDateTime(synced)}, {relative}.
        </>
      }
      tip={
        <Tip title={label}>
          {failedRun ? `${state?.message ?? "The last sync didn't finish."} ` : failed ? "The last sync didn't start. " : null}
          Last synced {formatDateTime(synced)}.{stale ? " Older than two hours." : null}
        </Tip>
      }
      className={cn(warn ? "text-warn-ink" : "text-ink-low", className)}
    >
      {warn ? (
        <>
          <span className="font-medium">{failed ? "Sync failed" : "Stale"}</span>
          <span>&middot;</span>
        </>
      ) : null}
      <span className="max-lg:hidden">
        <span className="hidden min-[90rem]:inline">{warn ? "last synced" : "Last synced"}</span>
        <span className="min-[90rem]:hidden">{warn ? "synced" : "Synced"}</span>
      </span>
      <time dateTime={synced} className={cn("mono hidden xl:inline", !warn && "text-ink-mid")}>
        {absolute}
      </time>
      <span className="hidden xl:inline">&middot;</span>
      <span>{relative}</span>
    </SyncPill>
  );
}

interface SyncPillProps {
  /** The button's name: "Sync Demo project". */
  label: string;
  statusId: string;
  /** The sync's state, as tests and styles read it from the button. */
  state: "queued" | "running" | "not-synced" | "failed" | "synced";
  /** Queued or running: a press does nothing more. */
  busy?: boolean;
  onPress: () => void;
  /** The pill's mark, which the button is. */
  icon: ReactNode;
  /** The state in words: the button's description. */
  status: ReactNode;
  tip: ReactNode;
  className?: string;
  /** The state drawn beside the mark: hidden from screen readers, who hear the description instead. */
  children: ReactNode;
}

/** The pill. */
function SyncPill({ label, statusId, state, busy = false, onPress, icon, status, tip, className, children }: SyncPillProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span data-sync-now="" className={cn(PILL, "relative", className)}>
          <button
            type="button"
            onClick={onPress}
            aria-label={label}
            aria-describedby={statusId}
            aria-disabled={busy || undefined}
            data-sync-state={state}
            className={cn("jo-stretch inline-flex shrink-0 items-center rounded-md", busy && "cursor-progress")}
          >
            {icon}
          </button>
          <span aria-hidden className="contents">
            {children}
          </span>
        </span>
      </Tooltip.Trigger>
      <Status id={statusId}>{status}</Status>
      {tip}
    </Tooltip.Root>
  );
}
