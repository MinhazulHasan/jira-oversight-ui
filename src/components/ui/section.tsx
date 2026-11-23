import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SectionProps {
  /** The section's name, set as a small uppercase label: "Hot spots". */
  title: string;
  /** A figure beside the name, e.g. how many rows follow. */
  count?: ReactNode;
  /** A line under the rule on what the section shows. */
  description?: ReactNode;
  /** Right of the rule: a link to the full view, an export. */
  actions?: ReactNode;
  /** h2 on a page, h3 inside a drawer. */
  headingLevel?: 2 | 3;
  id?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A titled part of a page. Sections are separated by space and a hairline
 * that runs from the label to the actions, never by another card: the page
 * is one sheet.
 */
export function Section({
  title,
  count,
  description,
  actions,
  headingLevel = 2,
  id,
  children,
  className,
}: SectionProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-h-6 items-center gap-3">
        {/* A long name wraps rather than pushing the actions off a narrow screen. */}
        <Heading id={headingId} className="micro min-w-0 text-ink-low">
          {title}
        </Heading>
        {count !== undefined ? <span className="mono -ml-1 shrink-0 text-xs text-ink-low">{count}</span> : null}
        <span aria-hidden className="h-px min-w-6 flex-1 bg-rule-weak" />
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      {description ? <p className="-mt-1 max-w-[76ch] text-sm text-ink-mid">{description}</p> : null}
      {children}
    </section>
  );
}
