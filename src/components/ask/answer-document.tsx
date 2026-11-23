"use client";

import { Info, RotateCcw } from "lucide-react";
import { useMemo } from "react";

import { usePeopleLevel } from "@/components/shell/people-level";
import { StateDot } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import { segmentAnswer, type AnswerSegment } from "@/lib/api/citations";
import { SCORECARD_SENTENCES, type AskResponse } from "@/lib/api/schemas";

import { AnswerProse, withoutTickets } from "./answer-prose";
import { AskScorecards } from "./ask-scorecards";
import { DECLINE_FOOTER, DECLINE_LABEL, declineOf, OUTCOME_LABEL, toolLabel } from "./describe";
import { OutcomeBody } from "./outcome-body";
import { nextQuestions, SuggestionChips } from "./suggestions";

const PARTS: Record<string, string> = {
  params: "its parameters",
  row_count: "its row count",
  note: "its note",
  as_of: "its as-of time",
};

/** The answer split into prose and bound values, the markers in reading order, and each citation's source in words. */
export function useAnswerTrace(response: AskResponse | null): {
  segments: AnswerSegment[];
  order: number[];
  describe: (marker: number) => string;
} {
  return useMemo(() => {
    const segments =
      response?.outcome === "answered" && response.answer ? segmentAnswer(response.answer.trim(), response.citations) : [];
    const order = segments.flatMap((segment) => (segment.kind === "cite" ? [segment.citation.marker] : []));
    const describe = (marker: number) => {
      const citation = response?.citations.find((candidate) => candidate.marker === marker);
      const fact = response?.facts.find((candidate) => candidate.ref === citation?.fact_ref);
      if (!citation || !fact) return "";
      const where =
        citation.row_index >= 0
          ? `row ${citation.row_index + 1}, ${fact.columns.find((column) => column.key === citation.column)?.label ?? citation.column}`
          : (PARTS[citation.column] ?? citation.column);
      return `From ${fact.ref} ${toolLabel(fact.tool)}, ${where}.`;
    };
    return { segments, order, describe };
  }, [response]);
}

function Eyebrow({ response, cited }: { response: AskResponse; cited: number }) {
  if (response.outcome === "answered") {
    const figures = cited === 0 ? "" : ` · ${cited} ${cited === 1 ? "figure" : "figures"} cited`;
    return <StateDot tone="cite" size="sm" label={`${OUTCOME_LABEL.answered}${figures}`} />;
  }
  if (response.outcome === "not_measurable") {
    return (
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="hatch size-2.5 rounded-[2px] border border-hatch-edge" />
        {OUTCOME_LABEL.not_measurable}
      </span>
    );
  }
  const decline = declineOf(response);
  return <StateDot tone="hollow" size="sm" label={decline ? DECLINE_LABEL[decline] : OUTCOME_LABEL[response.outcome]} />;
}

const Sep = () => (
  <span aria-hidden className="text-ink-dim">
    ·
  </span>
);

/**
 * The answer's outcome and when it was asked, with "Ask again". Nothing a developer reads: no model, time taken or
 * reference (SQA, go-live).
 */
function MetaLine({ response, onAskAgain, busy }: { response: AskResponse; onAskAgain: () => void; busy: boolean }) {
  const decline = declineOf(response);
  const outcome = response.outcome === "answered" ? "Answered" : decline ? DECLINE_FOOTER[decline] : OUTCOME_LABEL[response.outcome];
  return (
    <footer className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-rule-weak pt-3 text-xs text-ink-low">
      <span className="text-ink-mid">{outcome}</span>
      <Sep />
      <span>
        asked <Timestamp value={response.asked_at} mode="time" />
      </span>
      {response.outcome === "not_verified" ? (
        <>
          <Sep />
          <span>Wording withheld: it did not match the facts</span>
        </>
      ) : null}
      <span data-print="hide" className="ml-auto inline-flex items-center">
        <IconButton label="Ask again for a fresh answer" icon={RotateCcw} size="sm" onClick={onAskAgain} disabled={busy} />
      </span>
    </footer>
  );
}

/** The sentences code closes a scorecard or comparison answer with, after its figures: the decision, then the caveat. */
const CLOSING = [`\n\n${SCORECARD_SENTENCES.decision}`, "\n\nFigures from Jira over the last "];

/**
 * The answer's words, and its closing paragraphs apart: the decision sentence
 * ("The figures are above") and the caveat follow the figures they speak of,
 * so the compact figures go between (DESIGN 6.4: words, figures, the caveat
 * last). No figure spans a paragraph break, so only words are ever split.
 */
export function splitClosing(segments: readonly AnswerSegment[]): [AnswerSegment[], AnswerSegment[]] {
  const text = segments.map((segment) => segment.text).join("");
  const starts = CLOSING.map((marker) => text.indexOf(marker)).filter((at) => at > 0);
  if (starts.length === 0) return [[...segments], []];
  const cut = Math.min(...starts);
  const head: AnswerSegment[] = [];
  const tail: AnswerSegment[] = [];
  let at = 0;
  for (const segment of segments) {
    const end = at + segment.text.length;
    if (end <= cut) head.push(segment);
    else if (at >= cut) tail.push(segment);
    else if (segment.kind === "text") {
      head.push({ kind: "text", text: segment.text.slice(0, cut - at) });
      tail.push({ kind: "text", text: segment.text.slice(cut - at) });
    } else head.push(segment);
    at = end;
  }
  const first = tail[0];
  if (first?.kind === "text") tail[0] = { kind: "text", text: first.text.replace(/^\s+/, "") };
  return [head, tail];
}

/**
 * One answer as an annotated document: the question as its title, then the
 * prose with every cited value bound to its row, the figures behind a
 * scorecard or comparison, the decision sentence and the caveat, or the calm
 * state for an outcome that is not an answer, then how it was made.
 */
export function AnswerDocument({
  response,
  segments,
  describe,
  onAsk,
  onAskAgain,
  busy,
}: {
  response: AskResponse;
  segments: readonly AnswerSegment[];
  describe: (marker: number) => string;
  /** Ask a new question (a suggestion). */
  onAsk: (question: string) => void;
  /** Ask this question again for a fresh answer, about the same people; by default, its words alone. */
  onAskAgain?: () => void;
  busy: boolean;
}) {
  const answered = response.outcome === "answered" && Boolean(response.answer?.trim());
  const cited = segments.filter((segment) => segment.kind === "cite").length;
  const [words, closing] = splitClosing(segments);
  const peopleLevel = usePeopleLevel();
  const unlinked = withoutTickets(response.answer, response.people);
  return (
    <article aria-labelledby="ask-question" data-outcome={response.outcome} className="rise flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="micro text-ink-low">
          <Eyebrow response={response} cited={cited} />
        </p>
        <h2 id="ask-question" className="max-w-[40ch] text-xl font-semibold tracking-[-0.012em] text-ink">
          {response.question || "An empty question"}
        </h2>
      </header>

      {answered ? (
        <AnswerProse segments={words} describe={describe} people={response.people} unlinked={unlinked} />
      ) : (
        <OutcomeBody response={response} onAsk={onAsk} busy={busy} />
      )}

      {/* A scorecard or comparison answer: its figures, compact, as the facts hold them (JO-11), before the sentences
          that speak of them. */}
      {answered || response.outcome === "not_verified" ? <AskScorecards facts={response.facts} /> : null}

      {answered && closing.length > 0 ? (
        <div data-answer-closing>
          <AnswerProse segments={closing} describe={describe} people={response.people} unlinked={unlinked} />
        </div>
      ) : null}

      {/* A line the service adds under the answer (JO-12: the day's AI budget is used up, so code built it). */}
      {response.note ? (
        <p data-answer-note className="flex max-w-[66ch] items-start gap-2 text-xs leading-relaxed text-ink-low">
          <Info aria-hidden size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          {response.note}
        </p>
      ) : null}

      <MetaLine response={response} onAskAgain={onAskAgain ?? (() => onAsk(response.question))} busy={busy} />

      {answered ? (
        <div className="flex flex-col gap-3" data-print="hide">
          {cited > 0 ? (
            <p aria-hidden className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-low">
              Point at a figure to see its source.
            </p>
          ) : null}
          <div className="flex flex-col gap-2.5 pt-2">
            <h3 className="micro text-ink-low">Ask next</h3>
            <SuggestionChips questions={nextQuestions(response.question, response.suggestions, 3, peopleLevel ? "people" : "team")} onAsk={onAsk} disabled={busy} />
          </div>
        </div>
      ) : null}
    </article>
  );
}
