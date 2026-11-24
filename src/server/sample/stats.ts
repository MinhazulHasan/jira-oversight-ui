/** The statistics oversight/stats.py uses, so a sample median is computed the */

export function percentile(values: readonly number[], pct: number): number | null {
  const data = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (data.length === 0) return null;
  const rank = ((data.length - 1) * pct) / 100;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return data[low];
  return data[low] + (data[high] - data[low]) * (rank - low);
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 50);
}

export function share(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Facts carry floats to four decimals, as the backend's catalogue does, so no float noise reaches a reader. */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function round4OrNull(value: number | null): number | null {
  return value === null ? null : round4(value);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
