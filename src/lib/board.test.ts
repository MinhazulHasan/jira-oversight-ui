import { describe, expect, it } from "vitest";

import { BOARD_COOKIE, boardCookie, boardFromCookie, boardFromCookieHeader, landingAfterSwitch } from "./board";

describe("the board cookie", () => {
  it("reads a project key, in any case, and nothing else", () => {
    expect(boardFromCookie("AIL")).toBe("AIL");
    expect(boardFromCookie(" ail ")).toBe("AIL");
    expect(boardFromCookie("OPS_2")).toBe("OPS_2");
    for (const bad of [undefined, null, "", "A", "1AB", "AIL-1", "AIL&x=1", "a b", "A".repeat(21)]) {
      expect(boardFromCookie(bad), String(bad)).toBeNull();
    }
  });

  it("finds its own cookie in a Cookie header", () => {
    expect(boardFromCookieHeader(`theme=dark; ${BOARD_COOKIE}=OPS; jo-rail=collapsed`)).toBe("OPS");
    expect(boardFromCookieHeader("theme=dark")).toBeNull();
    expect(boardFromCookieHeader(`x${BOARD_COOKIE}=OPS`)).toBeNull();
    expect(boardFromCookieHeader(`${BOARD_COOKIE}=AIL%3Bx`)).toBeNull();
    expect(boardFromCookieHeader(null)).toBeNull();
  });

  it("reads the last of two, as the server's parser does, and no pick from a value it cannot decode", () => {
    expect(boardFromCookieHeader(`${BOARD_COOKIE}=CHARLIE; theme=dark; ${BOARD_COOKIE}=BRAVO`)).toBe("BRAVO");
    expect(boardFromCookieHeader(`${BOARD_COOKIE}=%E0%A4%A`)).toBeNull();
    expect(boardFromCookieHeader(`${BOARD_COOKIE}=OPS; ${BOARD_COOKIE}=%E0%A4%A`)).toBeNull();
  });

  it("writes a pick for a year, and forgets it at once", () => {
    expect(boardCookie("AIL")).toBe(`${BOARD_COOKIE}=AIL; path=/; max-age=31536000; samesite=lax`);
    expect(boardCookie(null)).toBe(`${BOARD_COOKIE}=; path=/; max-age=0; samesite=lax`);
  });

  it("lands on the same page after a switch, except an issue page", () => {
    expect(landingAfterSwitch("/findings")).toBe("/findings");
    expect(landingAfterSwitch("/ask")).toBe("/ask");
    expect(landingAfterSwitch("/issues/AIL-12")).toBe("/");
    expect(landingAfterSwitch("")).toBe("/");
  });
});
