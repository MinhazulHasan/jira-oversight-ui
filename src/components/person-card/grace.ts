
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

export function wayArea(exit: Point, from: Box, to: Box): Point[] {
  return convexHull([...corners(from), ...alongSide(exit, exitSide(exit, from), from), ...corners(to)]);
}

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
