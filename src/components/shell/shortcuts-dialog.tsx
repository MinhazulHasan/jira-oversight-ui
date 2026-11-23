"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";

import { navPagesFor } from "@/lib/nav";

import { Keys, type KeyName } from "./kbd";
import { usePeopleLevel } from "./people-level";
import { useShell } from "./shell-context";

interface Shortcut {
  keys: KeyName[];
  /** A sequence ("G then F") rather than a combination ("Ctrl K"). */
  sequence?: boolean;
  label: string;
}

const GENERAL: Shortcut[] = [
  { keys: ["mod", "K"], label: "Search, jump to an issue, or ask" },
  { keys: ["/"], label: "Search on this page" },
  { keys: ["?"], label: "Show these shortcuts" },
  { keys: ["["], label: "Collapse or expand the navigation" },
];

const TABLES: Shortcut[] = [
  { keys: ["J", "K"], label: "Move down or up the rows" },
  { keys: ["↵"], label: "Open the row" },
  { keys: ["Esc"], label: "Close a drawer or dialog" },
];

/** `g` then a letter, for each page this reader is offered. */
function goTo(peopleLevel: boolean): Shortcut[] {
  return navPagesFor(peopleLevel).map((page) => ({
    keys: ["G", page.chord.toUpperCase()],
    sequence: true,
    label: page.label,
  }));
}

const SPOKEN: Record<string, string> = {
  "/": "slash",
  "?": "question mark",
  "[": "left bracket",
  "↵": "Enter",
  Esc: "Escape",
};

function Section({ title, items }: { title: string; items: Shortcut[] }) {
  const { platform } = useShell();
  const speak = (key: KeyName) =>
    key === "mod" ? (platform === "mac" ? "Command" : "Control") : (SPOKEN[key] ?? key);

  return (
    <section className="flex flex-col gap-1">
      <h3 className="micro pb-1 text-ink-low">{title}</h3>
      <dl className="flex flex-col">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex min-h-9 items-center justify-between gap-4 border-b border-rule-weak last:border-b-0"
          >
            <dt className="text-sm text-ink-mid">{item.label}</dt>
            <dd className="shrink-0">
              <Keys keys={item.keys} joiner={item.sequence ? "then" : undefined} />
              <span className="sr-only">
                {item.keys.map(speak).join(item.sequence ? " then " : " ")}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The ? sheet. Lists every shortcut the interface answers to. */
export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useShell();
  const peopleLevel = usePeopleLevel();

  return (
    <Dialog.Root open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-fade-in_140ms_ease_both]" />
        <Dialog.Content
          // A sheet to read, not a form: focus the sheet itself so the close
          // button does not open wearing a focus ring. Tab still reaches it.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
          }}
          className="fixed top-1/2 left-1/2 z-[var(--z-overlay)] max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-sheet p-6 shadow-pop outline-none data-[state=closed]:animate-[jo-fade-out_120ms_ease_both] data-[state=open]:animate-[jo-rise_200ms_var(--ease-out)_both]"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-ink">Keyboard shortcuts</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-ink-low">
                None of them fire while you are typing in a field.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="pressable -mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-low hover:bg-hover hover:text-ink"
            >
              <X aria-hidden size={16} />
            </Dialog.Close>
          </div>
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <div className="flex flex-col gap-6">
              <Section title="Anywhere" items={GENERAL} />
              <Section title="In tables" items={TABLES} />
            </div>
            <Section title="Go to" items={goTo(peopleLevel)} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
