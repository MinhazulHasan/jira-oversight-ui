import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/shell/brand-mark";

/* The pieces both sign-in pages share. */

export function SignInSheet({ children }: { children: ReactNode }) {
  return (
    <div className="sheet rise flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <BrandMark size={32} className="shrink-0" />
        <p className="flex min-w-0 flex-col leading-tight">
          <span className="text-md font-semibold tracking-[-0.01em] text-ink">Jira Oversight</span>
          <span className="text-xs text-ink-low">ManCo Central</span>
        </p>
      </div>
      {children}
    </div>
  );
}

export function SignInHeading({ eyebrow, title, purpose }: { eyebrow?: string; title: string; purpose: string }) {
  return (
    <div className="flex flex-col gap-2">
      {eyebrow ? <p className="micro text-ink-low">{eyebrow}</p> : null}
      <h1 className="text-h font-semibold tracking-[-0.015em] text-ink">{title}</h1>
      <p className="text-base text-ink-mid">{purpose}</p>
    </div>
  );
}

/** The page's one primary action, as a plain link (a GET). */
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="pressable inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cite px-4 text-sm font-medium text-cite-ink hover:bg-cite-hot"
    >
      {children}
      <ArrowRight aria-hidden size={15} strokeWidth={1.75} className="shrink-0" />
    </a>
  );
}

/** A link out of the dashboard, in running text. */
export function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium whitespace-nowrap text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
    >
      {children}
      <ArrowUpRight aria-hidden size={12} strokeWidth={1.75} className="ml-0.5 inline align-[-1px]" />
      {/* The comma keeps the words apart however the accessible name is assembled. */}
      <span className="sr-only">, opens in a new tab</span>
    </a>
  );
}
