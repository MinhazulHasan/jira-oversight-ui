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

function localeFromBrowser(): string | undefined {
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
  zoneNamed?: boolean;
}

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
