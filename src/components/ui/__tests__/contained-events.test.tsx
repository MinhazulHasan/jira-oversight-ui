import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { keepBackspaceFromBrowser } from "../contained-events";
import { Sheet } from "../sheet";
import { renderKit } from "./kit";

/*
 * Backspace in a layer that holds no field of its own (a person card): WebKit
 * takes it for Back, so the layer keeps it from the browser. A field inside
 * keeps its Backspace, and a key with a modifier is left alone.
 */

function Layer() {
  return (
    <div role="dialog" aria-label="Card" tabIndex={-1} onKeyDownCapture={keepBackspaceFromBrowser}>
      <a href="#scorecard">View scorecard</a>
      <button type="button">Close</button>
      <input aria-label="A field" />
      <textarea aria-label="A text area" />
      <div aria-label="An editor" role="textbox" contentEditable suppressContentEditableWarning>
        <span data-testid="in-editor">text</span>
      </div>
      <div aria-label="Not editable" role="textbox" contentEditable="false" suppressContentEditableWarning>
        <span data-testid="not-editable">text</span>
      </div>
    </div>
  );
}

describe("keepBackspaceFromBrowser", () => {
  it("keeps Backspace pressed on the layer, a link or a button in it from the browser", () => {
    render(<Layer />);
    expect(fireEvent.keyDown(screen.getByRole("dialog"), { key: "Backspace" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByRole("link", { name: "View scorecard" }), { key: "Backspace" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Backspace" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByTestId("not-editable"), { key: "Backspace" })).toBe(false);
  });

  it("leaves Backspace to a field, other keys and Backspace with a modifier alone", () => {
    render(<Layer />);
    expect(fireEvent.keyDown(screen.getByRole("textbox", { name: "A field" }), { key: "Backspace" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole("textbox", { name: "A text area" }), { key: "Backspace" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByTestId("in-editor"), { key: "Backspace" })).toBe(true);
    const layer = screen.getByRole("dialog");
    expect(fireEvent.keyDown(layer, { key: "Delete" })).toBe(true);
    expect(fireEvent.keyDown(layer, { key: "x" })).toBe(true);
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      expect(fireEvent.keyDown(layer, { key: "Backspace", [modifier]: true })).toBe(true);
    }
  });
});

describe("a Sheet that keeps Backspace", () => {
  it("keeps it only when asked: a person card's sheet does, the evidence drawer is as it was", () => {
    const { rerender } = renderKit(
      <Sheet open onOpenChange={() => {}} title="Ada Brooks" side="bottom" keepBackspace>
        <p>Figures</p>
      </Sheet>,
    );
    expect(fireEvent.keyDown(screen.getByRole("dialog", { name: "Ada Brooks" }), { key: "Backspace" })).toBe(false);
    rerender(
      <Sheet open onOpenChange={() => {}} title="Ada Brooks" side="bottom">
        <p>Figures</p>
      </Sheet>,
    );
    expect(fireEvent.keyDown(screen.getByRole("dialog", { name: "Ada Brooks" }), { key: "Backspace" })).toBe(true);
  });
});
