"use client";

import { Search, X } from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";

import { Keys } from "@/components/shell/kbd";
import { cn } from "@/lib/utils";

export interface SearchInputProps
  extends Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "size"> {
  /** The field's accessible name, e.g. "Search findings". */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  pageSearch?: boolean;
  /** Width and layout of the field. */
  className?: string;
}

/** The page's search field. */
export function SearchInput({
  label,
  value,
  onValueChange,
  pageSearch = true,
  placeholder,
  className,
  onKeyDown,
  onFocus,
  onBlur,
  ref,
  ...props
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);

  // The clear button refocuses the field, so the kit keeps its own handle and passes it on.
  const setRefs = (element: HTMLInputElement | null) => {
    inputRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };

  return (
    <div className={cn("jo-field w-full", className)}>
      <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      <input
        {...props}
        ref={setRefs}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder ?? label}
        autoComplete="off"
        spellCheck={false}
        data-page-search={pageSearch ? "" : undefined}
        aria-keyshortcuts={pageSearch ? "/" : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "Escape") return;
          if (value) {
            event.preventDefault();
            onValueChange("");
          } else {
            event.currentTarget.blur();
          }
        }}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          className="pressable inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-low hover:bg-hover hover:text-ink"
        >
          <X aria-hidden size={13} strokeWidth={2} />
        </button>
      ) : pageSearch && !focused ? (
        <Keys keys={["/"]} className="mr-0.5" />
      ) : null}
    </div>
  );
}
