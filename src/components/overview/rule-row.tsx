"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { TooltipBody, type TooltipRow } from "@/components/charts/chart-tooltip";
import { STATUS_COLOURS } from "@/components/charts/palette";
import { SeverityMark } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { RuleSummary } from "@/lib/api/schemas";
import { formatCount, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";

import { missingEvidenceText } from "./copy";
import { ruleHref } from "./links";

/*
 * One rule on a line: its mark, id and title, a thin bar of its open findings
 * and the count. The kit's BarRow gives the name two fifths of the row, which
 * cuts rule titles short; this row gives the name the room and keeps the bar
 * as a compact column, with the kit's row classes, marks and tooltip body.
 * In a narrow container the bar drops under the name, as the kit's rows do,
 * and a title longer than its room wraps in balanced lines rather than being
 * cut: a phone has no hover for a tooltip (JO-14).
 */
const ROW = cn(
  "jo-bar-row pressable grid min-h-7 items-center gap-x-3 gap-y-1 rounded-[6px] px-2 py-1.5 outline-offset-[-2px] hover:bg-rail",
  "grid-cols-[minmax(0,1fr)_2.75rem_0.875rem] [grid-template-areas:'label_value_go'_'bar_bar_bar']",
  "@sm:grid-cols-[minmax(0,1fr)_minmax(2.5rem,18%)_2.75rem_0.875rem] @sm:gap-y-0 @sm:py-1 @sm:[grid-template-areas:'label_bar_value_go']",
);

/** "270 open breaches", "1 open warning". */
export function openNoun(rule: Pick<RuleSummary, "open" | "severity">): string {
  const one = rule.open === 1;
  return rule.severity === "breach" ? (one ? "open breach" : "open breaches") : one ? "open warning" : "open warnings";
}

export interface RuleRowProps {
  rule: RuleSummary;
  /** The open count a full-width bar stands for. */
  max: number;
  /** Every open finding, for the share in the tooltip. */
  totalOpen: number;
}

export function RuleRow({ rule, max, totalOpen }: RuleRowProps) {
  const locale = useFigureLocale();
  const count = formatCount(rule.open, { locale });
  const colour = STATUS_COLOURS[rule.severity];
  const missing = rule.measurable ? null : missingEvidenceText(rule.missing_evidence);

  const tooltipRows: TooltipRow[] = missing
    ? [{ id: "not-measurable", value: "Not measurable", name: missing, severity: "not-measurable" }]
    : [
        { id: "open", value: count, name: openNoun(rule), severity: rule.severity },
        ...(totalOpen > 0 ? [{ id: "share", value: formatShare(rule.open / totalOpen, { locale }), name: "of all open findings" }] : []),
      ];

  return (
    <Tooltip
      content={<TooltipBody heading={`${rule.rule_id} · ${rule.title}`} rows={tooltipRows} />}
      side="top"
      align="end"
      className="bg-transparent p-0 shadow-none"
    >
      <Link href={ruleHref(rule)} className={ROW}>
        <span className="flex min-w-0 items-center gap-2 [grid-area:label]">
          <SeverityMark severity={missing ? "not-measurable" : rule.severity} size={9} palette="chart" />
          <span className="mono min-w-[9ch] shrink-0 text-xs text-ink-low">{rule.rule_id}</span>
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-balance text-ink">{rule.title}</span>
            {missing ? <span className="text-xs text-balance text-ink-low">{missing}</span> : null}
          </span>
        </span>

        <span aria-hidden className="flex h-2.5 items-center [grid-area:bar]">
          {missing ? (
            <span className="hatch block h-full w-full rounded-[4px] border border-hatch-edge/60" />
          ) : rule.open > 0 ? (
            <span
              className="jo-bar-fill block h-full rounded-r-[4px]"
              style={{ width: `max(${max > 0 ? (rule.open / max) * 100 : 0}%, 3px)`, background: colour }}
            />
          ) : null}
        </span>

        <span className="mono text-right text-sm text-ink [grid-area:value]" data-figure>
          {missing ? (
            <>
              <span aria-hidden className="text-ink-low">
                —
              </span>
              <span className="sr-only">, not measurable</span>
            </>
          ) : (
            <>
              {count}
              <span className="sr-only"> {openNoun(rule)}</span>
            </>
          )}
        </span>

        <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="jo-row-affordance text-ink-low [grid-area:go]" />
      </Link>
    </Tooltip>
  );
}
