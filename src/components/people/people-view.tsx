"use client";

import { UserRoundSearch } from "lucide-react";
import { createParser, parseAsNumberLiteral, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Section } from "@/components/ui/section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import { usePeopleDirectory, usePeopleScorecard, type ApiError } from "@/lib/api/hooks";
import {
  PERSON_ID_PATTERN,
  recordsCodeReview,
  SCORECARD_DAYS,
  SCORECARD_DEFAULT_DAYS,
  scorecardCaveat,
  type PeopleScorecard,
  type ScorecardDays,
  type ScorecardPerson,
} from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { Comparison, ComparisonSkeleton } from "./comparison";
import { firstOrder, SORT_KEYS, type SortOrder } from "./model";
import { PersonPicker } from "./person-picker";
import { CaveatSkeleton, MarkKey, Scorecard, ScorecardSkeleton } from "./scorecard";

const ORDERS = ["asc", "desc"] as const;
const TOAST = "people-view";

/** A person id as the contract writes it (any case in a typed address): anything else opens no one. */
const personParser = createParser({
  parse: (value: string) => {
    const id = value.trim().toLowerCase();
    return PERSON_ID_PATTERN.test(id) ? id : null;
  },
  serialize: (value: string) => value,
});

export const peopleUrlParsers = {
  days: parseAsNumberLiteral(SCORECARD_DAYS).withDefault(SCORECARD_DEFAULT_DAYS),
  person: personParser,
  sort: parseAsStringLiteral(SORT_KEYS).withDefault("name"),
  order: parseAsStringLiteral(ORDERS),
};

const PERIODS = SCORECARD_DAYS.map((days) => ({ value: String(days) as `${ScorecardDays}`, label: `${days} days` }));

/** The everyone table's words, the same in the table and in the list a phone shows. */
const EVERYONE_DESCRIPTION =
  "Each person beside the whole board. Choose someone to open their scorecard.";

/** The caveat under the everyone table, as at the foot of every scorecard: what the figures can and cannot show. */
function TableCaveat({ data }: { data: PeopleScorecard }) {
  return (
    <div className="border-t border-rule-weak pt-3">
      <p className="max-w-[76ch] text-xs leading-relaxed text-ink-low">{scorecardCaveat(data.period.days, recordsCodeReview(data.measures))}</p>
    </div>
  );
}

function errorDetail(error: ApiError | null): string | undefined {
  return error ? `${error.status > 0 ? `HTTP ${error.status} · ` : ""}${error.code}` : undefined;
}

/** Brings the scorecard into view when it opens below the fold (a phone, a long table); still with reduced motion. */
function revealScorecard() {
  requestAnimationFrame(() => {
    const target = document.getElementById("scorecard");
    if (!target) return;
    const { top, bottom } = target.getBoundingClientRect();
    if (top >= 0 && bottom <= window.innerHeight) return;
    if (top >= 0 && top < window.innerHeight * 0.6) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  });
}

/** The words above the scorecard where an organisation has turned comparing people off. */
const OFF_NOTE = "Comparing people is off. One person at a time.";
/** The prompt with no one chosen, comparison off: the Person control above. */
const OFF_PROMPT = "Choose someone above to see their scorecard.";

export function PeopleView({ expected = "on" }: { expected?: PeopleScorecard["comparison"] }) {
  const locale = useFigureLocale();
  const [url, setUrl] = useQueryStates(peopleUrlParsers, { history: "push", scroll: false });
  const { days, person, sort } = url;
  const order: SortOrder = url.order ?? firstOrder(sort);

  const everyone = usePeopleScorecard({ days });
  const data = everyone.data;
  const comparison = data?.comparison ?? null;
  const shape = comparison ?? expected;
  const fromEveryone = comparison === "on" && person ? (data?.people.find((row) => row.person.id === person) ?? null) : null;
  const needsOne = person !== null && data !== undefined && fromEveryone === null;
  const one = usePeopleScorecard({ days, person: person ? [person] : [] }, { enabled: needsOne });
  const directory = usePeopleDirectory({ enabled: shape === "off" });

  const select = useCallback(
    (row: ScorecardPerson) => {
      void setUrl({ person: row.person.id });
      revealScorecard();
      // Every choice is acknowledged (DESIGN 7), as the picker's is: a screen reader hears whose scorecard opened.
      notify.info("Person chosen", { description: `${row.person.name}'s scorecard is open below.`, id: TOAST });
    },
    [setUrl],
  );

  const landed = useRef(false);
  const scorecardReady = person !== null && data !== undefined && (fromEveryone !== null || (needsOne && one.data !== undefined));
  useEffect(() => {
    if (!scorecardReady || landed.current) return;
    landed.current = true;
    if (comparison === "on") revealScorecard();
  }, [scorecardReady, comparison]);

  const setDays = (next: ScorecardDays) => {
    void setUrl({ days: next === SCORECARD_DEFAULT_DAYS ? null : next });
    notify.info("Period changed", { description: `The last ${next} days, next to the whole board.`, id: TOAST });
  };

  const stalePeriod = everyone.isPlaceholderData;
  // The scorecard's figures are another period's while its own load: marked as the table's are.
  const staleScorecard = needsOne ? one.isPlaceholderData : stalePeriod;
  const scorecardSource: { data: PeopleScorecard; row: ScorecardPerson } | null =
    fromEveryone && data
      ? { data, row: fromEveryone }
      : needsOne && one.data && one.data.people[0]?.person.id === person
        ? { data: one.data, row: one.data.people[0] }
        : null;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3" data-print="hide">
        <SegmentedControl
          label="Period"
          options={PERIODS}
          value={String(days) as `${ScorecardDays}`}
          onValueChange={(value) => setDays(Number(value) as ScorecardDays)}
        />
        {shape === "off" ? (
          <PersonPicker
            entries={directory.data?.people}
            state={directory.isError && !directory.isFetching ? "error" : directory.data ? "success" : "pending"}
            onRetry={() => void directory.refetch()}
            value={person}
            onValueChange={(chosen) => {
              void setUrl({ person: chosen.id });
              notify.info("Person chosen", { description: `${chosen.name}'s scorecard, next to the whole board.`, id: TOAST });
            }}
          />
        ) : null}
        <p className="text-xs text-ink-low sm:ml-auto">
          {data ? (
            <>
              Last {data.period.days} days, <Timestamp value={data.period.from} mode="date" /> to{" "}
              <Timestamp value={data.period.to} mode="date" />
            </>
          ) : everyone.isError ? (
            // Settled on an error: the period asked for, in words, never a loading bar that never resolves.
            <>Last {days} days</>
          ) : (
            // Inline, so the line keeps the height of the dates it stands for (on a phone it has a row of its own).
            <Skeleton className="inline-block h-3 w-48 align-middle" />
          )}
        </p>
      </div>

      {!data && everyone.isError ? (
        <ErrorState
          title="Couldn't load the scorecards"
          description="Try again."
          detail={errorDetail(everyone.error)}
          onRetry={() => void everyone.refetch()}
          retrying={everyone.isFetching}
        />
      ) : !data && shape === "off" ? (
        // One person at a time, as it will stand: the note, then the scorecard's region in its final place.
        <>
          <p className="max-w-[76ch] text-sm text-ink-mid">{OFF_NOTE}</p>
          <ScorecardRegion person={person} source={null} loading error={null} onRetry={() => undefined} retrying={false} prompt={OFF_PROMPT} />
        </>
      ) : !data ? (
        <>
          <Section id="everyone" title="Everyone with tickets" description={EVERYONE_DESCRIPTION}>
            <MarkKey className="text-xs" />
            <ComparisonSkeleton />
            <CaveatSkeleton />
          </Section>
          <ScorecardRegion person={person} source={null} loading error={null} onRetry={() => undefined} retrying={false} prompt={ON_PROMPT} />
        </>
      ) : comparison === "on" ? (
        <>
          <Section id="everyone" title="Everyone with tickets" count={formatCount(data.people.length, { locale })} description={EVERYONE_DESCRIPTION}>
            {data.people.length === 0 ? (
              <EmptyState
                icon={UserRoundSearch}
                title="No one holds a ticket on this board"
                description={"No ticket is assigned to anyone."}
              />
            ) : (
              <>
                {/* The marks' shapes and words, once, above the figures that carry them. */}
                <MarkKey className="text-xs" />
                <Comparison
                  data={data}
                  selectedId={person}
                  onSelect={select}
                  sort={sort}
                  order={order}
                  onSort={(nextSort, nextOrder) =>
                    void setUrl({ sort: nextSort === "name" ? null : nextSort, order: nextOrder === firstOrder(nextSort) ? null : nextOrder })
                  }
                  stale={stalePeriod}
                />
                <TableCaveat data={data} />
              </>
            )}
          </Section>
          <ScorecardRegion
            person={person}
            source={scorecardSource}
            loading={needsOne && one.isPending}
            error={needsOne && one.isError ? one.error : null}
            onRetry={() => void one.refetch()}
            retrying={one.isFetching}
            stale={staleScorecard}
            prompt={ON_PROMPT}
          />
        </>
      ) : (
        <>
          <p className="max-w-[76ch] text-sm text-ink-mid">{OFF_NOTE}</p>
          <ScorecardRegion
            person={person}
            source={scorecardSource}
            loading={needsOne && one.isPending}
            error={needsOne && one.isError ? one.error : null}
            onRetry={() => void one.refetch()}
            retrying={one.isFetching}
            stale={staleScorecard}
            prompt={OFF_PROMPT}
          />
        </>
      )}
    </div>
  );
}

/** The prompt with no one chosen, comparison on: the table above, or the list a phone shows. */
const ON_PROMPT = "Choose someone above to see their scorecard.";

function ScorecardRegion({
  person,
  source,
  loading,
  error,
  onRetry,
  retrying,
  stale = false,
  prompt,
}: {
  person: string | null;
  source: { data: PeopleScorecard; row: ScorecardPerson } | null;
  /** One person's figures are on their way (the skeleton shows meanwhile). */
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  retrying: boolean;
  /** Another period is loading: the figures shown are the last period's (dimmed and busy, as the table is). */
  stale?: boolean;
  prompt: string;
}) {
  let body: ReactNode;
  if (person === null) {
    body = <EmptyState icon={UserRoundSearch} title="No one chosen yet" description={prompt} />;
  } else if (source) {
    const { data, row } = source;
    body = (
      <Scorecard
        person={row.person}
        tickets={row.tickets}
        values={row.values}
        board={data.board}
        measures={data.measures}
        days={data.period.days}
        headingLevel={3}
      />
    );
  } else if (!loading && error?.notFound) {
    body = (
      <EmptyState
        icon={UserRoundSearch}
        title="Not on this board"
        description="Choose someone else."
      />
    );
  } else if (error) {
    body = (
      <ErrorState
        title="Couldn't load the scorecard"
        description="Try again."
        detail={errorDetail(error)}
        onRetry={onRetry}
        retrying={retrying}
      />
    );
  } else {
    body = <ScorecardSkeleton />;
  }
  return (
    <Section id="scorecard" title="Scorecard">
      <div aria-busy={(stale && source !== null) || undefined} className={cn(stale && source !== null && "opacity-60 transition-opacity")}>
        {body}
      </div>
    </Section>
  );
}

/** While the address is read: the controls and the table (or, comparison off, the person control) in their final places. */
export function PeopleViewFallback({ expected = "on" }: { expected?: PeopleScorecard["comparison"] }) {
  return (
    <div aria-hidden className="flex flex-col gap-7">
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-56" still />
        {expected === "off" ? <Skeleton className="h-8 w-44" still /> : null}
        <Skeleton className="ml-auto h-3 w-48" still />
      </div>
      {expected === "off" ? <ScorecardSkeleton /> : <ComparisonSkeleton />}
    </div>
  );
}
