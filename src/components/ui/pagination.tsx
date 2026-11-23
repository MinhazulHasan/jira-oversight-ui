"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { IconButton } from "./button";
import { useFigureLocale } from "./use-figures";

export interface PaginationProps {
  /** 1-based, so it reads the same in the URL as on screen. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** What the rows are, for the range text: "findings". */
  noun?: string;
  className?: string;
}

/** The page count for a total, never less than one. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/**
 * Where the reader is in a long list ("26–50 of 214 findings") and the way
 * to the next page. The page belongs in the URL, so the caller owns it.
 */
export function Pagination({ page, pageSize, total, onPageChange, noun = "rows", className }: PaginationProps) {
  const locale = useFigureLocale();
  const pages = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const count = (value: number) => formatCount(value, { locale });

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-between gap-4 text-xs text-ink-low", className)}>
      <p aria-live="polite">
        <span className="mono text-ink-mid" data-figure>
          {count(from)}–{count(to)}
        </span>{" "}
        of{" "}
        <span className="mono text-ink-mid" data-figure>
          {count(total)}
        </span>{" "}
        {noun}
      </p>
      <div className="flex items-center gap-1">
        <span className="mr-2 hidden sm:inline">
          Page{" "}
          <span className="mono text-ink-mid" data-figure>
            {count(current)}
          </span>{" "}
          of{" "}
          <span className="mono text-ink-mid" data-figure>
            {count(pages)}
          </span>
        </span>
        <IconButton
          label="Previous page"
          icon={ChevronLeft}
          variant="secondary"
          size="sm"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        />
        <IconButton
          label="Next page"
          icon={ChevronRight}
          variant="secondary"
          size="sm"
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
        />
      </div>
    </nav>
  );
}
