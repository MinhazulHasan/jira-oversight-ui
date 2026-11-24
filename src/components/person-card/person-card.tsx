"use client";

import { RotateCw, X } from "lucide-react";
import Link from "next/link";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { openOnBoard, pickBoard } from "@/components/shell/board-switcher";
import { Badge, SeverityMark, StateDot } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useHealth, usePersonCard, useProjects, type ApiError, type Health, type Projects } from "@/lib/api/hooks";
import type { Person, PersonCard, PersonCardBoard, PersonCardProcess, ScorecardDays } from "@/lib/api/schemas";
import { boardFromCookieHeader } from "@/lib/board";
import { formatCount, formatDateTime } from "@/lib/format";
import { isStale } from "@/lib/sync";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

import { useAskAboutHere } from "./ask-about";
import {
  askAboutHref,
  boardsText,
  boardsThatFit,
  FINDINGS_LABEL,
  FINDINGS_SCOPE,
  findingsHref,
  findingsNoun,
  firstName,
  headerLine,
  idleLine,
  inProgressFor,
  issueHref,
  METER_PARTS,
  meterSummary,
  moreText,
  noComparisonLine,
  processSentenceParts,
  scorecardLink,
  workingOnHref,
  type MeterPart,
} from "./model";

/** The card's width in a popover (the brief's 340 px). */
export const CARD_WIDTH_PX = 340;

/** The meter's neutral inks, darkest for closer; too few tickets the quietest, a step firmer in dark (charts.css). */
const METER_FILL: Record<MeterPart, string> = {
  closer: "bg-ink",
  level: "bg-ink-low",
  further: "bg-ink-dim",
  too_few: "bg-(--chart-too-few)",
};

const SECTION_LABEL = "micro text-ink-low";
const FRAME = "rounded-md border border-rule";
/** What a section says when it has nothing to show: one muted line at the top of its room, unframed. */
const EMPTY_LINE = "text-xs leading-[17px] text-ink-low";

/* ---------------------------------------------------------- the boards -- */

function useTopBarBoard(): string | null {
  const health = useHealth();
  const projects = useProjects();
  const hydrated = useHydrated();
  return health.data?.projects[0] ?? (hydrated ? boardFromCookieHeader(document.cookie) : null) ?? projects.data?.default ?? null;
}

function useLinkBoard(read: string | null | undefined): string | null {
  const top = useTopBarBoard();
  return read && read !== top ? read : null;
}

interface CardLinkProps {
  href: string;
  /** The board to pick before the link opens; null for an ordinary link, on the top bar's board. */
  board: string | null;
  /** The card is left for the link (it closes, and gives focus to no one). */
  onLeave?: () => void;
  here?: () => void;
  className?: string;
  title?: string;
  children: ReactNode;
}

function CardLink({ href, board, onLeave, here, className, title, children }: CardLinkProps) {
  const press = (event: MouseEvent<HTMLAnchorElement>) => {
    const plain = !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (here && plain) {
      event.preventDefault();
      onLeave?.();
      here();
      return;
    }
    onLeave?.();
    if (board === null) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      pickBoard(board);
      return;
    }
    event.preventDefault();
    openOnBoard(board, href);
  };
  const auxiliary = (event: MouseEvent<HTMLAnchorElement>) => {
    if (board !== null && event.button === 1) pickBoard(board);
  };
  return (
    <Link href={href} prefetch={board === null ? undefined : false} onClick={press} onAuxClick={auxiliary} title={title} className={className}>
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------- pieces -- */

/** The plain line under the name: "Holds 13 open tickets on Demo project", "Member of Demo project · no tickets". */
function HeaderLineText({ card, failed }: { card: PersonCard | undefined; failed: boolean }) {
  const locale = useFigureLocale();
  if (!card) {
    // Not read: the line keeps its room, empty (the body says why), never a placeholder still saying it loads.
    if (failed) return <span aria-hidden className="block h-[18px]" data-card-line />;
    return (
      <span className="flex h-[18px] items-center" data-card-line>
        <Skeleton className="h-3 w-40" />
      </span>
    );
  }
  const line = headerLine(card, locale);
  return (
    <span className="block h-[18px] truncate text-xs leading-[18px] text-ink-mid" data-card-line title={line.title}>
      {line.lead}
      {line.figure ? (
        <span className="mono text-ink" data-figure>
          {line.figure}
        </span>
      ) : null}
      {line.middle}
      <span className="text-ink">{line.board}</span>
      {line.tail}
    </span>
  );
}

/** Open, in progress, and done in the period: three figures in one ruled frame, as the Overview's tiles stand. */
function Tiles({ card, days }: { card: PersonCard | undefined; days: number }) {
  const locale = useFigureLocale();
  const tiles = [
    { key: "open", label: "Open", spoken: "Open tickets", value: card?.work.open_tickets },
    { key: "progress", label: "In progress", spoken: "In progress now", value: card?.work.in_progress },
    { key: "done", label: `Done in ${days} days`, spoken: `Done in the last ${days} days`, value: card?.work.done_in_period },
  ];
  return (
    // The third is wider, so its period is said whole beside the two short words.
    <dl className={cn(FRAME, "grid h-[58px] shrink-0 grid-cols-[1fr_1fr_1.35fr] gap-px overflow-hidden bg-rule-weak")} data-card-tiles>
      {tiles.map((tile) => (
        <div key={tile.key} className="flex min-w-0 flex-col justify-center gap-1 bg-raised px-2.5" data-tile={tile.key}>
          <dt className="truncate text-xs leading-4 text-ink-low">
            <span aria-hidden>{tile.label}</span>
            <span className="sr-only">{tile.spoken}</span>
          </dt>
          <dd className="flex h-[22px] items-center">
            {tile.value === undefined ? (
              <Skeleton className="h-5 w-9" />
            ) : (
              // A nought is said as plainly, in the secondary ink, so the figures that are there stand out.
              <span className={cn("mono text-xl leading-none font-medium tracking-[-0.02em]", tile.value === 0 ? "text-ink-low" : "text-ink")} data-figure>
                {formatCount(tile.value, { locale })}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FindingsLine({ card }: { card: PersonCard | undefined }) {
  const locale = useFigureLocale();
  let line: ReactNode;
  if (!card) {
    line = (
      <p className="flex h-5 items-center" data-card-findings>
        <Skeleton className="h-3 w-48" />
      </p>
    );
  } else {
    const counts = [
      { severity: "breach" as const, value: card.findings.open_breaches },
      { severity: "warning" as const, value: card.findings.open_warnings },
    ].filter((entry) => entry.value > 0);
    line = (
      <p className="flex h-5 items-center gap-4 overflow-hidden text-xs whitespace-nowrap" title={counts.length === 0 ? undefined : FINDINGS_SCOPE} data-card-findings>
        {counts.length === 0 ? (
          <span className="inline-flex items-center gap-2 text-ink-low">
            <StateDot tone="hollow" size="sm" />
            No open findings
          </span>
        ) : (
          counts.map(({ severity, value }) => (
            <span key={severity} className="inline-flex items-center gap-1.5 text-ink-mid" data-findings={severity}>
              <SeverityMark severity={severity} size={9} />
              <span>
                <span className="mono text-ink" data-figure>
                  {formatCount(value, { locale })}
                </span>{" "}
                {findingsNoun(value, severity)}
              </span>
            </span>
          ))
        )}
      </p>
    );
  }
  return (
    <section aria-label={FINDINGS_LABEL} className="flex h-[39px] shrink-0 flex-col gap-1.5" data-card-findings-section>
      <h3 className={cn(SECTION_LABEL, "h-[13px]")}>{FINDINGS_LABEL}</h3>
      {line}
    </section>
  );
}

/** The meter's parts as a slim bar: closer, level, further, too few tickets, each as wide as its count. */
function MeterBar({ process }: { process: PersonCardProcess }) {
  return (
    <span aria-hidden className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-pill" data-card-meter>
      {METER_PARTS.filter((part) => process[part.key] > 0).map((part) => (
        <span key={part.key} data-part={part.key} className={cn("h-full min-w-1 first:rounded-l-pill last:rounded-r-pill", METER_FILL[part.key])} style={{ flexGrow: process[part.key], flexBasis: 0 }} />
      ))}
    </span>
  );
}

/** How their figures stand next to the board's over the period: the scorecard's sentence, the bar, and its key with each count. */
function ProcessMeter({ card, days }: { card: PersonCard | undefined; days: number }) {
  const locale = useFigureLocale();
  const body = "flex h-[72px] flex-col";
  let content: ReactNode;
  if (!card) {
    content = (
      <div className={cn(body, "gap-2")}>
        <span className="flex flex-col gap-1.5 pt-0.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/3" />
        </span>
        <Skeleton className="mt-1 h-1.5 w-full rounded-pill" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
  } else if (card.process === null) {
    // Nothing about them compares with the board: one muted line where the sentence would start; the rest is room.
    content = <p className={cn(body, EMPTY_LINE)}>{noComparisonLine(card)}</p>;
  } else {
    const process = card.process;
    const sentence = processSentenceParts(process, locale);
    content = (
      <div className={cn(body, "gap-2")}>
        <p className="h-[34px] text-xs leading-[17px] text-ink-mid" data-card-sentence>
          {sentence.lead}{" "}
          <span className="block">
            on{" "}
            <span className="mono text-ink" data-figure>
              {sentence.closer}
            </span>{" "}
            of{" "}
            <span className="mono text-ink" data-figure>
              {sentence.compared}
            </span>{" "}
            {sentence.noun}.
          </span>
        </p>
        <MeterBar process={process} />
        <p className="flex h-4 items-center gap-x-2.5 overflow-hidden text-[11px] leading-4 whitespace-nowrap text-ink-low">
          {METER_PARTS.map((part) => (
            <span key={part.key} className="inline-flex shrink-0 items-center gap-1" data-key={part.key}>
              <span aria-hidden className={cn("size-2 rounded-[2px]", METER_FILL[part.key])} />
              <span className="mono text-ink-mid">{formatCount(process[part.key], { locale })}</span>
              {part.label}
            </span>
          ))}
          <span className="sr-only">{meterSummary(process, locale)}</span>
        </p>
      </div>
    );
  }
  return (
    <section aria-label={`Process, last ${days} days`} className="flex h-[91px] shrink-0 flex-col gap-1.5" data-card-process={card ? (card.process ? "meter" : "none") : "loading"}>
      <h3 className={cn(SECTION_LABEL, "h-[13px]")}>Process, last {days} days</h3>
      {content}
    </section>
  );
}

/** One of their tickets in progress: the key (to its page), the status, how long, and the summary on one line. */
function TicketRow({ ticket, asOf, board, onLeave }: { ticket: PersonCard["in_progress_now"][number]; asOf: string; board: string | null; onLeave?: () => void }) {
  const locale = useFigureLocale();
  const spell = inProgressFor(ticket.since, asOf, locale);
  return (
    <li className="flex h-11 min-w-0 flex-col justify-center gap-0.5 px-2.5" data-card-ticket={ticket.key}>
      <span className="flex h-4 min-w-0 items-center gap-2">
        <CardLink href={issueHref(ticket.key)} board={board} onLeave={onLeave} className="mono shrink-0 text-mono-s leading-4 text-cite underline-offset-2 hover:text-cite-hot hover:underline">
          {ticket.key}
        </CardLink>
        <Badge size="sm" className="h-4 max-w-[9rem] min-w-0 shrink px-1.5 text-[10.5px]">
          {/* Its own line box, as tall as the chip holds: the badge's one-to-one line height would cut a g or a y. */}
          <span className="truncate leading-[14px]">{ticket.status}</span>
        </Badge>
        {spell && <span className="ml-auto shrink-0 text-[11px] leading-4 text-ink-low">{spell}</span>}
      </span>
      <span className="block truncate text-xs leading-4 text-ink-mid" title={ticket.summary || undefined}>
        {ticket.summary || <span className="text-ink-low">No summary</span>}
      </span>
    </li>
  );
}

/** When anything last happened on their tickets: a status change or logged work, relative, the moment in its tooltip. */
function LastActivity({ card }: { card: PersonCard | undefined }) {
  if (!card) return <Skeleton className="h-2.5 w-24" />;
  return (
    <span className="truncate text-[11px] leading-4 text-ink-low" data-card-activity>
      {card.last_activity_at ? (
        <>
          Last activity <Timestamp value={card.last_activity_at} mode="relative" />
        </>
      ) : (
        "No activity recorded"
      )}
    </span>
  );
}

function WorkingOn({ card, person, board, onLeave }: { card: PersonCard | undefined; person: Person; board: string | null; onLeave?: () => void }) {
  const locale = useFigureLocale();
  const now = useNow();
  const more = card ? moreText(card.in_progress_more, locale) : null;
  const holds = card?.membership !== "member_no_tickets";
  const room = "h-[136px] shrink-0";
  const synced = card?.meta.last_synced_at ?? null;
  const stale = synced !== null && now !== null && isStale(synced, now);
  const asOf = synced === null || stale || now === null ? synced : new Date(now).toISOString();
  const heading = stale ? "In progress at last sync" : "Working on now";
  let list: ReactNode;
  if (!card) {
    list = (
      <ul aria-hidden className={cn(FRAME, room, "divide-y divide-rule-weak overflow-hidden")}>
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex h-11 flex-col justify-center gap-1.5 px-2.5">
            <span className="flex items-center gap-2">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-2.5 w-14" />
            </span>
            <Skeleton className={cn("h-2.5", row === 1 ? "w-3/5" : "w-4/5")} />
          </li>
        ))}
      </ul>
    );
  } else if (card.in_progress_now.length === 0) {
    list = (
      <p className={cn(room, EMPTY_LINE)} data-card-idle>
        {idleLine(card)}
      </p>
    );
  } else {
    list = (
      <div className={room}>
        <ul className={cn(FRAME, "divide-y divide-rule-weak overflow-hidden")} data-card-tickets>
          {card.in_progress_now.map((ticket) => (
            <TicketRow key={ticket.key} ticket={ticket} asOf={asOf ?? card.meta.last_synced_at} board={board} onLeave={onLeave} />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <section aria-label={heading} className="flex h-[180px] shrink-0 flex-col gap-1.5" data-card-working={stale ? "as-of-sync" : "now"}>
      <div className="flex h-4 items-center justify-between gap-3">
        <h3 className={cn(SECTION_LABEL, "shrink-0")} title={stale && synced ? `As of the last sync, ${formatDateTime(synced)}` : undefined}>
          {heading}
        </h3>
        {holds ? <LastActivity card={card} /> : null}
      </div>
      {list}
      {/* How many more there are: the whole list, in Ask. */}
      <p className="h-4 text-[11px] leading-4" data-card-more>
        {more ? (
          <CardLink
            href={workingOnHref(person)}
            board={board}
            onLeave={onLeave}
            title={`Everything ${person.name} is working on now, in Ask`}
            className="text-cite underline-offset-2 hover:text-cite-hot hover:underline"
          >
            {more}
          </CardLink>
        ) : null}
      </p>
    </section>
  );
}

function OtherBoards({ card, person, days, onLeave }: { card: PersonCard | undefined; person: Person; days: number; onLeave?: () => void }) {
  const locale = useFigureLocale();
  const projects = useProjects();
  const health = useHealth();
  const top = useTopBarBoard();
  const line = useRef<HTMLParagraphElement>(null);
  const ruler = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);
  const boards = card?.other_boards ?? [];
  const words = boards.map((board) => `${board.key} (${formatCount(board.open_tickets, { locale })} open)`);
  const signature = words.join(" · ");
  /** The line is on the card with its boards: measured once it is, however late the board list arrives. */
  const drawn = boards.length > 0 && otherBoardsLine(projects.data, health.data);

  useLayoutEffect(() => {
    const visible = line.current;
    const copy = ruler.current;
    if (!visible || !copy) return;
    const fit = () => {
      const width = (selector: string) => copy.querySelector(selector)?.getBoundingClientRect().width ?? 0;
      const widths = [...copy.querySelectorAll("[data-ruler-board]")].map((node) => node.getBoundingClientRect().width);
      setShown(boardsThatFit(width("[data-ruler-lead]"), widths, width("[data-ruler-more]"), visible.clientWidth));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(visible);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [signature, drawn]);

  if (!otherBoardsLine(projects.data, health.data)) return null;
  if (!card) {
    return (
      <p aria-hidden className="flex h-[18px] shrink-0 items-center" data-card-boards="loading">
        <Skeleton className="h-2.5 w-44" />
      </p>
    );
  }
  if (boards.length === 0) {
    // The reader has other boards: that they hold nothing open there is a fact worth the line.
    return (
      <p className="h-[18px] shrink-0 truncate text-xs leading-[18px] text-ink-low" data-card-boards="none">
        No open tickets on other boards.
      </p>
    );
  }
  const openable = (board: PersonCardBoard) => projects.data?.projects.some((candidate) => candidate.key === board.key && candidate.last_synced_at !== null) ?? false;
  const href = scorecardLink(person.id, days);
  const listed = boards.slice(0, shown ?? boards.length);
  const rest = boards.slice(listed.length);
  const separator = (index: number) =>
    index > 0 ? (
      <>
        <span aria-hidden> · </span>
        <span className="sr-only">, </span>
      </>
    ) : null;
  return (
    <div className="relative h-[18px] shrink-0">
      <p ref={line} className="h-[18px] truncate text-xs leading-[18px] text-ink-low" data-card-boards>
        Also on{" "}
        {listed.map((board, index) => (
          <span key={board.key} data-card-board={board.key}>
            {separator(index)}
            {openable(board) ? (
              <CardLink
                href={href}
                board={board.key === top ? null : board.key}
                onLeave={onLeave}
                title={board.key === top ? `Open ${person.name}'s scorecard on ${board.name}` : `Switch to ${board.name} and open ${person.name}'s scorecard there`}
                className="mono text-mono-s text-cite underline-offset-2 hover:text-cite-hot hover:underline"
              >
                {board.key}
              </CardLink>
            ) : (
              <span className="mono text-mono-s text-ink-mid" title={board.name}>
                {board.key}
              </span>
            )}{" "}
            <span className="text-ink-low">({formatCount(board.open_tickets, { locale })} open)</span>
          </span>
        ))}
        {rest.length > 0 ? (
          <span title={`Also on ${boardsText(rest, locale)}`} data-card-boards-more>
            {separator(1)}+{formatCount(rest.length, { locale })} more
            <span className="sr-only">{`: ${boardsText(rest, locale)}`}</span>
          </span>
        ) : null}
      </p>
      {/* The whole line again, unseen and unread, for measuring what fits: the same words in the same type. */}
      <span ref={ruler} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 w-max text-xs leading-[18px] whitespace-nowrap" data-card-boards-ruler>
        <span data-ruler-lead>Also on </span>
        {words.map((word, index) => (
          <span key={boards[index].key} data-ruler-board>
            {index > 0 ? " · " : null}
            <span className="mono text-mono-s">{boards[index].key}</span>
            {word.slice(boards[index].key.length)}
          </span>
        ))}
        {/* The widest "+N more" the line can need: all but the first left out. */}
        <span data-ruler-more> · +{formatCount(Math.max(1, boards.length - 1), { locale })} more</span>
      </span>
    </div>
  );
}

function otherBoardsLine(projects: Projects | undefined, health: Health | undefined): boolean {
  const synced = projects?.projects.filter((board) => board.last_synced_at !== null).length ?? 0;
  return synced > 1 || health?.data_mode === "sample";
}

/** Why a card read failed with a 404 (they are not on the board, or the board is not served): every way on is shut. */
function closedWays(error: ApiError | null, person: Person): string | null {
  if (error?.status !== 404) return null;
  return error.code === "unknown_board" ? "Not a board the oversight service serves" : `${person.name} is not on this board`;
}

/** Why the card could not be shown, in this interface's words, and Try again where trying again can help. */
function CardError({ error, person, onRetry, retrying, tall }: { error: ApiError; person: Person; onRetry: () => void; retrying: boolean; tall: boolean }) {
  // A 404 is the person not on the board, unless its code says the board itself is not one the service serves.
  const notHere = error.status === 404 && error.code !== "unknown_board";
  return (
    // The body's own height (the sections and the gaps between them), so the card keeps its size whatever it says.
    <div
      role="alert"
      className={cn("flex shrink-0 flex-col items-center justify-center gap-3 rounded-md bg-rail px-6 text-center", tall ? "h-[434px]" : "h-[404px]")}
      data-card-error={error.code}
    >
      <p className="text-sm text-ink">{notHere ? `${person.name} is not on this board.` : `Couldn't load ${person.name}'s card.`}</p>
      <p className="text-xs text-ink-low">
        {notHere ? "Not on this board." : error.message}
      </p>
      {error.status === 404 ? null : (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="pressable inline-flex h-7 items-center gap-1.5 rounded-md border border-rule bg-sheet px-2.5 text-xs text-ink-mid hover:border-rule-strong hover:text-ink disabled:opacity-60"
        >
          <RotateCw aria-hidden size={13} strokeWidth={1.75} className={cn(retrying && "animate-spin")} />
          Try again
        </button>
      )}
    </div>
  );
}

interface ActionsProps {
  card: PersonCard | undefined;
  /** Why the read failed, when it did: a 404 shuts every way on (each would open a page saying the same). */
  error: ApiError | null;
  person: Person;
  days: number;
  /** The board the card's links pick first, where it is not the top bar's. */
  board: string | null;
  onLeave?: () => void;
  layout: "bar" | "sheet";
}

function Actions({ card, error, person, days, board, onLeave, layout }: ActionsProps) {
  const askHere = useAskAboutHere();
  const member = card?.membership === "member_no_tickets";
  const closed = card ? null : closedWays(error, person);
  const ask = `Ask about ${firstName(person.name)}`;
  const cell = cn(
    "pressable flex flex-auto items-center justify-center px-2.5 py-1.5 text-center text-xs leading-4 font-medium text-ink-mid outline-offset-[-2px] hover:bg-hover hover:text-ink",
    layout === "bar" ? "min-h-9" : "min-h-11",
  );
  /** The two fixed labels keep their one line; the third takes what is left, and wraps a long first name. */
  const item = cn(cell, "shrink-0 whitespace-nowrap");
  const askItem = cn(cell, "min-w-0 text-balance [overflow-wrap:anywhere]");
  const shut = "cursor-default text-ink-low hover:bg-transparent hover:text-ink-low";
  const divider = <span aria-hidden className="w-px shrink-0 self-stretch bg-rule-weak" />;
  return (
    <nav aria-label={`Ways on from ${person.name}'s card`} className="flex w-full min-w-0 items-stretch" data-card-actions>
      {closed ? (
        <span aria-disabled="true" title={closed} className={cn(item, shut)}>
          View scorecard
        </span>
      ) : (
        <CardLink href={scorecardLink(person.id, days)} board={board} onLeave={onLeave} className={item}>
          View scorecard
        </CardLink>
      )}
      {divider}
      {closed || member ? (
        // A member who holds none of the board's tickets owns no finding: Findings would be an empty page.
        <span aria-disabled="true" title={closed ?? "No tickets on this board, so no findings"} className={cn(item, shut)}>
          Open findings
        </span>
      ) : (
        <CardLink href={findingsHref(person.id)} board={board} onLeave={onLeave} className={item}>
          Open findings
        </CardLink>
      )}
      {divider}
      {closed ? (
        <span aria-disabled="true" title={closed} className={cn(askItem, shut)}>
          {ask}
        </span>
      ) : (
        // On the Ask page, on its board, the person goes into the question being written: the answer and the draft stay.
        <CardLink href={askAboutHref(person.id)} board={board} onLeave={onLeave} here={askHere && board === null ? () => askHere(person) : undefined} className={askItem}>
          {ask}
        </CardLink>
      )}
    </nav>
  );
}

/** The card's body, between the header and the actions: the same in the popover and in the bottom sheet. */
function CardBody({ query, person, days, board, onLeave }: { query: ReturnType<typeof usePersonCard>; person: Person; days: number; board: string | null; onLeave?: () => void }) {
  const card = query.data;
  const tall = otherBoardsLine(useProjects().data, useHealth().data);
  if (!card && query.error) {
    return <CardError error={query.error} person={person} onRetry={() => void query.refetch()} retrying={query.isFetching} tall={tall} />;
  }
  return (
    <div className="flex flex-col gap-3" aria-busy={!card || undefined}>
      {!card ? <span className="sr-only" role="status">{`Loading ${person.name}'s card`}</span> : null}
      <Tiles card={card} days={days} />
      <FindingsLine card={card} />
      <ProcessMeter card={card} days={days} />
      <WorkingOn card={card} person={person} board={board} onLeave={onLeave} />
      <OtherBoards card={card} person={person} days={days} onLeave={onLeave} />
    </div>
  );
}

/* ------------------------------------------------------------- surfaces -- */

export interface PersonCardContentProps {
  person: Person;
  days: ScorecardDays;
  /** The board to read the card on, where the page names one (an access log entry's); else the top bar's. */
  board?: string | null;
  /** Pinned by a press: a dialog with focus inside, and a close button. A hover card has neither. */
  pinned: boolean;
  onClose: () => void;
}

export function PersonCardPopoverBody({ person, days, board, pinned, onClose }: PersonCardContentProps) {
  const query = usePersonCard(person.id, { days, board });
  const card = query.data;
  const links = useLinkBoard(board);
  return (
    <div className="flex flex-col" data-person-card={person.id} data-card-state={card ? "ready" : query.error ? "error" : "loading"}>
      <div className="relative flex min-h-18 items-center gap-3 border-b border-rule-weak bg-rail px-4 py-3" data-card-head>
        <PersonAvatar person={person} size={48} board={board} className="shadow-[0_0_0_2px_var(--paper-050)]" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <PopoverPrimitive.Title className={cn("text-lg leading-[1.3] font-semibold tracking-[-0.01em] text-balance text-ink [overflow-wrap:anywhere]", pinned && "pr-6")}>
            {person.name}
          </PopoverPrimitive.Title>
          <HeaderLineText card={card} failed={Boolean(query.error)} />
        </div>
        {pinned ? (
          <PopoverPrimitive.Close
            aria-label="Close"
            className="pressable absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md text-ink-low hover:bg-hover hover:text-ink"
          >
            <X aria-hidden size={15} strokeWidth={1.75} />
          </PopoverPrimitive.Close>
        ) : null}
      </div>
      <div className="px-4 pt-3.5 pb-3.5">
        <CardBody query={query} person={person} days={days} board={links} onLeave={onClose} />
      </div>
      <div className="border-t border-rule-weak bg-rail" data-card-foot>
        <Actions card={card} error={query.error} person={person} days={days} board={links} onLeave={onClose} layout="bar" />
      </div>
    </div>
  );
}

/** The card's parts for the bottom sheet's slots: the plain line under the title, the body, and the actions. */
export function usePersonCardSheetParts({
  person,
  days,
  board,
  onClose,
  enabled,
}: Omit<PersonCardContentProps, "pinned"> & {
  /** Read only once the sheet opens: a card is fetched when someone opens it, never because a name is on the page. */
  enabled: boolean;
}): {
  description: ReactNode;
  body: ReactNode;
  footer: ReactNode;
} {
  const query = usePersonCard(person.id, { days, board }, { enabled });
  const links = useLinkBoard(board);
  return {
    description: <HeaderLineText card={query.data} failed={Boolean(query.error)} />,
    body: (
      <div data-person-card={person.id} data-card-state={query.data ? "ready" : query.error ? "error" : "loading"}>
        <CardBody query={query} person={person} days={days} board={links} onLeave={onClose} />
      </div>
    ),
    footer: <Actions card={query.data} error={query.error} person={person} days={days} board={links} onLeave={onClose} layout="sheet" />,
  };
}
