"use client";

import { cva } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Show only the icon; the label becomes the accessible name. */
  iconOnly?: boolean;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** The group's accessible name, e.g. "View" or "Period". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}

const segment = cva(
  "pressable inline-flex items-center justify-center gap-1.5 rounded-[6px] whitespace-nowrap text-ink-mid select-none hover:text-ink data-[state=checked]:bg-sheet data-[state=checked]:text-ink data-[state=checked]:shadow-raised data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        sm: "h-6 px-2 text-xs [&_svg]:size-3.5",
        md: "h-7 px-2.5 text-sm [&_svg]:size-[15px]",
      },
      iconOnly: { true: "", false: "" },
    },
    compoundVariants: [
      { size: "sm", iconOnly: true, className: "w-7 px-0" },
      { size: "md", iconOnly: true, className: "w-8 px-0" },
    ],
    defaultVariants: { size: "md", iconOnly: false },
  },
);

/**
 * One choice from a few, shown side by side (Chart | Table, 7d | 30d | 90d).
 * It is a radio group to assistive technology: Tab enters it at the checked
 * option, arrow keys move and choose, and the group has a name.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      orientation="horizontal"
      loop
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onValueChange(option.value);
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-rule-weak bg-rail p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-label={option.iconOnly ? option.label : undefined}
            data-segment=""
            className={segment({ size, iconOnly: Boolean(option.iconOnly) })}
          >
            {Icon ? <Icon aria-hidden strokeWidth={1.75} /> : null}
            {option.iconOnly ? null : option.label}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
