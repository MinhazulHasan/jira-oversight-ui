"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/utils";

import { fieldTrigger, floatingSurface } from "./surfaces";

export interface ComboboxOption {
  value: string;
  label: string;
  /** A second line, e.g. a rule's title under its id. */
  description?: string;
  /** Right-aligned secondary text, e.g. the number of open findings. */
  hint?: ReactNode;
  /** Extra words the search should match. */
  keywords?: readonly string[];
  /** Set the label in Plex Mono (rule ids, epic keys). */
  mono?: boolean;
  /** A decorative mark before the label: a person's picture. */
  leading?: ReactNode;
}

/** Case-insensitive match on the value, label, description and keywords; every word must appear. */
export function matchesQuery(option: ComboboxOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [option.value, option.label, option.description ?? "", ...(option.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** "Any", "R-EST-01", or "R-EST-01 +2": what the trigger says about the choice. */
export function summarise(options: readonly ComboboxOption[], value: readonly string[], anyLabel: string): string {
  if (value.length === 0) return anyLabel;
  const first = options.find((option) => option.value === value[0]);
  const name = first?.label ?? value[0];
  return value.length === 1 ? name : `${name} +${value.length - 1}`;
}

/** Tick or untick one value. */
export function toggleValue(options: readonly ComboboxOption[], value: readonly string[], changed: string): string[] {
  const selected = new Set(value);
  if (selected.has(changed)) return value.filter((item) => item !== changed);
  return options
    .filter((option) => selected.has(option.value) || option.value === changed)
    .map((option) => option.value);
}

export interface ComboboxPanelProps {
  /** What is being chosen, e.g. "Rule". Names the listbox and the search field. */
  label: string;
  options: readonly ComboboxOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  /** The search text; the owner keeps it so Escape can clear it before it closes anything. */
  query: string;
  onQueryChange: (query: string) => void;
  searchPlaceholder?: string;
  /** Said when the search matches nothing. */
  emptyText?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** The control that ends the choice, after Clear: the popover's Done. */
  done?: ReactNode;
  className?: string;
}

/** The searchable, multi-select list itself. */
export function ComboboxPanel({
  label,
  options,
  value,
  onValueChange,
  query,
  onQueryChange,
  searchPlaceholder,
  emptyText = "Nothing matches that.",
  inputRef,
  done,
  className,
}: ComboboxPanelProps) {
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const visible = useMemo(() => options.filter((option) => matchesQuery(option, query)), [options, query]);
  const selected = useMemo(() => new Set(value), [value]);
  const activeIndex = visible.length === 0 ? -1 : Math.min(active, visible.length - 1);

  const toggle = (option: ComboboxOption) => onValueChange(toggleValue(options, value, option.value));

  const moveTo = (index: number) => {
    if (visible.length === 0) return;
    const wrapped = (index + visible.length) % visible.length;
    setActive(wrapped);
    document.getElementById(optionId(wrapped))?.scrollIntoView?.({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case "PageDown":
        event.preventDefault();
        moveTo(Math.min(activeIndex + 8, visible.length - 1));
        break;
      case "PageUp":
        event.preventDefault();
        moveTo(Math.max(activeIndex - 8, 0));
        break;
      case "Enter": {
        event.preventDefault();
        const option = visible[activeIndex];
        if (option) toggle(option);
        break;
      }
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-rule-weak px-3">
        <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={`Search ${label.toLowerCase()}`}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-low"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        // Focus stays in the search field (aria-activedescendant); -1 only keeps the list programmatically focusable.
        tabIndex={-1}
        aria-label={label}
        aria-multiselectable
        // Keep focus in the search field when an option is clicked.
        onMouseDown={(event) => event.preventDefault()}
        className="scroll-region max-h-[min(320px,50vh)] p-1.5"
      >
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-low">{emptyText}</p>
        ) : (
          visible.map((option, index) => {
            const checked = selected.has(option.value);
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={checked}
                data-active={index === activeIndex || undefined}
                onPointerMove={() => {
                  if (index !== activeIndex) setActive(index);
                }}
                onClick={() => toggle(option)}
                className="flex cursor-pointer items-start gap-2.5 rounded-[6px] px-2.5 py-2 text-sm text-ink-mid select-none data-[active]:bg-hover data-[active]:text-ink"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                    checked ? "border-ink bg-ink" : "border-rule-control bg-sheet",
                  )}
                >
                  {checked ? <Check size={10} strokeWidth={3} className="text-sheet" /> : null}
                </span>
                {/* Centred on the first line, which is a pixel shorter than a 20 px picture. */}
                {option.leading ? <span className="-my-px flex shrink-0">{option.leading}</span> : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate", checked && "text-ink", option.mono && "mono")}>{option.label}</span>
                  {option.description ? (
                    <span className="truncate text-xs text-ink-low">{option.description}</span>
                  ) : null}
                </span>
                {option.hint !== undefined ? (
                  <span className="mono mt-px shrink-0 text-xs text-ink-low">{option.hint}</span>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-rule-weak bg-rail px-3 text-xs text-ink-low">
        <span aria-live="polite">
          {value.length === 0 ? `${options.length} to choose from` : `${value.length} selected`}
        </span>
        <span className="flex items-center gap-1">
          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onValueChange([])}
              className="pressable rounded-[5px] px-2 py-1 text-ink-mid hover:bg-hover hover:text-ink"
            >
              Clear
            </button>
          ) : null}
          {done}
        </span>
      </div>
    </div>
  );
}

export interface ComboboxProps {
  /** What is being filtered, e.g. "Rule" or "Epic". The trigger and the list are named after it. */
  label: string;
  options: readonly ComboboxOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  /** Shown in the trigger when nothing is chosen. */
  anyLabel?: string;
  searchPlaceholder?: string;
  /** Said when the search matches nothing. */
  emptyText?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Open the list from outside (a link that lands on it); left out, the trigger alone opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** How the trigger shows the choice, given what it says ("Ada Brooks"): a person's name that opens their card. */
  renderValue?: (text: string) => ReactNode;
  className?: string;
  /** inline. */
  labelPlacement?: "inline" | "above" | "hidden";
  /** The trigger's id, for a form that focuses a field to show what is wrong with it. */
  id?: string;
  /** A choice that cannot be saved as it is: the edge in the breach ink, the words beside it saying why. */
  invalid?: boolean;
  /** The ids of its hint and its message. */
  describedBy?: string;
}

/** Choose several values from a long list by typing (rules, epics). */
export function Combobox({
  label,
  options,
  value,
  onValueChange,
  anyLabel = "Any",
  searchPlaceholder,
  emptyText,
  size = "md",
  disabled,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  renderValue,
  className,
  labelPlacement = "inline",
  id,
  invalid = false,
  describedBy,
}: ComboboxProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const valueId = useId();
  const above = labelPlacement !== "inline";

  const onOpenChange = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChangeProp?.(next);
    if (!next) setQuery("");
  };

  const trigger = (
    <PopoverPrimitive.Trigger
      id={id}
      disabled={disabled}
      aria-labelledby={above ? `${labelId} ${valueId}` : undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        fieldTrigger,
        size === "sm" ? "h-7 pr-1.5 pl-2.5 text-xs" : "h-8 pr-2 pl-3 text-sm",
        above && "justify-between",
        invalid && "border-breach hover:border-breach",
        className,
      )}
    >
      {/* The spaces between the parts keep the name readable ("Rule R-FLOW-02 +1"); a flex row draws none. */}
      {above ? null : (
        <>
          <span className="text-ink-low">{label}</span>{" "}
        </>
      )}
      <span id={valueId} className={cn("truncate", value.length > 0 ? "font-medium text-ink" : "text-ink-mid")}>
        {renderValue ? renderValue(summarise(options, value, anyLabel)) : summarise(options, value, anyLabel)}
      </span>
      <ChevronDown aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
    </PopoverPrimitive.Trigger>
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {above ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span id={labelId} className={labelPlacement === "hidden" ? "sr-only" : "text-xs text-ink-low"}>
            {label}
          </span>
          {trigger}
        </div>
      ) : (
        trigger
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-label={label}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // The first Escape clears the search; the next one closes the list.
            if (query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          className={cn(floatingSurface, "w-[min(340px,calc(100vw-32px))] overflow-hidden")}
        >
          <ComboboxPanel
            label={label}
            options={options}
            value={value}
            onValueChange={onValueChange}
            query={query}
            onQueryChange={setQuery}
            searchPlaceholder={searchPlaceholder}
            emptyText={emptyText}
            inputRef={inputRef}
            done={
              <PopoverPrimitive.Close className="pressable rounded-[5px] px-2 py-1 font-medium text-ink hover:bg-hover">
                Done
              </PopoverPrimitive.Close>
            }
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
