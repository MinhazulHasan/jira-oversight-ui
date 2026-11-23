import type { DOMAttributes, KeyboardEvent, SyntheticEvent } from "react";

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Where Backspace edits text, and so is the reader's: a field. */
const FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Backspace, kept from the browser in a layer that holds no field of its own
 * (a person card, pinned beside a name or as a bottom sheet). WebKit takes
 * Backspace pressed outside a field for Back, which would leave the page,
 * and an answer or a question being written on it, for the one before. A
 * field inside the layer keeps its Backspace, and Backspace with a modifier
 * is left alone. Give it to the layer's `onKeyDownCapture`, so it is read
 * before anything inside hears the key.
 */
export function keepBackspaceFromBrowser(event: KeyboardEvent<Element>): void {
  if (event.key !== "Backspace" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest(FIELD) !== null) return;
  event.preventDefault();
}

/**
 * React's own events, stopped at the edge of a portal's content.
 *
 * A portal is drawn at the end of the page, but React passes its events up
 * through the components it was rendered from. A person card opened from a
 * table row, a chip in the question box or a bar with a tooltip would
 * otherwise hand that row, field or tooltip every press, key and focus made
 * inside the card: a press on one of its links would open the row too, Enter
 * would ask the question, and the pointer moving over it would open the
 * row's tooltip. Spread these on the content's outermost element (and on an
 * overlay's). Handlers inside it run as before; the browser's own events
 * (keyboard shortcuts, a layer's outside press, a focus trap) are untouched.
 */
export const CONTAINED_EVENTS = {
  onClick: stop,
  onAuxClick: stop,
  onContextMenu: stop,
  onDoubleClick: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onMouseMove: stop,
  onMouseOver: stop,
  onMouseOut: stop,
  onPointerDown: stop,
  onPointerUp: stop,
  onPointerMove: stop,
  onPointerOver: stop,
  onPointerOut: stop,
  onPointerCancel: stop,
  onTouchStart: stop,
  onTouchMove: stop,
  onTouchEnd: stop,
  onTouchCancel: stop,
  onKeyDown: stop,
  onKeyUp: stop,
  onFocus: stop,
  onBlur: stop,
  onCopy: stop,
  onCut: stop,
  onPaste: stop,
  onCompositionStart: stop,
  onCompositionUpdate: stop,
  onCompositionEnd: stop,
  onBeforeInput: stop,
  onInput: stop,
  onChange: stop,
  onDragStart: stop,
  onDrag: stop,
  onDragEnd: stop,
  onDragEnter: stop,
  onDragLeave: stop,
  onDragOver: stop,
  onDrop: stop,
  onWheel: stop,
} satisfies DOMAttributes<HTMLElement>;
