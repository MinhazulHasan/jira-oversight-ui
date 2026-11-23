import { FALLBACK_LOCALE } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The locale to format figures with in a client component.
 *
 * The server cannot know the reader's locale, so it formats with the en-GB
 * fallback; the first client render must match it or React reports a
 * hydration error (a German reader's "1.234,5" against the server's
 * "1,234.5"). After hydration this returns undefined, which lets
 * src/lib/format.ts pick the reader's own conventions.
 */
export function useFigureLocale(): string | undefined {
  const hydrated = useHydrated();
  return hydrated ? undefined : FALLBACK_LOCALE;
}
