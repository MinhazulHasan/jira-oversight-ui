"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useState, type ReactNode } from "react";

import { usePeopleLevel } from "@/components/shell/people-level";
import { SeverityBadge, SeverityMark } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { KeyValueList, type KeyValueItem } from "@/components/ui/key-value";
import { Section } from "@/components/ui/section";
import { Sheet } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ProcessStage, Rule } from "@/lib/api/schemas";
import { formatCount, MISSING } from "@/lib/format";

import { findingsHref, KIND_LABEL, missingEvidenceText, OFF_ON_BOARD, openFindings, RULE_SETTINGS_HREF } from "./labels";

export function useOpenRule() {
  return useQueryState("rule", parseAsString.withOptions({ history: "push" }));
}

/** Another rule named inside the drawer: a link in the accent that opens it in place. */
function RuleLink({ rule, onOpen }: { rule: Pick<Rule, "rule_id" | "title">; onOpen: (ruleId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(rule.rule_id)}
      className="pressable -mx-1 inline-flex max-w-full items-baseline gap-2 rounded-xs px-1 py-0.5 hover:bg-hover"
    >
      <span className="mono shrink-0 text-cite">{rule.rule_id}</span>{" "}
      <span className="truncate text-ink">{rule.title}</span>
    </button>
  );
}

function OpenFindings({ rule }: { rule: Rule }) {
  const locale = useFigureLocale();
  const open = openFindings(rule);
  if (open === undefined) return <span className="text-ink-low">{rule.enabled ? "Not measured" : OFF_ON_BOARD}</span>;
  if (open === 0) return <span className="mono">{formatCount(0, { locale })}</span>;
  return (
    <Link href={findingsHref(rule.rule_id)} className="mono text-cite underline-offset-2 hover:underline">
      {formatCount(open, { locale })}
    </Link>
  );
}

function ruleFacts(rule: Rule, rules: readonly Rule[], onOpen: (ruleId: string) => void): KeyValueItem[] {
  const escalatesTo = rule.escalates_to ? rules.find((candidate) => candidate.rule_id === rule.escalates_to) : undefined;
  const foreshadowedBy = rules.filter((candidate) => candidate.escalates_to === rule.rule_id);
  const items: KeyValueItem[] = [
    { id: "kind", label: "Kind", value: KIND_LABEL[rule.kind] },
    // A rule an admin added to the board, by the check it runs.
    ...(rule.custom ? [{ id: "custom", label: "Custom rule", value: rule.check_label ?? "Yes" }] : []),
    // How this board runs it: on or off, and whether an admin changed its settings from the catalogue's.
    {
      id: "board",
      label: "On this board",
      value: rule.enabled ? (rule.customised ? "On, customised" : "On") : <span className="text-ink-low">Off</span>,
    },
    { id: "severity", label: "Severity", value: <SeverityBadge severity={rule.severity} size="sm" /> },
    {
      id: "threshold",
      label: "Threshold",
      value: rule.threshold ?? <span className="text-ink-low">None: any occurrence counts</span>,
    },
    { id: "open", label: "Open findings", value: <OpenFindings rule={rule} /> },
    { id: "version", label: "Version", value: rule.version, mono: true },
  ];
  if (rule.escalates_to) {
    items.push({
      id: "escalates",
      label: "Escalates to",
      value: <RuleLink rule={escalatesTo ?? { rule_id: rule.escalates_to, title: "" }} onOpen={onOpen} />,
    });
  }
  if (foreshadowedBy.length > 0) {
    items.push({
      id: "foreshadowed",
      label: "Foreshadowed by",
      value: (
        <span className="flex flex-col items-end">
          {foreshadowedBy.map((warning) => (
            <RuleLink key={warning.rule_id} rule={warning} onOpen={onOpen} />
          ))}
        </span>
      ),
    });
  }
  return items;
}

function RuleDetail({
  rule,
  rules,
  stages,
  onOpen,
}: {
  rule: Rule;
  rules: readonly Rule[];
  stages: readonly ProcessStage[];
  onOpen: (ruleId: string) => void;
}) {
  const missing = missingEvidenceText(rule, stages);
  return (
    <div className="flex flex-col gap-7">
      {!rule.measurable ? (
        <Callout
          tone="not-measurable"
          title={missing ? `Jira holds no ${missing} evidence` : "Jira holds no evidence for this rule"}
          action={
            <Button asChild size="sm">
              <Link href="/process#process-map">See the process map</Link>
            </Button>
          }
        >
          This rule cannot run until Jira records {missing || "what it needs"}.
        </Callout>
      ) : null}

      <Section title="How it is judged" headingLevel={3}>
        <KeyValueList items={ruleFacts(rule, rules, onOpen)} labelWidth="minmax(0,38%)" />
      </Section>

      <Section title="What it reads from Jira" count={rule.needs.length} headingLevel={3}>
        {rule.needs.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm text-ink">
            {rule.needs.map((need) => (
              <li key={need} className="flex items-center gap-2.5">
                <SeverityMark severity="neutral" size={8} />
                {need}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-low">{MISSING}</p>
        )}
      </Section>
    </div>
  );
}

function DrawerFooter({
  sequence,
  index,
  onOpen,
}: {
  sequence: readonly string[];
  index: number;
  onOpen: (ruleId: string) => void;
}) {
  const locale = useFigureLocale();
  const previous = index > 0 ? sequence[index - 1] : undefined;
  const next = index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : undefined;
  return (
    <>
      <Button size="sm" icon={ChevronLeft} disabled={!previous} onClick={() => previous && onOpen(previous)}>
        Previous
      </Button>
      <Button size="sm" iconEnd={ChevronRight} disabled={!next} onClick={() => next && onOpen(next)}>
        Next
      </Button>
      {index >= 0 ? (
        <span className="ml-auto text-xs text-ink-low">
          <span className="mono">{formatCount(index + 1, { locale })}</span> of{" "}
          <span className="mono">{formatCount(sequence.length, { locale })}</span> rules
        </span>
      ) : null}
    </>
  );
}

function FindingsAction({ rule }: { rule: Rule }): ReactNode {
  if (openFindings(rule) === undefined) {
    return (
      <Tooltip
        content={
          rule.enabled
            ? "Not measurable: this rule cannot run, so it has no findings"
            : `${OFF_ON_BOARD}: it does not run here, so it raises no findings`
        }
      >
        <Button variant="ghost" size="sm" iconEnd={ArrowUpRight} aria-disabled>
          View findings
        </Button>
      </Tooltip>
    );
  }
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={findingsHref(rule.rule_id)}>
        View findings
        <ArrowUpRight aria-hidden strokeWidth={1.75} />
      </Link>
    </Button>
  );
}

export interface RuleDrawerProps {
  rules: readonly Rule[];
  stages: readonly ProcessStage[];
  /** The rule ids in the order the catalogue shows them. */
  order: readonly string[];
  openId: string | null;
  onOpen: (ruleId: string | null) => void;
}

/** A rule in full: what it checks, how it is judged, what it reads from Jira. Open while the URL names it. */
export function RuleDrawer({ rules, stages, order, openId, onOpen }: RuleDrawerProps) {
  const admin = usePeopleLevel();
  const rule = openId ? (rules.find((candidate) => candidate.rule_id === openId) ?? null) : null;
  // Keep the last rule drawn while the drawer slides shut, rather than flash another.
  const [shown, setShown] = useState<Rule | null>(rule);
  if (rule !== null && rule !== shown) setShown(rule);
  const display = rule ?? shown;
  if (!display) return null;

  const sequence = order.length > 0 ? order : rules.map((candidate) => candidate.rule_id);
  const index = sequence.indexOf(display.rule_id);

  return (
    <Sheet
      open={rule !== null}
      onOpenChange={(open) => {
        if (!open) onOpen(null);
      }}
      width={520}
      eyebrow={
        <>
          <SeverityBadge severity={display.severity} size="sm" className="tracking-normal normal-case" />
          <span className="mono tracking-normal">{display.rule_id}</span>
          <span aria-hidden>·</span>
          <span>{KIND_LABEL[display.kind]}</span>
        </>
      }
      title={display.title}
      description={display.description || undefined}
      actions={
        <>
          {admin ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={RULE_SETTINGS_HREF}>
                <SlidersHorizontal aria-hidden strokeWidth={1.75} />
                Edit rule settings
              </Link>
            </Button>
          ) : null}
          <FindingsAction rule={display} />
        </>
      }
      footer={<DrawerFooter sequence={sequence} index={index} onOpen={onOpen} />}
    >
      <RuleDetail rule={display} rules={rules} stages={stages} onOpen={onOpen} />
    </Sheet>
  );
}
