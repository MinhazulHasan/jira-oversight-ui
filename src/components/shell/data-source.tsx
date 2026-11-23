"use client";

import { RotateCcw, TriangleExclamationPoint } from "lucide-react";
import { Popover, Tooltip } from "radix-ui";

import { useHealth, type Health } from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

/**
 * Where the figures come from. Sample data is always labelled as sample data,
 * in the top bar, at the foot of the rail and on paper: nobody should ever
 * mistake the DEMO project for real work.
 */

export function sourceLabel(health: Health): string {
  return health.data_mode === "sample" ? "Sample data" : `Live · ${health.projects.join(", ")}`;
}

/** Sample is a hollow ring (nothing live behind it); live is a filled green dot. */
function SourceDot({ health }: { health: Health }) {
  return health.data_mode === "sample" ? (
    <span aria-hidden className="inline-block size-2 shrink-0 rounded-full border-[1.5px] border-ink-low" />
  ) : (
    <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-ok" />
  );
}

function useRetry() {
  const health = useHealth();
  return async () => {
    const result = await health.refetch();
    if (result.isSuccess) notify.ok("Data source reachable again", { description: sourceLabel(result.data) });
    else notify.warn("Still unreachable", { description: "The figures on screen may be out of date." });
  };
}

/* ------------------------------------------------------------ top bar ---- */

export function DataSourcePill({ className }: { className?: string }) {
  const health = useHealth();
  const retry = useRetry();

  if (health.isPending) {
    return (
      <span className={cn("inline-flex", className)}>
        {/* As wide as what follows at each width, so the top bar neither jumps nor overflows while it loads. */}
        <span aria-hidden className="skeleton h-[26px] w-[72px] rounded-pill lg:w-[104px] xl:w-[158px]" />
        <span className="sr-only">Checking the data source</span>
      </span>
    );
  }

  // A board that has never synced, on a service with none synced yet (JO-17): reachable, and nothing to say yet.
  if (health.isError && health.error.code === "board_not_synced") {
    return (
      <span
        className={cn(
          "inline-flex h-[26px] items-center gap-1.5 rounded-pill border border-rule bg-sheet px-2.5 text-xs whitespace-nowrap text-ink",
          className,
        )}
      >
        <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-ok" />
        Live
      </span>
    );
  }

  if (health.isError) {
    return (
      <button
        type="button"
        onClick={retry}
        aria-label="Data source unreachable. Retry"
        className={cn(
          "pressable inline-flex h-[26px] items-center gap-1.5 rounded-pill border border-rule bg-sheet px-2.5 text-xs whitespace-nowrap text-warn-ink hover:border-rule-strong",
          className,
        )}
      >
        <TriangleExclamationPoint aria-hidden size={12} className="text-warn" />
        <span className="lg:hidden">Unreachable</span>
        <span className="max-lg:hidden">Data source unreachable</span>
        <RotateCcw aria-hidden size={11} className="text-ink-low" />
      </button>
    );
  }

  const data = health.data;
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          "pressable inline-flex h-[26px] items-center gap-1.5 rounded-pill border border-rule bg-sheet px-2.5 text-xs whitespace-nowrap text-ink-mid hover:border-rule-strong data-[state=open]:border-rule-strong",
          className,
        )}
      >
        <SourceDot health={data} />
        {/* Below 1024px the short word, to leave the top bar room; the name stays the whole label ("Sample data"). */}
        <span className="text-ink">
          <span aria-hidden className="lg:hidden">
            {data.data_mode === "sample" ? "Sample" : "Live"}
          </span>
          <span className="max-lg:sr-only">{sourceLabel(data)}</span>
        </span>
        {data.read_only ? (
          <span className="hidden items-center gap-1.5 xl:inline-flex">
            <span aria-hidden className="text-ink-dim">
              &middot;
            </span>
            read-only
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-[var(--z-overlay)] w-[340px] rounded-lg bg-sheet p-4 shadow-pop outline-none"
        >
          <DataSourceDetails health={data} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DataSourceDetails({ health }: { health: Health }) {
  const hydrated = useHydrated();
  const sample = health.data_mode === "sample";
  // No time zone is named on screen: every time here is in the reader's own. "Board", as the rest of the dashboard
  // says, and nothing a developer reads, such as the API's version (SQA).
  const rows: [string, string][] = [
    ["Board", health.projects.join(", ")],
    ["Access", health.read_only ? "Read-only" : "Read and write"],
    ["Last synced", health.last_synced_at === null ? "Not synced yet" : hydrated ? formatDateTime(health.last_synced_at) : "…"],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="micro text-ink-low">Data source</p>
        <p className="flex items-center gap-2 text-md font-medium text-ink">
          <SourceDot health={health} />
          {sample ? "Sample data" : "Live data"}
        </p>
      </div>
      <p className="text-sm text-ink-mid">
        {sample ? "Fictional boards for trying the dashboard. No real work or people." : "A read-only copy of Jira. Sync brings it up to date."}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-rule-weak pt-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-low">{label}</dt>
            <dd className="mono text-right text-ink-mid">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------- rail foot ---- */

export function DataSourceSummary({ collapsed }: { collapsed: boolean }) {
  const health = useHealth();
  const retry = useRetry();

  if (health.isPending) {
    return collapsed ? (
      <span aria-hidden className="skeleton mx-auto size-2 rounded-full" />
    ) : (
      <div aria-hidden className="flex flex-col gap-1.5 px-2.5 py-1">
        <span className="skeleton h-3 w-24" />
        <span className="skeleton h-3 w-32" />
      </div>
    );
  }

  // A board that has never synced, on a service with none synced yet (JO-17): reachable, and nothing more to say.
  if (health.isError && health.error.code === "board_not_synced") {
    return collapsed ? (
      <span className="mx-auto flex size-9 items-center justify-center">
        <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-ok" />
        <span className="sr-only">Data source: Live</span>
      </span>
    ) : (
      <div className="flex items-center gap-2.5 px-2.5 py-1 text-sm text-ink">
        <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-ok" />
        Live
      </div>
    );
  }

  if (health.isError) {
    return (
      <button
        type="button"
        onClick={retry}
        className={cn(
          "pressable flex items-center gap-2 rounded-[6px] text-left text-xs text-warn-ink hover:bg-hover",
          collapsed ? "mx-auto size-9 justify-center" : "px-2.5 py-1.5",
        )}
        aria-label={collapsed ? "Data source unreachable, retry" : undefined}
      >
        <TriangleExclamationPoint aria-hidden size={13} className="shrink-0 text-warn" />
        {collapsed ? null : <span>Data source unreachable. Retry</span>}
      </button>
    );
  }

  const data = health.data;
  const detail = `${data.projects.join(", ")}${data.read_only ? " · read-only" : ""}`;

  if (collapsed) {
    return (
      <Popover.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Popover.Trigger className="pressable mx-auto flex size-9 items-center justify-center rounded-[6px] hover:bg-hover">
              <SourceDot health={data} />
              <span className="sr-only">
                Data source: {sourceLabel(data)}, {detail}
              </span>
            </Popover.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="right"
              sideOffset={10}
              className="z-[var(--z-overlay)] rounded-md bg-sheet px-2.5 py-1.5 text-xs text-ink shadow-pop"
            >
              {sourceLabel(data)} <span className="text-ink-low">&middot; {detail}</span>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="end"
            sideOffset={12}
            collisionPadding={16}
            className="z-[var(--z-overlay)] w-[340px] rounded-lg bg-sheet p-4 shadow-pop outline-none"
          >
            <DataSourceDetails health={data} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <div className="flex items-start gap-2.5 px-2.5 py-1">
      <span className="mt-[6px] flex">
        <SourceDot health={data} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-ink">{sourceLabel(data)}</span>
        <span className="mono truncate text-xs text-ink-low">{detail}</span>
      </span>
    </div>
  );
}
