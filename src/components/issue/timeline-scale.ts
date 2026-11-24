
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const PAD_X = 10;
/** The surface left where the axis is cut. */
export const CUT_GAP = 12;
/** The compressed stretch from the cut to now. */
export const STUB_W = 44;

export interface TimelineScale {
  t0: number;
  t1: number;
  /** The instant after which the axis is compressed, or null for one continuous axis. */
  cutAt: number | null;
  /** Where the to-scale part of the plot ends, in px. */
  mainEnd: number;
  x: (time: number) => number;
}

export interface ScaleInput {
  /** The earliest instant on the chart. */
  start: number;
  /** The last thing that happened: the latest status change, skip or field event. */
  lastEvent: number;
  /** The latest closed end of any spell (a spell can end after the last event only in odd data). */
  latest: number;
  /** Now: where an open spell runs to and the now marker stands. */
  clock: number;
  /** The plot's width in px. */
  width: number;
  allowCut?: boolean;
}

/** Cut when the stretch since the last change is over three days and more than twice the life before it. */
export function shouldCut(start: number, lastEvent: number, clock: number): boolean {
  const active = lastEvent - start;
  const tail = clock - lastEvent;
  return active > 0 && tail > 2 * active && tail > 3 * DAY;
}

/** Where the cut falls: a little after the last change, so the final spell is seen to begin. */
export function cutAfter(start: number, lastEvent: number): number {
  return lastEvent + Math.max((lastEvent - start) * 0.12, 6 * HOUR);
}

/** The quiet stretch a finished issue's axis cuts out, or null when its axis runs whole. */
export function quietStretch(start: number, lastEvent: number, clock: number): { from: number; days: number } | null {
  const t0 = Math.min(start, clock);
  if (!shouldCut(t0, lastEvent, clock)) return null;
  const from = cutAfter(t0, lastEvent);
  return { from, days: Math.floor((clock - from) / DAY) };
}

export function timelineScale({ start, lastEvent, latest, clock, width, allowCut = false }: ScaleInput): TimelineScale {
  const inner = Math.max(1, width - PAD_X * 2);
  const t0 = Math.min(start, clock);

  if (allowCut && inner > STUB_W * 3 && shouldCut(t0, lastEvent, clock)) {
    const cutAt = cutAfter(t0, lastEvent);
    const t1 = clock + (clock - cutAt) * 0.1;
    const mainWidth = inner - STUB_W - CUT_GAP;
    const mainEnd = PAD_X + mainWidth;
    const x = (time: number) =>
      time <= cutAt
        ? PAD_X + ((time - t0) / Math.max(1, cutAt - t0)) * mainWidth
        : mainEnd + CUT_GAP + Math.min(1, (time - cutAt) / Math.max(1, t1 - cutAt)) * STUB_W;
    return { t0, t1, cutAt, mainEnd, x };
  }

  const end = Math.max(clock, latest);
  const t1 = end + (end - t0) * 0.02;
  const x = (time: number) => PAD_X + ((time - t0) / Math.max(1, t1 - t0)) * inner;
  return { t0, t1, cutAt: null, mainEnd: PAD_X + inner, x };
}

/** A bar with independently rounded ends: an open spell has a square end at now. */
export function barPath(x: number, y: number, w: number, h: number, left: number, right: number): string {
  const l = Math.min(left, w / 2, h / 2);
  const r = Math.min(right, w / 2, h / 2);
  return [
    `M${x + l} ${y}`,
    `H${x + w - r}`,
    r ? `A${r} ${r} 0 0 1 ${x + w} ${y + r}` : "",
    `V${y + h - r}`,
    r ? `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` : "",
    `H${x + l}`,
    l ? `A${l} ${l} 0 0 1 ${x} ${y + h - l}` : "",
    `V${y + l}`,
    l ? `A${l} ${l} 0 0 1 ${x + l} ${y}` : "",
    "Z",
  ].join("");
}

/** A diamond centred on (cx, cy): the mark for a field change. */
export function diamondPath(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;
}
