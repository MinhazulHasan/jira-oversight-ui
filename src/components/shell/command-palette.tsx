"use client";

import { Command } from "cmdk";
import {
  Check,
  Hash,
  Keyboard,
  Link2,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useState, type ReactNode } from "react";

import { useHealth } from "@/lib/api/hooks";
import { copyCurrentLink } from "@/lib/copy-link";
import { navigateGuarded } from "@/lib/leave-guard";
import { parseIssueKey } from "@/lib/issue-key";
import { navPagesFor } from "@/lib/nav";

import { Keys } from "./kbd";
import { NAV_ICONS } from "./nav-icons";
import { usePeopleLevel } from "./people-level";
import { useShell } from "./shell-context";
import { useSignOut } from "./sign-out";
import { THEME_CHOICES, useThemeSwitch } from "./theme-menu";

/** Cmd/Ctrl+K. */
export function CommandPalette({ showSignOut = false }: { showSignOut?: boolean }) {
  const router = useRouter();
  const shell = useShell();
  const health = useHealth();
  const { theme, choose } = useThemeSwitch();
  const signOut = useSignOut();
  const pages = navPagesFor(usePeopleLevel());
  const [query, setQuery] = useState("");

  const projects = health.data?.projects ?? [];
  const issueKey = parseIssueKey(query, projects.length === 1 ? projects[0] : undefined);
  const question = query.trim();

  const setOpen = (open: boolean) => {
    shell.setPaletteOpen(open);
    if (!open) setQuery("");
  };

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  // A page with unsaved work asks first (lib/leave-guard.ts).
  const go = (href: string) => run(() => navigateGuarded(() => router.push(href)));

  return (
    <Dialog.Root open={shell.paletteOpen} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both]" />
        <Dialog.Content
          className="jo-palette fixed top-[12vh] left-1/2 z-[var(--z-overlay)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg bg-sheet shadow-pop outline-none data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-rise_200ms_var(--ease-out)_both]"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Go to a page, open an issue by its key, ask a question, or change a setting.
          </Dialog.Description>

          <Command label="Command palette" loop vimBindings={false}>
            <div className="flex items-center gap-3 border-b border-rule-weak px-4">
              <Search aria-hidden size={16} className="shrink-0 text-ink-low" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Go to a page, type an issue key, or ask a question"
                className="h-[52px] min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-low"
              />
              <Keys keys={["Esc"]} />
            </div>

            <Command.List className="scroll-region max-h-[min(440px,58vh)] p-2">
              {/* cmdk counts only filtered items, so beside a forced item "Empty" would show too. */}
              {question ? null : (
                <Command.Empty className="px-3 py-8 text-center text-sm text-ink-low">
                  Nothing matches that.
                </Command.Empty>
              )}

              {/* Forced groups: cmdk hides a group whose items did not match the filter, forced or not. */}
              {issueKey ? (
                <Command.Group heading="Jump to issue" forceMount>
                  <Item
                    value={`issue ${issueKey}`}
                    forceMount
                    icon={Hash}
                    hint="Issue"
                    onSelect={() => go(`/issues/${issueKey}`)}
                  >
                    Open <span className="mono font-medium text-ink">{issueKey}</span>
                  </Item>
                </Command.Group>
              ) : null}

              <Command.Group heading="Go to">
                {pages.map((page) => (
                  <Item
                    key={page.key}
                    value={page.label}
                    keywords={page.keywords}
                    icon={NAV_ICONS[page.key]}
                    hint={<Keys keys={["G", page.chord.toUpperCase()]} joiner="then" />}
                    onSelect={() => go(page.href)}
                  >
                    {page.label}
                  </Item>
                ))}
              </Command.Group>

              {question && !issueKey ? (
                <Command.Group heading="Ask" forceMount>
                  <Item
                    value={`ask ${question}`}
                    forceMount
                    icon={MessageSquareText}
                    hint="Ask"
                    onSelect={() => go(`/ask?q=${encodeURIComponent(question)}`)}
                  >
                    <span className="truncate">
                      Ask <span className="text-ink">&ldquo;{question}&rdquo;</span>
                    </span>
                  </Item>
                </Command.Group>
              ) : null}

              <Command.Group heading="Actions">
                <Item value="Copy link to this view" keywords={["share", "url"]} icon={Link2} onSelect={() => run(copyCurrentLink)}>
                  Copy link to this view
                </Item>
                {THEME_CHOICES.map((choice) => (
                  <Item
                    key={choice.value}
                    value={`${choice.label} theme`}
                    keywords={["theme", "appearance", "mode"]}
                    icon={choice.icon}
                    hint={
                      theme === choice.value ? (
                        <>
                          <Check aria-hidden size={14} className="text-ink" />
                          <span className="sr-only">(current)</span>
                        </>
                      ) : (
                        choice.hint
                      )
                    }
                    onSelect={() => run(() => choose(choice.value))}
                  >
                    {choice.label} theme
                  </Item>
                ))}
                <Item
                  value={shell.railCollapsed ? "Expand navigation" : "Collapse navigation"}
                  keywords={["sidebar", "rail"]}
                  icon={shell.railCollapsed ? PanelLeftOpen : PanelLeftClose}
                  hint={<Keys keys={["["]} />}
                  onSelect={() => run(shell.toggleRail)}
                >
                  {shell.railCollapsed ? "Expand navigation" : "Collapse navigation"}
                </Item>
                <Item
                  value="Keyboard shortcuts"
                  keywords={["keys", "help", "hotkeys"]}
                  icon={Keyboard}
                  hint={<Keys keys={["?"]} />}
                  onSelect={() => run(() => shell.setShortcutsOpen(true))}
                >
                  Keyboard shortcuts
                </Item>
                {showSignOut ? (
                  <Item value="Sign out" keywords={["log out", "logout", "session"]} icon={LogOut} onSelect={() => run(signOut)}>
                    Sign out
                  </Item>
                ) : null}
              </Command.Group>
            </Command.List>

            <div
              aria-hidden
              className="flex items-center gap-4 border-t border-rule-weak bg-rail px-4 py-2 text-xs text-ink-low"
            >
              <span className="flex items-center gap-1.5">
                <Keys keys={["↑", "↓"]} /> move
              </span>
              <span className="flex items-center gap-1.5">
                <Keys keys={["↵"]} /> open
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({
  value,
  keywords,
  forceMount,
  icon: Icon,
  hint,
  onSelect,
  children,
}: {
  value: string;
  keywords?: string[];
  forceMount?: boolean;
  icon: LucideIcon;
  hint?: ReactNode;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      forceMount={forceMount}
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-ink-mid select-none data-[selected=true]:bg-hover data-[selected=true]:text-ink"
    >
      <Icon aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      <span className="flex min-w-0 flex-1 items-center gap-1">{children}</span>
      {hint ? <span className="shrink-0 text-xs text-ink-low">{hint}</span> : null}
    </Command.Item>
  );
}
