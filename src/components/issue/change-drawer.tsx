"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { STAGE_LABELS } from "@/components/charts/palette";
import { SeverityBadge, StateDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { KeyValueList, type KeyValueItem } from "@/components/ui/key-value";
import { Section } from "@/components/ui/section";
import { Sheet } from "@/components/ui/sheet";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount, formatHours } from "@/lib/format";

import { fieldLabel, findingHref, ms, reopenChanges, spellBefore, type ChangeRow, type IssueData } from "./model";

const HOUR = 3_600_000;
const ESTIMATE_FIELDS = new Set(["story_points", "original_estimate"]);

/** A changed value; an empty one reads "None". */
export function ChangeValue({ value }: { value: string | null }) {
  return value === null || value === "" ? <span className="text-ink-low">None</span> : <span>{value}</span>;
}

function changeTitle(row: ChangeRow): string {
  if (row.kind === "status") return `${row.from ?? "None"} → ${row.to ?? "None"}`;
  const name = fieldLabel(row.field);
  if (row.from === null || row.from === "") return `${name} set to ${row.to ?? "None"}`;
  if (row.to === null || row.to === "") return `${name} cleared`;
  return `${name}: ${row.from} → ${row.to}`;
}

export interface ChangeDrawerProps {
  data: IssueData;
  /** The changelog rows, oldest first. */
  rows: readonly ChangeRow[];
  openId: string | null;
  onOpenChange: (changelogId: string | null) => void;
}

/**
 * One changelog entry in full: what changed and when, what it meant for the
 * issue (the time spent in the status it left, a reopen, a skipped stage, an
 * estimate set after work began), and the findings that cite it.
 */
export function ChangeDrawer({ data, rows, openId, onOpenChange }: ChangeDrawerProps) {
  const locale = useFigureLocale();
  const ids = [...new Set(rows.map((row) => row.changelog_id))];
  const index = openId ? ids.indexOf(openId) : -1;
  const current = index >= 0 ? ids[index] : null;
  // Keep the last entry drawn while the drawer animates shut.
  const [lastShown, setLastShown] = useState<string | null>(null);
  if (current !== null && current !== lastShown) setLastShown(current);
  const shownId = current ?? lastShown;
  const entry = rows.filter((row) => row.changelog_id === shownId);
  const first = entry[0];
  if (!first) return null;

  const { issue } = data;
  const hours = (value: number) => formatHours(value, { locale });
  const cited = [...new Map(entry.flatMap((row) => row.cited).map((finding) => [finding.finding_id, finding])).values()];
  const reopened = reopenChanges(data).some((change) => change.changelog_id === first.changelog_id);
  const skip = data.skipped.find((candidate) => candidate.changelog_id === first.changelog_id);

  const context: KeyValueItem[] = [];
  for (const row of entry) {
    const spell = spellBefore(data, row);
    if (spell) {
      const spent = spell.hours ?? (ms(row.changed_at) - ms(spell.entered_at)) / HOUR;
      context.push({ id: `spell-${row.rowId}`, label: `Time in ${spell.status} before`, value: hours(spent), mono: true });
    }
    if (ESTIMATE_FIELDS.has(row.field) && issue.started_at) {
      const gap = (ms(row.changed_at) - ms(issue.started_at)) / HOUR;
      context.push({
        id: `start-${row.rowId}`,
        label: gap > 0 ? "After work began" : gap < 0 ? "Before work began" : "As work began",
        value: hours(Math.abs(gap)),
        mono: true,
        highlight: gap > 0,
      });
    }
  }
  if (reopened) context.push({ id: "reopen", label: "Reopened", value: "Left Done for work again", highlight: true });
  if (skip) {
    context.push({
      id: "skip",
      label: "Stages skipped",
      value: skip.skipped.map((stage) => STAGE_LABELS[stage]).join(", "),
      highlight: true,
    });
  }
  context.push({
    id: "age",
    label: "Since the issue was created",
    value: hours(Math.max(0, (ms(first.changed_at) - ms(issue.created_at)) / HOUR)),
    mono: true,
  });

  const changed: KeyValueItem[] = [
    { id: "when", label: "When", value: <Timestamp value={first.changed_at} mode="datetime" /> },
    ...entry.map((row) => ({
      id: row.rowId,
      label: row.kind === "status" ? "Status" : fieldLabel(row.field),
      value: (
        <>
          <ChangeValue value={row.from} /> <span className="text-ink-low">→</span> <ChangeValue value={row.to} />
        </>
      ),
      highlight: row.cited.length > 0,
    })),
    { id: "kind", label: "Kind", value: entry.some((row) => row.kind === "status") ? "Status change" : "Field change" },
    { id: "id", label: "Changelog id", value: first.changelog_id, mono: true },
  ];

  const move = (to: number) => onOpenChange(ids[to] ?? null);

  return (
    <Sheet
      open={index >= 0}
      onOpenChange={(open) => {
        if (!open) onOpenChange(null);
      }}
      eyebrow={
        <>
          Changelog <span className="mono tracking-normal">{first.changelog_id}</span>
        </>
      }
      title={entry.length > 1 ? `${changeTitle(first)}, and ${entry.length - 1} more` : changeTitle(first)}
      description={`${issue.key} · ${issue.summary}`}
      actions={<CopyButton value={first.changelog_id} what="changelog id" iconOnly />}
      footer={
        <>
          <Button size="sm" icon={ChevronLeft} disabled={index <= 0} onClick={() => move(index - 1)}>
            Earlier
          </Button>
          <Button size="sm" iconEnd={ChevronRight} disabled={index < 0 || index >= ids.length - 1} onClick={() => move(index + 1)}>
            Later
          </Button>
          <span className="ml-auto text-xs text-ink-low">
            <span className="mono">{formatCount(Math.max(0, index) + 1, { locale })}</span> of{" "}
            <span className="mono">{formatCount(ids.length, { locale })}</span> entries
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <Section title="What changed" headingLevel={3}>
          <KeyValueList items={changed} labelWidth="minmax(0,40%)" />
        </Section>
        <Section title="In context" headingLevel={3}>
          <KeyValueList items={context} labelWidth="minmax(0,52%)" />
        </Section>
        <Section title="Cited by" count={formatCount(cited.length, { locale })} headingLevel={3}>
          {cited.length === 0 ? (
            <p className="text-sm text-ink-mid">
              No finding cites this entry: it is part of the issue&apos;s record, not evidence for a rule.
            </p>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-md border border-rule-weak">
              {cited.map((finding) => (
                <li key={finding.finding_id} className="border-t border-rule-weak first:border-t-0">
                  <Link
                    href={findingHref(finding.finding_id)}
                    className="group pressable flex items-center gap-3 px-3 py-2.5 outline-offset-[-2px] hover:bg-rail"
                  >
                    <SeverityBadge severity={finding.severity} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-ink">
                        <span className="mono text-xs text-ink-low">{finding.rule_id}</span> {finding.rule_title}
                      </span>
                      <span className="truncate text-xs text-ink-mid">{finding.message}</span>
                    </span>
                    <StateDot
                      tone={finding.state === "open" ? "neutral" : "ok"}
                      label={finding.state === "open" ? "Open" : "Resolved"}
                      className="shrink-0 text-xs text-ink-mid"
                    />
                    <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Sheet>
  );
}
