"use client";

import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { StateDot } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api/hooks";
import type { AskLevel } from "@/lib/api/schemas";

import { StarterGrid } from "./suggestions";

/** The question as the document's title, whatever state the answer is in. */
function Title({ eyebrow, question }: { eyebrow: ReactNode; question: string }) {
  return (
    <header className="flex flex-col gap-2">
      <p className="micro text-ink-low">{eyebrow}</p>
      <h2 className="max-w-[40ch] text-xl font-semibold tracking-[-0.012em] text-ink">{question}</h2>
    </header>
  );
}

const WIDTHS = ["w-full", "w-[94%]", "w-[97%]", "w-[58%]"];

/**
 * Asking: the answer in its final shape, the question already set as its
 * title, and a thin line sweeping under it while the facts are read and every
 * number is checked. Nothing spins; reduced motion stills the sweep.
 */
export function AnswerSkeleton({ question }: { question: string }) {
  return (
    <SkeletonGroup label="Asking. Reading the facts and checking every number." className="flex min-w-0 flex-col gap-5">
      <Title eyebrow={<StateDot tone="hollow" size="sm" label="Reading the facts" />} question={question} />
      <span aria-hidden className="relative block h-px overflow-hidden bg-rule-weak">
        <span className="absolute inset-y-0 w-[40%] bg-rule-strong [animation:jo-sweep_1400ms_var(--ease-in-out)_infinite]" />
      </span>
      <span aria-hidden className="flex max-w-[66ch] flex-col gap-[15px] py-1">
        {WIDTHS.map((width) => (
          <Skeleton key={width} className={`h-3.5 ${width}`} />
        ))}
      </span>
      <span aria-hidden className="flex items-center gap-3 border-t border-rule-weak pt-3.5">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-14" />
        <Skeleton className="h-2.5 w-10" />
        <Skeleton className="h-2.5 w-40" />
      </span>
    </SkeletonGroup>
  );
}

function errorText(error: ApiError): string {
  if (error.status === 0) return "Could not reach the service. Try again in a moment.";
  if (error.status === 429) return "Too many questions at once. Try again in a moment.";
  if (error.status >= 500) return "The service failed while answering. Try again.";
  return error.message || "The question could not be sent.";
}

/** The question did not get an answer: said inline, with the way to try again. */
export function AnswerError({ question, error, onRetry, retrying }: { question: string; error: ApiError; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Title eyebrow={<StateDot tone="hollow" size="sm" label="Not answered" />} question={question} />
      <div className="rounded-md border border-rule-weak">
        <ErrorState
          title="Couldn't get an answer"
          description={errorText(error)}
          detail={`HTTP ${error.status || "—"} · ${error.code || "ask"}`}
          onRetry={onRetry}
          retrying={retrying}
        />
      </div>
    </div>
  );
}

/** Before the first question: what can be asked, by the part of the work it looks at. */
export function AskStart({ onAsk, busy, level = "team" }: { onAsk: (question: string) => void; busy: boolean; level?: AskLevel }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="micro text-ink-low">Start with</h2>
        <span aria-hidden className="h-px flex-1 bg-rule-weak" />
      </div>
      <StarterGrid onAsk={onAsk} disabled={busy} level={level} />
      <p className="flex max-w-[66ch] items-start gap-2 text-xs leading-relaxed text-ink-low">
        <ArrowRight aria-hidden size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        {level === "people"
          ? "Type @ to ask about someone on this board."
          : "Answers cover the team and the process."}
      </p>
    </div>
  );
}

export function errorSummary(error: ApiError): string {
  return errorText(error);
}
