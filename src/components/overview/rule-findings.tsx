"use client";

import { categoryCell } from "@/components/charts/bar-list";
import { ChartFrame } from "@/components/charts/chart-frame";
import type { ChartTableData } from "@/components/charts/chart-table";
import { Legend } from "@/components/charts/legend";
import { SEVERITY_LABEL } from "@/components/ui/badge";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Overview, RuleSummary } from "@/lib/api/schemas";
import { formatCount, MISSING } from "@/lib/format";

import { counted, listWords, missingEvidenceText } from "./copy";
import { PROCESS_HREF } from "./links";
import { RuleRow } from "./rule-row";
import { SectionLink } from "./section-link";

/** Row heights (px): one line, or two when the row names what Jira lacks. */
const ROW_HEIGHT = 28;
const TWO_LINE_ROW_HEIGHT = 44;
/** The catalogue's size today, held while loading so nothing moves: ten measurable rules and two that are not. */
const LOADING_HEIGHT = 10 * ROW_HEIGHT + 2 * TWO_LINE_ROW_HEIGHT;

const LEGEND = [
  { id: "breach", label: "Breach", severity: "breach" as const },
  { id: "warning", label: "Warning", severity: "warning" as const },
  { id: "not-measurable", label: "Not measurable", hatch: true },
];

/**
 * Most open findings first (ties keep catalogue order), then the rules Jira
 * cannot evaluate, in catalogue order: they have no count to rank by.
 */
export function rankRules(rules: readonly RuleSummary[]): RuleSummary[] {
  const measurable = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.measurable)
    .sort((a, b) => b.rule.open - a.rule.open || a.index - b.index)
    .map(({ rule }) => rule);
  return [...measurable, ...rules.filter((rule) => !rule.measurable)];
}

function ruleTable(rules: readonly RuleSummary[], locale: string | undefined): ChartTableData {
  return {
    columns: [{ header: "Rule" }, { header: "Severity" }, { header: "Open", numeric: true }, { header: "Evidence" }],
    rows: rules.map((rule) => [
      categoryCell({ meta: rule.rule_id, label: rule.title }),
      SEVERITY_LABEL[rule.severity],
      rule.measurable ? formatCount(rule.open, { locale }) : MISSING,
      rule.measurable ? "In Jira" : missingEvidenceText(rule.missing_evidence),
    ]),
  };
}

function summarise(rules: readonly RuleSummary[], locale: string | undefined): string {
  const lead = rules.find((rule) => rule.measurable && rule.open > 0);
  const gaps = rules.filter((rule) => !rule.measurable);
  const first = lead
    ? `${lead.rule_id} ${lead.title} has the most open findings, ${formatCount(lead.open, { locale })}.`
    : "No rule has an open finding.";
  if (gaps.length === 0) return first;
  return `${first} ${counted(gaps.length, "rule cannot", "rules cannot", locale)} be measured in Jira: ${listWords(gaps.map((rule) => rule.rule_id))}.`;
}

/**
 * Which rules fire: every rule in the catalogue with its open findings, as a
 * compact ranked list. A rule Jira cannot evaluate shows the hatch and names
 * the evidence it lacks rather than a misleading zero.
 */
export function RuleFindings({ data, className }: { data?: Overview; className?: string }) {
  const locale = useFigureLocale();
  const rules = data ? rankRules(data.by_rule) : [];
  const state = !data ? "loading" : rules.length === 0 ? "empty" : "ready";
  const max = Math.max(0, ...rules.map((rule) => (rule.measurable ? rule.open : 0)));
  const totalOpen = rules.reduce((sum, rule) => sum + (rule.measurable ? rule.open : 0), 0);
  const gaps = rules.filter((rule) => !rule.measurable).length;
  const height =
    state === "loading"
      ? LOADING_HEIGHT
      : state === "empty"
        ? 3 * TWO_LINE_ROW_HEIGHT
        : rules.reduce((sum, rule) => sum + (rule.measurable ? ROW_HEIGHT : TWO_LINE_ROW_HEIGHT), 0);

  return (
    <Section id="findings-by-rule" title="Findings by rule" actions={<SectionLink href={PROCESS_HREF}>All rules</SectionLink>} className={className}>
      <ChartFrame
        title="Open findings by rule"
        description={
          state === "ready"
            ? `${counted(rules.length, "rule", "rules", locale)}, most findings first${gaps > 0 ? `; ${formatCount(gaps, { locale })} cannot be measured` : ""}`
            : "Most findings first"
        }
        summary={state === "ready" ? summarise(rules, locale) : state === "empty" ? "No rules yet." : "Loading the findings by rule."}
        legend={<Legend items={gaps > 0 ? LEGEND : LEGEND.slice(0, 2)} />}
        table={state === "ready" ? ruleTable(rules, locale) : undefined}
        state={state}
        loadingShape="bars"
        height={height}
        emptyTitle="No rules in the catalogue"
        emptyDescription={data ? undefined : undefined}
      >
        <ul aria-label="Open findings by rule" className="@container flex flex-col">
          {rules.map((rule) => (
            <li key={rule.rule_id}>
              <RuleRow rule={rule} max={max} totalOpen={totalOpen} />
            </li>
          ))}
        </ul>
      </ChartFrame>
    </Section>
  );
}
