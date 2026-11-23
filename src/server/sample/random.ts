/**
 * A seeded generator, so the sample project is the same on every machine and
 * every run. Each concern draws from its own stream (forked by label), so
 * tuning one part of the story never reshuffles the rest of it.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(choices: readonly (readonly [T, number])[]): T;
  /** Standard normal (Box–Muller). */
  normal(): number;
  /** Log-normal with the given median; sigma is the spread of the log. */
  lognormal(median: number, sigma: number): number;
}

/** FNV-1a: turns a label into a 32-bit seed. */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast and plenty for a story about 1,150 tickets. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number, label = ""): Rng {
  const next = mulberry32(hash32(`${seed}:${label}`));

  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from an empty list");
      return items[Math.floor(next() * items.length)];
    },
    weighted: (choices) => {
      const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
      let point = next() * total;
      for (const [value, weight] of choices) {
        point -= weight;
        if (point < 0) return value;
      }
      return choices[choices.length - 1][0];
    },
    normal: () => {
      // 1 - next() keeps the logarithm away from zero.
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    lognormal: (median, sigma) => median * Math.exp(sigma * rng.normal()),
  };
  return rng;
}
