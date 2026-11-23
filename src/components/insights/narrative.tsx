"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SeverityMark } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import type { Candidate, InsightSentence } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import type { SentencePart, TraceFocus } from "./bind";
import { TONES, candidatesOf, primaryHref, sentenceSource, tonesIn } from "./model";
import { CandidateRef, FindingsLink, IssueKeys, candidateAnchor, useFindingsTarget } from "./trace-links";

/*
 * The briefing, sentence by sentence. Each carries its tone as a mark (the
 * words are in the legend and read out with the sentence), the candidates it
 * was written from and the findings behind them. Hovering or focusing a
 * sentence lights those candidates and the very figures it quotes.
 */

/**
 * Shared with the candidate rows: the hover ground, and when linked to what
 * the reader is on, the tick-and-tie line down the left edge. The line, not a
 * tint, so the lit figures inside keep their contrast.
 */
export const traceRow =
  "group relative -mx-3 rounded-md px-3 transition-[background-color,box-shadow] duration-[var(--dur-fast)] data-[row-href]:cursor-pointer hover:bg-rail data-[linked=true]:rounded-l-none data-[linked=true]:shadow-[inset_2px_0_0_var(--cite)] print:mx-0 print:break-inside-avoid print:px-0 print:shadow-none";

function ToneLegend({ sentences }: { sentences: readonly InsightSentence[] }) {
  return (
    <ul aria-label="Tones" className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-ink-low">
      {tonesIn(sentences).map((tone) => (
        <li key={tone} className="inline-flex items-center gap-1.5">
          <SeverityMark severity={TONES[tone].mark} size={9} />
          {TONES[tone].label}
        </li>
      ))}
    </ul>
  );
}

function SentenceText({
  sentence,
  parts,
  focus,
}: {
  sentence: InsightSentence;
  parts: readonly SentencePart[];
  focus: TraceFocus;
}) {
  return (
    <p className="text-lg leading-[1.6] text-pretty text-ink print:text-base">
      <span className="sr-only">{TONES[sentence.tone].label}: </span>
      {parts.map((part, index): ReactNode => {
        if (part.kind === "key") {
          return (
            <Link
              key={index}
              href={`/issues/${part.issueKey}`}
              className="mono text-ink underline decoration-rule-strong underline-offset-[3px] hover:text-cite hover:decoration-cite"
            >
              {part.text}
            </Link>
          );
        }
        if (part.kind === "figure") {
          const lit = focus.figureLit(sentence.id, part.candidateId);
          return (
            <span
              key={index}
              data-figure
              data-quoted={part.detailKey}
              className={cn("transition-colors duration-[var(--dur-fast)]", lit && "font-medium text-cite")}
            >
              {part.text}
            </span>
          );
        }
        return <span key={index}>{part.text}</span>;
      })}
    </p>
  );
}

function SentenceItem({
  sentence,
  parts,
  candidates,
  ranks,
  focus,
}: {
  sentence: InsightSentence;
  parts: readonly SentencePart[];
  /** The candidates it was written from, in rank order. */
  candidates: readonly Candidate[];
  ranks: ReadonlyMap<string, number>;
  focus: TraceFocus;
}) {
  const lead = candidates[0];
  const orphan = lead ? null : sentenceSource(sentence);
  const target = useFindingsTarget(lead ?? orphan ?? undefined);
  const href = target?.href ?? (lead ? `#${candidateAnchor(lead)}` : orphan ? primaryHref(orphan, null) : null);

  return (
    <li
      data-trace-kind="sentence"
      data-trace-id={sentence.id}
      data-row-href={href ?? undefined}
      data-linked={focus.linkedSentences.has(sentence.id) || undefined}
      className={cn(traceRow, "flex gap-3.5 py-2.5")}
    >
      <span className="flex h-[1.6em] shrink-0 items-center text-lg">
        <SeverityMark severity={TONES[sentence.tone].mark} size={10} />
      </span>
      <div className="min-w-0 flex-1">
        <SentenceText sentence={sentence} parts={parts} focus={focus} />
        {candidates.length > 0 || orphan ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {candidates.map((candidate, index) => (
              <SentenceCitation
                key={candidate.id}
                candidate={candidate}
                rank={ranks.get(candidate.id) ?? index + 1}
                primary={index === 0}
              />
            ))}
            {orphan ? <OrphanSources source={orphan} /> : null}
          </div>
        ) : null}
      </div>
      {href ? (
        <ArrowUpRight
          aria-hidden
          size={15}
          strokeWidth={1.75}
          className="mt-1.5 shrink-0 text-ink-low opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 print:hidden"
        />
      ) : null}
    </li>
  );
}

function SentenceCitation({ candidate, rank, primary }: { candidate: Candidate; rank: number; primary: boolean }) {
  const target = useFindingsTarget(candidate);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <CandidateRef candidate={candidate} rank={rank} primary={primary && target === null} />
      {target ? <FindingsLink target={target} primary={primary} /> : null}
    </span>
  );
}

function OrphanSources({ source }: { source: Candidate }) {
  const target = useFindingsTarget(source);
  return target ? <FindingsLink target={target} primary /> : <IssueKeys keys={source.issue_keys} primary />;
}

export function Narrative({
  sentences,
  candidates,
  bound,
  focus,
  verified,
  className,
}: {
  sentences: readonly InsightSentence[];
  candidates: readonly Candidate[];
  bound: ReadonlyMap<string, readonly SentencePart[]>;
  focus: TraceFocus;
  verified: boolean;
  className?: string;
}) {
  const ranks = new Map(candidates.map((candidate, index) => [candidate.id, index + 1]));
  return (
    <Section
      id="briefing"
      title={verified ? "The briefing" : "The candidate table"}
      headingLevel={3}
      actions={sentences.length > 0 ? <ToneLegend sentences={sentences} /> : undefined}
      className={cn("max-w-[72ch]", className)}
    >
      {sentences.length === 0 ? (
        <EmptyState
          size="compact"
          title="No sentences in this briefing"
          description="The ranked candidates are still listed."
        />
      ) : (
        <ol className="flex flex-col gap-0.5">
          {sentences.map((sentence) => (
            <SentenceItem
              key={sentence.id}
              sentence={sentence}
              parts={bound.get(sentence.id) ?? [{ kind: "text", text: sentence.text }]}
              candidates={candidatesOf(sentence, candidates)}
              ranks={ranks}
              focus={focus}
            />
          ))}
        </ol>
      )}
    </Section>
  );
}
