"use client";

import { UserRound } from "lucide-react";
import { useCallback, useState } from "react";

import { API_BASE } from "@/lib/api/client";
import { UNNAMED_ACCOUNT, type Person } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/** The sizes DESIGN.md sets. */
export type PersonAvatarSize = 20 | 24 | 48;

const BOX: Record<PersonAvatarSize, string> = { 20: "size-5", 24: "size-6", 48: "size-12" };
/** The generic figure drawn for nobody, sized to sit inside the round. */
const FIGURE: Record<PersonAvatarSize, number> = { 20: 12, 24: 14, 48: 24 };

/** A word's first letter or digit, whole even when it carries an accent. */
const FIRST_LETTER = /[\p{L}\p{N}]\p{M}*/u;

/** Initials as Jira draws them. */
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

/** Where this interface serves a person's picture, or null when the service holds none. */
export function personAvatarSrc(person: Pick<Person, "id" | "avatar">, board?: string | null): string | null {
  if (person.avatar === null) return null;
  const src = `${API_BASE}/people/${encodeURIComponent(person.id)}/avatar?v=${person.avatar}`;
  // A person shown from another board than the one picked (an access log entry's): read from that board.
  return board ? `${src}&board=${encodeURIComponent(board)}` : src;
}

export interface PersonAvatarProps {
  person: Pick<Person, "id" | "name" | "avatar"> | null;
  /** 20 (the default) in tables, menus, chart rows and lines of text; 24 in Ask's @ list; 48 heading a person card. */
  size?: PersonAvatarSize;
  /** The board to read the picture from, where it is not the one picked in the top bar (an access log entry's). */
  board?: string | null;
  className?: string;
}

/** A person's Jira picture, beside their name as Jira and Confluence show it. */
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
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={watch} src={shown} alt="" width={size} height={size} decoding="async" draggable={false} />
      ) : null}
    </span>
  );
}
