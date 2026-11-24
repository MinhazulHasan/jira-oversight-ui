"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/* Text a reader types (a rule's name, its description). */

const FIELD =
  "w-full rounded-md border bg-sheet px-3 text-sm text-ink placeholder:text-ink-low focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-45";
const VALID = "border-rule-control hover:border-ink-low focus-visible:border-focus focus-visible:outline-focus";
const INVALID = "border-breach focus-visible:outline-breach";

export interface TextInputProps extends Omit<ComponentProps<"input">, "type"> {
  invalid?: boolean;
}

/** One line of text. */
export function TextInput({ invalid = false, className, ...props }: TextInputProps) {
  return (
    <input
      type="text"
      autoComplete="off"
      aria-invalid={invalid || undefined}
      className={cn(FIELD, "h-8", invalid ? INVALID : VALID, className)}
      {...props}
    />
  );
}

export interface TextAreaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

/** A few lines of text, which the reader may make taller. */
export function TextArea({ invalid = false, className, ...props }: TextAreaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(FIELD, "min-h-16 resize-y py-2", invalid ? INVALID : VALID, className)}
      {...props}
    />
  );
}
