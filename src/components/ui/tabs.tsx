"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Views of one subject (Radix Tabs. */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex items-end gap-5 overflow-x-auto overscroll-x-contain shadow-[inset_0_-1px_0_var(--rule-weak)] [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  /** A count shown after the label, e.g. findings on an issue. */
  count?: ReactNode;
}

export function TabsTrigger({ className, children, count, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "pressable relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-t-[4px] text-sm text-ink-mid outline-offset-[-2px] select-none hover:text-ink",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-transparent",
        "data-[state=active]:font-medium data-[state=active]:text-ink data-[state=active]:after:bg-ink",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? (
        <span className="mono rounded-pill bg-rail px-1.5 py-px text-[11px] font-normal text-ink-low">{count}</span>
      ) : null}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-4", className)}
      {...props}
    />
  );
}
