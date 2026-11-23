import { describe, expect, it } from "vitest";

import { convexHull, edgeCrossing, insidePolygon, laneArea, wayArea, type Box, type Point } from "../grace";

/*
 * The way from a name to its hover card (JO-13) in plain geometry: the way,
 * where the card stays (the whole name, the whole card, and room for a hand's
 * curve), and its lane, where no other name's card is armed (the straight
 * ways from where the pointer left to the whole card).
 */

/** The People table's first name and the card beside it, level with it and moved up to fit a 900 px window. */
const NAME = { left: 280, top: 380, right: 440, bottom: 416 };
const CARD = { left: 448, top: 327, right: 788, bottom: 888 };
/** Findings' Assignee column at 1440 × 900 (the final check's case): a 20 px picture and the name, its card beside it. */
const ASSIGNEE = { left: 853.2, top: 440.4, right: 977.4, bottom: 460.6 };
const ASSIGNEE_CARD = { left: 985, top: 308, right: 1325, bottom: 888 };

const LAYOUTS = [
  { name: "the People table", box: NAME, card: CARD, text: { x: 372, y: 398 }, picture: { x: 290, y: 398 } },
  { name: "Findings' Assignee column", box: ASSIGNEE, card: ASSIGNEE_CARD, text: { x: 929.3, y: 450.5 }, picture: { x: 863.2, y: 450.5 } },
];

/** The middles of the three ways on in the card's 36 px foot: View scorecard (the leftmost), Open findings, Ask about. */
const waysOn = (card: Box): [string, Point][] => [
  ["View scorecard", { x: card.left + 57, y: card.bottom - 18 }],
  ["Open findings", { x: card.left + 166, y: card.bottom - 18 }],
  ["Ask about", { x: card.left + 280, y: card.bottom - 18 }],
];

const within = (box: Box, point: Point) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;

/**
 * Points along a quadratic arc from `from` to `to`, its middle `bow` px off the straight line: positive bows to the
 * left of the way (on a way down to a card on the right, away from it), negative to the right.
 */
function arc(from: Point, to: Point, bow: number, steps = 400): Point[] {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const normal = { x: -(to.y - from.y) / chord, y: (to.x - from.x) / chord };
  const control = { x: (from.x + to.x) / 2 + 2 * bow * normal.x, y: (from.y + to.y) / 2 + 2 * bow * normal.y };
  return Array.from({ length: steps + 1 }, (_, step) => {
    const t = step / steps;
    return {
      x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x,
      y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y,
    };
  });
}

/**
 * Follows a pointer along `path` from the name to the card as the trigger does: leaving the name draws the shape
 * from where it left; true when it is on the card before it is ever outside that shape.
 */
function reaches(path: Point[], name: Box, card: Box, shape: (exit: Point, from: Box, to: Box) => Point[]): boolean {
  let area: Point[] | null = null;
  for (const point of path) {
    if (within(card, point)) return true;
    if (within(name, point)) {
      area = null;
      continue;
    }
    area ??= shape(point, name, card);
    if (!insidePolygon(point, area)) return false;
  }
  return true;
}

/**
 * The pointer as a browser that reports few moves delivers it (WebKit here: one every 150 px or so at a hand's
 * speed): one sample every `gap` px along the path, the first `offset` px in, and its end.
 */
function sampled(path: Point[], gap: number, offset: number): Point[] {
  const samples = [path[0]];
  let travelled = 0;
  let next = offset;
  for (let i = 1; i < path.length; i += 1) {
    travelled += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (travelled >= next) {
      samples.push(path[i]);
      next += gap;
    }
  }
  return [...samples, path[path.length - 1]];
}

/**
 * Follows sampled moves from the name to the card as the trigger does, the exit read by `exitOf` from the last
 * sighting on the name and the first sample off it; true when the card is reached before a sample is off the way.
 */
function reachesSampled(samples: Point[], name: Box, card: Box, exitOf: (seen: Point, now: Point) => Point): boolean {
  let area: Point[] | null = null;
  let seen = samples[0];
  for (const point of samples) {
    if (within(card, point)) return true;
    if (within(name, point)) {
      area = null;
      seen = point;
      continue;
    }
    area ??= wayArea(exitOf(seen, point), name, card);
    if (!insidePolygon(point, area)) return false;
  }
  return true;
}

describe("the convex hull", () => {
  it("keeps the corners and drops what lies inside or on an edge between them", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 5, y: 0 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(expect.arrayContaining([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  });
});

describe("where the pointer crossed the edge", () => {
  it("is on the side it crossed, however far past it the first move off lands", () => {
    // From the middle of the name, a jump far down and to the left: it crossed the foot, not the left side it ends nearer.
    const exit = edgeCrossing({ x: 360, y: 398 }, { x: 250, y: 560 }, NAME);
    expect(exit.y).toBeCloseTo(NAME.bottom, 6);
    expect(exit.x).toBeGreaterThan(NAME.left);
    expect(exit.x).toBeLessThan(360);
    // Out by the right side, towards a card beside the name.
    expect(edgeCrossing({ x: 400, y: 398 }, { x: 520, y: 410 }, NAME)).toEqual({ x: 440, y: 402 });
    // Through a corner: the corner.
    expect(edgeCrossing({ x: 430, y: 406 }, { x: 450, y: 426 }, NAME)).toEqual({ x: 440, y: 416 });
  });

  it("is where the pointer is when it was never seen on the box", () => {
    expect(edgeCrossing({ x: 100, y: 100 }, { x: 250, y: 560 }, NAME)).toEqual({ x: 250, y: 560 });
  });
});

describe("a point in a polygon", () => {
  it("is inside or outside a square as it looks", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(insidePolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(insidePolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(insidePolygon({ x: 5, y: -1 }, square)).toBe(false);
  });
});

describe("the way, where the card stays", () => {
  for (const layout of LAYOUTS) {
    it(`holds a hand's curve to every way on at the card's foot, bowing up to 60 px either way, from the name or its picture (${layout.name})`, () => {
      for (const [where, start] of [
        ["the name", layout.text],
        ["the picture", layout.picture],
      ] as const) {
        for (const [way, target] of waysOn(layout.card)) {
          for (const bow of [-60, -45, -30, 0, 15, 30, 45, 60]) {
            expect(reaches(arc(start, target, bow), layout.box, layout.card, wayArea), `from ${where} to ${way}, bowing ${bow} px`).toBe(true);
          }
        }
      }
    });
  }

  it("holds the same curves when the pointer is reported only every 60 to 200 px, read from where it crossed the name's edge", () => {
    const crossing = (box: Box) => (seen: Point, now: Point) => edgeCrossing(seen, now, box);
    for (const layout of LAYOUTS) {
      for (const start of [layout.text, layout.picture]) {
        for (const [way, target] of waysOn(layout.card)) {
          for (const bow of [-60, -45, -30, 0, 30, 45, 60]) {
            const path = arc(start, target, bow, 2000);
            for (const gap of [60, 100, 150, 200]) {
              for (let offset = 10; offset < gap; offset += 10) {
                const samples = sampled(path, gap, offset);
                expect(reachesSampled(samples, layout.box, layout.card, crossing(layout.box)), `${layout.name} to ${way}, bowing ${bow} px, every ${gap} px from ${offset}`).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it("would lose a sampled curve if the first move off the name were taken for where it left (the WebKit case)", () => {
    // From the assignee's picture, bowing 60 px, reported every 100 px: the first move off the picture lands below
    // and to the left of the name, nearer its left side than its foot, a side facing away from the card.
    const samples = sampled(arc(LAYOUTS[1].picture, waysOn(ASSIGNEE_CARD)[0][1], 60, 2000), 100, 20);
    expect(reachesSampled(samples, ASSIGNEE, ASSIGNEE_CARD, (_seen, now) => now)).toBe(false);
    expect(reachesSampled(samples, ASSIGNEE, ASSIGNEE_CARD, (seen, now) => edgeCrossing(seen, now, ASSIGNEE))).toBe(true);
  });

  it("holds the final check's path that the straight ways alone lost: 30 px away from the card, to View scorecard", () => {
    const path = arc(LAYOUTS[1].text, waysOn(ASSIGNEE_CARD)[0][1], 30);
    expect(reaches(path, ASSIGNEE, ASSIGNEE_CARD, laneArea)).toBe(false);
    expect(reaches(path, ASSIGNEE, ASSIGNEE_CARD, wayArea)).toBe(true);
  });

  it("is left at once by a side facing away from the card, and leaves out what lies past the card", () => {
    // Out by the name's far side, away from the card beside it.
    const area = wayArea({ x: 279, y: 398 }, NAME, CARD);
    expect(insidePolygon({ x: 277, y: 398 }, area)).toBe(false);
    expect(insidePolygon({ x: 277, y: 440 }, area)).toBe(false);
    // Out by the foot, on the way to the card's foot: past the card is still outside.
    const down = wayArea({ x: 300, y: 417 }, NAME, CARD);
    expect(insidePolygon({ x: 300, y: 420 }, down)).toBe(true);
    expect(insidePolygon({ x: 600, y: 892 }, down)).toBe(false);
    expect(insidePolygon({ x: 792, y: 600 }, down)).toBe(false);
    expect(insidePolygon({ x: 600, y: 323 }, down)).toBe(false);
    // Far down and to the left of the card's foot: not on the way to it.
    expect(insidePolygon({ x: 300, y: 860 }, down)).toBe(false);
    // A card below the name: out by the name's top, or by its far side, is off the way at once.
    const below = { left: 280, top: 424, right: 620, bottom: 985 };
    expect(insidePolygon({ x: 360, y: 377 }, wayArea({ x: 360, y: 379 }, NAME, below))).toBe(false);
    expect(insidePolygon({ x: 277, y: 400 }, wayArea({ x: 279, y: 400 }, NAME, below))).toBe(false);
    expect(insidePolygon({ x: 445, y: 420 }, wayArea({ x: 441, y: 410 }, NAME, below))).toBe(true);
  });

  it("from the card back to the name, the other way round", () => {
    const area = wayArea({ x: 447, y: 860 }, CARD, NAME);
    // Back up to the name, bowing out to the left.
    for (const point of arc({ x: 447, y: 860 }, { x: 372, y: 398 }, -45).filter((point) => !within(NAME, point) && !within(CARD, point))) {
      expect(insidePolygon(point, area), `${point.x}, ${point.y}`).toBe(true);
    }
    // Past the card's far side, or below it: not on the way to the name.
    expect(insidePolygon({ x: 792, y: 600 }, wayArea({ x: 789, y: 600 }, CARD, NAME))).toBe(false);
    expect(insidePolygon({ x: 600, y: 892 }, wayArea({ x: 600, y: 889 }, CARD, NAME))).toBe(false);
  });
});

describe("the lane, where no other name's card is armed", () => {
  it("holds every straight way from where the pointer left the name to anywhere on the card", () => {
    // Leaving the name's foot, heading down and right to the ways on at the card's foot, across the names below.
    const exit = { x: 372, y: 417 };
    const area = laneArea(exit, NAME, CARD);
    for (const target of [
      { x: 500, y: 870 },
      { x: 460, y: 340 },
      { x: 780, y: 880 },
    ]) {
      for (let step = 0; step <= 20; step += 1) {
        const point = { x: exit.x + ((target.x - exit.x) * step) / 20, y: exit.y + ((target.y - exit.y) * step) / 20 };
        expect(insidePolygon(point, area), `${point.x}, ${point.y}`).toBe(true);
      }
    }
  });

  it("is narrower than the way: a curve's middle, and the names just below and to the left, are on the way but off the lane", () => {
    const exit = { x: 372, y: 417 };
    const lane = laneArea(exit, NAME, CARD);
    const way = wayArea(exit, NAME, CARD);
    for (const point of [
      // The middle of a 45 px curve down to View scorecard.
      arc({ x: 372, y: 398 }, waysOn(CARD)[0][1], 45)[200],
      // The next row's name, below and to the left of where the pointer left.
      { x: 320, y: 450 },
    ]) {
      expect(insidePolygon(point, way), `${point.x}, ${point.y} on the way`).toBe(true);
      expect(insidePolygon(point, lane), `${point.x}, ${point.y} off the lane`).toBe(false);
    }
  });

  it("leaves out the way back, and anywhere off to the side", () => {
    const area = laneArea({ x: 441, y: 398 }, NAME, CARD);
    expect(insidePolygon({ x: 300, y: 398 }, area)).toBe(false);
    expect(insidePolygon({ x: 300, y: 800 }, area)).toBe(false);
    expect(insidePolygon({ x: 600, y: 300 }, area)).toBe(false);
    expect(insidePolygon({ x: 445, y: 400 }, area)).toBe(true);
    expect(insidePolygon({ x: 600, y: 600 }, area)).toBe(true);
  });

  it("from the card back to the name, the other way round", () => {
    const area = laneArea({ x: 447, y: 500 }, CARD, NAME);
    expect(insidePolygon({ x: 444, y: 460 }, area)).toBe(true);
    expect(insidePolygon({ x: 400, y: 600 }, area)).toBe(false);
  });
});
