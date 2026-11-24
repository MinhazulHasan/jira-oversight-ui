import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const card = cva("min-w-0", {
  variants: {
    variant: {
      /** A sheet of its own on the desk. */
      sheet: "sheet",
      /** Lifted off the sheet: something that can be acted on or opened. */
      raised: "raised",
      /** Recessed into the sheet: grouped facts, a specimen, a quote. */
      inset: "rounded-md border border-rule-weak bg-rail",
    },
    padding: {
      none: "",
      sm: "p-3",
      md: "p-4",
      lg: "p-6",
    },
  },
  defaultVariants: { variant: "sheet", padding: "md" },
});

export interface CardProps extends Omit<ComponentProps<"div">, "title">, VariantProps<typeof card> {
  /** A small heading for the card. */
  title?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Controls at the right of the title row. */
  actions?: ReactNode;
}

/** A panel. */
export function Card({ variant, padding, title, description, actions, className, children, ...props }: CardProps) {
  return (
    <div className={cn(card({ variant, padding }), className)} {...props}>
      {title || actions ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <h3 className="text-sm font-medium text-ink">{title}</h3> : null}
            {description ? <p className="text-xs text-ink-low">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
