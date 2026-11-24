"use client";

import { Keys, type KeyName } from "@/components/shell/kbd";

export type { KeyName };

export interface KbdProps {
  /** One key ("/") or a combination (["mod", "K"]). "mod" is Cmd on a Mac and Ctrl elsewhere. */
  keys: KeyName | KeyName[];
  /** Placed between the keys of a sequence: "then" for G then F. Omit for a combination. */
  joiner?: string;
  className?: string;
}

export function Kbd({ keys, joiner, className }: KbdProps) {
  return <Keys keys={Array.isArray(keys) ? keys : [keys]} joiner={joiner} className={className} />;
}
