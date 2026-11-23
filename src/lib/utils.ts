import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge only knows Tailwind's default scale. The type scale here is
 * custom (text-micro, text-h, text-hero, ...), and without being told,
 * tailwind-merge reads "text-micro" as a colour and lets it survive next to
 * "text-ink", or drops a size when a colour follows it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "mono-s", "xs", "sm", "base", "md", "lg", "xl", "h", "hero"],
      shadow: ["sheet", "raised", "pop", "toast"],
      radius: ["xs", "pill"],
    },
  },
});

/** Join class names, letting a later Tailwind utility override an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
