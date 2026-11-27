"use client";

import { ArrowUpRight, EyeOff, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { IgnoreProvider, useIgnoreActions } from "@/components/findings/ignore-actions";
import { IgnoredChip } from "@/components/findings/ignored-chip";
import { SeverityBadge, StateDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, dataTableColumns } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Finding } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { findingHref, issueFindingsHref, type IssueData } from "./model";

const col = dataTableColumns<Finding>();

function StateCell({ finding }: { finding: Finding }) {
  if (finding.state === "ignored") {
    return (
      <span className="flex min-w-0 flex-col items-start gap-1 py-2">
        <IgnoredChip ignore={finding.ignore} />
        <span className="text-xs text-ink-low">
          on <Timestamp value={finding.ignore?.at ?? finding.resolved_at ?? finding.last_seen_at} className="whitespace-nowrap" />
        </span>
      </span>
    );
  }
  const open = finding.state === "open";
  return (
    <span className="flex min-w-0 flex-col gap-0.5 py-2">
      <StateDot
        tone={open || finding.resolved_why === "settings_changed" ? "neutral" : "ok"}
        label={open ? "Open" : finding.resolved_why === "settings_changed" ? "Closed:" : "Resolved"}
        className="text-ink-mid"
      />
      <span className="text-xs text-ink-low">
        {open
          ? "since "
          : finding.resolved_why === "superseded"
            ? "superseded "
            : finding.resolved_why === "settings_changed"
              ? "rule settings changed "
              : "cleared "}
        <Timestamp value={open ? finding.first_seen_at : (finding.resolved_at ?? finding.last_seen_at)} className="whitespace-nowrap" />
      </span>
    </span>
  );
}

const COLUMNS = col.columns([
  col.accessor("severity", {
    header: "Severity",
    cell: (info) => <SeverityBadge severity={info.getValue()} size="sm" />,
    meta: { width: "7.25rem" },
  }),
  col.accessor("rule_title", {
    header: "Finding",
    cell: (info) => {
      const finding = info.row.original;
      return (
        // The rule and what it saw read whole: each wraps rather than being cut, at 390 px as at 1440.
        <span className="flex min-w-0 flex-col gap-0.5 py-2">
          <span className="text-pretty">
            <span className="mono text-xs text-ink-low">{finding.rule_id}</span>{" "}
            <span className={finding.state === "open" ? "text-ink" : "text-ink-mid"}>{finding.rule_title}</span>
          </span>
          <span className="text-xs text-pretty text-ink-mid">{finding.message}</span>
        </span>
      );
    },
    meta: { label: "Rule and finding", cellClassName: "whitespace-normal" },
  }),
  col.accessor("state", {
    header: "State",
    cell: (info) => <StateCell finding={info.row.original} />,
    meta: { width: "9.5rem", cellClassName: "whitespace-normal" },
  }),
]);

const LOADING: Finding[] = [];

/** Where the focus waits once "Ignore all on this ticket" has gone with the ticket's open findings. */
const findingsLink = () => document.querySelector<HTMLElement>("[data-issue-findings-link]");

export function IssueFindings({ data }: { data: IssueData | null }) {
  return (
    <IgnoreProvider fallbackFocus={findingsLink}>
      <TicketFindings data={data} />
    </IgnoreProvider>
  );
}

function TicketFindings({ data }: { data: IssueData | null }) {
  const router = useRouter();
  const locale = useFigureLocale();
  const ignoring = useIgnoreActions();
  const findings = data?.findings ?? LOADING;
  const key = data?.issue.key;
  const open = findings.filter((finding) => finding.state === "open").length;
  const ignored = findings.filter((finding) => finding.state === "ignored").length;
  const resolved = findings.length - open - ignored;

  return (
    <Section
      title="Findings"
      id="findings"
      count={data ? formatCount(findings.length, { locale }) : undefined}
      actions={
        key && findings.length > 0 ? (
          <>
            {ignoring.enabled && open > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={EyeOff}
                disabled={ignoring.busy}
                data-ignore-ticket=""
                onClick={() => ignoring.askIgnore({ target: { issue_keys: [key] }, scope: "ticket", choose: false, ticket: key, ruleId: null })}
              >
                Ignore all on this ticket
              </Button>
            ) : null}
            {ignoring.enabled && ignored > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                disabled={ignoring.busy}
                data-restore-ticket=""
                onClick={() => ignoring.askRestore(findings.filter((finding) => finding.state === "ignored"))}
              >
                {open === 0 ? "Restore all on this ticket" : "Restore ignored"}
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href={issueFindingsHref(key)} data-issue-findings-link="">
                All in Findings
                <ArrowUpRight aria-hidden strokeWidth={1.75} />
              </Link>
            </Button>
          </>
        ) : undefined
      }
    >
      <DataTable
        caption={key ? `Findings on ${key}` : "Findings"}
        data={findings}
        columns={COLUMNS}
        getRowId={(row) => row.finding_id}
        onRowOpen={(row) => router.push(findingHref(row.finding_id))}
        loading={!data}
        loadingRows={3}
        keyboardScope="page"
        minWidth="34rem"
        toolbar={
          data && findings.length > 0 ? (
            <>
              <span className="mono text-ink-mid">{formatCount(open, { locale })}</span> open,{" "}
              <span className="mono text-ink-mid">{formatCount(resolved, { locale })}</span> resolved
              {ignored > 0 ? (
                <>
                  , <span className="mono text-ink-mid">{formatCount(ignored, { locale })}</span> ignored
                </>
              ) : null}
            </>
          ) : undefined
        }
        empty={
          <EmptyState
            size="compact"
            title={`No findings on ${key ?? "this issue"}`}
            description={"Nothing flagged, open or resolved."}
          />
        }
      />
    </Section>
  );
}
