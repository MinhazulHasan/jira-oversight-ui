"use client";

import { Menu, Search } from "lucide-react";
import { usePathname } from "next/navigation";

import { ISSUE_PAGE, pageForPath } from "@/lib/nav";
import { cn } from "@/lib/utils";

import { BoardSwitcher } from "./board-switcher";
import { useCurrentBoard } from "./current-board";
import { DataSourcePill } from "./data-source";
import { Keys, useAriaShortcut } from "./kbd";
import { LastSynced } from "./last-synced";
import { useShell } from "./shell-context";
import { AdminBadge, SignOutButton } from "./sign-out";
import { ThemeMenu } from "./theme-menu";

/** 56px across the top of the content column. */
export function TopBar({ showSignOut = false, admin = false }: { showSignOut?: boolean; admin?: boolean }) {
  const { setMobileNavOpen } = useShell();

  return (
    <header
      data-print="hide"
      className="sticky top-0 z-[var(--z-sticky)] flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-rule-weak bg-desk px-4 md:px-[var(--gutter)]"
    >
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="pressable -ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-mid hover:bg-hover hover:text-ink md:hidden"
      >
        <Menu aria-hidden size={17} strokeWidth={1.75} />
        <span className="sr-only">Open navigation</span>
      </button>

      {/* Below 768px the board picker sits at the top of the navigation sheet. */}
      <BoardSwitcher className="max-md:hidden" />
      <Whereabouts />

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <DataSourcePill />
        <LastSynced />
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-rule lg:block" />
        <SearchButton />
        {/* Below 1024px the theme lives in the palette, to leave room for the board and the page name. */}
        <div className="hidden lg:block">
          <ThemeMenu />
        </div>
        {admin ? <AdminBadge className="max-md:hidden" /> : null}
        {showSignOut ? <SignOutButton variant="bar" className="max-md:hidden" /> : null}
      </div>
    </header>
  );
}

/** The page you are on by its name, or "Issue / KEY" on an issue. */
function Whereabouts() {
  const pathname = usePathname();
  const page = pageForPath(pathname);
  const { key: board } = useCurrentBoard();
  const issue = /^\/issues\/([^/]+)/.exec(pathname);

  let trail: string | undefined;
  let title: string;
  let mono = false;
  if (page) {
    title = page.label;
  } else if (issue) {
    trail = ISSUE_PAGE.label;
    title = decodeURIComponent(issue[1]).toUpperCase();
    mono = true;
  } else {
    title = "Jira Oversight";
  }

  return (
    <p className="@container flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
      {/* The rule after the board picker (from 768px). Under 3rem there is no room for a name, so both go; on a phone the board code gives way before the page name does. */}
      <span aria-hidden className="mx-1 hidden h-5 w-px shrink-0 bg-rule md:@min-[3rem]:block" />
      {board ? (
        <span className="flex shrink-0 items-center gap-2 @max-[11rem]:sr-only md:hidden" data-board-in-bar>
          <span className="mono text-ink-mid">
            <span className="sr-only">Board </span>
            {board}
          </span>
          <span aria-hidden className="text-ink-dim">
            /
          </span>
        </span>
      ) : null}
      {trail ? (
        <>
          <span className="hidden shrink-0 text-ink-low @min-[12rem]:inline">{trail}</span>
          <span aria-hidden className="hidden shrink-0 text-ink-dim @min-[12rem]:inline">
            /
          </span>
        </>
      ) : null}
      <span className={cn("truncate font-medium text-ink @max-[3rem]:hidden", mono && "mono")}>{title}</span>
    </p>
  );
}

/** "Search or jump to" with its shortcut from 1440px, "Search" from 1280px, and below that the icon alone. */
function SearchButton() {
  const { setPaletteOpen } = useShell();
  const shortcut = useAriaShortcut(["mod", "K"]);

  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-keyshortcuts={shortcut}
      className="pressable inline-flex h-8 shrink-0 items-center gap-2 rounded-md text-sm text-ink-low hover:text-ink-mid max-xl:size-8 max-xl:justify-center max-xl:hover:bg-hover xl:w-[200px] xl:border min-[90rem]:w-[232px] xl:border-rule xl:bg-sheet xl:pr-1.5 xl:pl-2.5 xl:hover:border-rule-strong"
    >
      <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0" />
      {/* One name everywhere, "Search or jump to": the words that do not fit are still read out. */}
      <span className="hidden flex-1 text-left whitespace-nowrap xl:inline">
        Search<span className="max-[90rem]:sr-only">{" or jump to"}</span>
      </span>
      <span className="sr-only xl:hidden">Search or jump to</span>
      <Keys keys={["mod", "K"]} className="hidden xl:inline-flex" />
    </button>
  );
}
