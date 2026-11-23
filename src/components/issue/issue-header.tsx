"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";

import { stageColour } from "@/components/charts/palette";
import { PersonCardHover } from "@/components/person-card/person-card-trigger";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { PageHeader } from "@/components/shell/page";
import { usePeopleLevel } from "@/components/shell/people-level";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import type { DataMode } from "@/lib/api/schemas";
import { ISSUE_PAGE } from "@/lib/nav";

import { epicFindingsHref, personFindingsHref, stageWords, type IssueData } from "./model";

export type IssueHeaderProps =
  | { issueKey: string; state: "loading" | "error" | "missing"; data?: undefined }
  | { issueKey: string; state: "ready"; data: IssueData };

/**
 * The issue's header: the key in Plex Mono and its summary as the title; its
 * type, status (with the stage it maps to), epic and assignee on the line
 * beneath; and Copy link and Open in Jira. Sample data has no Jira site behind it, so
 * Open in Jira stays in place, dimmed, and says why.
 */
export function IssueHeader({ issueKey, state, data }: IssueHeaderProps) {
  const issue = data?.issue;
  return (
    <PageHeader
      eyebrow={issue ? `${ISSUE_PAGE.label} · ${issue.type}` : ISSUE_PAGE.label}
      title={
        <>
          <span className="mono font-medium tracking-[-0.01em] text-ink-mid">{issueKey}</span>
          {issue?.summary ? (
            <>
              {" "}
              <span className="ml-1.5">{issue.summary}</span>
            </>
          ) : null}
        </>
      }
      purpose={
        state === "ready" ? (
          <IssueMeta data={data} />
        ) : state === "loading" ? (
          <span className="flex items-center gap-3 py-0.5" aria-hidden>
            <Skeleton className="h-[22px] w-24 rounded-pill" />
            <Skeleton className="h-3 w-56" />
          </span>
        ) : state === "missing" ? (
          "Not in the synced snapshot."
        ) : (
          ISSUE_PAGE.purpose
        )
      }
      actions={
        <>
          <CopyLinkButton />
          {state === "ready" || state === "loading" ? (
            <OpenInJira url={issue?.url ?? null} mode={data?.meta.data_mode ?? null} />
          ) : null}
        </>
      }
    />
  );
}

/** The issue's epic, leading to its findings; or "No epic". */
function Epic({ data }: { data: IssueData }) {
  const { epic } = data.issue;
  if (!epic) return <span className="text-sm text-ink-low">No epic</span>;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-sm">
      <span className="text-ink-low">Epic</span>
      <Tooltip content={`Findings in epic ${epic.key}`}>
        <Link
          href={epicFindingsHref(epic.key)}
          aria-label={`${epic.key} ${epic.title}: show the epic's findings`}
          className="group inline-flex min-w-0 items-baseline gap-1.5 rounded-xs text-cite underline-offset-[3px] hover:text-cite-hot hover:underline"
        >
          {/* The space keeps the visible text "DEMO-4 Onboarding flow", as the label says it; flex drops it from the layout. */}
          <span className="mono text-xs">{epic.key}</span>{" "}
          <span className="truncate">{epic.title}</span>
          <ArrowUpRight aria-hidden size={13} strokeWidth={1.75} className="shrink-0 self-center" />
        </Link>
      </Tooltip>
    </span>
  );
}

function IssueMeta({ data }: { data: IssueData }) {
  const { issue } = data;
  const stage = stageWords(issue.status, issue.stage);
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <Badge tone="neutral" className="text-ink">
        {/* The stage's step of the timeline's ramp, edged so the palest step still shows on paper. */}
        <span
          aria-hidden
          className="inline-block size-2 shrink-0 rounded-[2px] border border-rule-strong"
          style={issue.stage ? { background: stageColour(issue.stage) } : undefined}
        />
        {issue.status}
        <span className="sr-only">, status</span>
      </Badge>
      {stage ? <span className="text-sm text-ink-low">{stage}</span> : null}
      {/* The dots part the facts on one line. On a phone the line wraps, and a dot would end or start a line,
          so there the gap alone parts them. Each dot travels with the fact after it, so a line that wraps above the
          phone's width never ends on one (SQA: "In Progress · Development stage ·"). */}
      <span className="inline-flex min-w-0 items-baseline gap-2.5">
        <span aria-hidden className="hidden text-ink-low sm:inline" data-separator>
          ·
        </span>
        <Epic data={data} />
      </span>
      {/* The dot travels with the assignee, so a line that wraps above the phone's width never ends on it. */}
      <span className="inline-flex min-w-0 items-baseline gap-2.5">
        <span aria-hidden className="hidden text-ink-low sm:inline" data-separator>
          ·
        </span>
        <Assignee data={data} />
      </span>
    </span>
  );
}

/**
 * Who the issue is assigned to now, by name with their Jira picture, leading
 * to their open findings; or Unassigned. At people level resting on the name
 * opens their card (JO-13), which says where the link leads among its ways
 * on; the press stays the link's.
 */
function Assignee({ data }: { data: IssueData }) {
  const peopleLevel = usePeopleLevel();
  const person = data.issue.assignee;
  if (person === null) {
    return (
      <span className="inline-flex items-baseline gap-1.5 text-sm text-ink-low" data-assignee>
        <PersonAvatar person={null} className="self-center" />
        Unassigned
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-sm" data-assignee>
      <span className="text-ink-low">Assignee</span>
      {peopleLevel ? (
        <PersonCardHover person={person}>{assigneeLink(person)}</PersonCardHover>
      ) : (
        <Tooltip content={`Open findings assigned to ${person.name}`}>{assigneeLink(person)}</Tooltip>
      )}
    </span>
  );
}

function assigneeLink(person: NonNullable<IssueData["issue"]["assignee"]>) {
  return (
    <Link
      href={personFindingsHref(person.id)}
      aria-label={`${person.name}: show their open findings`}
      // The name alone is underlined on hover: a link's own underline would run on through the avatar's initials.
      className="group inline-flex min-w-0 items-baseline gap-1.5 rounded-xs text-cite hover:text-cite-hot"
    >
      <PersonAvatar person={person} className="self-center" />
      <span data-assignee-name className="max-w-[24ch] truncate underline-offset-[3px] group-hover:underline">
        {person.name}
      </span>
      <ArrowUpRight aria-hidden size={13} strokeWidth={1.75} className="shrink-0 self-center" />
    </Link>
  );
}

/** Open the issue in Jira; dimmed with its reason where there is no link to follow. */
function OpenInJira({ url, mode }: { url: string | null; mode: DataMode | null }) {
  if (url) {
    return (
      <Button asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Open in Jira
          <ArrowUpRight aria-hidden strokeWidth={1.75} />
        </a>
      </Button>
    );
  }
  const reason =
    mode === "sample"
      ? "Sample data: no Jira link"
      : mode === "live"
        ? "No Jira link: the Jira site is not configured"
        : "Loading the issue";
  // aria-disabled rather than disabled: the button stays focusable, so its tooltip can say why.
  return (
    <Tooltip content={reason}>
      <Button aria-disabled="true" iconEnd={ArrowUpRight} onClick={(event: MouseEvent) => event.preventDefault()}>
        Open in Jira
      </Button>
    </Tooltip>
  );
}
