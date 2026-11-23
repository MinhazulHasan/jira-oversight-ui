import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FALLBACK_LOCALE,
  MISSING,
  formatByKind,
  formatCount,
  formatDate,
  formatDateTime,
  formatDelta,
  formatHours,
  formatNumber,
  formatRatio,
  formatRelative,
  formatShare,
  formatTime,
  resolveLocale,
  tidyZoneName,
} from "./format";

const NBSP = " ";
const london = { locale: "en-GB", timeZone: "Europe/London" } as const;
const SYNCED = "2026-11-04T14:32:00Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatDate", () => {
  it("writes the day before an abbreviated month", () => {
    expect(formatDate(SYNCED, london)).toBe("4 Nov 2026");
  });

  it("follows a US reader's order without becoming numeric", () => {
    expect(formatDate(SYNCED, { locale: "en-US", timeZone: "America/New_York" })).toBe(
      "Nov 4, 2026",
    );
  });

  it("never produces the 11/04/2026 form in any common locale", () => {
    for (const locale of ["en-US", "en-GB", "en-DE", "en-FR", "de-DE", "fr-FR", "nl-NL"]) {
      expect(formatDate(SYNCED, { locale, timeZone: "UTC" })).not.toMatch(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/);
    }
  });

  it("uses the date in the zone it is asked for", () => {
    expect(formatDate("2026-11-04T23:30:00Z", { locale: "en-GB", timeZone: "Asia/Tokyo" })).toBe(
      "5 Nov 2026",
    );
  });

  it("marks a missing or invalid date rather than inventing one", () => {
    expect(formatDate(null, london)).toBe(MISSING);
    expect(formatDate("not a date", london)).toBe(MISSING);
  });
});

/** ICU joins a time and its "PM" with a narrow no-break space, so they never wrap apart: read here as a space. */
const spaced = (text: string) => text.replace(/\s/g, " ");

describe("formatDateTime", () => {
  it("reads on the 12-hour clock in every locale, and names no zone: the reader's own", () => {
    expect(spaced(formatDateTime(SYNCED, london))).toBe("4 Nov 2026, 2:32 PM");
    expect(spaced(formatDateTime("2026-07-04T14:32:00Z", london))).toBe("4 Jul 2026, 3:32 PM");
    expect(formatDateTime(SYNCED, london)).not.toMatch(/GMT|BST|14:32/);
  });

  it("converts to a given zone", () => {
    expect(spaced(formatDateTime(SYNCED, { locale: "en-US", timeZone: "America/New_York" }))).toBe("Nov 4, 2026, 9:32 AM");
  });

  it("names no zone for a reader in New York or Berlin either, as the Issue changelog shows them (e2e/issue.spec.ts)", () => {
    const changed = "2025-11-12T11:12:00Z";
    expect(spaced(formatDateTime(changed, { locale: "en-US", timeZone: "America/New_York" }))).toBe("Nov 12, 2025, 6:12 AM");
    // A German browser reads as en-DE: English words, German conventions, and the PM that en-DE writes "pm".
    expect(spaced(formatDateTime(changed, { locale: "en-DE", timeZone: "Europe/Berlin" }))).toBe("12 Nov 2025, 12:12 PM");
    expect(formatDateTime("2026-07-04T14:32:00Z", { locale: "en-DE", timeZone: "Europe/Berlin" })).not.toMatch(/CES?T|MES?Z|GMT|UTC|16:32/);
  });

  it("names the zone only when asked, for a time set in another zone than the reader's", () => {
    expect(spaced(formatDateTime(SYNCED, { ...london, zoneNamed: true }))).toBe("4 Nov 2026, 2:32 PM GMT");
    expect(spaced(formatDateTime("2026-07-04T14:32:00Z", { ...london, zoneNamed: true }))).toBe("4 Jul 2026, 3:32 PM BST");
  });

  it("defaults to the viewer's zone", () => {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatDateTime(SYNCED, { locale: "en-GB" })).toBe(
      formatDateTime(SYNCED, { locale: "en-GB", timeZone: zone }),
    );
  });
});

describe("formatTime", () => {
  it("gives the time on the 12-hour clock, with no zone unless asked", () => {
    expect(spaced(formatTime(SYNCED, london))).toBe("2:32 PM");
    expect(spaced(formatTime(SYNCED, { locale: "en-GB", timeZone: "UTC", zoneNamed: true }))).toBe("2:32 PM UTC");
  });
});

describe("tidyZoneName", () => {
  it("names a zero offset plainly, as browsers with trimmed zone data do not", () => {
    expect(tidyZoneName("GMT+0")).toBe("GMT");
    expect(tidyZoneName("GMT-0")).toBe("GMT");
    expect(tidyZoneName("UTC+00:00")).toBe("UTC");
  });

  it("leaves real offsets and named zones alone", () => {
    expect(tidyZoneName("GMT+1")).toBe("GMT+1");
    expect(tidyZoneName("GMT+10")).toBe("GMT+10");
    expect(tidyZoneName("GMT-5")).toBe("GMT-5");
    expect(tidyZoneName("BST")).toBe("BST");
    expect(tidyZoneName("CET")).toBe("CET");
  });
});

describe("formatRelative", () => {
  const now = "2026-11-04T14:32:00Z";

  it("speaks in short units", () => {
    expect(formatRelative("2026-11-04T12:32:00Z", { now, locale: "en-GB" })).toBe(`2${NBSP}h ago`);
    expect(formatRelative("2026-11-04T14:28:00Z", { now, locale: "en-GB" })).toBe(`4${NBSP}min ago`);
    expect(formatRelative("2026-11-07T14:32:00Z", { now, locale: "en-GB" })).toBe(`in 3${NBSP}d`);
    expect(formatRelative("2026-08-04T14:32:00Z", { now, locale: "en-GB" })).toBe(`3${NBSP}mo ago`);
    expect(formatRelative("2024-11-04T14:32:00Z", { now, locale: "en-GB" })).toBe(`2${NBSP}y ago`);
  });

  it("calls anything within the last minute just now", () => {
    expect(formatRelative("2026-11-04T14:31:30Z", { now, locale: "en-GB" })).toBe("just now");
  });

  it("marks a missing time", () => {
    expect(formatRelative(undefined, { now, locale: "en-GB" })).toBe(MISSING);
  });
});

describe("numbers", () => {
  it("formats hours to one decimal place", () => {
    expect(formatHours(12.5, { locale: "en-GB" })).toBe(`12.5${NBSP}h`);
    expect(formatHours(12, { locale: "en-GB" })).toBe(`12.0${NBSP}h`);
    expect(formatHours(1234.56, { locale: "en-GB" })).toBe(`1,234.6${NBSP}h`);
  });

  it("formats ratios to two places with a times sign", () => {
    expect(formatRatio(1.4234, { locale: "en-GB" })).toBe("1.42×");
    expect(formatRatio(1.4234, { locale: "de-DE" })).toBe("1,42×");
  });

  it("formats shares as whole percentages without hiding a fact", () => {
    expect(formatShare(0.16, { locale: "en-GB" })).toBe("16%");
    expect(formatShare(0.004, { locale: "en-GB" })).toBe("<1%");
    expect(formatShare(0.009, { locale: "en-GB" })).toBe("<1%");
    expect(formatShare(0, { locale: "en-GB" })).toBe("0%");
    expect(formatShare(0.996, { locale: "en-GB" })).toBe(">99%");
    expect(formatShare(1, { locale: "en-GB" })).toBe("100%");
  });

  it("groups counts by the reader's convention", () => {
    expect(formatCount(1134, { locale: "en-GB" })).toBe("1,134");
    expect(formatCount(1134, { locale: "en-DE" })).toBe("1.134");
  });

  it("signs a change with a true minus", () => {
    expect(formatDelta(3, { locale: "en-GB" })).toBe("+3");
    expect(formatDelta(-2, { locale: "en-GB" })).toBe("−2");
    expect(formatDelta(0, { locale: "en-GB" })).toBe("0");
  });

  it("marks anything that is not a number", () => {
    expect(formatNumber(Number.NaN)).toBe(MISSING);
    expect(formatHours(null)).toBe(MISSING);
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe(MISSING);
    expect(formatShare(undefined)).toBe(MISSING);
    expect(formatCount(null)).toBe(MISSING);
  });
});

describe("resolveLocale", () => {
  it("honours a locale the runtime holds data for", () => {
    expect(resolveLocale("en-US")).toBe("en-US");
  });

  it("falls back to en-GB for a malformed or unknown locale", () => {
    expect(resolveLocale("not a locale")).toBe(FALLBACK_LOCALE);
    expect(resolveLocale("en-XX")).toBe(FALLBACK_LOCALE);
  });

  it("keeps English words with the reader's regional conventions", () => {
    vi.stubGlobal("navigator", { languages: ["de-DE"], language: "de-DE" });
    expect(resolveLocale()).toBe("en-DE");
    expect(formatDate(SYNCED, { timeZone: "Europe/Berlin" })).toBe("4 Nov 2026");
    expect(formatHours(1234.5)).toBe(`1.234,5${NBSP}h`);
  });

  it("uses an English browser locale as it is", () => {
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
    expect(resolveLocale()).toBe("en-US");
  });

  it("falls back to en-GB when the browser names no region", () => {
    vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
    expect(resolveLocale()).toBe(FALLBACK_LOCALE);
  });
});

describe("formatByKind", () => {
  const gb = { locale: "en-GB", timeZone: "Europe/London" } as const;

  it("formats each contract kind the way its own formatter does", () => {
    expect(formatByKind(1134, "count", gb)).toBe("1,134");
    expect(formatByKind(12.54, "hours", gb)).toBe(`12.5${NBSP}h`);
    expect(formatByKind(1.4207, "ratio", gb)).toBe("1.42×");
    expect(formatByKind(0.158, "share", gb)).toBe("16%");
    expect(formatByKind(3.5, "days", gb)).toBe(`3.5${NBSP}d`);
    expect(formatByKind(5, "points", gb)).toBe(`5${NBSP}pt`);
    expect(formatByKind(0.5, "points", gb)).toBe(`0.5${NBSP}pt`);
    expect(formatByKind(SYNCED, "date", gb)).toBe("4 Nov 2026");
    expect(formatByKind("DEMO-142", "issue_key", gb)).toBe("DEMO-142");
  });

  it("reads a missing value, or a number in a figure kind that is not a number, as missing", () => {
    expect(formatByKind(null, "count", gb)).toBe(MISSING);
    expect(formatByKind(undefined, "hours", gb)).toBe(MISSING);
    expect(formatByKind("", "text", gb)).toBe(MISSING);
    expect(formatByKind("n/a", "ratio", gb)).toBe(MISSING);
  });

  it("writes text as it is and an unknown kind's number with sensible decimals", () => {
    expect(formatByKind("To Do", "text", gb)).toBe("To Do");
    expect(formatByKind(7, "mystery", gb)).toBe("7");
    expect(formatByKind(2.345, undefined, gb)).toBe("2.35");
  });
});

describe("resolveLocale on the server", () => {
  it("ignores Node's navigator, so server-rendered figures match the browser's fallback", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    expect(resolveLocale()).toBe(FALLBACK_LOCALE);
  });
});
