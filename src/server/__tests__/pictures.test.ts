// @vitest-environment node
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isPicture, pictureType } from "../pictures";
import { buildDataset } from "../sample/dataset";
import { boardPeople, boardPicture, directoryPeople } from "../sample/people";
import { crc32, pictureOf } from "../sample/pictures";
import { MEMBERS, personIdFor, TEAM } from "../sample/team";

/** The sample's two pictures are abstract patterns drawn in code, and must be */

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));

interface Chunk {
  type: string;
  data: Buffer;
}

/** A PNG's chunks, each checked against its CRC as a decoder would. */
function chunks(bytes: Uint8Array): Chunk[] {
  const buffer = Buffer.from(bytes);
  expect([...buffer.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const found: Chunk[] = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    expect(buffer.readUInt32BE(at + 8 + length), `${type} CRC`).toBe(crc32(buffer.subarray(at + 4, at + 8 + length)));
    found.push({ type, data });
    at += 12 + length;
  }
  return found;
}

describe("the sample's pictures", () => {
  it("are two of the eight fictional people's; the other six have none", () => {
    const pictured = TEAM.filter((member) => pictureOf(member.accountId) !== null).map((member) => member.name);
    expect(pictured).toEqual(["Carmen Ruiz", "Grace Lindqvist"]);
  });

  it("are valid PNGs: 48 px square, 8-bit RGB, their image data whole", () => {
    for (const accountId of ["acc-03", "acc-07"]) {
      const picture = pictureOf(accountId)!;
      expect(picture.type).toBe("image/png");
      const parts = chunks(picture.bytes);
      expect(parts.map((part) => part.type)).toEqual(["IHDR", "IDAT", "IEND"]);
      const header = parts[0].data;
      expect([header.readUInt32BE(0), header.readUInt32BE(4), ...header.subarray(8)]).toEqual([48, 48, 8, 2, 0, 0, 0]);
      const rows = inflateSync(parts[1].data);
      expect(rows.length).toBe(48 * (1 + 48 * 3));
      // Every row unfiltered, and the picture two colours: a ground and a pattern on it.
      const colours = new Set<string>();
      for (let y = 0; y < 48; y += 1) {
        expect(rows[y * 145]).toBe(0);
        for (let x = 0; x < 48; x += 1) colours.add(rows.subarray(y * 145 + 1 + x * 3, y * 145 + 4 + x * 3).toString("hex"));
      }
      expect(colours.size).toBe(2);
      expect(isPicture("image/png", picture.bytes)).toBe(true);
      expect(picture.bytes.length).toBeLessThan(256 * 1024);
    }
  });

  it("go by the contract's version: the first 12 hex characters of sha256 of their bytes", () => {
    const carmen = pictureOf("acc-03")!;
    const grace = pictureOf("acc-07")!;
    expect(carmen.version).toBe(createHash("sha256").update(carmen.bytes).digest("hex").slice(0, 12));
    expect(grace.version).toMatch(/^[0-9a-f]{12}$/);
    expect(carmen.version).not.toBe(grace.version);
    // Different patterns, not one picture twice.
    expect(Buffer.from(carmen.bytes).equals(Buffer.from(grace.bytes))).toBe(false);
  });

  it("are served only for someone on the board: assigned a ticket now, or a member", () => {
    expect(boardPeople(dataset).map((person) => person.name)).toContain("Carmen Ruiz");
    // The members with no tickets are on the board too; none of them has a picture, so none is served.
    const members = MEMBERS.map((member) => personIdFor(member.accountId));
    expect(directoryPeople(dataset).filter((person) => members.includes(person.id)).map((person) => person.avatar)).toEqual([null, null, null]);
    for (const id of members) expect(boardPicture(dataset, id)).toBeNull();
    expect(boardPicture(dataset, personIdFor("acc-03"))?.version).toBe(pictureOf("acc-03")?.version);
    expect(boardPicture(dataset, personIdFor("acc-01"))).toBeNull();
    expect(boardPicture(dataset, "p000000000000")).toBeNull();
  });

  it("are named by version on every person the sample sends", () => {
    const versions = new Map(boardPeople(dataset).map((person) => [person.name, person.avatar]));
    expect(versions.get("Carmen Ruiz")).toBe(pictureOf("acc-03")?.version);
    expect(versions.get("Grace Lindqvist")).toBe(pictureOf("acc-07")?.version);
    expect(versions.get("Ada Brooks")).toBeNull();
  });
});

describe("what passes as a picture", () => {
  it("is one of four types, read from the Content-Type in any case and with any parameters", () => {
    expect(pictureType("image/png")).toBe("image/png");
    expect(pictureType("IMAGE/JPEG; charset=binary")).toBe("image/jpeg");
    expect(pictureType("image/gif")).toBe("image/gif");
    expect(pictureType("image/webp")).toBe("image/webp");
    for (const type of ["image/svg+xml", "text/html", "application/json", "image/png-ish", "", null]) {
      expect(pictureType(type), String(type)).toBeNull();
    }
  });

  it("must start as its type says it does", () => {
    const bytes = (...values: number[]) => Uint8Array.from(values);
    const text = (value: string) => Uint8Array.from(Buffer.from(value, "latin1"));
    expect(isPicture("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(isPicture("image/gif", text("GIF89a...."))).toBe(true);
    expect(isPicture("image/gif", text("GIF87a...."))).toBe(true);
    expect(isPicture("image/webp", text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe(true);
    expect(isPicture("image/png", text("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(false);
    expect(isPicture("image/jpeg", pictureOf("acc-03")!.bytes)).toBe(false);
    expect(isPicture("image/webp", text("RIFF\u0000\u0000\u0000\u0000WAVEfmt "))).toBe(false);
    expect(isPicture("image/png", new Uint8Array(0))).toBe(false);
  });
});
