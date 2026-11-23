"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { StatusTimeline } from "@/components/charts/status-timeline";
import { Badge, SeverityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/error-state";
import { KeyValueList, type KeyValueItem } from "@/components/ui/key-value";
import { NAME_TRIGGER, PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { PersonName } from "@/components/ui/person-name";
import { Section } from "@/components/ui/section";
import { Skeleton, SkeletonGroup, SkeletonText } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ApiError } from "@/lib/api/client";
import { useRules } from "@/lib/api/hooks";
import type { Finding, FindingDetail } from "@/lib/api/schemas";
import { formatDateTime } from "@/lib/format";

import { ChangelogTable } from "./changelog-table";
import { useFindingClock } from "./clock";
import { evidenceText, timelineModel, turnsOn } from "./evidence";
import { findingAgeMs, findingStatus, formatAge, NO_ONES_LABEL, noOnesReason } from "./model";

const DAY = 86_400_000;

function EvidenceValue({ item, finding }: { item: Finding["evidence"][number]; finding: Finding }) {
  const locale = useFigureLocale();
  const { text, none } = evidenceText(item, locale);
  if (item.kind === "sprint" && item.at) {
    return (
      <>
        {text}, <Timestamp value={item.at} mode="datetime" />
      </>
    );
  }
  return <span className={none && !turnsOn(finding, item) ? "text-ink-low" : undefined}>{text}</span>;
}

/** "Warned on X, breached on Y": the warning that foreshadowed this finding, one click away. */
function WarnedBefore({ finding, onOpenFinding }: { finding: Finding; onOpenFinding: (id: string) => void }) {
  const warned = finding.warned_before;
  if (!warned) return null;
  const days = Math.max(0, Math.round((Date.parse(finding.first_seen_at) - Date.parse(warned.warned_at)) / DAY));
  const raised = finding.severity === "breach" ? "Breached on" : "Raised on";
  return (
    <Callout
      label="Warned before"
      action={
        <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => onOpenFinding(warned.warning_finding_id)}>
          Open the warning <span className="mono">{warned.warning_rule_id}</span>
        </Button>
      }
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <SeverityBadge severity="warning" size="sm">
          Warned on <Timestamp value={warned.warned_at} mode="date" />
        </SeverityBadge>
        <ArrowRight aria-hidden size={14} strokeWidth={1.75} className="text-ink-low" />
        <SeverityBadge severity={finding.severity} size="sm">
          {raised} <Timestamp value={finding.first_seen_at} mode="date" />
        </SeverityBadge>
        <span className="text-xs text-ink-low">
          {days === 0 ? "the same day" : `${days} ${days === 1 ? "day" : "days"} later`}
        </span>
      </span>
    </Callout>
  );
}

function resolvedValue(finding: Finding) {
  if (finding.resolved_at === null) return <span className="text-ink-low">Not yet</span>;
  const status = findingStatus(finding);
  const why = status === "superseded" ? "superseded" : status === "settings_changed" ? "closed: rule settings changed" : "cleared";
  return (
    <>
      <Timestamp value={finding.resolved_at} mode="datetime" /> <span className="text-ink-low">· {why}</span>
    </>
  );
}

export interface FindingEvidenceProps {
  finding: Finding;
  /** The finding with its issue's timeline; the list already gave everything else. */
  detail: UseQueryResult<FindingDetail, ApiError>;
  onOpenFinding: (id: string) => void;
  /** The board's last sync, as the list behind the drawer read it: ages on the table's clock (else the detail's). */
  lastSyncedAt?: string | null;
}

/**
 * How long it has been open, on the table's clock, so a row and its drawer give one figure: to now while the
 * board's data is fresh; on a stale board an open finding's age is as at the last sync, and says so.
 */
function AgeValue({ finding, lastSyncedAt }: { finding: Finding; lastSyncedAt: string | null | undefined }) {
  const locale = useFigureLocale();
  const clock = useFindingClock(lastSyncedAt);
  const age = formatAge(findingAgeMs(finding, clock.now), locale);
  if (!clock.stale || finding.resolved_at !== null) return <span className="mono">{age}</span>;
  return (
    <span title={clock.syncedAt ? `As at the last sync, ${formatDateTime(clock.syncedAt)}` : undefined}>
      <span className="mono">{age}</span> <span className="text-ink-low">at last sync</span>
    </span>
  );
}

/** Why a rule fired: the claim, the rule and its threshold, the evidence, the changelog and the timeline. */
export function FindingEvidence({ finding, detail, onOpenFinding, lastSyncedAt }: FindingEvidenceProps) {
  const top = useRef<HTMLDivElement>(null);
  // What the rule fires on, in the catalogue's words: asked for only once a drawer is open.
  const rules = useRules();
  const rule = rules.data?.rules.find((entry) => entry.rule_id === finding.rule_id);

  // A new finding starts at its claim, not wherever the last one was scrolled to.
  useEffect(() => {
    top.current?.closest(".jo-scroller")?.scrollTo?.({ top: 0 });
  }, [finding.finding_id]);

  const noOnes = noOnesReason(finding);
  const items: KeyValueItem[] = [
    {
      id: "rule",
      label: "Rule",
      // The title is the drawer's heading; here, the rule as the catalogue versions it.
      value: (
        <>
          <span className="mono">{finding.rule_id}</span>{" "}
          <span className="text-ink-low">version {finding.rule_version}</span>
        </>
      ),
    },
    {
      id: "threshold",
      label: "Threshold",
      value: finding.threshold ?? <span className="text-ink-low">None: the condition alone</span>,
      mono: finding.threshold !== null,
    },
    ...finding.evidence.map((item, index) => ({
      id: `evidence-${index}`,
      label: item.label,
      value: <EvidenceValue item={item} finding={finding} />,
      mono: typeof item.value === "number",
      highlight: turnsOn(finding, item),
    })),
    { id: "first", label: "First seen", value: <Timestamp value={finding.first_seen_at} mode="datetime" /> },
    { id: "last", label: "Last seen", value: <Timestamp value={finding.last_seen_at} mode="datetime" /> },
    { id: "age", label: "Open for", value: <AgeValue finding={finding} lastSyncedAt={lastSyncedAt ?? detail.data?.meta.last_synced_at} /> },
    { id: "resolved", label: "Resolved", value: resolvedValue(finding) },
    // Who has the issue now (not who had it when the rule fired). A sprint finding belongs to no one, and so
    // does one whose ticket has left the synced data. At people level the name opens their card (JO-13).
    {
      id: "assignee",
      label: "Assignee",
      value: noOnes ? (
        <span className="text-ink-low">{NO_ONES_LABEL[noOnes]}</span>
      ) : finding.assignee ? (
        <PersonCardTrigger person={finding.assignee} className={NAME_TRIGGER}>
          <PersonName person={finding.assignee} />
        </PersonCardTrigger>
      ) : (
        <PersonName person={null} />
      ),
    },
  ];

  // What the rule fires on, as the catalogue says it; the threshold follows in the list.
  const description = rules.isPending ? <SkeletonText lines={1} className="mt-1 w-4/5" /> : rule?.description;

  return (
    <div ref={top} className="flex flex-col gap-7">
      <div className="flex flex-col gap-4">
        <p className="text-base text-ink">{finding.message}</p>
        <WarnedBefore finding={finding} onOpenFinding={onOpenFinding} />
      </div>

      <Section title="Why the rule fired" headingLevel={3} description={description}>
        <KeyValueList items={items} labelWidth="minmax(0,40%)" />
      </Section>

      <ChangelogTable finding={finding} />

      {finding.scope === "issue" ? <IssueTimeline finding={finding} detail={detail} /> : null}

      <p className="text-xs text-ink-low">
        Finding <span className="mono">{finding.finding_id}</span>
      </p>
    </div>
  );
}

function IssueTimeline({ finding, detail }: { finding: Finding; detail: UseQueryResult<FindingDetail, ApiError> }) {
  const key = finding.issue_key ?? "";
  const data = detail.data?.finding.finding_id === finding.finding_id ? detail.data : undefined;

  let body: ReactNode;
  if (data) {
    const model = timelineModel(data.timeline);
    body =
      model.intervals.length === 0 ? (
        <p className="text-sm text-ink-low">No status history has been synced for {key}.</p>
      ) : (
        <StatusTimeline
          title={`${key}, status timeline`}
          lanes={model.lanes}
          intervals={model.intervals}
          now={data.meta.last_synced_at}
          laneHeight={24}
          labelWidth={104}
          compact
        />
      );
  } else if (detail.error) {
    body = (
      <ErrorState
        size="compact"
        title="Couldn't load the timeline"
        description="The evidence above is complete."
        detail={`${detail.error.status > 0 ? `HTTP ${detail.error.status} · ` : ""}${detail.error.code}`}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
      />
    );
  } else {
    body = (
      <SkeletonGroup label={`Loading the status timeline of ${key}`} className="flex flex-col gap-2">
        {[0.7, 0.45, 0.3].map((width, index) => (
          <span key={index} className="flex items-center gap-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2.5" style={{ width: `${width * 70}%` }} />
          </span>
        ))}
      </SkeletonGroup>
    );
  }

  return (
    <Section
      title="Status timeline"
      headingLevel={3}
      actions={
        data ? (
          <Badge tone="muted" size="sm">
            as of <Timestamp value={data.meta.last_synced_at} mode="datetime" className="ml-1" />
          </Badge>
        ) : null
      }
    >
      {body}
    </Section>
  );
}

