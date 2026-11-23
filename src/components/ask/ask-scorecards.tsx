"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { peopleHref, scorecardHref } from "@/components/people/links";
import { figureText, markOf, standingOf, standingText, type Mark } from "@/components/people/model";
import { CompactScorecard, Figure, MarkKey, MarkLabel } from "@/components/people/scorecard";
import { cardDays } from "@/components/person-card/model";
import { NAME_TRIGGER, PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { NameText } from "@/components/ui/person-name";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { FactSet } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useResolvePerson } from "./people-in-facts";
import {
  comparisonFromFacts,
  comparisonOrderWords,
  NOW_COUNTS,
  peoplePageOrder,
  scorecardsFromFacts,
  type FactComparison,
  type FactScorecards,
} from "./scorecard-facts";

/*
 * The figures behind a scorecard or comparison answer (JO-11), drawn under
 * the answer's words: the compact scorecard (one person, or several side by
 * side, beside the whole board) with each person's one-line summary, or
 * everyone in the order the answer gives. The order is the facts'; nobody is
 * numbered, so no rank is read into people who are level, and someone with
 * too few tickets is labelled so, never shown as "0 of 0". The facts
 * themselves stay in the ledger, cited as ever; this reads the same rows.
 */

const RATIO = { kind: "ratio", measurable: true } as const;

/**
 * The heading of an overall comparison's column of marks: its word, or in a narrow column (a phone) the mark's icon,
 * which the key under the comparisons names, so the five columns fit inside the frame rather than scroll (as a rate's
 * marks do).
 */
function MarkHeading({ mark, word }: { mark: Mark; word: string }) {
  return (
    <>
      <span className="@max-[29rem]:hidden">{word}</span>
      <MarkLabel mark={mark} compact className="align-middle @min-[29rem]:hidden" />
    </>
  );
}

function Compared({ comparison }: { comparison: FactComparison }) {
  const locale = useFigureLocale();
  const { measure, days } = comparison;
  const counted = measure?.kind === "count";
  // A count of now (open tickets, in progress) has no period to state.
  const period = measure && NOW_COUNTS.includes(measure.key) ? "" : `, last ${days} days`;
  const order = comparisonOrderWords(comparison);
  // Who the table sets beside the board: everyone, or the people the question mentions, by name ("A, B and C").
  const names = comparison.people.map((row) => row.person.name);
  const who = comparison.only ? (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("")) : "everyone";
  const caption = measure
    ? `${measure.label}${period}: ${who}, ${order}`
    : `Last ${days} days: ${who}, by the measures on which each is closer to the process than the board${comparison.order === "fewest" ? ", fewest first" : ""}`;
  return (
    <ScrollArea axis="x" label={caption} frameClassName="min-w-0 rounded-md border border-rule-weak bg-sheet">
      <table className="jo-compact-scorecard w-full border-separate border-spacing-0" data-compact-comparison>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              Person
            </th>
            {measure ? (
              <>
                {/* In a narrow column (a phone) the headers wrap and each mark is its icon, named by the key below
                    it, so a rate's figures and marks fit inside the frame rather than scroll (as the scorecard's
                    cards do, G6). */}
                <th scope="col" className="text-right @max-[29rem]:whitespace-normal">
                  {measure.label}
                </th>
                {counted ? null : (
                  <th scope="col" className="text-left @max-[29rem]:whitespace-normal">
                    Next to the board
                  </th>
                )}
              </>
            ) : (
              <>
                <th scope="col" className="text-right">
                  <MarkHeading mark="closer" word="Closer" />
                </th>
                <th scope="col" className="text-right">
                  <MarkHeading mark="level" word="Level" />
                </th>
                <th scope="col" className="text-right">
                  <MarkHeading mark="further" word="Further" />
                </th>
                <th scope="col" className="text-right @max-[29rem]:whitespace-normal" title="Open findings per 10 open tickets">
                  Findings per 10
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {comparison.people.map((row) => {
            const mark = measure && !counted ? markOf(measure, row.value) : null;
            const ratio = figureText(RATIO, row.value, locale);
            const fewForRatio = row.value.value !== null && !row.value.enough;
            return (
              <tr key={row.person.id} data-person={row.person.id}>
                <th scope="row" className="text-left font-normal">
                  {/* The name opens the person's card over the comparison's period (JO-13), as on the People page. In
                      a narrow column a long name is cut short to leave the figures room; the card says it whole. */}
                  <PersonCardTrigger person={row.person} days={cardDays(days)} className={cn(NAME_TRIGGER, "max-w-[14rem] @max-[29rem]:max-w-[7.5rem]")}>
                    <span className="inline-flex max-w-[14rem] min-w-0 items-center gap-2 @max-[29rem]:max-w-[7.5rem]">
                      <PersonAvatar person={row.person} />
                      <NameText name={row.person.name} className="truncate text-ink" />
                    </span>
                  </PersonCardTrigger>
                </th>
                {measure ? (
                  <>
                    <td className="text-right">
                      <Figure measure={measure} value={row.value} strong inline />
                    </td>
                    {counted ? null : (
                      <td className="whitespace-normal" data-mark-cell>
                        {mark ? (
                          <>
                            <MarkLabel mark={mark} wrap className="hidden @min-[29rem]:inline-flex" />
                            {/* An icon alone has no baseline of its own: held on the figures' middle, not above it. */}
                            <MarkLabel mark={mark} compact className="align-middle @min-[29rem]:hidden" />
                          </>
                        ) : null}
                      </td>
                    )}
                  </>
                ) : (
                  <>
                    {row.compared === 0 ? (
                      // Compared with the board on no measure: said so, never counted as nought of nought.
                      <td colSpan={3} className="whitespace-normal">
                        <MarkLabel mark="too_few" wrap />
                      </td>
                    ) : (
                      <>
                        <td className="mono text-right text-ink" data-figure>
                          {row.closer === null ? "—" : `${formatCount(row.closer, { locale })} of ${formatCount(row.compared ?? 0, { locale })}`}
                        </td>
                        <td className="mono text-right text-ink-mid" data-figure>
                          {row.level === null ? "—" : formatCount(row.level, { locale })}
                        </td>
                        <td className="mono text-right text-ink-mid" data-figure>
                          {row.further === null ? "—" : formatCount(row.further, { locale })}
                        </td>
                      </>
                    )}
                    <td className="text-right" title={ratio.detail ?? undefined}>
                      <span className="inline-flex items-center justify-end gap-2">
                        {/* A ratio on too few open tickets is shown, never compared: it carries the mark. */}
                        {fewForRatio ? <MarkLabel mark="too_few" compact /> : null}
                        <span className="mono text-sm text-ink-mid" data-figure>
                          <span aria-hidden>{ratio.value}</span>
                          <span className="sr-only">{ratio.spoken}</span>
                        </span>
                      </span>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          {comparison.unassigned && measure ? (
            // The work nobody holds, after the people and never ranked among them (JO-12, G5): the rows add up to
            // the board's below.
            <tr data-unassigned>
              <th scope="row" className="text-left font-normal text-ink-low">
                <span className="pl-7">Unassigned</span>
              </th>
              <td className="text-right text-ink-mid">
                <Figure measure={measure} value={comparison.unassigned} inline />
              </td>
            </tr>
          ) : null}
          {comparison.board ? (
            <tr data-board>
              <th scope="row" className="text-left font-normal text-ink-mid">
                <span className="pl-7">Whole board</span>
              </th>
              {measure ? (
                <>
                  <td className="text-right">
                    <Figure measure={measure} value={comparison.board} inline />
                  </td>
                  {counted ? null : <td />}
                </>
              ) : (
                <>
                  <td />
                  <td />
                  <td />
                  <td className="text-right">
                    <Figure measure={RATIO} value={comparison.board} inline />
                  </td>
                </>
              )}
            </tr>
          ) : null}
        </tbody>
      </table>
    </ScrollArea>
  );
}

/** Whether a drawn comparison carries any mark (so the key is worth showing): counts carry none. */
function comparisonMarks(comparison: FactComparison): boolean {
  if (comparison.measure) return comparison.measure.kind !== "count";
  return comparison.people.some((row) => row.compared === 0 || (row.value.value !== null && !row.value.enough));
}

/** Each person's one-line summary, as the People page writes it: where their figures stand next to the board's. */
function Summaries({ cards }: { cards: FactScorecards }) {
  const one = cards.people.length === 1;
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink-mid" data-scorecard-summaries>
      {cards.people.map((row) => (
        <li key={row.person.id}>
          {one ? null : <span className="text-ink">{row.person.name}: </span>}
          {standingText(standingOf(cards.measures, row.values))}
        </li>
      ))}
    </ul>
  );
}

/** Every scorecard or comparison among an answer's facts, drawn compact; nothing for any other answer. */
export function AskScorecards({ facts, className }: { facts: readonly FactSet[]; className?: string }) {
  const resolve = useResolvePerson();
  type Drawn = { ref: string; kind: "scorecard"; cards: FactScorecards } | { ref: string; kind: "comparison"; comparison: FactComparison };
  const drawn = facts.flatMap((fact): Drawn[] => {
    const cards = scorecardsFromFacts(fact, resolve);
    if (cards) return [{ ref: fact.ref, kind: "scorecard", cards }];
    const comparison = comparisonFromFacts(fact, resolve);
    return comparison ? [{ ref: fact.ref, kind: "comparison", comparison }] : [];
  });
  if (drawn.length === 0) return null;
  const marked = drawn.some((item) =>
    item.kind === "comparison"
      ? comparisonMarks(item.comparison)
      : item.cards.people.some((row) => item.cards.measures.some((measure) => row.values[measure.key] && markOf(measure, row.values[measure.key]!))),
  );
  // An overall comparison heads its columns with the marks' icons in a narrow column: the key names them there.
  const overall = drawn.some((item) => item.kind === "comparison" && !item.comparison.measure);
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} data-ask-scorecards>
      {drawn.map((item) =>
        item.kind === "scorecard" ? (
          <figure key={item.ref} className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-ink-low">
                <span>
                  {item.cards.people.length === 1 ? "Scorecard" : "Scorecards"}, last {item.cards.days} days ({item.ref})
                </span>
                {item.cards.people.length === 1 ? (
                  <Link
                    href={scorecardHref(item.cards.people[0].person.id, { days: item.cards.days })}
                    className="inline-flex items-center gap-1 text-cite hover:text-cite-hot hover:underline"
                    data-print="hide"
                  >
                    Open on the People page <ArrowRight aria-hidden size={12} strokeWidth={1.75} />
                  </Link>
                ) : null}
              </span>
              <Summaries cards={item.cards} />
            </figcaption>
            <CompactScorecard
              people={item.cards.people}
              board={item.cards.board}
              measures={item.cards.measures}
              caption={`${item.cards.people.map((row) => row.person.name).join(", ")}, last ${item.cards.days} days, next to the whole board`}
              days={item.cards.days}
            />
          </figure>
        ) : (
          <figure key={item.ref} className="flex min-w-0 flex-col gap-2">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-ink-low">
              <span>
                {item.comparison.only ? "Side by side" : "Everyone in order"}
                {item.comparison.measure && NOW_COUNTS.includes(item.comparison.measure.key) ? "" : `, last ${item.comparison.days} days`} ({item.ref})
              </span>
              <Link
                href={peopleHref({ days: item.comparison.days, sort: item.comparison.measure?.key, order: peoplePageOrder(item.comparison) })}
                className="inline-flex items-center gap-1 text-cite hover:text-cite-hot hover:underline"
                data-print="hide"
              >
                Open on the People page <ArrowRight aria-hidden size={12} strokeWidth={1.75} />
              </Link>
            </figcaption>
            <Compared comparison={item.comparison} />
          </figure>
        ),
      )}
      {marked ? <MarkKey className="text-xs" /> : overall ? <MarkKey className="text-xs @min-[29rem]:hidden" /> : null}
    </div>
  );
}
