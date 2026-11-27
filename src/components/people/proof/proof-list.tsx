"use client";

import { ArrowUpRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { memo, startTransition, useEffect, useId, useState, type CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { iconButtonVariants } from "@/components/ui/button";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { PROOF_AT, type FindingIgnore, type PeopleProof, type ProofMeasureKey, type ProofTicket } from "@/lib/api/schemas";
import { FALLBACK_LOCALE, formatCount, formatDate } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

import { basisWords, detailWords, GROUP_WORDS } from "./model";

/** Which of a rate's tickets the list shows: those counted, the rest, or all. */
export type Segment = "all" | "counted" | "other";

/** What each measure's detail column is headed. */
const DETAIL_HEADS: Partial<Record<ProofMeasureKey, string>> = {
  done_in_period: "Done",
  estimated_before_start: "Estimate",
  time_logged: "Time logged",
  within_estimate: "Effort",
  stuck_now: "Time in status",
  reopened: "Reopened",
  skipped_stage: "Stages",
  code_review: "Code review",
  open_findings_per_10: "Open findings",
};

/** Rows drawn at once, then more each frame: a list of thousands stays smooth while it fills. */
const FIRST_ROWS = 60;
const MORE_ROWS = 240;

function useProgressive(total: number, key: string): number {
  const [state, setState] = useState({ key, shown: FIRST_ROWS });
  const shown = state.key === key ? state.shown : FIRST_ROWS;
  useEffect(() => {
    if (shown >= total) return;
    const timer = window.setTimeout(() => startTransition(() => setState({ key, shown: shown + MORE_ROWS })), 16);
    return () => window.clearTimeout(timer);
  }, [shown, total, key]);
  return Math.min(shown, total);
}

/** Dates as the reader's own: their zone and locale once the page is alive, a fixed form before. */
function useDateWords(): (value: string) => string {
  const hydrated = useHydrated();
  return (value) => formatDate(value, hydrated ? {} : { locale: FALLBACK_LOCALE, timeZone: "UTC" });
}

interface Layout {
  detail: string | null;
  /** Each row's columns and areas, wide and narrow, as custom properties on the list. */
  style: CSSProperties;
}

/** Every measure's tickets say whom each counts for: the board's setting decides it, for a person's and the board's alike. */
function layoutFor(key: ProofMeasureKey, leftOut: boolean): Layout {
  const detail = DETAIL_HEADS[key] ?? (leftOut ? "Ignored" : null);
  // The ticket's summary takes the spare width; the status and detail columns flex with it instead of claiming their maximum first.
  const columns = ["minmax(9rem,2.2fr)", "minmax(6.5rem,0.9fr)", detail ? "minmax(10rem,1.5fr)" : null, "minmax(7.5rem,1.1fr)", "2rem"];
  const wide = ["ticket", "status", detail ? "detail" : null, "credit", "link"].filter(Boolean).join(" ");
  const narrow = ['"ticket link"', detail ? '"detail detail"' : null, '"credit credit"'].filter(Boolean).join(" ");
  return {
    detail,
    style: { "--proof-cols": columns.filter(Boolean).join(" "), "--proof-areas": `"${wide}"`, "--proof-narrow": narrow } as CSSProperties,
  };
}

const ROW =
  "relative grid grid-cols-[minmax(0,1fr)_2rem] gap-x-3 gap-y-1 border-b border-rule-weak px-3 py-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_3.25rem] [grid-template-areas:var(--proof-narrow)] hover:bg-rail @min-[40rem]/proof:min-h-[3.25rem] @min-[40rem]/proof:grid-cols-(--proof-cols) @min-[40rem]/proof:items-center @min-[40rem]/proof:gap-x-4 @min-[40rem]/proof:gap-y-0 @min-[40rem]/proof:py-2 @min-[40rem]/proof:[grid-template-areas:var(--proof-areas)]";

/** A cell's two lines, one above the other: nothing is left dangling where a line wraps. */
const LINES = "flex min-w-0 flex-col items-start";

function StatusChip({ status }: { status: string | null }) {
  return (
    <Badge size="sm" className="h-[18px] max-w-full min-w-0 px-1.5 text-[11px] text-ink-mid">
      {/* Its own line box, as tall as the chip holds, so no descender is cut. */}
      <span className="truncate leading-[16px]" title={status ?? undefined}>{status ?? "No status"}</span>
    </Badge>
  );
}

function ignoreLine(ignore: FindingIgnore, date: (value: string) => string): string {
  const what = ignore.scope === "ticket" ? "Ignored" : `${ignore.rule_id} ignored`;
  return `${what}${ignore.by ? ` by ${ignore.by}` : ""} on ${date(ignore.at)}`;
}

interface RowProps {
  ticket: ProofTicket;
  measure: ProofMeasureKey;
  layout: Layout;
  locale: string | undefined;
  date: (value: string) => string;
  /** Left out of the figure by an ignore: said in the detail's place, the row muted. */
  leftOut?: boolean;
}

const ProofRow = memo(function ProofRow({ ticket, measure, layout, locale, date, leftOut = false }: RowProps) {
  const words = leftOut ? null : detailWords(measure, ticket, locale);
  const at = PROOF_AT[measure];
  const when = ticket.at && at ? `${at === "done" ? "Done" : "Started"} ${date(ticket.at)}` : null;
  const main = leftOut && ticket.ignore ? ignoreLine(ticket.ignore, date) : (words?.main ?? when);
  const more = leftOut ? ticket.ignore?.reason ?? null : [words?.more, words ? when : null].filter(Boolean).join(" · ") || null;
  const basis = basisWords(ticket.credit);
  return (
    <li className={ROW} data-ticket={ticket.key} data-counted={ticket.counted} data-left-out={leftOut || undefined}>
      <div className="flex min-w-0 flex-col gap-0.5 [grid-area:ticket]">
        <span className="flex h-[18px] min-w-0 items-center gap-2">
          {ticket.url ? (
            <a
              href={ticket.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${ticket.key} in Jira (new tab)`}
              className="mono relative z-[1] inline-flex shrink-0 items-center gap-1 rounded-xs text-[12.5px] leading-4 font-medium text-cite underline-offset-2 hover:text-cite-hot hover:underline"
            >
              {ticket.key}
              <ExternalLink aria-hidden size={12} strokeWidth={1.75} className="shrink-0" />
            </a>
          ) : (
            <span className={cn("mono shrink-0 text-[12.5px] leading-4 font-medium", leftOut ? "text-ink-mid" : "text-ink")}>{ticket.key}</span>
          )}
          <span className="flex min-w-0 @min-[40rem]/proof:hidden">
            <StatusChip status={ticket.status} />
          </span>
        </span>
        <span className={cn("truncate text-xs leading-4", leftOut ? "text-ink-low" : "text-ink-mid")} title={ticket.summary || undefined}>
          {ticket.summary || "No summary"}
        </span>
      </div>
      <div className="hidden min-w-0 [grid-area:status] @min-[40rem]/proof:flex">
        <StatusChip status={ticket.status} />
      </div>
      {layout.detail ? (
        <div className={cn(LINES, "pr-2 [grid-area:detail]")} data-figure>
          <span className={cn("max-w-full text-xs leading-4 break-words", leftOut ? "text-ink-mid" : "text-ink")} title={main ?? undefined}>
            {main ?? "—"}
          </span>
          {more ? (
            <>
              <span className={cn("max-w-full leading-4 break-words text-ink-low", words?.ids ? "mono text-[11px]" : "text-[11px]")} title={more}>
                {more}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2 [grid-area:credit]">
        <PersonAvatar person={ticket.credit.person} />
        <span className={LINES}>
          <span className={cn("max-w-full truncate text-xs leading-4", ticket.credit.person ? "text-ink" : "text-ink-low")}>
            {ticket.credit.person?.name ?? "Nobody"}
          </span>
          {basis ? (
            <span className="max-w-full truncate text-[11px] leading-4 text-ink-low" data-basis title={basis}>
              {basis}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex items-center justify-end [grid-area:link]">
        {/* The row opens the ticket's page here; the key, above it, opens Jira. */}
        <Link
          href={`/issues/${ticket.key}`}
          aria-label={`${ticket.key} ticket page`}
          title="Ticket page"
          className={cn(iconButtonVariants({ variant: "ghost", size: "sm" }), "jo-stretch")}
        >
          <ArrowUpRight aria-hidden strokeWidth={1.75} />
        </Link>
      </div>
    </li>
  );
});

interface Group {
  id: string;
  /** The group's heading; null for a count's one list. */
  label: string | null;
  tickets: ProofTicket[];
}

/** The tickets in the order the list shows them: the ratio's by their open findings, most first; the rest as sent. */
function groupsOf(proof: PeopleProof, segment: Segment): Group[] {
  const key = proof.measure.key;
  if (proof.measure.kind === "count") return [{ id: "all", label: null, tickets: proof.tickets }];
  const words = GROUP_WORDS[key] ?? ["Counted", "Not counted"];
  const counted = proof.tickets.filter((ticket) => ticket.counted);
  const other = proof.tickets.filter((ticket) => !ticket.counted);
  if (key === "open_findings_per_10") {
    const findings = (ticket: ProofTicket) => (ticket.detail as { findings: number } | null)?.findings ?? 0;
    counted.sort((a, b) => findings(b) - findings(a));
  }
  return [
    { id: "counted", label: words[0], tickets: segment === "other" ? [] : counted },
    { id: "other", label: words[1], tickets: segment === "counted" ? [] : other },
  ].filter((group) => group.tickets.length > 0);
}

/** The tickets a segment shows, in order: what "Open in Jira" opens. */
export function shownTickets(proof: PeopleProof, segment: Segment): ProofTicket[] {
  return groupsOf(proof, segment).flatMap((group) => group.tickets);
}

const HEAD = "micro text-ink-low";

export function ProofList({ proof, segment, locale }: { proof: PeopleProof; segment: Segment; locale: string | undefined }) {
  const base = useId();
  const date = useDateWords();
  const key = proof.measure.key;
  const layout = layoutFor(key, proof.left_out.length > 0);
  const groups = groupsOf(proof, segment);
  const lists = [...groups.map((group) => group.tickets), proof.left_out];
  const rows = lists.reduce((sum, list) => sum + list.length, 0);
  const drawn = useProgressive(rows, `${key}:${proof.person?.id ?? "board"}:${segment}`);
  // Each list's share of the rows drawn so far, in the order they stand.
  const slices: ProofTicket[][] = [];
  let left = drawn;
  for (const list of lists) {
    const slice = list.slice(0, Math.max(0, left));
    slices.push(slice);
    left -= slice.length;
  }
  const headed = groups.length > 1 || groups.some((group) => group.label !== null);

  return (
    <div className="@container/proof flex min-h-[12rem] flex-1 flex-col" style={layout.style}>
      {/* As tall as its rows, up to the room there is; past that it scrolls. */}
      <ScrollArea
        axis="y"
        frameClassName="flex min-h-0 flex-initial flex-col rounded-md border border-rule-weak"
        className="min-h-0 flex-initial [&>section:last-of-type_li:last-child]:border-b-0"
        scrollerProps={{ "aria-busy": drawn < rows || undefined }}
      >
        <div
          aria-hidden
          className={cn(
            "sticky top-0 z-[2] hidden h-8 items-center gap-x-4 border-b border-rule bg-sheet px-3 @min-[40rem]/proof:grid @min-[40rem]/proof:grid-cols-(--proof-cols) @min-[40rem]/proof:[grid-template-areas:var(--proof-areas)]",
          )}
        >
          <span className={cn(HEAD, "[grid-area:ticket]")}>Ticket</span>
          <span className={cn(HEAD, "[grid-area:status]")}>Status</span>
          {layout.detail ? <span className={cn(HEAD, "[grid-area:detail]")}>{layout.detail}</span> : null}
          <span className={cn(HEAD, "[grid-area:credit]")}>Counts for</span>
        </div>
        {groups.map((group, index) => {
          const shown = slices[index];
          const id = `${base}-${group.id}`;
          return (
            <section key={group.id} aria-labelledby={id} data-group={group.id}>
              {headed ? (
                <h3 id={id} className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-rule-weak bg-rail px-3 text-xs font-medium text-ink @min-[40rem]/proof:top-8">
                  {group.label}{" "}
                  <span className="mono font-normal text-ink-low" data-figure>
                    {formatCount(group.tickets.length, { locale })}
                  </span>
                </h3>
              ) : (
                <h3 id={id} className="sr-only">
                  Tickets
                </h3>
              )}
              <ul>
                {shown.map((ticket) => (
                  <ProofRow key={ticket.key} ticket={ticket} measure={key} layout={layout} locale={locale} date={date} />
                ))}
              </ul>
            </section>
          );
        })}
        {proof.left_out.length > 0 ? (
          <section aria-labelledby={`${base}-left-out`} data-group="left-out" className="bg-rail/60">
            <div className="flex flex-col gap-0.5 border-b border-rule-weak px-3 py-2.5">
              <h3 id={`${base}-left-out`} className="flex items-center gap-2 text-xs font-medium text-ink-mid">
                Left out{" "}
                <span className="mono font-normal text-ink-low" data-figure>
                  ({formatCount(proof.left_out.length, { locale })})
                </span>
              </h3>
              <p className="text-[11px] leading-4 text-ink-low">Ignored by an admin, so not counted either way.</p>
            </div>
            <ul>
              {slices[groups.length].map((ticket) => (
                <ProofRow key={ticket.key} ticket={ticket} measure={key} layout={layout} locale={locale} date={date} leftOut />
              ))}
            </ul>
          </section>
        ) : null}
      </ScrollArea>
    </div>
  );
}

/** Rows a loading list draws at most: more than any screen shows. */
const SKELETON_ROWS = 16;

/** The list while it loads, in its final shape: the head, a band per group, and as many rows as are coming. */
export function ProofListSkeleton({ measure, groups }: { measure: ProofMeasureKey; groups: readonly number[] }) {
  const layout = layoutFor(measure, false);
  const bands: number[] = [];
  let budget = SKELETON_ROWS;
  for (const rows of groups) {
    bands.push(Math.min(rows, budget));
    budget -= bands.at(-1)!;
  }
  const headed = groups.length > 1 || GROUP_WORDS[measure] !== undefined;
  return (
    <div className="@container/proof flex min-h-[12rem] flex-1 flex-col" style={layout.style}>
      <SkeletonGroup label="Loading the tickets" className="flex min-h-0 flex-initial flex-col overflow-hidden rounded-md border border-rule-weak">
        <div className="hidden h-8 shrink-0 items-center gap-x-4 border-b border-rule px-3 @min-[40rem]/proof:grid @min-[40rem]/proof:grid-cols-(--proof-cols)">
          <Skeleton className="h-2 w-12" />
          <Skeleton className="h-2 w-10" />
          {layout.detail ? <Skeleton className="h-2 w-20" /> : null}
          <Skeleton className="h-2 w-16" />
        </div>
        {bands.map((rows, group) => (
          <div key={group} className="flex flex-col">
            {headed && rows > 0 ? (
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-rule-weak bg-rail px-3">
                <Skeleton className="h-2.5 w-16" />
              </div>
            ) : null}
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className={cn(ROW, "shrink-0 hover:bg-transparent")}>
                <span className="flex min-w-0 flex-col gap-1.5 [grid-area:ticket]">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className={cn("h-2.5", row % 3 === 0 ? "w-3/4" : row % 3 === 1 ? "w-1/2" : "w-2/3")} />
                </span>
                <span className="hidden items-center [grid-area:status] @min-[40rem]/proof:flex">
                  <Skeleton className="h-[18px] w-16 rounded-pill" />
                </span>
                {layout.detail ? (
                  <span className="flex flex-col gap-1.5 [grid-area:detail]">
                    <Skeleton className="h-2.5 w-28" />
                    <Skeleton className="h-2 w-16" />
                  </span>
                ) : null}
                <span className="flex items-center gap-2 [grid-area:credit]">
                  <Skeleton className="size-5 rounded-full" />
                  <Skeleton className="h-2.5 w-20" />
                </span>
                <span className="flex items-center justify-end [grid-area:link]">
                  <Skeleton className="size-4 rounded-[4px]" />
                </span>
              </div>
            ))}
          </div>
        ))}
      </SkeletonGroup>
    </div>
  );
}
