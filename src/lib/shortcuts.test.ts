import { describe, expect, it } from "vitest";

import { CHORD_TIMEOUT_MS, isTypingTarget, resolveShortcut, type KeyInput } from "./shortcuts";

const press = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

const idle = { typing: false, chordArmedAt: null, now: 10_000 };

describe("resolveShortcut", () => {
  it("opens the palette with Cmd+K or Ctrl+K, even while typing", () => {
    expect(resolveShortcut(press("k", { metaKey: true }), idle)).toEqual({ type: "palette" });
    expect(resolveShortcut(press("K", { ctrlKey: true }), { ...idle, typing: true })).toEqual({
      type: "palette",
    });
  });

  it("navigates with g then a page letter", () => {
    expect(resolveShortcut(press("g"), idle)).toEqual({ type: "arm-chord" });
    const armed = { typing: false, chordArmedAt: 10_000, now: 10_400 };
    expect(resolveShortcut(press("f"), armed)).toEqual({ type: "navigate", href: "/findings" });
    expect(resolveShortcut(press("o"), armed)).toEqual({ type: "navigate", href: "/" });
    expect(resolveShortcut(press("b"), armed)).toEqual({ type: "navigate", href: "/baseline" });
  });

  it("lets a chord lapse", () => {
    const lapsed = { typing: false, chordArmedAt: 10_000, now: 10_001 + CHORD_TIMEOUT_MS };
    expect(resolveShortcut(press("f"), lapsed)).toBeNull();
  });

  it("ignores a letter after g that names no page", () => {
    expect(resolveShortcut(press("x"), { typing: false, chordArmedAt: 10_000, now: 10_100 })).toBeNull();
  });

  it("maps the single keys", () => {
    expect(resolveShortcut(press("?"), idle)).toEqual({ type: "shortcuts" });
    expect(resolveShortcut(press("/"), idle)).toEqual({ type: "focus-search" });
    expect(resolveShortcut(press("["), idle)).toEqual({ type: "toggle-rail" });
  });

  it("never fires a single key while the reader is typing", () => {
    const typing = { ...idle, typing: true };
    for (const key of ["g", "?", "/", "["]) expect(resolveShortcut(press(key), typing)).toBeNull();
    expect(resolveShortcut(press("f"), { typing: true, chordArmedAt: 10_000, now: 10_100 })).toBeNull();
  });

  it("leaves browser and system combinations alone", () => {
    expect(resolveShortcut(press("g", { ctrlKey: true }), idle)).toBeNull();
    expect(resolveShortcut(press("k", { ctrlKey: true, altKey: true }), idle)).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("treats text fields as typing", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("does not treat buttons, checkboxes or plain elements as typing", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("leaves widgets with their own keys alone", () => {
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    expect(isTypingTarget(listbox)).toBe(true);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.append(inside);
    document.body.append(dialog);
    expect(isTypingTarget(inside)).toBe(true);
    dialog.remove();
  });

  it("treats editable content as typing", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.append(child);
    document.body.append(editor);
    expect(isTypingTarget(child)).toBe(true);
    editor.remove();
  });
});
