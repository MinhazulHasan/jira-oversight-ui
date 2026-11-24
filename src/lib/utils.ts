import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

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
