"use client";

import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The accessible name, where no element on the page names it (else `labelledBy`). */
  label?: string;
  /** The ids of the elements that name it, e.g. a rule's title and "On this board". */
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * On or off (Radix Switch): a button with the switch role, which Space and
 * Enter toggle and a screen reader reads as on or off. The state is in ink and
 * shape, never the accent (teal means traceable): on is a filled ink track
 * with the thumb at its end, off a track in the 3:1 field edge with the thumb
 * at its start. Say the state in words beside it ("On", "Off"): the switch is
 * the control, the words are for reading at a glance.
 */
export function Switch({ checked, onCheckedChange, label, labelledBy, describedBy, disabled, id, className }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn(
        "jo-switch pressable relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-pill transition-colors duration-150",
        "bg-rule-control data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-sheet shadow-raised transition-transform duration-150 data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
