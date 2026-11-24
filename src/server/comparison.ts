import "server-only";

import { ConfigError, readConfig, type PeopleComparison, type ServerConfig } from "./env";

/** Whether people may be compared side by side, as far as this server knows it */

let reported: PeopleComparison | null = null;

/** What the service just said about comparing people: a scorecard's `comparison`, or a `comparison_off` refusal. */
export function noteComparison(value: PeopleComparison): void {
  reported = value;
}

/** The comparison setting the People page lays itself out for while its figures load. */
export function expectedComparison(config?: ServerConfig): PeopleComparison {
  try {
    const settings = config ?? readConfig();
    return settings.mode === "sample" ? settings.sample.peopleComparison : (reported ?? "on");
  } catch (error) {
    // A configuration mistake is reported by the routes that read it; the page's shape falls back to the default.
    if (error instanceof ConfigError) return "on";
    throw error;
  }
}

/** For tests: forget what the service last reported. */
export function forgetReportedComparison(): void {
  reported = null;
}
