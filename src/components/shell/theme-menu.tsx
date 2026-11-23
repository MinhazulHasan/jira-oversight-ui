"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { DropdownMenu } from "radix-ui";

import { notify } from "@/lib/notify";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", hint: "Paper", icon: Sun },
  { value: "dark", label: "Dark", hint: "Slate", icon: Moon },
  { value: "system", label: "System", hint: "Follows your device", icon: Monitor },
];

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** Switch the theme and say so. Shared by the menu and the command palette. */
export function useThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const choose = (next: ThemeChoice) => {
    setTheme(next);
    const choice = THEME_CHOICES.find((c) => c.value === next);
    notify.info(`${choice?.label ?? "System"} theme`, {
      description: next === "system" ? "Follows your device setting." : undefined,
      id: "theme",
    });
  };
  return { theme: isThemeChoice(theme) ? theme : "system", choose } as const;
}

export function ThemeMenu() {
  const hydrated = useHydrated();
  const { theme, choose } = useThemeSwitch();
  // The stored choice is only known in the browser; until then show the neutral icon.
  const current = hydrated ? theme : "system";
  const Icon = THEME_CHOICES.find((c) => c.value === current)?.icon ?? Monitor;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Theme"
        className="pressable inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-low hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink"
      >
        <Icon aria-hidden size={15} strokeWidth={1.75} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-[var(--z-overlay)] min-w-[220px] rounded-lg bg-sheet p-1.5 shadow-pop outline-none"
        >
          <DropdownMenu.Label className="micro px-2.5 pt-1.5 pb-2 text-ink-low">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={current}
            onValueChange={(value) => {
              if (isThemeChoice(value)) choose(value);
            }}
          >
            {THEME_CHOICES.map((choice) => (
              <DropdownMenu.RadioItem
                key={choice.value}
                value={choice.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-sm text-ink-mid outline-none select-none",
                  "data-[highlighted]:bg-hover data-[highlighted]:text-ink data-[state=checked]:text-ink",
                )}
              >
                <choice.icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
                <span className="flex-1">{choice.label}</span>
                <span className="text-xs text-ink-low">{choice.hint}</span>
                <span className="flex w-3.5 justify-end">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden size={13} className="text-ink" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
