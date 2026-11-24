import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Every page is a sheet on the desk that opens with a header. */

export function PageSheet({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("sheet rise", className)}>{children}</div>;
}

export function PageHeader({
  title,
  purpose,
  eyebrow,
  actions,
  titleClassName,
}: {
  title: ReactNode;
  purpose: ReactNode;
  /** A short label above the title, e.g. "Issue" or the project key. */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-rule-weak px-5 pt-6 pb-5 md:flex-row md:items-end md:justify-between md:gap-8 md:px-[var(--sheet-pad)] md:pt-7 md:pb-6">
      <div className="min-w-0 max-w-[76ch]">
        {eyebrow ? <p className="micro mb-2 text-ink-low">{eyebrow}</p> : null}
        <h1 className={cn("text-h font-semibold tracking-[-0.015em] text-ink", titleClassName)}>
          {title}
        </h1>
        <p className="mt-1.5 text-base text-ink-mid">{purpose}</p>
      </div>
      {actions ? (
        <div data-print="hide" className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-6 md:px-[var(--sheet-pad)] md:py-7", className)}>{children}</div>;
}
