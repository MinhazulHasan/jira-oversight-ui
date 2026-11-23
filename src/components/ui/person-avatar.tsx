"use client";

import { UserRound } from "lucide-react";
import { useCallback, useState } from "react";

import { API_BASE } from "@/lib/api/client";
import { UNNAMED_ACCOUNT, type Person } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * The sizes DESIGN.md sets: 20 px in tables, menus, chart rows and lines of
 * text; 24 px in Ask's @ list and beside a scorecard's name; 48 px heading a
 * person card (JO-13): the size of the picture Jira gives, so it is shown at
 * its source's size, never stretched to another (the product owner's
 * decision, 13 Nov 2026).
 */
export type PersonAvatarSize = 20 | 24 | 48;

const BOX: Record<PersonAvatarSize, string> = { 20: "size-5", 24: "size-6", 48: "size-12" };
/** The generic figure drawn for nobody, sized to sit inside the round. */
const FIGURE: Record<PersonAvatarSize, number> = { 20: 12, 24: 14, 48: 24 };

/** A word's first letter or digit, whole even when it carries an accent. */
const FIRST_LETTER = /[\p{L}\p{N}]\p{M}*/u;

/**
 * Initials as Jira draws them: the first letters of the first and last
 * words ("Ada Brooks" is AB, "Cher" is C), skipping words with no letter in
 * them ("(Contractor)" counts by its C, "-" not at all); "?" for an Unnamed
 * account, and for a name with no letter at all.
 */
export function personInitials(name: string): string {
  if (name === UNNAMED_ACCOUNT) return "?";
  const letters = name
    .normalize("NFC")
    .split(/\s+/)
    .map((word) => FIRST_LETTER.exec(word)?.[0])
    .filter((letter): letter is string => letter !== undefined);
  if (letters.length === 0) return "?";
  return (letters.length === 1 ? letters[0] : `${letters[0]}${letters[letters.length - 1]}`).toUpperCase();
}

/**
 * Where this interface serves a person's picture, or null when the service
 * holds none. The version in the address means a changed picture is never
 * hidden by a cached one. Never Jira's or Gravatar's address: the browser
 * only ever asks this dashboard, by person id.
 */
export function personAvatarSrc(person: Pick<Person, "id" | "avatar">, board?: string | null): string | null {
  if (person.avatar === null) return null;
  const src = `${API_BASE}/people/${encodeURIComponent(person.id)}/avatar?v=${person.avatar}`;
  // A person shown from another board than the one picked (an access log entry's): read from that board.
  return board ? `${src}&board=${encodeURIComponent(board)}` : src;
}

export interface PersonAvatarProps {
  /**
   * The API's person object, as every response names one; null for nobody
   * (the unassigned tickets), drawn as a generic figure so the names in a
   * list stay in line.
   */
  person: Pick<Person, "id" | "name" | "avatar"> | null;
  /** 20 (the default) in tables, menus, chart rows and lines of text; 24 in Ask's @ list; 48 heading a person card. */
  size?: PersonAvatarSize;
  /** The board to read the picture from, where it is not the one picked in the top bar (an access log entry's). */
  board?: string | null;
  className?: string;
}

/**
 * A person's Jira picture, beside their name as Jira and Confluence show it:
 * the picture when the service holds one, their initials on a neutral ground
 * when it holds none or the picture fails to load. Round, its width and
 * height set so nothing shifts while it loads, light and dark.
 *
 * Always decorative (aria-hidden, alt=""): the name goes beside it, never in
 * its place, and is what a screen reader reads. The initials are drawn by
 * the stylesheet from data-initials (components.css, .jo-avatar), so they
 * stay out of the text a reader copies.
 */
export function PersonAvatar({ person, size = 20, board, className }: PersonAvatarProps) {
  const src = person === null ? null : personAvatarSrc(person, board);
  // The address that failed to load, if one has: a new version of the picture is tried afresh.
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src !== null && failed !== src ? src : null;

  // The picture failing, as it happens or (before the page came alive, when no one was listening) as it was.
  const watch = useCallback(
    (image: HTMLImageElement | null) => {
      if (image === null || shown === null) return;
      const fail = () => setFailed(shown);
      if (image.complete && image.naturalWidth === 0) fail();
      image.addEventListener("error", fail);
      return () => image.removeEventListener("error", fail);
    },
    [shown],
  );

  if (person === null) {
    return (
      <span aria-hidden="true" data-avatar="none" data-size={size} className={cn("jo-avatar", BOX[size], className)}>
        <UserRound size={FIGURE[size]} strokeWidth={2} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      data-avatar={shown ? "picture" : "initials"}
      data-initials={shown ? undefined : personInitials(person.name)}
      data-size={size}
      className={cn("jo-avatar", BOX[size], className)}
    >
      {shown ? (
        // A plain img, not next/image: the picture is this route's own, private to the reader's session,
        // and already small; the optimiser would fetch it again without the reader's cookies.
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={watch} src={shown} alt="" width={size} height={size} decoding="async" draggable={false} />
      ) : null}
    </span>
  );
}
