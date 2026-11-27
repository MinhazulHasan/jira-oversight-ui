"use client";

import { ArrowRight, Circle, CircleDot, Equal, Minus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { cardDays } from "@/components/person-card/model";
import { NAME_TRIGGER, PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { NameText } from "@/components/ui/person-name";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import {
  recordsCodeReview,
  SCORECARD_MEASURES,
  scorecardCaveat,
  type Person,
  type ScorecardMeasure,
  type ScorecardValue,
  type ScorecardValues,
} from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useCredit } from "./credit/context";
import { creditReading } from "./credit/model";
import { cellName, hasTicketsBehind } from "./proof/model";
import { ProofButton, useProof } from "./proof/proof-provider";
import {
  figureText,
  MARK_LABEL,
  markOf,
  measureDefinition,
  measureLink,
  standingOf,
  standingText,
  type Mark,
} from "./model";

const MARK_ICON: Record<Mark, LucideIcon> = {
  closer: CircleDot,
  further: Circle,
  level: Equal,
  too_few: Minus,
};

/** A mark beside a figure: its shape and its words (or, compact, its shape with the words for assistive technology). */
export function MarkLabel({
  mark,
  compact = false,
  wrap = false,
  className,
}: {
  mark: Mark;
  compact?: boolean;
  /** Let the words wrap rather than cut short (a narrow column). */
  wrap?: boolean;
  className?: string;
}) {
  const Icon = MARK_ICON[mark];
  const label = MARK_LABEL[mark];
  if (compact) {
    return (
      <Tooltip content={label}>
        <span data-mark={mark} className={cn("inline-flex shrink-0 items-center text-ink-low", className)} tabIndex={-1}>
          <Icon aria-hidden size={13} strokeWidth={1.75} />
          <span className="sr-only">{label}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <span
      data-mark={mark}
      className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs", mark === "too_few" ? "text-ink-low" : "text-ink-mid", className)}
    >
      <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      <span className={wrap ? "whitespace-normal" : "truncate"}>{label}</span>
    </span>
  );
}

/** A figure as two lines: the value in Plex Mono, the counts behind it under it. */
export function Figure({
  measure,
  value,
  strong = false,
  inline = false,
  wrap = false,
  lines = false,
}: {
  measure: Pick<ScorecardMeasure, "kind" | "measurable">;
  value: ScorecardValue;
  strong?: boolean;
  /** The counts beside the value rather than under it (compact rows). */
  inline?: boolean;
  /** Let the counts wrap where the column is narrow (the scorecard on a phone), rather than cut short. */
  wrap?: boolean;
  /** Let the counts wrap inside their cell, always, never cut short (a column narrower than the words). */
  lines?: boolean;
}) {
  const locale = useFigureLocale();
  const text = figureText(measure, value, locale);
  return (
    <span className={cn("flex min-w-0", inline ? "items-baseline justify-end gap-1.5" : "flex-col items-end")} data-figure>
      <span className={cn("mono text-sm", strong ? "font-medium text-ink" : "text-ink-mid", value.value === null && "text-ink-low")}>
        <span aria-hidden={value.value === null || undefined} data-figure-value>
          {text.value}
        </span>
        {value.value === null ? <span className="sr-only">none to show</span> : null}
      </span>
      {/* A space between the two lines, so a button holding both reads "8.7 59 findings", not "8.759 findings". */}
      {text.detail ? " " : null}
      {text.detail ? (
        <span
          className={cn(
            "mono max-w-full text-right text-[11px] leading-4 text-ink-low",
            lines ? "whitespace-normal" : wrap ? "@min-[40rem]:truncate" : "truncate",
          )}
          title={text.detail}
        >
          {text.detail}
        </span>
      ) : null}
    </span>
  );
}

/** The hatch mark and its words: the board keeps no record of this, which is a fact in itself. */
function NotMeasurable({ reason }: { reason: string | null }) {
  return (
    <span className="flex min-w-0 items-start gap-2 text-xs text-ink-low">
      <span aria-hidden className="hatch mt-[3px] size-2.5 shrink-0 rounded-[2px] border border-hatch-edge" />
      <span className="min-w-0">
        <span className="text-ink-mid">Not measurable.</span> {reason}
      </span>
    </span>
  );
}

function MeasureName({ measure, muted = false }: { measure: ScorecardMeasure; muted?: boolean }) {
  const definition = measureDefinition(measure, useCredit());
  return (
    <Popover>
      <Tooltip content={<span className="block max-w-[18rem] whitespace-normal">{definition}</span>} side="top" align="start">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${measure.label}: what it counts`}
            className={cn(
              "cursor-help rounded-[3px] text-left text-sm underline decoration-rule-strong decoration-dotted underline-offset-[3px] outline-none focus-visible:shadow-[0_0_0_2px_var(--focus)]",
              muted ? "text-ink-low" : "text-ink",
            )}
          >
            {measure.label}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" className="max-w-[20rem] p-3 text-xs leading-relaxed text-ink-mid" aria-label={`${measure.label}: what it counts`}>
        {definition}
      </PopoverContent>
    </Popover>
  );
}

/** Measurable first in the contract's order, then the ones the board cannot show. */
function ordered(measures: readonly ScorecardMeasure[]): ScorecardMeasure[] {
  return [...measures.filter((measure) => measure.measurable), ...measures.filter((measure) => !measure.measurable)];
}

export interface ScorecardProps {
  person: Person;
  /** Their tickets on the board now, every type. */
  tickets: number;
  values: ScorecardValues;
  board: { tickets: number; values: ScorecardValues };
  measures: readonly ScorecardMeasure[];
  days: number;
  /** The heading's level on the page. */
  headingLevel?: 2 | 3;
  className?: string;
}

export function Scorecard({ person, tickets, values, board, measures, days, headingLevel = 2, className }: ScorecardProps) {
  const headingId = useId();
  const locale = useFigureLocale();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const standing = standingOf(measures, values);
  const codeReview = recordsCodeReview(measures);
  const credit = useCredit();
  const proof = useProof();
  const empty = tickets === 0;
  /** A figure that opens the tickets behind it where the page offers that, and where it has any. */
  const proven = (measure: ScorecardMeasure, value: ScorecardValue, whose: Person | null, figure: ReactNode) =>
    proof && hasTicketsBehind(measure, value) ? (
      <ProofButton
        target={{ measure: measure.key, person: whose?.id ?? null }}
        label={cellName(whose?.name ?? "Whole board", measure.key, figureText(measure, value, locale).spoken)}
      >
        {figure}
      </ProofButton>
    ) : (
      figure
    );

  return (
    <section aria-labelledby={headingId} data-scorecard={person.id} className={cn("@container flex min-w-0 flex-col gap-4", className)}>
      <header className="flex min-w-0 flex-col gap-1.5">
        {/* Wide, the count sits at the right of the name; narrow, under it, so the name keeps the whole width. */}
        <div className="flex min-w-0 flex-col gap-1 @min-[40rem]:flex-row @min-[40rem]:items-center @min-[40rem]:gap-2.5" data-scorecard-head>
          {/* The picture and the name open the person's card, as their name does everywhere at people level. */}
          <Heading id={headingId} className="flex min-w-0 items-center text-lg font-semibold tracking-[-0.01em] text-ink">
            <PersonCardTrigger person={person} days={cardDays(days)} className={cn(NAME_TRIGGER, "gap-2.5")}>
              <PersonAvatar person={person} size={24} />
              <NameText name={person.name} className="min-w-0 truncate" />
            </PersonCardTrigger>
          </Heading>
          <span className="shrink-0 text-xs text-ink-low @min-[40rem]:ml-auto">
            {proof && tickets > 0 ? (
              <ProofButton target={{ measure: "tickets", person: person.id }} label={cellName(person.name, "tickets", formatCount(tickets, { locale }))} className="text-left">
                <span className="mono text-ink-mid" data-figure data-figure-value>
                  {formatCount(tickets, { locale })}
                </span>
              </ProofButton>
            ) : (
              <span className="mono text-ink-mid" data-figure>
                {formatCount(tickets, { locale })}
              </span>
            )}{" "}
            {tickets === 1 ? "ticket" : "tickets"}
          </span>
        </div>
        <p className="text-sm text-ink-mid">
          {empty ? `${person.name} has no tickets on this board.` : standingText(standing)}
        </p>
      </header>

      <table className="jo-scorecard w-full border-separate border-spacing-0" aria-labelledby={headingId}>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              Measure
            </th>
            <th scope="col" className="w-[5.75rem] text-right @min-[40rem]:w-[9rem]">
              <span className="block truncate" title={person.name}>
                {person.name}
              </span>
            </th>
            <th scope="col" className="w-[5.75rem] text-right @min-[40rem]:w-[9rem]">
              Whole board
            </th>
            <th scope="col" className="hidden w-[12.5rem] text-left @min-[40rem]:table-cell">
              Next to the board
            </th>
            <th scope="col" className="hidden w-[8.5rem] @min-[40rem]:table-cell">
              <span className="sr-only">Tickets behind it</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered(measures).map((measure) => {
            const value = values[measure.key];
            const mark = markOf(measure, value);
            const link = empty ? null : measureLink(measure, person, days);
            if (!measure.measurable) {
              return (
                <tr key={measure.key} data-measure={measure.key} data-measurable="false">
                  <th scope="row" className="text-left font-normal">
                    <MeasureName measure={measure} muted />
                  </th>
                  <td colSpan={4} className="whitespace-normal">
                    <NotMeasurable reason={measure.reason} />
                  </td>
                </tr>
              );
            }
            return (
              <tr key={measure.key} data-measure={measure.key}>
                <th scope="row" className="text-left font-normal">
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <MeasureName measure={measure} />
                    {/* Narrow: the mark and the link under the name, where the figures leave room for them. */}
                    {mark || link ? (
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 @min-[40rem]:hidden">
                        {mark ? <MarkLabel mark={mark} wrap /> : null}
                        {link ? <MeasureLinkView link={link} /> : null}
                      </span>
                    ) : null}
                  </span>
                </th>
                <td className="text-right">
                  {proven(measure, value, person, <Figure measure={measure} value={value} strong wrap />)}
                </td>
                <td className="text-right">
                  {proven(measure, board.values[measure.key], null, <Figure measure={measure} value={board.values[measure.key]} wrap />)}
                </td>
                <td className="hidden @min-[40rem]:table-cell">{mark ? <MarkLabel mark={mark} /> : null}</td>
                <td className="hidden text-right @min-[40rem]:table-cell">{link ? <MeasureLinkView link={link} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="border-t border-rule-weak pt-3">
        <p className="max-w-[76ch] text-xs leading-relaxed text-ink-low">{scorecardCaveat(days, codeReview, credit && creditReading(credit))}</p>
      </div>
    </section>
  );
}

function MeasureLinkView({ link }: { link: NonNullable<ReturnType<typeof measureLink>> }) {
  const words = link.label.split(" ");
  const last = words.pop();
  return (
    <Link
      href={link.href}
      className="group inline-block max-w-full rounded-[3px] text-xs text-cite hover:text-cite-hot hover:underline focus-visible:shadow-[0_0_0_2px_var(--focus)] focus-visible:outline-none"
    >
      {words.length > 0 ? `${words.join(" ")} ` : null}
      <span className="whitespace-nowrap">
        {last}
        <span className="sr-only">: {link.description}</span>
        <ArrowRight aria-hidden size={12} strokeWidth={1.75} className="ml-1 inline-block align-[-2px] transition-transform group-hover:translate-x-px" />
      </span>
    </Link>
  );
}

const NARROW_ROW: Record<ScorecardMeasure["kind"], string> = {
  count: "h-[3.45rem]",
  rate: "h-[6.05rem]",
  ratio: "h-[6.05rem]",
};

/** The scorecard while its figures load: the same rows in their final shape, so nothing moves when they arrive. */
export function ScorecardSkeleton({ className, label = "Loading the scorecard" }: { className?: string; label?: string }) {
  return (
    <SkeletonGroup label={label} className={cn("@container flex flex-col gap-4", className)}>
      {/* Each line as tall as the text it stands for (1.45em of its size), laid out as the header is at each width. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 flex-col gap-1 @min-[40rem]:flex-row @min-[40rem]:items-center @min-[40rem]:gap-2.5">
          <div className="flex h-[1.45em] items-center gap-2.5 text-lg">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <span className="flex h-[1.45em] items-center text-xs @min-[40rem]:ml-auto">
            <Skeleton className="h-3 w-16" />
          </span>
        </div>
        <span className="flex h-[1.45em] items-center text-sm">
          <Skeleton className="h-3 w-80 max-w-full" />
        </span>
        {/* Narrow, the summary takes two lines. */}
        <span className="flex h-[1.45em] items-center text-sm @min-[40rem]:hidden">
          <Skeleton className="h-3 w-48 max-w-full" />
        </span>
      </div>
      <div className="jo-scorecard-skeleton flex flex-col">
        <div className="flex h-9 items-center justify-between border-b border-rule-weak">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-2.5 w-24" />
        </div>
        {SCORECARD_MEASURES.map((measure, index) => (
          <div
            key={measure.key}
            className={cn(
              // Narrow, a row holds the name (on two lines) and the mark and the link under it; wide, one line.
              "flex items-center justify-between gap-6 border-b border-rule-weak last:border-b-0 @min-[40rem]:h-[3.25rem]",
              NARROW_ROW[measure.kind],
            )}
          >
            <Skeleton className={cn("h-3", index % 3 === 0 ? "w-44" : index % 3 === 1 ? "w-36" : "w-52")} />
            <span className="flex items-center gap-10">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-14" />
            </span>
          </div>
        ))}
      </div>
      {/* The caveat's place at the foot, so the card is its final height before its figures arrive. */}
      <CaveatSkeleton phoneLines={5} />
    </SkeletonGroup>
  );
}

const CAVEAT_WIDTHS = ["w-[34rem]", "w-[30rem]", "w-72", "w-40", "w-24"] as const;

/** A caveat's lines while it loads: `lines` where there is room, `phoneLines` on a phone. */
export function CaveatSkeleton({ lines = 3, phoneLines = 4 }: { lines?: 2 | 3; phoneLines?: 4 | 5 }) {
  return (
    <div aria-hidden className="border-t border-rule-weak pt-3">
      {CAVEAT_WIDTHS.slice(0, phoneLines).map((width, index) => (
        <span key={width} className={cn("flex h-[1.625em] items-center text-xs", index >= lines && "sm:hidden")}>
          <Skeleton className={cn("h-3 max-w-full", width)} />
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- compact -- */

export interface CompactScorecardPerson {
  person: Person;
  values: Partial<Record<ScorecardMeasure["key"], ScorecardValue>>;
}

export function CompactScorecard({
  people,
  board,
  measures,
  caption,
  days,
  className,
}: {
  people: readonly CompactScorecardPerson[];
  board: Partial<Record<ScorecardMeasure["key"], ScorecardValue>>;
  measures: readonly ScorecardMeasure[];
  caption: ReactNode;
  /** The period, for each stacked card's caption ("Ada Brooks, last 90 days, next to the whole board"). */
  days?: number;
  className?: string;
}) {
  const table = <CompactTable people={people} board={board} measures={measures} caption={caption} className={className} />;
  if (people.length < 2) return table;
  const unmeasured = measures.filter((measure) => !measure.measurable);
  return (
    <div className="@container min-w-0">
      <div className="hidden @min-[29rem]:block">{table}</div>
      <div className="flex flex-col gap-2 @min-[29rem]:hidden" data-compact-cards>
        {people.map((row) => (
          <CompactTable
            key={row.person.id}
            people={[row]}
            board={board}
            measures={measures.filter((measure) => measure.measurable)}
            caption={`${row.person.name}${days ? `, last ${days} days` : ""}, next to the whole board`}
            className={className}
            card
          />
        ))}
        {unmeasured.length > 0 ? (
          <ul className="flex flex-col gap-1.5 pt-0.5" aria-label="Not measurable on this board">
            {unmeasured.map((measure) => (
              <li key={measure.key} className="flex flex-col gap-0.5" data-measure={measure.key} data-measurable="false">
                <span className="text-xs text-ink-low">{measure.label}</span>
                <NotMeasurable reason={measure.reason} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** One table of compact scorecards: the side-by-side table, or (`card`) one person's card in the narrow stack. */
function CompactTable({
  people,
  board,
  measures,
  caption,
  className,
  card = false,
}: {
  people: readonly CompactScorecardPerson[];
  board: Partial<Record<ScorecardMeasure["key"], ScorecardValue>>;
  measures: readonly ScorecardMeasure[];
  caption: ReactNode;
  className?: string;
  card?: boolean;
}) {
  const columns = people.length + 1;
  return (
    <ScrollArea
      axis="x"
      label={typeof caption === "string" ? caption : "Scorecards"}
      frameClassName={cn("min-w-0 rounded-md border border-rule-weak bg-sheet", className)}
    >
      <table
        className="jo-compact-scorecard w-full border-separate border-spacing-0"
        data-compact-scorecard={card ? undefined : ""}
        data-compact-card={card ? people[0]?.person.id : undefined}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              Measure
            </th>
            {people.map((row) => (
              <th key={row.person.id} scope="col" className="text-right">
                <span className="inline-flex max-w-[11rem] min-w-0 items-center justify-end gap-1.5">
                  <PersonAvatar person={row.person} />
                  <span className={cn("text-ink", people.length === 1 ? "min-w-0 text-left whitespace-normal" : "truncate")} title={row.person.name}>
                    {row.person.name}
                  </span>
                </span>
              </th>
            ))}
            <th scope="col" className="text-right" data-board-cell>
              Whole board
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered(measures).map((measure) => {
            if (!measure.measurable) {
              return (
                <tr key={measure.key} data-measure={measure.key} data-measurable="false">
                  <th scope="row" className="text-left font-normal text-ink-low">
                    {measure.label}
                  </th>
                  <td colSpan={columns} className="whitespace-normal">
                    {/* Within the width the frame shows at rest, however many people the columns hold. */}
                    <span className="block max-w-[17rem]">
                      <NotMeasurable reason={measure.reason} />
                    </span>
                  </td>
                </tr>
              );
            }
            const boardValue = board[measure.key];
            return (
              <tr key={measure.key} data-measure={measure.key}>
                <th scope="row" className="text-left font-normal text-ink">
                  {measure.label}
                </th>
                {people.map((row) => {
                  const value = row.values[measure.key];
                  const mark = value ? markOf(measure, value) : null;
                  return (
                    <td key={row.person.id} className="text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        {value ? <Figure measure={measure} value={value} strong lines={measure.kind === "ratio"} /> : <span className="text-ink-low">—</span>}
                        {mark ? <MarkLabel mark={mark} compact /> : <span aria-hidden className="inline-block w-[13px]" />}
                      </span>
                    </td>
                  );
                })}
                <td className="text-right" data-board-cell>
                  {boardValue ? <Figure measure={measure} value={boardValue} lines={measure.kind === "ratio"} /> : <span className="text-ink-low">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}

/** The marks' key under a compact scorecard: each shape and its words, once. */
export function MarkKey({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {(Object.keys(MARK_LABEL) as Mark[]).map((mark) => (
        <MarkLabel key={mark} mark={mark} />
      ))}
    </p>
  );
}
