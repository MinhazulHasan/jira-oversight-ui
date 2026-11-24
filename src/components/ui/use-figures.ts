import { FALLBACK_LOCALE } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";

/** The locale to format figures with in a client component. */
export function useFigureLocale(): string | undefined {
  const hydrated = useHydrated();
  return hydrated ? undefined : FALLBACK_LOCALE;
}
