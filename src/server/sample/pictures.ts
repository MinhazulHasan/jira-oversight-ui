/** The sample's two pictures, drawn here in code: an abstract pattern (a */

import { createHash } from "node:crypto";

/** A picture as the service holds one: its bytes, their type, and the version the contract names it by. */
export interface SamplePicture {
  bytes: Uint8Array<ArrayBuffer>;
  type: "image/png";
  /** The first 12 hex characters of sha256 of the bytes. */
  version: string;
}

type Rgb = readonly [number, number, number];

interface Pattern {
  ground: Rgb;
  mark: Rgb;
  /** Five rows of the left three columns ("x" is marked); the right two mirror them. */
  rows: readonly [string, string, string, string, string];
}

/** 48 px square, the size of the picture Jira links; a 30 px grid of 6 px cells keeps clear of the round it is shown in. */
const SIZE = 48;
const CELL = 6;
const MARGIN = (SIZE - 5 * CELL) / 2;

/** By made-up account id (team.ts). Calm hues from the chart palette, clear of the status colours and the teal. */
const PATTERNS: Readonly<Record<string, Pattern>> = {
  // Carmen Ruiz, who leads the Overview's people: violet.
  "acc-03": { ground: [0x8c, 0x6e, 0xbd], mark: [0xf4, 0xf0, 0xfa], rows: [".x.", "xx.", ".xx", "x.x", ".x."] },
  // Grace Lindqvist, the first assignee on Findings and the showcase breach's: blue.
  "acc-07": { ground: [0x56, 0x74, 0xbe], mark: [0xee, 0xf2, 0xfa], rows: ["x.x", ".xx", "xx.", "..x", "xx."] },
};

/* ------------------------------------------------------------------- PNG -- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as PNG chunks carry it (ISO 3309). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream holding the data in one stored block: no compressor, so nothing varies between machines. */
function zlibStored(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (data.length > 0xffff) throw new Error("a sample picture is larger than one stored block");
  const out = new Uint8Array(2 + 5 + data.length + 4);
  // 0x78 0x01: deflate with a 32 KB window, no dictionary, the header's check bits set.
  out.set([0x78, 0x01, 0x01, data.length & 0xff, data.length >>> 8, ~data.length & 0xff, (~data.length >>> 8) & 0xff]);
  out.set(data, 7);
  new DataView(out.buffer).setUint32(7 + data.length, adler32(data));
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit RGB PNG of `raw`: each row its filter byte (0, none), then the row's pixels. */
function png(width: number, height: number, raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // 8 bits a channel, truecolour, deflate, adaptive filtering, no interlace.
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* --------------------------------------------------------------- drawing -- */

function marked(pattern: Pattern, x: number, y: number): boolean {
  if (x < MARGIN || y < MARGIN) return false;
  const column = Math.floor((x - MARGIN) / CELL);
  const row = Math.floor((y - MARGIN) / CELL);
  if (column > 4 || row > 4) return false;
  return pattern.rows[row][column < 3 ? column : 4 - column] === "x";
}

function draw(pattern: Pattern): Uint8Array<ArrayBuffer> {
  const stride = 1 + SIZE * 3;
  const raw = new Uint8Array(SIZE * stride);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      raw.set(marked(pattern, x, y) ? pattern.mark : pattern.ground, y * stride + 1 + x * 3);
    }
  }
  return png(SIZE, SIZE, raw);
}

const PICTURES: ReadonlyMap<string, SamplePicture> = new Map(
  Object.entries(PATTERNS).map(([accountId, pattern]) => {
    const bytes = draw(pattern);
    const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    return [accountId, { bytes, type: "image/png", version }];
  }),
);

/** The picture of a made-up account, or null for the six without one. */
export function pictureOf(accountId: string): SamplePicture | null {
  return PICTURES.get(accountId) ?? null;
}
