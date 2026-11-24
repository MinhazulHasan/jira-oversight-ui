"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { Tooltip } from "radix-ui";

import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";
import { DataSourceSummary } from "./data-source";
import { Keys, useAriaShortcut } from "./kbd";
import { NavList } from "./nav-list";
import { useShell } from "./shell-context";

/** The left rail. */
export function Rail() {
  const { railCollapsed: collapsed, toggleRail } = useShell();

  return (
    <aside
      id="rail"
      aria-label="Sidebar"
      data-print="hide"
      data-collapsed={collapsed}
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-rule-weak bg-rail md:flex",
        "transition-[width] duration-[var(--dur)] ease-[var(--ease-out)]",
        collapsed ? "w-[var(--rail-w-collapsed)]" : "w-[var(--rail-w)]",
      )}
    >
      <div
        className={cn(
          "flex h-[var(--topbar-h)] shrink-0 items-center border-b border-rule-weak",
          collapsed ? "justify-center" : "px-4",
        )}
      >
        <BrandLink collapsed={collapsed} />
      </div>

      <nav aria-label="Primary" className="scroll-region flex-1 px-3 py-4">
        <NavList collapsed={collapsed} />
      </nav>

      <div className="flex shrink-0 flex-col gap-2 border-t border-rule-weak px-3 py-3">
        {collapsed ? null : <ShortcutHints />}
        <DataSourceSummary collapsed={collapsed} />
        <CollapseButton collapsed={collapsed} onToggle={toggleRail} />
      </div>
    </aside>
  );
}

export function BrandLink({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="pressable -m-1 flex min-w-0 items-center gap-2.5 rounded-md p-1 hover:bg-hover"
    >
      <BrandMark size={26} className="shrink-0" />
      {collapsed ? (
        <span className="sr-only">Jira Oversight, Overview</span>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">
            Jira Oversight
          </span>
          <span className="truncate text-xs text-ink-low">ManCo Central</span>
        </span>
      )}
    </Link>
  );
}

const HINT =
  "pressable flex h-7 items-center justify-between rounded-[5px] px-1.5 text-left hover:bg-hover hover:text-ink-mid";

function ShortcutHints() {
  const { setPaletteOpen, setShortcutsOpen } = useShell();
  const paletteShortcut = useAriaShortcut(["mod", "K"]);
  return (
    <div className="flex flex-col px-1 pb-1 text-xs text-ink-low">
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-keyshortcuts={paletteShortcut}
        className={HINT}
      >
        Search or jump
        <Keys keys={["mod", "K"]} />
      </button>
      <button
        type="button"
        onClick={() => setShortcutsOpen(true)}
        aria-keyshortcuts="?"
        className={HINT}
      >
        All shortcuts
        <Keys keys={["?"]} />
      </button>
    </div>
  );
}

function CollapseButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const shortcut = useAriaShortcut(["["]);
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  const button = (
    <button
      type="button"
      onClick={onToggle}
      aria-controls="rail"
      aria-keyshortcuts={shortcut}
      className={cn(
        "pressable flex h-8 items-center gap-2.5 rounded-[6px] text-xs text-ink-low hover:bg-hover hover:text-ink",
        collapsed ? "mx-auto w-10 justify-center" : "px-2.5",
      )}
    >
      <Icon aria-hidden size={15} strokeWidth={1.75} className="shrink-0" />
      {collapsed ? (
        <span className="sr-only">Expand navigation</span>
      ) : (
        <>
          <span className="flex-1 text-left">
            Collapse<span className="sr-only"> navigation</span>
          </span>
          <Keys keys={["["]} />
        </>
      )}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-[var(--z-overlay)] flex items-center gap-2.5 rounded-md bg-sheet px-2.5 py-1.5 text-xs text-ink shadow-pop"
        >
          Expand navigation
          <Keys keys={["["]} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
