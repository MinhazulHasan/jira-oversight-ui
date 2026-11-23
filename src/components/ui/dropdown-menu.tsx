"use client";

import { Check, type LucideIcon } from "lucide-react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { Keys, type KeyName } from "@/components/shell/kbd";
import { cn } from "@/lib/utils";

import { floatingSurface, menuItem, menuLabel, menuSeparator } from "./surfaces";

/**
 * A menu of actions or choices (Radix DropdownMenu: arrow keys, typeahead,
 * Escape, focus returned to the trigger). Styled like the theme menu in the
 * top bar, so every menu in the product reads the same.
 */
export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 8,
  collisionPadding = 16,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(floatingSurface, "min-w-[200px] p-1.5", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  icon?: LucideIcon;
  /** Secondary text at the right edge, e.g. a count or a hint. */
  hint?: ReactNode;
  shortcut?: KeyName[];
}

export function DropdownMenuItem({
  icon: Icon,
  hint,
  shortcut,
  className,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item className={cn(menuItem, className)} {...props}>
      {Icon ? <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-xs text-ink-low">{hint}</span> : null}
      {shortcut ? <Keys keys={shortcut} /> : null}
    </MenuPrimitive.Item>
  );
}

/** A choice that can be on or off together with others (column visibility). */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(menuItem, "data-[state=checked]:text-ink", className)}
      {...props}
    >
      <span
        aria-hidden
        className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-rule-control bg-sheet data-[on=true]:border-ink data-[on=true]:bg-ink"
        data-on={props.checked === true}
      >
        <MenuPrimitive.ItemIndicator>
          <Check size={10} strokeWidth={3} className="text-sheet" />
        </MenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.CheckboxItem>
  );
}

/** One of a set of exclusive choices; the chosen one carries a tick. */
export function DropdownMenuRadioItem({
  className,
  children,
  hint,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem> & { hint?: ReactNode }) {
  return (
    <MenuPrimitive.RadioItem className={cn(menuItem, "data-[state=checked]:text-ink", className)} {...props}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-xs text-ink-low">{hint}</span> : null}
      <span className="flex w-4 shrink-0 justify-end">
        <MenuPrimitive.ItemIndicator>
          <Check aria-hidden size={14} strokeWidth={2.25} className="text-ink" />
        </MenuPrimitive.ItemIndicator>
      </span>
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn(menuLabel, className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn(menuSeparator, className)} {...props} />;
}
