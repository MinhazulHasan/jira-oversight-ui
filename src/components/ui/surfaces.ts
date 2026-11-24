/** A popover, a select's list, a menu: the sheet lifted off the page. */
export const floatingSurface =
  "jo-pop z-[var(--z-overlay)] rounded-lg bg-sheet shadow-pop outline-none";

/** A row in a menu or a list. Highlight is a ground change, not a colour. */
export const menuItem =
  "relative flex min-h-8 cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-sm text-ink-mid outline-none select-none data-[highlighted]:bg-hover data-[highlighted]:text-ink data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/** A small uppercase label heading a group of rows. */
export const menuLabel = "micro px-2.5 pt-1.5 pb-2 text-ink-low";

/** A hairline between groups of rows. */
export const menuSeparator = "mx-1 my-1.5 h-px bg-rule-weak";

/** The tooltip: a short line of ink on the sheet, lifted. */
export const tooltipSurface =
  "jo-pop z-[var(--z-toast)] flex max-w-[280px] items-center gap-2.5 rounded-md bg-sheet px-2.5 py-1.5 text-xs leading-snug text-ink shadow-pop";

/** A control that opens a list of values (Select, Combobox, DateRange). */
export const fieldTrigger =
  "pressable inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-rule-control bg-sheet text-left whitespace-nowrap hover:border-ink-low data-[state=open]:border-ink-low disabled:cursor-not-allowed disabled:opacity-45";
