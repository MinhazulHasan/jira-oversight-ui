"use client";

import { ArrowUpRight, Inbox } from "lucide-react";

import { Badge, SeverityBadge, SeverityMark } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { KeyValueList } from "@/components/ui/key-value";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Candidate } from "@/lib/api/schemas";
import { formatByKind, formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { TraceFocus } from "./bind";
import {
  KIND_LABELS,
  affectedUnit,
  isTextDetail,
  primaryHref,
  trendWord,
  type CandidateDetail,
  type CandidateSeverity,
} from "./model";
import { traceRow } from "./narrative";
import { FindingsLink, IssueKeys, candidateAnchor, useFindingsTarget } from "./trace-links";

/*
 * The ranked problems the briefing was written from: what code found, in the
 * order it scored them. Each shows what it counts and which way it is moving,
 * and the figures the sentences were allowed to quote, formatted by kind.
 */

function SeverityLabel({ severity }: { severity: CandidateSeverity }) {
  if (severity === "info") {
    return (
      <Badge tone="muted" size="sm">
        <SeverityMark severity="neutral" size={8} />
        Info
      </Badge>
    );
  }
  return <SeverityBadge severity={severity} size="sm" />;
}

/** "26 open breaches · rising": what the problem counts and which way it is moving, in words. */
function Extent({ candidate }: { candidate: Candidate }) {
  const locale = useFigureLocale();
  return (
    <p className="text-xs text-ink-low">
      <span className="mono text-ink-mid" data-figure>
        {formatCount(candidate.affected, { locale })}
      </span>{" "}
      {affectedUnit(candidate.kind, candidate.affected)} · {trendWord(candidate.trend)}
    </p>
  );
}

function detailKind(detail: CandidateDetail): string {
  return detail.unit ?? (typeof detail.value === "number" ? "number" : "text");
}

function CandidateItem({
  candidate,
  rank,
  linked,
  lit,
}: {
  candidate: Candidate;
  rank: number;
  linked: boolean;
  lit: ReadonlySet<string> | undefined;
}) {
  const locale = useFigureLocale();
  const target = useFindingsTarget(candidate);
  const href = primaryHref(candidate, target);
  const words = candidate.detail.filter(isTextDetail);
  const figures = candidate.detail.filter((detail) => !isTextDetail(detail));

  return (
    <li
      id={candidateAnchor(candidate)}
      data-trace-kind="candidate"
      data-trace-id={candidate.id}
      data-row-href={href ?? undefined}
      data-linked={linked || undefined}
      className={cn(
        traceRow,
        // A hairline between candidates, inset to the text so it lines up with the section's rule.
        "flex gap-3 rounded-none py-3.5 before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-rule-weak first:before:hidden print:before:inset-x-0",
      )}
    >
      <span aria-hidden className="mono w-4 shrink-0 pt-px text-sm text-ink-low group-data-[linked=true]:text-cite">
        {rank}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm leading-snug font-medium text-pretty text-ink">{candidate.title}</h4>
            <p className="mt-0.5 text-xs text-ink-low">
              {KIND_LABELS[candidate.kind]}
              {words.map((detail) => (
                <span key={detail.key}>
                  {" · "}
                  {detail.label}: <span className="text-ink-mid">{String(detail.value)}</span>
                </span>
              ))}
            </p>
          </div>
          <SeverityLabel severity={candidate.severity} />
        </div>

        <Extent candidate={candidate} />

        {figures.length > 0 ? (
          <KeyValueList
            variant="plain"
            labelWidth="minmax(0,3fr)"
            className="-mx-1.5 text-xs [&>div]:min-h-6 [&>div]:rounded-xs [&>div]:px-1.5"
            items={figures.map((detail) => ({
              id: detail.key,
              label: detail.label,
              value: formatByKind(detail.value, detailKind(detail), { locale }),
              mono: true,
              highlight: lit?.has(detail.key) ?? false,
            }))}
          />
        ) : null}

        {target || candidate.issue_keys.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {target ? <FindingsLink target={target} primary /> : null}
            <IssueKeys keys={candidate.issue_keys} primary={!target} />
          </div>
        ) : null}
      </div>
      {href ? (
        <ArrowUpRight
          aria-hidden
          size={15}
          strokeWidth={1.75}
          className="shrink-0 text-ink-low opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 print:hidden"
        />
      ) : null}
    </li>
  );
}

export function CandidateList({
  candidates,
  focus,
  className,
}: {
  candidates: readonly Candidate[];
  focus: TraceFocus;
  className?: string;
}) {
  return (
    <Section
      id="candidates"
      title="Top problems"
      count={candidates.length > 0 ? candidates.length : undefined}
      headingLevel={3}
      description="Ranked by issues affected, severity and trend."
      className={cn("max-w-[72ch] xl:max-w-none", className)}
    >
      {candidates.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Inbox}
          title="No problems this week"
        />
      ) : (
        <ol className="flex flex-col">
          {candidates.map((candidate, index) => (
            <CandidateItem
              key={candidate.id}
              candidate={candidate}
              rank={index + 1}
              linked={focus.linkedCandidates.has(candidate.id)}
              lit={focus.litDetails.get(candidate.id)}
            />
          ))}
        </ol>
      )}
    </Section>
  );
}
