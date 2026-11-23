"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
        // The rule and what it saw read whole: each wraps rather than being cut, at 390 px as at 1440 (JO-14).
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
    cell: (info) => {
      const finding = info.row.original;
      const open = finding.state === "open";
      return (
        <span className="flex min-w-0 flex-col gap-0.5 py-2">
          <StateDot
            tone={open || finding.resolved_why === "settings_changed" ? "neutral" : "ok"}
            label={open ? "Open" : finding.resolved_why === "settings_changed" ? "Closed:" : "Resolved"}
            className="text-ink-mid"
          />
          {/* Read whole: "superseded 12 Nov 2026" and "cleared 14. Nov. 2026" (de-DE) run past the column, so the
              date, kept whole, takes a second line rather than being cut (the JO-14 review). */}
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
    },
    meta: { width: "9.5rem", cellClassName: "whitespace-normal" },
  }),
]);

const LOADING: Finding[] = [];

/**
 * Every finding about the issue, open first: its severity, the rule and what
 * it saw, and since when. A row opens the finding's evidence on the Findings
 * page.
 */
export function IssueFindings({ data }: { data: IssueData | null }) {
  const router = useRouter();
  const locale = useFigureLocale();
  const findings = data?.findings ?? LOADING;
  const key = data?.issue.key;
  const open = findings.filter((finding) => finding.state === "open").length;

  return (
    <Section
      title="Findings"
      id="findings"
      count={data ? formatCount(findings.length, { locale }) : undefined}
      actions={
        key && findings.length > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={issueFindingsHref(key)}>
              All in Findings
              <ArrowUpRight aria-hidden strokeWidth={1.75} />
            </Link>
          </Button>
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
              <span className="mono text-ink-mid">{formatCount(findings.length - open, { locale })}</span> resolved
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
