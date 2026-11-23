import { formatNumber, formatShare } from "@/lib/format";

/*
 * Axis arithmetic shared by the charts. Ticks fall on clean round numbers
 * (1, 2 or 5 times a power of ten), never on the data's own extremes, so a
 * reader can read any value off the grid.
 */

export interface NiceScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

const STEPS = [1, 2, 5];

/** Decimal places needed to write a multiple of this step without float noise. */
function decimalsOf(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

/**
 * The domain and ticks for values between min and max: the smallest round
 * step that needs no more than maxTicks + 1 ticks, with the domain widened
 * to whole steps. `zero` keeps zero on the axis (counts, hours on bars).
 */
export function niceScale(
  min: number,
  max: number,
  { maxTicks = 5, zero = false }: { maxTicks?: number; zero?: boolean } = {},
): NiceScale {
  let lo = zero ? Math.min(0, min) : min;
  let hi = zero ? Math.max(0, max) : max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (hi === lo) {
    const pad = hi === 0 ? 1 : Math.abs(hi) * 0.1;
    lo = zero && lo >= 0 ? lo : lo - pad;
    hi += pad;
  }

  const raw = (hi - lo) / Math.max(1, maxTicks - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const candidates = [...STEPS.map((step) => step * power), ...STEPS.map((step) => step * power * 10)];
  for (const step of candidates) {
    const start = Math.floor(lo / step + 1e-9) * step;
    const end = Math.ceil(hi / step - 1e-9) * step;
    const count = Math.round((end - start) / step) + 1;
    if (count <= maxTicks + 1) {
      const decimals = decimalsOf(step);
      const ticks = Array.from({ length: count }, (_, index) => Number((start + index * step).toFixed(decimals)));
      return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks };
    }
  }
  return { min: lo, max: hi, step: hi - lo, ticks: [lo, hi] };
}

/**
 * Which week to label on a weekly axis: every nth, counted back from the
 * latest, so the week a reader cares about most is always named.
 */
export function weekTicks<T extends { week: string }>(rows: readonly T[], maxLabels: number): string[] {
  if (rows.length === 0) return [];
  const step = Math.max(1, Math.ceil(rows.length / Math.max(1, maxLabels)));
  return rows.filter((_, index) => (rows.length - 1 - index) % step === 0).map((row) => row.week);
}

/*
 * Axis labels are round numbers, so they carry no more decimals than their
 * step needs, and every tick on one axis carries the same number.
 */

/** A tick formatter: the value, the locale, and the step between ticks when the chart knows it. */
export type AxisFormat = (value: number, options: { locale?: string; step?: number }) => string;

/** "35 h", "2.5 h". */
export const axisHours: AxisFormat = (value, { locale, step } = {}) =>
  `${formatNumber(value, { locale, decimals: step === undefined ? (Number.isInteger(value) ? 0 : 1) : decimalsOf(step) })}\u00a0h`;

/** "1.1×", "1.25×": ratios to the step's precision rather than always two places. */
export const axisRatio: AxisFormat = (value, { locale, step } = {}) =>
  `${formatNumber(value, { locale, decimals: step === undefined ? 2 : decimalsOf(step) })}×`;

/** "15%". */
export const axisShare: AxisFormat = (value, { locale } = {}) => formatShare(value, { locale });
