import { useRef } from "react";

export interface ReturnFocus {
  /** On the dialog's content, before anything of its own: notes the control that has the focus as it opens. */
  onOpenAutoFocus: () => void;
  /** On the dialog's content, after anything of its own: gives the focus back as it closes. */
  onCloseAutoFocus: (event: Event) => void;
}

/** Gives the focus back as a dialog closes to the control that held it as the dialog opened. */
export function useReturnFocus(fallback?: () => HTMLElement | null | undefined): ReturnFocus {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      // Radix asks before it moves the focus, so what has it now is what opened the dialog.
      const focused = document.activeElement;
      opener.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    },
    onCloseAutoFocus: (event) => {
      const from = opener.current;
      opener.current = null;
      if (event.defaultPrevented) return;
      event.preventDefault();
      (from?.isConnected ? from : (fallback?.() ?? null))?.focus();
    },
  };
}
