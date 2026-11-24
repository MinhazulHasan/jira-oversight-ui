"use client";

import { createContext, useContext, type ReactNode } from "react";

import { UNASSIGNED_LABEL, type Person } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { PersonAvatar } from "./person-avatar";

/** Whether a name carries its whole self in a tooltip (the browser's own, from `title`). */
const NameTooltips = createContext(true);

/** Names inside without a tooltip of their own: they open a person card, which says the whole name. */
export function WithoutNameTooltips({ children }: { children: ReactNode }) {
  return <NameTooltips.Provider value={false}>{children}</NameTooltips.Provider>;
}

export interface NameTextProps {
  /** The display name, as the API gives it. */
  name: string;
  className?: string;
}

export function NameText({ name, className }: NameTextProps) {
  const titled = useContext(NameTooltips);
  return (
    <span className={className} title={titled ? name : undefined} data-person-name>
      {name}
    </span>
  );
}

export interface PersonNameProps {
  /** The API's person object, or null for nobody. */
  person: Person | null;
  /** What nobody reads as: "Unassigned" for a ticket. */
  none?: string;
  className?: string;
}

/** Someone as the API names them. */
export function PersonName({ person, none = UNASSIGNED_LABEL, className }: PersonNameProps) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2 align-middle">
      <PersonAvatar person={person} />
      {person === null ? (
        // Nobody always reads in the secondary ink, whatever ink the caller gives names.
        <span className={cn("min-w-0 truncate", className, "text-ink-low")}>{none}</span>
      ) : (
        <NameText name={person.name} className={cn("block min-w-0 truncate text-ink normal-nums", className)} />
      )}
    </span>
  );
}
