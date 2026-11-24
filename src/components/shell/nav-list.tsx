"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "radix-ui";

import { NAV_GROUPS, navPagesFor, pageForPath, type NavPage } from "@/lib/nav";
import { cn } from "@/lib/utils";

import { Keys } from "./kbd";
import { NAV_ICONS } from "./nav-icons";
import { usePeopleLevel } from "./people-level";

/** The pages, grouped. */
export function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = pageForPath(pathname);
  const offered = navPagesFor(usePeopleLevel());
  // A group with nothing for this reader (Governance, at team level) is not shown at all, heading and all.
  const groups = NAV_GROUPS.map((group) => ({ group, pages: offered.filter((page) => page.group === group.id) })).filter(
    (entry) => entry.pages.length > 0,
  );

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ group, pages }, groupIndex) => {
        const labelId = `nav-group-${group.id}`;
        return (
          <div key={group.id} className="flex flex-col gap-1">
            {collapsed ? (
              groupIndex > 0 ? (
                <span aria-hidden className="mx-auto mb-2 h-px w-6 bg-rule" />
              ) : null
            ) : (
              <p id={labelId} className="micro px-2.5 pb-1 text-ink-low">
                {group.label}
              </p>
            )}
            <ul
              className="flex flex-col gap-0.5"
              {...(collapsed ? { "aria-label": group.label } : { "aria-labelledby": labelId })}
            >
              {pages.map((page) => (
                <li key={page.key}>
                  <NavLink
                    page={page}
                    active={current?.key === page.key}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function NavLink({
  page,
  active,
  collapsed,
  onNavigate,
}: {
  page: NavPage;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[page.key];

  const link = (
    <Link
      href={page.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "pressable group flex h-[var(--row-nav)] items-center gap-2.5 rounded-[6px] text-sm",
        collapsed ? "mx-auto w-10 justify-center" : "px-2.5",
        active
          ? "bg-pressed font-medium text-ink"
          : "text-ink-mid hover:bg-hover hover:text-ink",
      )}
    >
      <Icon
        aria-hidden
        size={16}
        strokeWidth={active ? 2 : 1.75}
        className={cn("shrink-0", active ? "text-ink" : "text-ink-low group-hover:text-ink-mid")}
      />
      <span className={collapsed ? "sr-only" : "truncate"}>{page.label}</span>
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-[var(--z-overlay)] flex items-center gap-2.5 rounded-md bg-sheet px-2.5 py-1.5 text-xs text-ink shadow-pop"
        >
          {page.label}
          <Keys keys={["G", page.chord.toUpperCase()]} joiner="then" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
