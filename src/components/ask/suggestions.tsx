"use client";

import { ArrowRight, CornerDownRight } from "lucide-react";

import type { AskLevel } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { sameQuestion } from "./describe";

/**
 * Questions the catalogue can answer, by the part of the work they look at.
 * They are the first thing on an empty page and the way back from an answer
 * that could not be given.
 */
export const STARTERS = [
  { topic: "Where work waits", question: "Where do tickets get stuck most?" },
  { topic: "Hot spots", question: "Which epics have the most open breaches?" },
  { topic: "Estimates", question: "How is effort against estimate trending?" },
  { topic: "Process gaps", question: "Which rules can't be measured in Jira today?" },
  { topic: "Flow", question: "Which tickets went straight from To Do to Done this month?" },
  { topic: "Rework", question: "Which tickets have been reopened after Done?" },
] as const;

/** For a reader Ask answers about people, the last two starters are about people instead (the service suggests them too). */
const PEOPLE_STARTERS = [
  { topic: "Process", question: "Who follows the process most closely?" },
  { topic: "People", question: "Who has the most open breaches?" },
] as const;

function startersFor(level: AskLevel): readonly { topic: string; question: string }[] {
  return level === "people" ? [...STARTERS.slice(0, -2), ...PEOPLE_STARTERS] : STARTERS;
}

/**
 * What to offer next: the service's own suggestions first, then starters,
 * never the question just asked and never the same question twice.
 */
export function nextQuestions(asked: string, offered: readonly string[] = [], count = 3, level: AskLevel = "team"): string[] {
  const picked: string[] = [];
  // At people level the questions about people come first, as the service suggests them.
  const starters = level === "people" ? [...PEOPLE_STARTERS, ...STARTERS] : STARTERS;
  for (const question of [...offered, ...starters.map((starter) => starter.question)]) {
    if (picked.length === count) break;
    if (sameQuestion(question, asked) || picked.some((other) => sameQuestion(other, question))) continue;
    picked.push(question);
  }
  return picked;
}

/** A row of questions to ask with one click. */
export function SuggestionChips({
  questions,
  onAsk,
  disabled = false,
  label = "Suggested questions",
  className,
}: {
  questions: readonly string[];
  onAsk: (question: string) => void;
  disabled?: boolean;
  /** The list's name for assistive technology. */
  label?: string;
  className?: string;
}) {
  if (questions.length === 0) return null;
  return (
    <ul aria-label={label} data-print="hide" className={cn("flex flex-wrap gap-2", className)}>
      {questions.map((question) => (
        <li key={question} className="min-w-0 max-w-full">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAsk(question)}
            className="pressable group inline-flex min-h-8 max-w-full items-center gap-2 rounded-md border border-rule bg-sheet px-3 py-1.5 text-left text-sm text-ink-mid hover:border-rule-strong hover:text-ink disabled:pointer-events-none disabled:opacity-45"
          >
            <CornerDownRight
              aria-hidden
              size={13}
              strokeWidth={1.75}
              className="shrink-0 text-ink-dim group-hover:text-ink-low"
            />
            <span className="min-w-0">{question}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The starters as cards, each with the part of the work it looks at. */
export function StarterGrid({
  onAsk,
  disabled = false,
  level = "team",
}: {
  onAsk: (question: string) => void;
  disabled?: boolean;
  level?: AskLevel;
}) {
  return (
    <ul aria-label="Questions to start with" data-print="hide" className="grid gap-2.5 @min-[28rem]:grid-cols-2">
      {startersFor(level).map((starter) => (
        <li key={starter.question} className="min-w-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAsk(starter.question)}
            className="pressable group flex min-h-16 w-full items-center gap-3 rounded-md border border-rule-weak bg-sheet px-4 py-2.5 text-left hover:border-rule hover:bg-hover disabled:pointer-events-none disabled:opacity-45"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="micro text-ink-low">{starter.topic}</span>
              <span className="text-sm text-ink">{starter.question}</span>
            </span>
            <ArrowRight
              aria-hidden
              size={15}
              strokeWidth={1.75}
              className="shrink-0 text-ink-low opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
