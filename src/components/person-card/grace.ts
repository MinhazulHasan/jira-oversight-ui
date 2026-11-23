/*
 * The way from a name to its hover card (JO-13). A card can open beside a
 * name, or below it, with its far parts (the ways on at its foot) a long way
 * from where the pointer leaves the name; at an ordinary speed the pointer is
 * outside both for longer than the 150 ms a card waits before it closes, it
 * crosses other names on the way, and a hand rarely moves in a straight line:
 * its path bows, often by a tenth of its length. So the pointer leaving the
 * name (or the card, back towards the name) draws two shapes, in plain
 * geometry, so they are tested without a browser:
 *
 * - The way: the smallest convex shape holding the whole name, the whole
 *   card, and the side the pointer left by, reaching well beyond either side
 *   of where it left. While the pointer is on it, the card stays; once it
 *   leaves it, the 150 ms begin. Nothing of it lies past a side the other
 *   lies wholly behind, so a pointer that leaves by a side facing away from
 *   the card is off the way at once.
 * - The lane: the smallest convex shape holding where the pointer left and
 *   the whole of the other, the straight ways there (as Radix's tooltip draws
 *   its grace area). While the pointer is in it, no other name's card is
 *   armed, so a hand that pauses on a name it crosses keeps the card; on the
 *   rest of the way, a name the pointer rests on opens its own card as it
 *   would anywhere, once it has been reported at a second place on it (the
 *   trigger's rule: a pass over a name is one report, JO-14).
 *
 * Both are drawn from where the pointer crossed the edge it left by, read
 * from its last sighting on the name (or the card) and its first off it, so
 * a browser that reports the pointer only every 150 px or so draws the same
 * shapes as one that reports every pixel.
 */

export interface Point {
  x: number;
  y: number;
}

/** A rectangle as the browser measures one (DOMRect has these). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far either side of the exit point the lane starts, so a pointer leaving at a corner is not lost at once. */
const LANE_PAD_PX = 5;
/**
 * How far the way reaches either side of where the pointer left, along the side it left by: room for a hand's
 * curve. A path to a way on at a card's foot, 450 px off, that bows 60 px away from the card stays on the way with
 * room to spare, from the middle of the name or from its picture.
 */
const WAY_REACH_PX = 96;

type Side = "left" | "right" | "top" | "bottom";

/** The side of `box` that `point` (on its edge, or just past it) left by: the nearest. */
function exitSide(point: Point, box: Box): Side {
  const distances: [Side, number][] = [
    ["left", Math.abs(point.x - box.left)],
    ["right", Math.abs(box.right - point.x)],
    ["top", Math.abs(point.y - box.top)],
    ["bottom", Math.abs(box.bottom - point.y)],
  ];
  return distances.reduce((nearest, entry) => (entry[1] < nearest[1] ? entry : nearest))[0];
}

/** Two points either side of the exit point, a little back inside the box it left. */
function paddedExit(point: Point, side: Side): Point[] {
  const { x, y } = point;
  switch (side) {
    case "top":
      return [
        { x: x - LANE_PAD_PX, y: y + LANE_PAD_PX },
        { x: x + LANE_PAD_PX, y: y + LANE_PAD_PX },
      ];
    case "bottom":
      return [
        { x: x - LANE_PAD_PX, y: y - LANE_PAD_PX },
        { x: x + LANE_PAD_PX, y: y - LANE_PAD_PX },
      ];
    case "left":
      return [
        { x: x + LANE_PAD_PX, y: y - LANE_PAD_PX },
        { x: x + LANE_PAD_PX, y: y + LANE_PAD_PX },
      ];
    case "right":
      return [
        { x: x - LANE_PAD_PX, y: y - LANE_PAD_PX },
        { x: x - LANE_PAD_PX, y: y + LANE_PAD_PX },
      ];
  }
}

/** Two points on the line of the side `box` was left by, `WAY_REACH_PX` either side of where the pointer left. */
function alongSide(point: Point, side: Side, box: Box): Point[] {
  switch (side) {
    case "top":
      return [
        { x: point.x - WAY_REACH_PX, y: box.top },
        { x: point.x + WAY_REACH_PX, y: box.top },
      ];
    case "bottom":
      return [
        { x: point.x - WAY_REACH_PX, y: box.bottom },
        { x: point.x + WAY_REACH_PX, y: box.bottom },
      ];
    case "left":
      return [
        { x: box.left, y: point.y - WAY_REACH_PX },
        { x: box.left, y: point.y + WAY_REACH_PX },
      ];
    case "right":
      return [
        { x: box.right, y: point.y - WAY_REACH_PX },
        { x: box.right, y: point.y + WAY_REACH_PX },
      ];
  }
}

const corners = (box: Box): Point[] => [
  { x: box.left, y: box.top },
  { x: box.right, y: box.top },
  { x: box.right, y: box.bottom },
  { x: box.left, y: box.bottom },
];

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The convex hull of some points (Andrew's monotone chain), anticlockwise in screen terms, no point repeated. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const half = (list: Point[]) => {
    const chain: Point[] = [];
    for (const point of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * Where a pointer last seen at `inside` (on `box`) and now at `outside` (off it) crossed the box's edge. A browser
 * that delivers few moves (WebKit here sends one every 150 px or so at a hand's speed) first reports the pointer
 * well past the edge, where the nearest side can be one it never crossed; the side it left by, and the way drawn
 * from it, are read where it really left. Without a sighting on the box, where it is now is all there is.
 */
export function edgeCrossing(inside: Point, outside: Point, box: Box): Point {
  const on = inside.x >= box.left && inside.x <= box.right && inside.y >= box.top && inside.y <= box.bottom;
  if (!on) return outside;
  const dx = outside.x - inside.x;
  const dy = outside.y - inside.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (box.right - inside.x) / dx);
  else if (dx < 0) t = Math.min(t, (box.left - inside.x) / dx);
  if (dy > 0) t = Math.min(t, (box.bottom - inside.y) / dy);
  else if (dy < 0) t = Math.min(t, (box.top - inside.y) / dy);
  return { x: inside.x + t * dx, y: inside.y + t * dy };
}

/**
 * The way for a pointer that left `from` at `exit`, on its way to `to`: the
 * hull of both boxes and the side it left by, `WAY_REACH_PX` either side of
 * the exit, so a path that bows on its way from anywhere on `from` to
 * anywhere on `to` stays inside, while one that leaves by a side `to` lies
 * wholly behind is outside at once.
 */
export function wayArea(exit: Point, from: Box, to: Box): Point[] {
  return convexHull([...corners(from), ...alongSide(exit, exitSide(exit, from), from), ...corners(to)]);
}

/**
 * The lane for a pointer that left `from` at `exit`, on its way to `to`: the
 * hull of the exit point (padded either side) and the corners of `to`, so
 * every straight path from where it left to anywhere on `to` lies inside.
 */
export function laneArea(exit: Point, from: Box, to: Box): Point[] {
  return convexHull([...paddedExit(exit, exitSide(exit, from)), ...corners(to)]);
}

/** Whether a point lies inside a polygon (ray casting; a point on an edge may fall either way). */
export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
