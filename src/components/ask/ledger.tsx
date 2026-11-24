"use client";

import { useId, useMemo, type ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { AskResponse, Citation, FactSet } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { DECLINE_LEDGER, declineOf, describeParams, indexCitations, toolLabel } from "./describe";
import { FactTable } from "./fact-table";
import { Markers, useTraceTarget, type CitationIndex } from "./ledger-parts";
import { ParamsInWords } from "./plan-steps";
import { useActiveCitation } from "./trace";

const HOT = "rounded-[3px] bg-cite-tint text-cite-hot shadow-[0_0_0_3px_var(--cite-tint)]";

/** A part of a fact set an answer can cite (its parameters, row count, note or as-of time), tied like a row. */
function Part({ fact, name, index, className, children }: { fact: FactSet; name: string; index: CitationIndex; className?: string; children: ReactNode }) {
  const ref = useTraceTarget(`fact:${fact.ref}:${name}`);
  const active = useActiveCitation();
  const hot = active?.fact_ref === fact.ref && active.row_index === -1 && active.column === name;
  const cited: Citation[] = index.byTarget.get(`fact:${fact.ref}:${name}`) ?? [];
  return (
    <span ref={ref} data-traced={hot || undefined} className={cn("transition-colors duration-100", hot && HOT, className)}>
      {children}
      {cited.length > 0 ? <Markers citations={cited} hot={hot} /> : null}
    </span>
  );
}

/** One catalogue call: what it was, in words; when it read Jira; its rows; its note. Never its raw call or query. */
function FactSetView({ fact, index }: { fact: FactSet; index: CitationIndex }) {
  const headingId = useId();
  const locale = useFigureLocale();
  const rows = fact.rows.length;
  return (
    <section aria-labelledby={headingId} data-fact={fact.ref} className="flex min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="mono shrink-0 rounded-[3px] border border-rule bg-sheet px-1 text-[10.5px] leading-[1.5] text-ink-low">
            {fact.ref}
          </span>
          <h3 id={headingId} className="min-w-0 truncate text-sm font-medium text-ink">
            {toolLabel(fact.tool)}
          </h3>
          <Part fact={fact} name="row_count" index={index} className="mono ml-auto shrink-0 text-[11px] text-ink-low">
            {formatCount(rows, { locale })} {rows === 1 ? "row" : "rows"}
          </Part>
        </div>
        {describeParams(fact.tool, fact.params).length > 0 ? (
          <p className="text-xs text-ink-mid">
            <Part fact={fact} name="params" index={index}>
              <ParamsInWords tool={fact.tool} params={fact.params} />
            </Part>
          </p>
        ) : null}
        {fact.as_of ? (
          <p className="text-[11px] text-ink-low">
            <Part fact={fact} name="as_of" index={index}>
              As of <Timestamp value={fact.as_of} mode="datetime" />
            </Part>
          </p>
        ) : null}
      </div>
      <FactTable fact={fact} index={index} captionId={headingId} />
      {fact.note ? (
        <p className="text-[11px] leading-snug text-ink-low">
          <Part fact={fact} name="note" index={index}>
            {fact.note}
          </Part>
        </p>
      ) : null}
      {fact.truncated ? (
        <p className="text-[11px] leading-snug text-ink-low">More rows exist in Jira; the first {formatCount(rows, { locale })} are shown.</p>
      ) : null}
    </section>
  );
}

/** Ruled before there is anything to rule: the ledger keeps its shape while it waits. */
function RuledEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[44ch] text-xs leading-relaxed text-ink-low">{children}</p>
      <div
        aria-hidden
        className="h-48 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,var(--rule-weak)_31px,var(--rule-weak)_32px)]"
      />
    </div>
  );
}

/** The ledger loading: two fact sets in their final shape. */
function LedgerSkeleton() {
  return (
    <SkeletonGroup label="Reading the facts" className="flex flex-col gap-7">
      {[6, 4].map((rows, set) => (
        <div key={set} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="ml-auto h-2.5 w-12" />
          </div>
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-2.5 w-56" />
          <div className="mt-1 flex flex-col">
            <div className="flex justify-between border-b border-rule px-2 pb-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-2.5 w-12" />
            </div>
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex h-8 items-center justify-between gap-6 border-b border-rule-weak px-2">
                <Skeleton className={cn("h-2.5", row % 2 ? "w-24" : "w-20")} />
                <Skeleton className="h-2.5 w-10" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

export type LedgerState = { kind: "idle" } | { kind: "loading" } | { kind: "failed" } | { kind: "response"; response: AskResponse };

function summary(state: LedgerState): string {
  if (state.kind === "idle") return "";
  if (state.kind === "loading") return "Reading";
  if (state.kind === "failed") return "Nothing read";
  const sets = state.response.facts.length;
  if (sets === 0) return "Nothing read";
  return `${sets} ${sets === 1 ? "source" : "sources"}`;
}

export function Ledger({ state, className }: { state: LedgerState; className?: string }) {
  const response = state.kind === "response" ? state.response : null;
  const index = useMemo(() => indexCitations(response?.citations ?? []), [response]);
  const facts = response?.facts ?? [];

  let body: ReactNode;
  if (state.kind === "loading") body = <LedgerSkeleton />;
  else if (facts.length > 0) body = facts.map((fact) => <FactSetView key={fact.ref} fact={fact} index={index} />);
  else if (response?.outcome === "not_measurable") {
    body = (
      <div className="flex flex-col gap-3.5">
        <p className="max-w-[44ch] text-xs leading-relaxed text-ink-low">
          Nothing was read. Jira holds no evidence for this.
        </p>
        <div className="flex items-stretch gap-3 rounded-md border border-rule bg-sheet">
          <span aria-hidden className="hatch w-3 shrink-0 rounded-l-md border-r border-rule" />
          <p className="py-2.5 pr-3 text-xs leading-relaxed text-ink-mid">
            <span className="micro mb-0.5 block text-ink-low">Not measurable</span>
            No rows. Jira keeps no record of this step.
          </p>
        </div>
      </div>
    );
  } else if (response?.outcome === "no_data" && response.answer?.trim()) {
    // People mentioned who hold none of the board's tickets: said in code, with nothing to look up.
    body = <RuledEmpty>Nothing was read. They hold no tickets on this board.</RuledEmpty>;
  } else if (response && declineOf(response)) {
    // Understood and turned down: said in the decline's own terms, never as a question nothing matched.
    body = <RuledEmpty>{DECLINE_LEDGER[declineOf(response)!]}</RuledEmpty>;
  } else if (response) {
    body = <RuledEmpty>Nothing was read. The question did not match a lookup.</RuledEmpty>;
  } else if (state.kind === "failed") {
    body = <RuledEmpty>Nothing was read. The question did not get through.</RuledEmpty>;
  } else {
    body = null;
  }

  return (
    <aside
      data-ledger
      aria-labelledby="ask-ledger-title"
      aria-busy={state.kind === "loading" || undefined}
      className={cn(
        "flex min-w-0 flex-col self-start overflow-hidden rounded-lg border border-rule-weak bg-rail @3xl:sticky @3xl:top-[calc(var(--topbar-h)+1rem)] print:static! print:overflow-visible",
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-3 border-b border-rule-weak px-4 last:border-b-0">
        <h2 id="ask-ledger-title" className="micro text-ink-low">
          Sources
        </h2>
        <span className="mono ml-auto text-[11px] text-ink-low">{summary(state)}</span>
      </div>
      {/* No name of its own: whenever it can scroll it holds focusable rows, or a fact table that is itself focusable. */}
      {body ? (
        <ScrollArea
          axis="y"
          fade="var(--paper-100)"
          className="@3xl:max-h-[calc(100dvh-var(--topbar-h)-6.75rem)] print:max-h-none!"
        >
          <div className="flex flex-col gap-8 p-4">{body}</div>
        </ScrollArea>
      ) : null}
    </aside>
  );
}
