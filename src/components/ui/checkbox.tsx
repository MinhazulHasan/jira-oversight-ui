"use client";

import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The words beside the box, which name it. */
  children: ReactNode;
  id?: string;
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}

/** One choice that is on or off among others (a rule's status categories). */
export function Checkbox({ checked, onCheckedChange, children, id, disabled, describedBy, className }: CheckboxProps) {
  return (
    <label className={cn("inline-flex min-h-6 cursor-pointer items-center gap-2 text-sm text-ink select-none", disabled && "cursor-not-allowed opacity-45", className)}>
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        disabled={disabled}
        aria-describedby={describedBy}
        className="pressable flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-rule-control bg-sheet data-[state=checked]:border-ink data-[state=checked]:bg-ink"
      >
        <CheckboxPrimitive.Indicator>
          <Check aria-hidden size={10} strokeWidth={3} className="text-sheet" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {children}
    </label>
  );
}
