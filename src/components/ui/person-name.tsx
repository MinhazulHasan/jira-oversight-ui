"use client";

import { createContext, useContext, type ReactNode } from "react";

import { UNASSIGNED_LABEL, type Person } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { PersonAvatar } from "./person-avatar";

/**
 * Whether a name carries its whole self in a tooltip (the browser's own, from
 * `title`): yes, where it may be cut short; no inside a name that opens a
 * person card (JO-13), whose card says the whole name, never cut, so a rested
 * pointer would otherwise get the card and a tooltip on top of it.
 */
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

/**
 * A person's name as text, cut short where its room ends, its whole in a
 * tooltip; inside a name that opens a person card, no tooltip (the card
 * says it). Marked as the name, for the trigger's underline.
 */
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

/**
 * Someone as the API names them: their Jira picture (or initials) beside
 * the display name in text, the name cut short with the whole of it in its
 * tooltip (none inside a name that opens their card, which says it); or, for
 * nobody, a generic figure beside "Unassigned" in the secondary ink. Never an
 * email address or an account id. A name is running text, so it keeps
 * proportional figures even in a table, where tabular ones would space its
 * hyphen ("Anne - Marie"; globals.css).
 */
export function PersonName({ person, none = UNASSIGNED_LABEL, className }: PersonNameProps) {
  // Inline, so a right-aligned value (the drawer's facts) stays right-aligned; middle, so a picture and
  // initials sit at the same height on the line; never wider than its column, so the name cuts short.
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
