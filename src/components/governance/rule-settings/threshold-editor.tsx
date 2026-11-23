"use client";

import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { NumberField } from "@/components/ui/number-field";
import { useFigureLocale } from "@/components/ui/use-figures";
import { listWords } from "@/lib/api/custom-rules";
import type { RuleCheck, RuleSettingsNumberParam, RuleSettingsRule } from "@/lib/api/schemas";

import { appliesOf, appliesWords, choiceWords, fieldBounds, fieldId, fieldPath, fieldValue, numberParams, paramWords, settingsWords, type DraftRule } from "./model";

/** How a value is read out with its field: "1.5 times the estimate", "90 percent", "30 percent". */
function valueText(param: RuleSettingsNumberParam, text: string): string | undefined {
  const value = fieldValue(param, text);
  if (value === null) return undefined;
  switch (param.unit) {
    case "ratio":
      return `${value} times the estimate`;
    case "hours":
      return `${value} ${value === 1 ? "hour" : "hours"}`;
    case "percentile":
      return `${value} percent`;
    case "days":
      return `${value} ${value === 1 ? "day" : "days"}`;
    case "share":
      return `${text.trim()} percent`;
  }
}

/** What a field draws around its figure: its unit after it ("%" for a percentile, read in its sentence). */
function unitMarks(param: RuleSettingsNumberParam, text: string): { prefix?: string; suffix?: string } {
  switch (param.unit) {
    case "ratio":
      return { suffix: "×" };
    case "hours":
      return { suffix: "h" };
    case "percentile":
      return { suffix: "%" };
    case "days":
      return { suffix: fieldValue(param, text) === 1 ? "day" : "days" };
    case "share":
      return { suffix: "%" };
  }
}

export interface ThresholdEditorProps {
  rule: RuleSettingsRule;
  draft: DraftRule;
  /** The id of the rule's title: each field is named by it and its threshold. */
  titleId: string;
  problems: ReadonlyMap<string, string>;
  onChange: (name: string, text: string) => void;
  onBlur: (name: string) => void;
  /** A custom rule's check, as the board offers it (JO-20): the words of its choices. */
  check?: RuleCheck;
  /** Read only: a rule marked for deletion, whose fields are no longer the draft's to change. */
  readOnly?: boolean;
}

/**
 * A rule's thresholds, in the sentence its check reads as ("Flag when effort
 * ≥ [1.5] × the estimate", "≤ [2] days left and > [30]% not started"), each
 * figure a field with its bounds and step; under it the catalogue's default,
 * or what is wrong in its place (one line, so a message moves nothing). A
 * custom rule (JO-20) reads as its own check's sentence, with the board's
 * names it was given ("Stays in “In Progress” for over [72] h"), and under it
 * what it looks at ("Bug · In progress"), having no catalogue default.
 */
export function ThresholdEditor({ rule, draft, titleId, problems, onChange, onBlur, check, readOnly = false }: ThresholdEditorProps) {
  const locale = useFigureLocale();
  // One line under the sentence: the default (a custom rule: what it looks at), or what is wrong in its place.
  const noteId = `${titleId}-note`;
  const numbers = numberParams(rule);
  const problem = numbers.map((param) => problems.get(fieldPath(rule.rule_id, `params.${param.name}`))).find(Boolean) ?? null;
  const custom = rule.custom ? draft.custom : undefined;

  if (!custom && numbers.length === 0) {
    return (
      <p className="flex min-h-7 items-center text-xs text-ink-low">
        No threshold: any occurrence counts.
      </p>
    );
  }

  const field = (name: string): ReactNode => {
    const param = numbers.find((candidate) => candidate.name === name);
    if (!param) return null;
    const text = draft.params[name] ?? "";
    if (readOnly) {
      const value = fieldValue(param, text);
      return <span className="mono text-ink">{value === null ? text : paramWords(param, value, locale)}</span>;
    }
    const path = fieldPath(rule.rule_id, `params.${name}`);
    const labelId = `${titleId}-${name}`;
    return (
      <>
        <span id={labelId} className="sr-only">
          {param.label}
        </span>
        <NumberField
          id={fieldId(path)}
          value={text}
          onValueChange={(next) => onChange(name, next)}
          onBlur={() => onBlur(name)}
          {...fieldBounds(param)}
          {...unitMarks(param, text)}
          labelledBy={`${titleId} ${labelId}`}
          describedBy={noteId}
          valueText={valueText(param, text)}
          invalid={problems.has(path)}
          width={param.unit === "ratio" || param.unit === "hours" ? "2.75rem" : "2rem"}
        />
      </>
    );
  };

  /** A custom rule's choice in words: its statuses quoted, a stage or an evidence name by its label. */
  const choice = (name: string): string => {
    const value = custom?.choices[name];
    if (Array.isArray(value)) return listWords(value.map((status: string) => `“${status}”`), "or");
    return choiceWords(rule.params.find((param) => param.name === name), value).toLowerCase();
  };

  const sentence = (() => {
    switch (rule.check) {
      case "effort_ratio_at_least":
        return (
          <>
            {rule.kind === "warning" ? "Warn" : "Flag"} when effort ≥ {field("threshold")} the estimate
          </>
        );
      case "estimate_after_start":
        return <>Grace of {field("grace_hours")} after work starts</>;
      // In plain words (SQA): "p90 of the board's closed time" read as jargon.
      case "stuck_in_status":
        return <>Longer in the status than {field("pct")} of finished work</>;
      case "no_evidence_after_percentile":
        return custom ? <>Longer in {choice("stage")} than {field("pct")} of finished work</> : <>Longer in the stage than {field("pct")} of finished work</>;
      case "sprint_at_risk":
        return (
          <>
            ≤ {field("days_left")} left and &gt; {field("not_started_share")} not started
          </>
        );
      case "time_in_status_over":
        return (
          <>
            Stays in {choice("statuses")} for over {field("hours")}
          </>
        );
      case "open_longer_than":
        return <>Open for over {field("days")}</>;
      case "no_update_for":
        return <>No change in Jira for {field("days")}</>;
      default:
        if (custom && numbers.length === 0) {
          const params = { ...custom.choices } as Record<string, string | string[]>;
          return <span className="text-ink-mid">{settingsWords(rule.check, params, check, locale) || "Any occurrence counts"}</span>;
        }
        return numbers.map((param) => (
          <span key={param.name} className="inline-flex items-center gap-1.5">
            {param.label} {field(param.name)}
          </span>
        ));
    }
  })();

  const note = custom
    ? appliesWords(appliesOf(custom), rule.scope)
    : (
        <>
          Default <span className="mono">{numbers.map((param) => paramWords(param, param.default, locale)).join(", ")}</span>
        </>
      );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex min-h-7 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-mid">{sentence}</p>
      <p id={noteId} aria-live="polite" className={problem ? "flex items-start gap-1.5 text-xs text-breach-ink" : "text-xs text-ink-low"} data-threshold-note="">
        {problem ? (
          <>
            <CircleAlert aria-hidden size={13} strokeWidth={2} className="mt-px shrink-0" />
            {problem}
          </>
        ) : (
          note
        )}
      </p>
    </div>
  );
}
