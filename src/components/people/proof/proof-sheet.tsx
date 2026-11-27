"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Braces, Copy, ExternalLink, LayoutGrid, Link2, SearchX } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { copyText } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import { oversightKeys, usePeopleProof, type ApiError } from "@/lib/api/hooks";
import type { PeopleProof, PeopleScorecard, Person, ScorecardDays, ScorecardValue } from "@/lib/api/schemas";
import { FALLBACK_LOCALE, formatCount, formatDateRange, formatDateTime } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";

import { figureText } from "../model";
import { GROUP_WORDS, isNowMeasure, JIRA_KEYS_MAX, jiraSearchUrl, jql, measureLabel, proofSentence, sameTarget, type ProofTarget } from "./model";
import { ProofList, ProofListSkeleton, shownTickets, type Segment } from "./proof-list";

/** Wide enough for the ticket, its status, the measure's detail and whom it counts for on one line; a phone's whole screen. */
const SHEET_WIDTH = 840;
/** Rows a loading list stands for when the page does not know the figure yet (a link opened cold). */
const SKELETON_GUESS = 8;

interface Known {
  person: Person | null;
  value: ScorecardValue | null;
  period: PeopleScorecard["period"] | null;
}

/** What the page already knows of the figure (its person, value and period), so the sheet's head stands before its tickets arrive. */
function useKnown(target: ProofTarget | null, days: ScorecardDays): Known {
  const client = useQueryClient();
  if (!target) return { person: null, value: null, period: null };
  for (const [, card] of client.getQueriesData<PeopleScorecard>({ queryKey: [...oversightKeys.people(), "scorecard", days] })) {
    if (!card) continue;
    const row = target.person === null ? null : card.people.find((candidate) => candidate.person.id === target.person);
    if (target.person !== null && !row) continue;
    const tickets = row ? row.tickets : card.board.tickets;
    const value =
      target.measure === "tickets"
        ? { value: tickets, numerator: null, denominator: null, enough: true, vs_board: null }
        : (row ? row.values : card.board.values)[target.measure];
    return { person: row?.person ?? null, value, period: card.period };
  }
  return { person: null, value: null, period: null };
}

function Whose({ target, person, settled }: { target: ProofTarget; person: Person | null; settled: boolean }) {
  const words = "flex min-w-0 items-center gap-2 text-xs font-medium tracking-normal normal-case";
  if (target.person === null) {
    return (
      <span className={words}>
        <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-pressed text-ink-low">
          <LayoutGrid size={12} strokeWidth={2} />
        </span>
        <span className="text-ink-mid">Whole board</span>
      </span>
    );
  }
  // Settled with no one to name (someone not on the board): the body says why, the eyebrow says nothing.
  if (!person) return settled ? null : <Skeleton className="h-5 w-36" />;
  return (
    <span className={words}>
      <PersonAvatar person={person} />
      <span className="truncate text-ink-mid">{person.name}</span>
    </span>
  );
}

function PeriodWords({ measure, period }: { measure: ProofTarget["measure"]; period: Known["period"] }) {
  const hydrated = useHydrated();
  if (!period) return <Skeleton className="inline-block h-3 w-56 align-middle" />;
  const zone = hydrated ? {} : { locale: FALLBACK_LOCALE, timeZone: "UTC" };
  // A figure of now has no period: it stands as of the last sync.
  if (isNowMeasure(measure)) return <>As of {formatDateTime(period.to, zone)}</>;
  return (
    <>
      Last {period.days} days · {formatDateRange(period.from, period.to, zone)}
    </>
  );
}

/** The figure large, its sentence, and (for a rate) the choice of which of its tickets to list. */
function FigureBlock({
  proof,
  known,
  target,
  segment,
  onSegment,
  locale,
}: {
  proof: PeopleProof | undefined;
  known: Known;
  target: ProofTarget;
  segment: Segment;
  onSegment: (segment: Segment) => void;
  locale: string | undefined;
}) {
  const value = proof?.value ?? known.value;
  const kind = proof?.measure.kind ?? (target.measure === "tickets" ? "count" : undefined);
  const days = proof?.period.days ?? known.period?.days ?? null;
  const shown = value && kind ? figureText({ kind, measurable: true }, value, locale).value : null;
  const findings = proof?.tickets.reduce((sum, ticket) => sum + ((ticket.detail as { findings?: number } | null)?.findings ?? 0), 0) ?? 0;
  const counted = proof?.counted ?? value?.numerator ?? (value?.value ?? 0);
  const total = proof?.total ?? value?.denominator ?? (value?.value ?? 0);
  const name = proof ? (proof.person?.name ?? null) : (known.person?.name ?? null);
  const words = GROUP_WORDS[target.measure];
  const rate = proof?.measure.kind === "rate" && words;

  return (
    <div className="flex shrink-0 flex-col gap-3.5 pb-4">
      {/* One sentence for a screen reader too: "14%, 1 of 7 open tickets is stuck in a status." */}
      <p className="flex min-h-[2.25rem] flex-wrap items-baseline gap-x-3 gap-y-1">
        {shown !== null ? (
          <span className="mono text-hero leading-none font-medium tracking-[-0.03em] text-ink" data-figure data-proof-figure>
            {shown}
          </span>
        ) : (
          <Skeleton className="h-8 w-20 self-center" />
        )}{" "}
        {value && days !== null ? (
          <span className="text-sm text-ink-mid" data-proof-sentence>
            {proofSentence(target.measure, { counted, total, findings, days, name }, locale)}
          </span>
        ) : (
          <Skeleton className="h-3 w-72 self-center" />
        )}
      </p>
      {rate && proof ? (
        <SegmentedControl<Segment>
          label="Which tickets"
          size="sm"
          className="self-start"
          options={[
            { value: "counted", label: words[0], count: formatCount(proof.counted, { locale }), disabled: proof.counted === 0 },
            { value: "other", label: words[1], count: formatCount(proof.total - proof.counted, { locale }), disabled: proof.counted === proof.total },
            { value: "all", label: "All", count: formatCount(proof.total, { locale }) },
          ]}
          value={segment}
          onValueChange={onSegment}
        />
      ) : null}
    </div>
  );
}

function JiraActions({ proof, segment, locale }: { proof: PeopleProof; segment: Segment; locale: string | undefined }) {
  const keys = shownTickets(proof, segment).map((ticket) => ticket.key);
  if (keys.length === 0) return null;
  const count = formatCount(keys.length, { locale });
  if (keys.length > JIRA_KEYS_MAX) {
    return (
      <>
        <Button size="sm" icon={Copy} onClick={() => void copyText(keys.join("\n"), `${count} keys`)}>
          Copy keys
        </Button>
        <Button size="sm" icon={Braces} onClick={() => void copyText(jql(keys), `JQL for ${count} tickets`)}>
          Copy JQL
        </Button>
      </>
    );
  }
  const link = proof.tickets.find((ticket) => ticket.url !== null)?.url ?? null;
  if (link) {
    return (
      <Button asChild size="sm">
        <a href={jiraSearchUrl(link, keys)} target="_blank" rel="noopener noreferrer">
          Open in Jira
          <ExternalLink aria-hidden strokeWidth={1.75} />
          <span className="sr-only"> (new tab)</span>
        </a>
      </Button>
    );
  }
  const reason = proof.meta.data_mode === "sample" ? "Sample data: no Jira link" : "No Jira link: the Jira address is not configured";
  return (
    <Tooltip content={reason}>
      {/* aria-disabled rather than disabled: it stays focusable, so its tooltip can say why. */}
      <Button size="sm" aria-disabled="true" iconEnd={ExternalLink} onClick={(event: MouseEvent) => event.preventDefault()}>
        Open in Jira
      </Button>
    </Tooltip>
  );
}

function CountLine({ proof, segment, locale }: { proof: PeopleProof; segment: Segment; locale: string | undefined }) {
  const shown = shownTickets(proof, segment).length;
  const n = (value: number) => (
    <span className="mono text-ink-mid" data-figure>
      {formatCount(value, { locale })}
    </span>
  );
  return (
    <p className="mr-auto min-w-0 text-xs text-ink-low" aria-live="polite" data-proof-count>
      {shown === proof.total ? (
        <>
          {n(proof.total)} {proof.total === 1 ? "ticket" : "tickets"}
        </>
      ) : (
        <>
          Showing {n(shown)} of {n(proof.total)} {proof.total === 1 ? "ticket" : "tickets"}
        </>
      )}
      {proof.left_out.length > 0 ? <> · {n(proof.left_out.length)} left out</> : null}
    </p>
  );
}

function errorBody(error: ApiError, retry: () => void, retrying: boolean): ReactNode {
  if (error.notFound) return <EmptyState icon={SearchX} title="Not on this board" description="This person is not on this board." size="compact" />;
  if (error.code === "not_measurable") {
    return <EmptyState icon={SearchX} title="Not measurable on this board" description="This board can't show that figure, so there are no tickets behind it." size="compact" />;
  }
  return (
    <ErrorState
      title="Couldn't load the tickets"
      description="Try again."
      detail={`${error.status > 0 ? `HTTP ${error.status} · ` : ""}${error.code}`}
      onRetry={retry}
      retrying={retrying}
    />
  );
}

export interface ProofSheetProps {
  /** The figure the address names; null when no proof is open. */
  target: ProofTarget | null;
  days: ScorecardDays;
  onClose: () => void;
  onReturnFocus: (closed: ProofTarget) => void;
}

export function ProofSheet({ target, days, onClose, onReturnFocus }: ProofSheetProps) {
  const locale = useFigureLocale();
  const open = target !== null;
  // The last figure stays drawn while the sheet slides shut.
  const [shown, setShown] = useState<ProofTarget | null>(target);
  if (target !== null && !sameTarget(target, shown)) setShown(target);
  const [segmentOf, setSegmentOf] = useState<{ target: ProofTarget | null; segment: Segment }>({ target: null, segment: "all" });
  const segment = sameTarget(segmentOf.target, shown) ? segmentOf.segment : "all";

  const query = usePeopleProof(shown ? { days, measure: shown.measure, person: shown.person } : null, { enabled: open });
  const known = useKnown(shown, days);
  const proof = query.data;
  const person = proof?.person ?? known.person;

  const copyLink = () => void copyText(window.location.href, "link to these tickets");

  let body: ReactNode = null;
  if (shown) {
    // The rows on their way, as the figure already says: a rate's counted and the rest, a count's all.
    const value = known.value;
    const total = value?.denominator ?? value?.value ?? SKELETON_GUESS;
    const counted = shown.measure === "open_findings_per_10" ? total : (value?.numerator ?? total);
    const coming = GROUP_WORDS[shown.measure] ? [counted, total - counted].filter((rows) => rows > 0) : [total];
    const list = proof ? (
      proof.total === 0 && proof.left_out.length === 0 ? (
        <EmptyState icon={SearchX} title="No tickets behind this figure" description="Nothing counts towards it in this period." size="compact" />
      ) : (
        <ProofList proof={proof} segment={segment} locale={locale} />
      )
    ) : query.isError ? (
      errorBody(query.error, () => void query.refetch(), query.isFetching)
    ) : (
      <ProofListSkeleton measure={shown.measure} groups={coming} />
    );
    body = (
      <div className="flex h-full min-h-0 flex-col">
        {query.isError && !proof ? null : (
          <FigureBlock
            proof={proof}
            known={known}
            target={shown}
            segment={segment}
            onSegment={(next) => setSegmentOf({ target: shown, segment: next })}
            locale={locale}
          />
        )}
        {list}
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={SHEET_WIDTH}
      initialFocus="title"
      onCloseFocus={() => {
        if (shown) onReturnFocus(shown);
      }}
      className="print:static"
      eyebrow={shown ? <Whose target={shown} person={person} settled={query.isError} /> : null}
      title={shown ? measureLabel(shown.measure) : "Tickets"}
      description={shown ? <PeriodWords measure={shown.measure} period={proof?.period ?? known.period} /> : undefined}
      actions={<IconButton label="Copy link to these tickets" icon={Link2} size="sm" onClick={copyLink} />}
      footer={
        proof ? (
          <>
            <CountLine proof={proof} segment={segment} locale={locale} />
            <JiraActions proof={proof} segment={segment} locale={locale} />
          </>
        ) : query.isError ? undefined : (
          <span aria-hidden className="flex h-7 w-full items-center">
            <Skeleton className="h-3 w-28" />
          </span>
        )
      }
    >
      {body}
    </Sheet>
  );
}
