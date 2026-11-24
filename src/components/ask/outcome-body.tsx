"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { AskResponse } from "@/lib/api/schemas";

import { AnswerProse } from "./answer-prose";
import { declineOf, missingEvidenceText } from "./describe";
import { PlanSteps } from "./plan-steps";
import { nextQuestions, SuggestionChips } from "./suggestions";

/** Where the Overview's "All people" lands: Findings with the Person filter open on everyone's counts. */
const PERSON_FILTER = "/findings?state=open&menu=person";

interface BodyProps {
  response: AskResponse;
  onAsk: (question: string) => void;
  busy: boolean;
}

/** A small titled part of an outcome: "Looked at", "Try instead". */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="micro text-ink-low">{title}</h3>
      {children}
    </div>
  );
}

/** The service's own words, set as the answer is: it is the answer. */
function Said({ children }: { children: ReactNode }) {
  return <p className="max-w-[66ch] text-md leading-[1.7] text-ink">{children}</p>;
}

function NotUnderstood({ response, onAsk, busy }: BodyProps) {
  const project = response.meta.projects[0] ?? "DEMO";
  const suggestions = nextQuestions(response.question, response.suggestions, 4);
  const decline = declineOf(response);
  if (decline === "team_level") {
    return (
      <div className="flex flex-col gap-6">
        <Callout
          label="Why there is no answer"
          title="Answers stay at team level"
          action={
            <Button asChild variant="secondary" size="sm" className="-ml-px">
              <Link href={PERSON_FILTER}>
                Open the Person filter <ArrowRight aria-hidden strokeWidth={1.75} />
              </Link>
            </Button>
          }
        >
          {response.message}
        </Callout>
        <Part title="Ask about the work instead">
          <SuggestionChips questions={suggestions} onAsk={onAsk} disabled={busy} />
        </Part>
      </div>
    );
  }
  if (decline === "judgement") {
    return (
      <div className="flex flex-col gap-6">
        <Callout label="Why there is no answer" title="Ask does not judge people">
          {response.message}
        </Callout>
        <Part title="Ask for the facts instead">
          <SuggestionChips questions={suggestions} onAsk={onAsk} disabled={busy} />
        </Part>
      </div>
    );
  }
  if (decline === "comparison_off") {
    // An organisation's choice (PEOPLE_COMPARISON=off): one person's figures are still there for the asking.
    return (
      <div className="flex flex-col gap-6">
        <Said>{response.message}</Said>
        <p className="-mt-3 max-w-[62ch] text-sm text-ink-mid">
          Type @ and pick one person to see their scorecard.
        </p>
        <Part title="Try one of these">
          <SuggestionChips questions={suggestions} onAsk={onAsk} disabled={busy} />
        </Part>
      </div>
    );
  }
  if (decline === "unknown_mention") {
    return (
      <div className="flex flex-col gap-6">
        <Said>{response.message}</Said>
        <p className="-mt-3 max-w-[62ch] text-sm text-ink-mid">
          Type @ to pick someone on this board.
        </p>
        <Part title="Try one of these">
          <SuggestionChips questions={suggestions} onAsk={onAsk} disabled={busy} />
        </Part>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Said>{response.message ?? "That question can't be answered from the Jira data."}</Said>
      <Part title="What can be asked">
        <ul className="grid max-w-[66ch] gap-x-6 gap-y-1.5 text-sm text-ink-mid @xl:grid-cols-2">
          {[
            "Where work waits, and for how long",
            "Which epics have the most open breaches",
            "Effort against estimate, by epic and by week",
            "How much work has an estimate or logged time",
            "Which rules Jira can't measure today",
            `One issue's story, by its key (${project}-142)`,
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-ink-dim">
                –
              </span>
              {item}
            </li>
          ))}
        </ul>
      </Part>
      <Part title="Try one of these">
        <SuggestionChips questions={suggestions} onAsk={onAsk} disabled={busy} />
      </Part>
    </div>
  );
}

/** No citations: a sentence built in code quotes no figure. */
const NOTHING_CITED = () => "";

function NoTickets({ response, onAsk, busy }: BodyProps) {
  const sentence = response.answer?.trim() ?? "";
  const everyone = new Set(response.people.map((person) => person.id));
  return (
    <div className="flex flex-col gap-6">
      <AnswerProse segments={[{ kind: "text", text: sentence }]} describe={NOTHING_CITED} people={response.people} unlinked={everyone} />
      <p className="-mt-3 max-w-[62ch] text-sm text-ink-mid">
        Tickets count for whoever holds them now. Type @ to pick someone else.
      </p>
      <Part title="Try one of these">
        <SuggestionChips questions={nextQuestions(response.question, response.suggestions)} onAsk={onAsk} disabled={busy} />
      </Part>
    </div>
  );
}

function NoData({ response, onAsk, busy }: BodyProps) {
  if (response.answer?.trim()) return <NoTickets response={response} onAsk={onAsk} busy={busy} />;
  return (
    <div className="flex flex-col gap-6">
      <Said>{response.message ?? "Nothing matched this question."}</Said>
      {response.plan.length > 0 ? (
        <Part title="Looked at">
          <PlanSteps plan={response.plan} />
        </Part>
      ) : null}
      <Part title="Widen the question">
        <p className="-mt-1 max-w-[62ch] text-sm text-ink-mid">
          Nothing matched. Try a longer period.
        </p>
        <SuggestionChips questions={nextQuestions(response.question, response.suggestions)} onAsk={onAsk} disabled={busy} />
      </Part>
    </div>
  );
}

function NotMeasurable({ response, onAsk, busy }: BodyProps) {
  const missing = missingEvidenceText(response.missing_evidence);
  return (
    <div className="flex flex-col gap-6">
      <Callout
        tone="not-measurable"
        title={missing ? `Jira holds no evidence of ${missing}` : "Jira holds no evidence for this"}
        action={
          <Button asChild variant="secondary" size="sm" className="-ml-px">
            <Link href="/process">
              See the process against Jira <ArrowRight aria-hidden strokeWidth={1.75} />
            </Link>
          </Button>
        }
      >
        <span className="flex flex-col gap-2">
          <span>{response.message}</span>
          <span className="font-medium text-ink">That gap is itself a finding.</span>
        </span>
      </Callout>
      {response.plan.length > 0 ? (
        <Part title="What would have been looked up">
          <PlanSteps plan={response.plan} />
        </Part>
      ) : null}
      <Part title="Ask what Jira can show">
        <SuggestionChips questions={nextQuestions(response.question, response.suggestions)} onAsk={onAsk} disabled={busy} />
      </Part>
    </div>
  );
}

function NotVerified({ response, onAsk, busy }: BodyProps) {
  return (
    <div className="flex flex-col gap-6">
      <Callout label="Facts only" title="Only the facts are shown">
        {response.message ?? "The written answer did not match the facts, so only the facts are shown."}
      </Callout>
      <Part title="Ask next">
        <SuggestionChips questions={nextQuestions(response.question, response.suggestions)} onAsk={onAsk} disabled={busy} />
      </Part>
    </div>
  );
}

/** Every outcome but an answer, each in its own calm state. None of them is an error. */
export function OutcomeBody(props: BodyProps) {
  switch (props.response.outcome) {
    case "not_understood":
      return <NotUnderstood {...props} />;
    case "no_data":
      return <NoData {...props} />;
    case "not_measurable":
      return <NotMeasurable {...props} />;
    case "not_verified":
      return <NotVerified {...props} />;
    default:
      return null;
  }
}
