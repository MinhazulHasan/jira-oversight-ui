"use client";

import { ChevronDown, Ticket } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fieldTrigger } from "@/components/ui/surfaces";
import { cn } from "@/lib/utils";

import type { TicketFilter as TicketValue } from "./url-state";

const OPTIONS: readonly { value: "any" | TicketValue; label: string; hint: string }[] = [
  { value: "any", label: "Any", hint: "Any status" },
  { value: "open", label: "Open", hint: "Not done in Jira" },
  { value: "finished", label: "Finished", hint: "Done in Jira" },
];

/** Findings on open or on finished tickets, by the ticket's status in Jira now; a sprint's finding is on neither. */
export function TicketFilter({ value, onValueChange }: { value: TicketValue | null; onValueChange: (value: TicketValue | null) => void }) {
  const current = OPTIONS.find((option) => option.value === (value ?? "any")) ?? OPTIONS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(fieldTrigger, "h-8 pr-2 pl-2.5 text-sm")} data-ticket-filter="">
        <Ticket aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        <span className="text-ink-low">Ticket</span>{" "}
        <span className={value === null ? "text-ink-mid" : "font-medium text-ink"}>{current.label}</span>
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuLabel>Ticket</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? "any"}
          onValueChange={(next) => {
            if (next === "any") onValueChange(null);
            else if (next === "open" || next === "finished") onValueChange(next);
          }}
        >
          {OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} hint={option.hint}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
