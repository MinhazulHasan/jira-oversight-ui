import type { DOMAttributes, KeyboardEvent, SyntheticEvent } from "react";

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Where Backspace edits text, and so is the reader's: a field. */
const FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export function keepBackspaceFromBrowser(event: KeyboardEvent<Element>): void {
  if (event.key !== "Backspace" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest(FIELD) !== null) return;
  event.preventDefault();
}

/** React's own events, stopped at the edge of a portal's content. */
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
