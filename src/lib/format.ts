/**
 * Every figure and time on screen goes through here, so it reads the same way
 * on every page, in every export and on paper.
 *
 * Dates are unambiguous on both sides of the Atlantic ("4 Nov 2026", never
 * 11/04/2026). Times read on the 12-hour clock ("2:32 PM") in the reader's
 * own zone, which is never named; a time set in another zone (the
 * organisation's, UTC) names it ("2:18 PM GMT"). Numbers follow the reader's regional
 * conventions through Intl, with en-GB as the fallback. Units are joined to
 * their figure with a no-break space so "12.5 h" never wraps apart.
 *
 * Output that depends on the viewer (their zone, their locale, "now") must be
 * rendered after hydration, or the server's version and the browser's will
 * disagree. See useNow and useHydrated.
 */

export const FALLBACK_LOCALE = "en-GB";
/** Shown where a value is missing or not a number. */
export const MISSING = "—";

const NBSP = " ";
const TIMES = "×";
const MINUS = "−";

export interface LocaleOptions {
  /** A BCP 47 tag. Defaults to the reader's browser, then en-GB. */
  locale?: string;
}

export interface ZoneOptions extends LocaleOptions {
  /** An IANA zone such as "Europe/London". Defaults to the viewer's zone. */
  timeZone?: string;
}

export type DateInput = Date | string | number;

/* ------------------------------------------------------------- locale ---- */

/** True when the runtime holds real data for this exact language and region,
 *  rather than quietly falling back to a parent such as plain "en". */
function hasLocaleData(tag: string): boolean {
  try {
    const requested = new Intl.Locale(tag);
    const resolved = new Intl.Locale(new Intl.NumberFormat(tag).resolvedOptions().locale);
    return (
      resolved.language === requested.language &&
      (requested.region === undefined || resolved.region === requested.region)
    );
  } catch {
    return false;
  }
}

/**
 * The interface is written in English, so a reader whose browser asks for
 * German gets English words with German conventions (en-DE: "4 Nov 2026",
 * "1.234,5") rather than German month names inside English sentences.
 */
function localeFromBrowser(): string | undefined {
  // Node 24 defines `navigator` (as en-US), so testing for it would format
  // server-rendered figures in en-US and mismatch the browser on hydration.
  // Only a real browser has `window`.
  if (typeof window === "undefined" || typeof navigator === "undefined") return undefined;
  const preferred = navigator.languages?.[0] ?? navigator.language;
  if (!preferred) return undefined;
  try {
    const tag = new Intl.Locale(preferred);
    if (!tag.region) return undefined;
    return tag.language === "en" ? tag.baseName : `en-${tag.region}`;
  } catch {
    return undefined;
  }
}

const resolvedLocales = new Map<string, string>();

/** The locale a formatter will actually use. */
export function resolveLocale(locale?: string): string {
  const wanted = locale ?? localeFromBrowser() ?? FALLBACK_LOCALE;
  const cached = resolvedLocales.get(wanted);
  if (cached) return cached;
  const result = hasLocaleData(wanted) ? new Intl.Locale(wanted).baseName : FALLBACK_LOCALE;
  resolvedLocales.set(wanted, result);
  return result;
}

/* --------------------------------------------------------- formatters ---- */

// Building an Intl formatter costs far more than using one, and a table of a
// few hundred rows formats thousands of cells.
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * Browsers ship trimmed zone names, and Chromium calls London in winter
 * "GMT+0" where a reader (and Node) says "GMT". A zero offset is named plainly.
 */
export function tidyZoneName(name: string): string {
  return name.replace(/^(GMT|UTC)[+−-]0{1,2}(?::?00)?$/, "$1");
}

/** "PM", whichever way the locale writes it ("pm", "p.m.", "p. m."): one form, the one US readers expect. */
function clockPart(part: Intl.DateTimeFormatPart): string {
  if (part.type === "dayPeriod") return part.value.replace(/[.\s]/g, "").toUpperCase();
  return part.type === "timeZoneName" ? tidyZoneName(part.value) : part.value;
}

function formatClockParts(format: Intl.DateTimeFormat, date: Date): string {
  return format.formatToParts(date).map(clockPart).join("");
}

function toDate(value: DateInput | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/* --------------------------------------------------------------- dates --- */

/** "4 Nov 2026" (en-GB), "Nov 4, 2026" (en-US). */
export function formatDate(value: DateInput | null | undefined, options: ZoneOptions = {}): string {
  const date = toDate(value);
  if (!date) return MISSING;
  return dateFormat(resolveLocale(options.locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: options.timeZone,
  }).format(date);
}

export interface ClockOptions extends ZoneOptions {
  /**
   * Name the zone after the time ("2:18 PM GMT"). Only for a time set in a zone other than the reader's own, where
   * it would otherwise be misread: the access log's, in the organisation's zone; Ask usage's UTC day; a baseline's
   * report window. A time in the reader's own zone names none.
   */
  zoneNamed?: boolean;
}

/**
 * "4 Nov 2026, 2:32 PM": a moment on the 12-hour clock, in the reader's zone, with no zone named, as every time in
 * the dashboard reads; "4 Nov 2026, 2:18 PM GMT" with `zoneNamed`, for another zone's time.
 */
export function formatDateTime(value: DateInput | null | undefined, options: ClockOptions = {}): string {
  const date = toDate(value);
  if (!date) return MISSING;
  const format = dateFormat(resolveLocale(options.locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(options.zoneNamed ? { timeZoneName: "short" as const } : {}),
    timeZone: options.timeZone,
  });
  return formatClockParts(format, date);
}

/** "2:32 PM": for a time whose date is obvious from where it sits ("2:32 PM GMT" with `zoneNamed`). */
export function formatTime(value: DateInput | null | undefined, options: ClockOptions = {}): string {
  const date = toDate(value);
  if (!date) return MISSING;
  const format = dateFormat(resolveLocale(options.locale), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(options.zoneNamed ? { timeZoneName: "short" as const } : {}),
    timeZone: options.timeZone,
  });
  return formatClockParts(format, date);
}

/** "2:10 PM": a time on the 12-hour clock, in the reader's zone, with no zone named (formatTime, never naming one). */
export function formatClock(value: DateInput | null | undefined, options: ZoneOptions = {}): string {
  return formatTime(value, { locale: options.locale, timeZone: options.timeZone });
}

export interface RelativeOptions extends LocaleOptions {
  /** The moment to measure from. Pass it in rather than reading the clock. */
  now: DateInput;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30.4375 * DAY;
const YEAR = 365.25 * DAY;

/**
 * "2 h ago", "in 3 d", "just now". Always shown with the absolute time in a
 * tooltip: a relative time alone cannot be checked against anything.
 */
export function formatRelative(value: DateInput | null | undefined, options: RelativeOptions): string {
  const date = toDate(value);
  const now = toDate(options.now);
  if (!date || !now) return MISSING;

  const delta = date.getTime() - now.getTime();
  const span = Math.abs(delta);
  if (span < 45_000) return "just now";

  let amount: number;
  let unit: string;
  if (span < 45 * MINUTE) {
    amount = Math.max(1, Math.round(span / MINUTE));
    unit = "min";
  } else if (span < 22 * HOUR) {
    amount = Math.max(1, Math.round(span / HOUR));
    unit = "h";
  } else if (span < 26 * DAY) {
    amount = Math.max(1, Math.round(span / DAY));
    unit = "d";
  } else if (span < 11 * MONTH) {
    amount = Math.max(1, Math.round(span / MONTH));
    unit = "mo";
  } else {
    amount = Math.max(1, Math.round(span / YEAR));
    unit = "y";
  }

  const figure = `${numberFormat(resolveLocale(options.locale), { maximumFractionDigits: 0 }).format(amount)}${NBSP}${unit}`;
  return delta < 0 ? `${figure} ago` : `in ${figure}`;
}

/* ------------------------------------------------------------- numbers --- */

/** A plain number with a fixed number of decimals. */
export function formatNumber(
  value: number | null | undefined,
  options: LocaleOptions & { decimals?: number } = {},
): string {
  if (!isFiniteNumber(value)) return MISSING;
  const decimals = options.decimals ?? 0;
  return numberFormat(resolveLocale(options.locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** "1,134": counts are whole and grouped. */
export function formatCount(value: number | null | undefined, options: LocaleOptions = {}): string {
  if (!isFiniteNumber(value)) return MISSING;
  return numberFormat(resolveLocale(options.locale), { maximumFractionDigits: 0 }).format(
    Math.round(value),
  );
}

/** "+3", "−2", "0": a week-on-week change in a count, with a true minus sign. */
export function formatDelta(value: number | null | undefined, options: LocaleOptions = {}): string {
  if (!isFiniteNumber(value)) return MISSING;
  const whole = Math.round(value);
  if (whole === 0) return formatCount(0, options);
  const magnitude = formatCount(Math.abs(whole), options);
  return whole > 0 ? `+${magnitude}` : `${MINUS}${magnitude}`;
}

/** "12.5 h": hours always to one decimal place, so a column of them aligns. */
export function formatHours(value: number | null | undefined, options: LocaleOptions = {}): string {
  if (!isFiniteNumber(value)) return MISSING;
  return `${formatNumber(value, { ...options, decimals: 1 })}${NBSP}h`;
}

/** "1.42×": a ratio to two decimal places with a true times sign. */
export function formatRatio(value: number | null | undefined, options: LocaleOptions = {}): string {
  if (!isFiniteNumber(value)) return MISSING;
  return `${formatNumber(value, { ...options, decimals: 2 })}${TIMES}`;
}

/**
 * "16%" from 0.16. Whole percentages only, and never a rounding that hides a
 * fact: a share above zero is "<1%", not "0%", and a share short of all is
 * ">99%", not "100%".
 */
export function formatShare(value: number | null | undefined, options: LocaleOptions = {}): string {
  if (!isFiniteNumber(value)) return MISSING;
  const percent = numberFormat(resolveLocale(options.locale), {
    style: "percent",
    maximumFractionDigits: 0,
  });
  if (value > 0 && value < 0.01) return `<${percent.format(0.01)}`;
  if (value > 0.99 && value < 1) return `>${percent.format(0.99)}`;
  return percent.format(value);
}

/* ------------------------------------------------------------ by kind ---- */

/**
 * The kinds the API contract uses for units, fact columns, evidence items and
 * insight details. Pages format any contract value through formatByKind, so a
 * figure reads the same in a tile, a table cell, a drawer and an export.
 */
export type ValueKind =
  | "text"
  | "number"
  | "count"
  | "hours"
  | "days"
  | "ratio"
  | "share"
  | "points"
  | "date"
  | "datetime"
  | "issue_key";

/**
 * One contract value as text. Numbers in a text kind are written as they are;
 * a date kind accepts ISO strings; anything missing reads as "—".
 */
export function formatByKind(
  value: unknown,
  kind: ValueKind | string | null | undefined,
  options: ZoneOptions = {},
): string {
  if (value === null || value === undefined || value === "") return MISSING;
  const number = typeof value === "number" ? value : Number.NaN;
  switch (kind) {
    case "count":
      return formatCount(number, options);
    case "number":
      return Number.isInteger(number) ? formatCount(number, options) : formatNumber(number, { ...options, decimals: 1 });
    case "hours":
      return formatHours(number, options);
    case "days":
      return isFiniteNumber(number) ? `${formatNumber(number, { ...options, decimals: 1 })}${NBSP}d` : MISSING;
    case "ratio":
      return formatRatio(number, options);
    case "share":
      return formatShare(number, options);
    case "points":
      return isFiniteNumber(number)
        ? `${formatNumber(number, { ...options, decimals: Number.isInteger(number) ? 0 : 1 })}${NBSP}pt`
        : MISSING;
    case "date":
      return typeof value === "string" || typeof value === "number" || value instanceof Date
        ? formatDate(value, options)
        : MISSING;
    case "datetime":
      return typeof value === "string" || typeof value === "number" || value instanceof Date
        ? formatDateTime(value, options)
        : MISSING;
    default:
      return typeof value === "number" ? formatNumber(value, { ...options, decimals: Number.isInteger(value) ? 0 : 2 }) : String(value);
  }
}
