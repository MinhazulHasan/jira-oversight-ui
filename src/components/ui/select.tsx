"use client";

import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { fieldTrigger, floatingSurface, menuItem } from "./surfaces";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Secondary text at the right edge of the row, e.g. a count. */
  hint?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  /** The field's name. Always the accessible name; where it shows depends on labelPlacement. */
  label: string;
  /** above. */
  labelPlacement?: "above" | "inline" | "hidden";
  options: readonly SelectOption<T>[];
  value: T | undefined;
  onValueChange: (value: T) => void;
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  /** Width of the trigger, e.g. "w-48". The list is at least as wide. */
  triggerClassName?: string;
  /** The trigger's id, for a form that focuses a field to show what is wrong with it; one of its own otherwise. */
  id?: string;
  /** A choice that cannot be saved as it is: the edge in the breach ink, the words beside it saying why. */
  invalid?: boolean;
  /** The ids of its hint and its message. */
  describedBy?: string;
}

/** Pick one value from a list (Radix Select. */
export function Select<T extends string>({
  label,
  labelPlacement = "above",
  options,
  value,
  onValueChange,
  placeholder = "Choose",
  size = "md",
  disabled,
  className,
  triggerClassName,
  id: givenId,
  invalid = false,
  describedBy,
}: SelectProps<T>) {
  const ownId = useId();
  const id = givenId ?? ownId;
  const visibleAbove = labelPlacement === "above";
  const trigger = useRef<HTMLButtonElement>(null);
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>(undefined);
  return (
    <div className={cn("inline-flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-xs text-ink-low", !visibleAbove && "sr-only")}>
        {label}
      </label>
      <SelectPrimitive.Root
        value={value}
        disabled={disabled}
        onOpenChange={(open) => {
          if (open) setTriggerWidth(trigger.current?.getBoundingClientRect().width);
        }}
        onValueChange={(next) => {
          const option = options.find((candidate) => candidate.value === next);
          if (option) onValueChange(option.value);
        }}
      >
        <SelectPrimitive.Trigger
          ref={trigger}
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            fieldTrigger,
            "justify-between gap-2 data-[placeholder]:text-ink-low",
            size === "sm" ? "h-7 pr-1.5 pl-2.5 text-xs" : "h-8 pr-2 pl-3 text-sm",
            invalid && "border-breach hover:border-breach",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {labelPlacement === "inline" ? (
              // The label element already names the control; this copy is for sighted readers.
              <span aria-hidden className="shrink-0 text-ink-low">
                {label}
              </span>
            ) : null}
            <span className={cn("truncate", labelPlacement === "inline" && value !== undefined && "font-medium text-ink")}>
              <SelectPrimitive.Value placeholder={placeholder} />
            </span>
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            collisionPadding={16}
            style={{ minWidth: triggerWidth }}
            className={cn(floatingSurface, "max-h-[min(360px,var(--radix-select-content-available-height))] overflow-hidden")}
          >
            <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-ink-low">
              <ChevronUp aria-hidden size={14} />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="p-1.5">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(menuItem, "pr-2 data-[state=checked]:text-ink")}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.hint ? (
                    <span className="ml-auto shrink-0 pl-3 text-xs text-ink-low">{option.hint}</span>
                  ) : (
                    <span className="ml-auto" />
                  )}
                  <span className="flex w-4 shrink-0 justify-end">
                    <SelectPrimitive.ItemIndicator>
                      <Check aria-hidden size={14} strokeWidth={2.25} className="text-ink" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-ink-low">
              <ChevronDown aria-hidden size={14} />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
