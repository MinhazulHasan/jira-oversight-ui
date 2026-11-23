import "server-only";

import { ConfigError, readConfig, type PeopleComparison, type ServerConfig } from "./env";

/*
 * Whether people may be compared side by side, as far as this server knows it
 * before the People page asks (the JO-11 check, G2: with comparison off, the
 * page drew the comparison's loading state, then jumped about 690 px when the
 * figures arrived). In sample mode it is the sample's own setting. In live
 * mode it is the service's PEOPLE_COMPARISON, an organisation-wide setting, as
 * the service last reported it on a scorecard this server passed on: on (the
 * service's default) until the first one, so after a restart of the service
 * with the setting changed, one load may still draw the other shape.
 */

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
