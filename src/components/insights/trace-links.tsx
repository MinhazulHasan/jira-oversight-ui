"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState, type MouseEvent } from "react";

import { badgeVariants } from "@/components/ui/badge";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useFinding } from "@/lib/api/hooks";
import type { Candidate } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { KIND_LABELS, findingsTarget, needsRuleHint, type FindingsTarget } from "./model";
import { focusRow } from "./use-trace";

export function useFindingsTarget(candidate: Candidate | undefined): FindingsTarget | null {
  const hint = useFinding(candidate && needsRuleHint(candidate) ? candidate.finding_ids[0] : null);
  return candidate ? findingsTarget(candidate, hint.data?.finding.rule_id) : null;
}

export function candidateAnchor(candidate: Candidate): string {
  return `candidate-${candidate.id}`;
}

const linkText = "underline-offset-2 hover:underline";

export function FindingsLink({
  target,
  primary = false,
  className,
}: {
  target: FindingsTarget;
  /** The row's own destination, which j and k land on. */
  primary?: boolean;
  className?: string;
}) {
  const locale = useFigureLocale();
  const noun = target.count === 1 ? target.noun[0] : target.noun[1];
  const count = formatCount(target.count, { locale });
  return (
    <Link
      href={target.href}
      data-row-primary={primary || undefined}
      aria-label={target.exact ? undefined : `Open the first of ${count} ${noun}`}
      className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-cite hover:text-cite-hot", linkText, className)}
    >
      <span className="mono" data-figure>
        {count}
      </span>{" "}
      {noun}
      <ArrowUpRight aria-hidden size={12} strokeWidth={2} className="shrink-0" />
    </Link>
  );
}

/** "1 Breach hot spot": a sentence's citation of the candidate it was written from. */
export function CandidateRef({
  candidate,
  rank,
  primary = false,
}: {
  candidate: Candidate;
  rank: number;
  primary?: boolean;
}) {
  const anchor = candidateAnchor(candidate);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    // The router scrolls to the candidate; focus follows, so the keyboard carries on from there.
    requestAnimationFrame(() => focusRow(document.getElementById(anchor)));
  };
  // A Link, not a bare anchor: the router records the jump, so Back returns here intact.
  return (
    <Link
      href={`#${anchor}`}
      onClick={onClick}
      data-row-primary={primary || undefined}
      className="group/ref inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-mid hover:text-ink"
    >
      <span className="sr-only">Candidate</span>{" "}
      <span className={cn(badgeVariants({ tone: "cite", size: "sm" }), "mono min-w-5 justify-center px-1.5 group-hover/ref:bg-cite-tint-strong group-hover/ref:text-cite-hot")}>
        {rank}
      </span>{" "}
      <span className={linkText}>{KIND_LABELS[candidate.kind]}</span>
      <span className="sr-only">: {candidate.title}</span>
    </Link>
  );
}

const SHOWN_KEYS = 3;

/** The issues a candidate is about: the first few, and the rest on request (all of them on paper). */
export function IssueKeys({ keys, primary = false }: { keys: readonly string[]; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  if (keys.length === 0) return null;
  const hidden = keys.length - SHOWN_KEYS;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-ink-low">Issues</span>
      <ul className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {keys.map((key, index) => (
          <li key={key} className={cn(index >= SHOWN_KEYS && !open && "hidden print:block")}>
            <Link
              href={`/issues/${key}`}
              data-row-primary={(primary && index === 0) || undefined}
              className={cn("mono -my-0.5 inline-block py-0.5 text-ink-mid hover:text-cite", linkText)}
            >
              {key}
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="pressable rounded-xs px-1 text-ink-low hover:bg-hover hover:text-ink print:hidden"
        >
          {open ? "Fewer" : `+${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}
