"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { navigateGuarded } from "@/lib/leave-guard";
import { isTypingTarget, resolveShortcut } from "@/lib/shortcuts";

import { usePeopleLevel } from "./people-level";
import { useShell } from "./shell-context";

/** The one keydown listener for the app-wide shortcuts. */
export function KeyboardShortcuts() {
  const router = useRouter();
  const shell = useShell();
  const peopleLevel = usePeopleLevel();
  const chordArmedAt = useRef<number | null>(null);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;

    const action = resolveShortcut(event, {
      typing: isTypingTarget(event.target),
      chordArmedAt: chordArmedAt.current,
      now: event.timeStamp,
      peopleLevel,
    });
    chordArmedAt.current = action?.type === "arm-chord" ? event.timeStamp : null;
    if (!action || action.type === "arm-chord") return;

    event.preventDefault();
    switch (action.type) {
      case "palette":
        shell.setPaletteOpen(!shell.paletteOpen);
        break;
      case "navigate": {
        // A page with unsaved work asks first (lib/leave-guard.ts).
        const href = action.href;
        navigateGuarded(() => router.push(href));
        break;
      }
      case "shortcuts":
        shell.setShortcutsOpen(true);
        break;
      case "toggle-rail":
        shell.toggleRail();
        break;
      case "focus-search": {
        const field = document.querySelector<HTMLElement>("[data-page-search]");
        if (!field) {
          shell.setPaletteOpen(true);
          break;
        }
        field.focus();
        if (field instanceof HTMLInputElement) field.select();
        break;
      }
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
