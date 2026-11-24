"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { Badge, SeverityBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { copyText } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useFinding } from "@/lib/api/hooks";
import type { DataMode, Finding } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { FindingEvidence } from "./finding-evidence";
import { OpenInJira } from "./open-in-jira";
import { findingStatus } from "./model";
import { normaliseFindingId } from "./url-state";

export interface FindingDrawerProps {
  /** ?finding= as written in the URL (it may not be a well-formed id). */
  urlId: string | null;
  /** Open another finding: push for a jump (Back returns), replace for previous and next. */
  onOpen: (id: string, history: "push" | "replace") => void;
  onClose: () => void;
  /** The findings on this page, in the order shown, for previous and next. */
  items: readonly Finding[];
  /** Sample or live, from the list; decides whether "Open in Jira" can lead anywhere. */
  dataMode: DataMode | undefined;
  /** The board's last sync, from the list: the drawer reads a finding's age on the table's clock. */
  lastSyncedAt?: string | null;
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function FindingDrawer({ urlId, onOpen, onClose, items, dataMode, lastSyncedAt }: FindingDrawerProps) {
  const locale = useFigureLocale();
  const open = urlId !== null;
  const id = normaliseFindingId(urlId);

  // Keep the last finding drawn while the drawer slides shut.
  const [shownId, setShownId] = useState(id);
  if (id !== null && id !== shownId) setShownId(id);

  const detail = useFinding(shownId);
  const index = shownId ? items.findIndex((item) => item.finding_id === shownId) : -1;
  const finding: Finding | undefined =
    (detail.data?.finding.finding_id === shownId ? detail.data.finding : undefined) ?? items[index];

  const previous = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 ? items[index + 1] : undefined;
  const move = (target: Finding | undefined) => {
    if (target) onOpen(target.finding_id, "replace");
  };

  // j and k step through the page while the drawer is open, as they do through the table behind it.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "j" && event.key !== "k") return;
    if (isTextField(event.target)) return;
    // Only while focus is in the drawer, never in a menu or a field elsewhere.
    if (!(event.target instanceof Element) || event.target.closest('[role="dialog"]') === null) return;
    event.preventDefault();
    move(event.key === "j" ? next : previous);
  });
  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const copyLink = () => {
    if (!shownId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("finding", shownId);
    void copyText(url.toString(), "link to this finding");
  };

  let title: ReactNode;
  let description: ReactNode;
  let body: ReactNode;
  if (finding) {
    title = finding.rule_title;
    description =
      finding.issue_key !== null ? (
        <>
          <span className="mono text-ink">{finding.issue_key}</span> · {finding.issue_summary}
        </>
      ) : (
        <>
          {finding.sprint?.name ?? "Sprint"} · Jira sprint <span className="mono">{finding.sprint?.sprint_id}</span>
        </>
      );
    body = (
      <FindingEvidence
        finding={finding}
        detail={detail}
        lastSyncedAt={lastSyncedAt}
        onOpenFinding={(target) => onOpen(target, "push")}
      />
    );
  } else if (shownId === null || detail.error?.notFound) {
    title = "Finding not found";
    body = (
      <EmptyState
        title="No finding has that id"
        description={
          shownId === null
            ? "That link is not a finding."
            : "It may be from an older rules version."
        }
        action={<Button onClick={onClose}>Back to the list</Button>}
      />
    );
  } else if (detail.error) {
    title = "Couldn't load the finding";
    body = (
      <ErrorState
        title="Couldn't load the finding"
        description="Try again."
        detail={`${detail.error.status > 0 ? `HTTP ${detail.error.status} · ` : ""}${detail.error.code}`}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
      />
    );
  } else {
    title = (
      <>
        <span className="sr-only">Loading the finding</span>
        <Skeleton className="mt-1 h-5 w-64" />
      </>
    );
    body = (
      <SkeletonGroup label="Loading the evidence" className="flex flex-col gap-7">
        <Skeleton className="h-4 w-11/12" />
        <span className="flex flex-col gap-3">
          <Skeleton className="h-2.5 w-28" />
          <span className="flex flex-col gap-px overflow-hidden rounded-sm border border-rule-weak">
            {[0.5, 0.35, 0.6, 0.4, 0.45, 0.3].map((width, row) => (
              <span key={row} className="flex h-8 items-center justify-between px-3">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-2.5" style={{ width: `${width * 50}%` }} />
              </span>
            ))}
          </span>
        </span>
      </SkeletonGroup>
    );
  }

  const status = finding ? findingStatus(finding) : "open";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className="print:static"
      eyebrow={
        finding ? (
          <>
            <SeverityBadge severity={finding.severity} size="sm" className="tracking-normal normal-case" />
            <span className="mono tracking-normal">{finding.rule_id}</span>
            {status === "resolved" ? (
              <SeverityBadge severity="resolved" size="sm" className="tracking-normal normal-case" />
            ) : status === "superseded" ? (
              <Badge tone="muted" size="sm" className="tracking-normal normal-case">
                Superseded
              </Badge>
            ) : status === "settings_changed" ? (
              <Badge tone="muted" size="sm" className="tracking-normal normal-case" data-state="settings_changed">
                Closed: rule settings changed
              </Badge>
            ) : null}
          </>
        ) : (
          "Finding"
        )
      }
      title={title}
      description={description}
      actions={
        <>
          <IconButton label="Copy link to this finding" icon={Link2} size="sm" onClick={copyLink} disabled={!shownId} />
          {finding?.issue_key ? (
            <>
              <OpenInJira issueKey={finding.issue_key} dataMode={dataMode} />
              <Button asChild variant="ghost" size="sm">
                <Link href={`/issues/${finding.issue_key}`}>
                  Open issue
                  <ArrowUpRight aria-hidden strokeWidth={1.75} />
                </Link>
              </Button>
            </>
          ) : null}
        </>
      }
      footer={
        <>
          <Tooltip content="Previous finding" shortcut={["k"]}>
            <Button size="sm" icon={ChevronLeft} aria-keyshortcuts="k" disabled={!previous} onClick={() => move(previous)}>
              Previous
            </Button>
          </Tooltip>
          <Tooltip content="Next finding" shortcut={["j"]}>
            <Button size="sm" iconEnd={ChevronRight} aria-keyshortcuts="j" disabled={!next} onClick={() => move(next)}>
              Next
            </Button>
          </Tooltip>
          <span className="ml-auto text-xs text-ink-low">
            {index >= 0 ? (
              <>
                <span className="mono">{formatCount(index + 1, { locale })}</span> of{" "}
                <span className="mono">{formatCount(items.length, { locale })}</span> on this page
              </>
            ) : (
              "Not on this page of the list"
            )}
          </span>
        </>
      }
    >
      {body}
    </Sheet>
  );
}
