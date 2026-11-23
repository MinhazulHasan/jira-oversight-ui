"use client";

import { ChevronDown, CircleAlert, Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { inSentence, joinWords, stageLabel } from "@/components/process/labels";
import { Badge, SeverityBadge, SeverityMark } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ParamValue, RuleCheck, RuleSettingsRule, Severity } from "@/lib/api/schemas";
import { formatCount, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

import { appliesOf, appliesWords, atDefaults, defaultsOf, fieldId, fieldPath, fieldValue, settingsWords, type DraftRule, type NewRule } from "./model";
import { ThresholdEditor } from "./threshold-editor";

const SEVERITY_OPTIONS = [
  { value: "breach", label: "Breach" },
  { value: "warning", label: "Warning" },
] as const;

/** The head row over a list of rules: the columns' names, where the list is wide enough to set them in a line. */
export function RuleListHead() {
  return (
    <div aria-hidden className="jo-rule-head border-b border-rule-weak px-4 pb-2">
      {[
        ["rule", "Rule"],
        ["state", "On this board"],
        ["severity", "Reported as"],
        ["threshold", "Threshold"],
        ["open", "Open"],
      ].map(([area, label]) => (
        <span key={area} className={cn("micro text-ink-low", area === "open" && "text-right")} style={{ gridArea: area }}>
          {label}
        </span>
      ))}
    </div>
  );
}

/** A small text button under a rule's title: "What it checks", "Reset to default", and a custom rule's Edit and Delete. */
function RowAction({ onClick, icon, children, label, ...data }: { onClick: () => void; icon?: ReactNode; children: ReactNode; label: string } & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable -mx-1 inline-flex min-h-6 items-center gap-1 rounded-xs px-1 text-xs text-ink-low hover:text-ink"
      {...data}
    >
      {icon}
      {children}
      <span className="sr-only"> ({label})</span>
    </button>
  );
}

/** What a custom rule's row offers (JO-20): edit it in the sheet, mark it for deletion, or take either back. */
export interface CustomRowActions {
  onEdit: (from: HTMLElement) => void;
  onDelete: () => void;
  /** Takes a deletion back: the rule stays. */
  onKeep: () => void;
}

export interface RuleRowProps {
  /** The rule as the board runs it now (the latest saved settings). */
  rule: RuleSettingsRule;
  /** What the page shows: the draft while editing, else the saved settings. */
  draft: DraftRule;
  /** Whether the draft changes any of the rule's fields. */
  edited: boolean;
  /** What is wrong, by the field's place ("R-EFF-01.params.threshold", "R-EFF-01" for the rule as a whole). */
  problems: ReadonlyMap<string, string>;
  onChange: (next: DraftRule) => void;
  onParamBlur: (name: string) => void;
  /** A custom rule's check as the board offers it, and its row's actions (JO-20). */
  check?: RuleCheck;
  custom?: CustomRowActions;
  /** Marked for deletion in the draft (JO-20): read only until the deletion is taken back. */
  deleted?: boolean;
}

/** The rule's badges beside its id: "Custom" for a board's own rule, "Customised" for a catalogue rule it changed. */
function RuleMarks({ rule, edited, deleted }: { rule: RuleSettingsRule; edited: boolean; deleted: boolean }) {
  return (
    <>
      {/* As the Process page marks it (rule-catalogue.tsx): a plain fact about the rule, in the neutral badge. */}
      {rule.custom ? (
        <Badge size="sm" data-custom-badge="">
          Custom
        </Badge>
      ) : rule.customised ? (
        <Badge size="sm">Customised</Badge>
      ) : null}{" "}
      {deleted ? (
        <span className="inline-flex items-center gap-1.5 text-ink-mid" data-marked="deleted">
          <Trash2 aria-hidden size={12} strokeWidth={1.75} />
          Deleted when you save
        </span>
      ) : edited ? (
        <span className="inline-flex items-center gap-1.5 text-ink-mid">
          <span aria-hidden className="size-1.5 rounded-full bg-ink-mid" />
          Edited
        </span>
      ) : null}
    </>
  );
}

/**
 * One rule: its id and title (what it checks, on demand), on or off on this
 * board, the severity its findings are reported as, its thresholds as a
 * sentence with their fields, and its open findings; "Reset to default" while
 * it differs from the catalogue. A rule Jira cannot feed on this board says so
 * and stays editable: its settings apply the day it can run. A custom rule
 * (JO-20) has the same controls, its check's label, and Edit and Delete; one
 * marked for deletion reads struck through, its controls held, with Keep.
 */
export function RuleRow({ rule, draft, edited, problems, onChange, onParamBlur, check, custom, deleted = false }: RuleRowProps) {
  const locale = useFigureLocale();
  const [open, setOpen] = useState(false);
  const titleId = `rule-${rule.rule_id}`;
  const stateId = `${titleId}-state`;
  const descriptionId = `${titleId}-description`;
  // The switch stands for the rule: what a refusal of the rule as a whole puts right, and where Reset leaves the focus.
  const switchId = fieldId(fieldPath(rule.rule_id, "enabled"));
  // What is wrong with the rule as a whole, its switch or its severity: everything said of it but its thresholds,
  // which their own fields say.
  const thresholds = new Set(rule.params.map((param) => fieldPath(rule.rule_id, `params.${param.name}`)));
  const ruleProblems = [
    ...new Set(
      [...problems]
        .filter(([path]) => (path === rule.rule_id || path.startsWith(`${rule.rule_id}.`)) && !thresholds.has(path))
        .map(([, message]) => message),
    ),
  ];
  const missing = joinWords(rule.missing_evidence.map((key) => inSentence(stageLabel(key))));
  const title = draft.custom?.title ?? rule.title;
  // A custom rule says what it checks in its admin's words, else in its check's.
  const description = rule.custom ? draft.custom?.description || check?.summary || rule.description : rule.description;

  return (
    <li
      className="jo-rule-row px-4 py-3.5"
      data-rule={rule.rule_id}
      data-edited={edited || undefined}
      data-enabled={draft.enabled}
      data-custom={rule.custom || undefined}
      data-deleted={deleted || undefined}
    >
      <div className="min-w-0" style={{ gridArea: "rule" }}>
        {/* As tall as a badge whatever it holds, so "Customised" or "Edited" appearing moves nothing. */}
        <p className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-low">
          <span className="mono">{rule.rule_id}</span>{" "}
          <RuleMarks rule={rule} edited={edited} deleted={deleted} />
        </p>
        <h3
          id={titleId}
          className={cn(
            "mt-0.5 text-sm font-medium text-pretty",
            deleted ? "text-ink-low line-through decoration-rule-strong" : draft.enabled ? "text-ink" : "text-ink-mid",
          )}
        >
          {title}
        </h3>
        {rule.custom ? <p className="text-xs text-ink-low">{rule.check_label}</p> : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={descriptionId}
            onClick={() => setOpen((value) => !value)}
            className="pressable -mx-1 inline-flex min-h-6 items-center gap-1 rounded-xs px-1 text-xs text-ink-low hover:text-ink"
          >
            What it checks
            <ChevronDown aria-hidden size={13} strokeWidth={1.75} className={cn("transition-transform", open && "rotate-180")} />
            <span className="sr-only"> ({rule.rule_id})</span>
          </button>
          {!deleted && !atDefaults(rule, draft) ? (
            <RowAction
              label={rule.rule_id}
              icon={<RotateCcw aria-hidden size={12} strokeWidth={1.75} />}
              onClick={() => {
                // The button goes with the reset: the rule's switch, the next control along, takes the focus first.
                document.getElementById(switchId)?.focus();
                onChange(defaultsOf(rule));
              }}
            >
              Reset to default
            </RowAction>
          ) : null}
          {custom && !deleted ? (
            <>
              <button
                type="button"
                onClick={(event) => custom.onEdit(event.currentTarget)}
                className="pressable -mx-1 inline-flex min-h-6 items-center gap-1 rounded-xs px-1 text-xs text-ink-low hover:text-ink"
                data-edit-rule={rule.rule_id}
              >
                <Pencil aria-hidden size={12} strokeWidth={1.75} />
                Edit
                <span className="sr-only"> ({rule.rule_id})</span>
              </button>
              <RowAction label={rule.rule_id} icon={<Trash2 aria-hidden size={12} strokeWidth={1.75} />} onClick={custom.onDelete} data-delete-rule={rule.rule_id}>
                Delete
              </RowAction>
            </>
          ) : null}
          {custom && deleted ? (
            <RowAction label={rule.rule_id} icon={<Undo2 aria-hidden size={12} strokeWidth={1.75} />} onClick={custom.onKeep} data-keep-rule={rule.rule_id}>
              Keep
            </RowAction>
          ) : null}
        </div>
        <p id={descriptionId} hidden={!open} className="mt-1.5 max-w-[60ch] text-xs text-pretty text-ink-mid">
          {description}
        </p>
        {!rule.measurable ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-low">
            <span className="flex h-[1lh] items-center">
              <SeverityMark severity="not-measurable" size={10} />
            </span>
            <span>
              Not measurable on this board{missing ? `: Jira holds no ${missing} evidence` : ""}. Its settings apply once it can run.
            </span>
          </p>
        ) : null}
        {ruleProblems.map((problem) => (
          <p key={problem} className="mt-1.5 flex items-start gap-1.5 text-xs text-breach-ink" data-rule-problem="">
            <CircleAlert aria-hidden size={13} strokeWidth={2} className="mt-px shrink-0" />
            {problem}
          </p>
        ))}
      </div>

      <div className="flex h-7 items-center gap-2" style={{ gridArea: "state" }}>
        <span id={stateId} className="sr-only">
          On this board
        </span>
        <Switch
          id={switchId}
          checked={draft.enabled}
          onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
          labelledBy={`${titleId} ${stateId}`}
          disabled={deleted}
        />
        <span aria-hidden className={cn("w-6 text-xs", draft.enabled && !deleted ? "text-ink" : "text-ink-low")}>
          {draft.enabled ? "On" : "Off"}
        </span>
      </div>

      <div className="flex h-7 items-center" style={{ gridArea: "severity" }}>
        {deleted ? (
          <SeverityBadge severity={draft.severity} size="sm" />
        ) : (
          <SegmentedControl<Severity>
            label={`${title}: reported as`}
            size="sm"
            options={SEVERITY_OPTIONS}
            value={draft.severity}
            onValueChange={(severity) => onChange({ ...draft, severity })}
          />
        )}
      </div>

      <div className="min-w-0" style={{ gridArea: "threshold" }}>
        <ThresholdEditor
          rule={rule}
          draft={draft}
          titleId={titleId}
          problems={problems}
          check={check}
          readOnly={deleted}
          onChange={(name, text) => onChange({ ...draft, params: { ...draft.params, [name]: text } })}
          onBlur={onParamBlur}
        />
      </div>

      <div className="flex h-7 items-center justify-end text-sm" style={{ gridArea: "open" }}>
        <OpenFindings rule={rule} locale={locale} />
      </div>
    </li>
  );
}

export interface NewRuleRowProps {
  item: NewRule;
  /** Its check as the board offers it: its label, and the words of its choices. */
  check: RuleCheck | undefined;
  onEdit: (from: HTMLElement) => void;
  /** Takes the new rule out of the draft: it is never added. */
  onDiscard: () => void;
}

/**
 * A rule added in the draft and not saved yet (JO-20), marked "New": it reads
 * as it will be added (its settings, what it looks at, how serious it is, on),
 * with Edit (the sheet) and Discard; it has no id or findings until the save.
 */
export function NewRuleRow({ item, check, onEdit, onDiscard }: NewRuleRowProps) {
  const locale = useFigureLocale();
  const { custom } = item.rule;
  const titleId = `rule-${item.key}`;
  const params: Record<string, ParamValue> = { ...(custom.choices as Record<string, string | string[]>) };
  for (const param of check?.params ?? []) {
    if (param.kind !== "number") continue;
    const value = fieldValue({ unit: param.unit }, item.rule.params[param.name]);
    if (value !== null) params[param.name] = value;
  }
  const settings = settingsWords(custom.check, params, check, locale);
  return (
    <li className="jo-rule-row px-4 py-3.5" data-new-rule={item.key} aria-labelledby={titleId}>
      <div className="min-w-0" style={{ gridArea: "rule" }}>
        {/* Marked as the draft marks an edit ("Edited"): a dot and the word, in the quiet ink. */}
        <p className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-low">
          <Badge size="sm">Custom</Badge>{" "}
          <span className="inline-flex items-center gap-1.5 text-ink-mid" data-marked="new">
            <span aria-hidden className="size-1.5 rounded-full bg-ink-mid" />
            New
          </span>
        </p>
        <h3 id={titleId} className="mt-0.5 text-sm font-medium text-pretty text-ink">
          {custom.title}
        </h3>
        <p className="text-xs text-ink-low">{check?.label ?? custom.check}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          <button
            type="button"
            onClick={(event) => onEdit(event.currentTarget)}
            className="pressable -mx-1 inline-flex min-h-6 items-center gap-1 rounded-xs px-1 text-xs text-ink-low hover:text-ink"
            data-edit-new={item.key}
          >
            <Pencil aria-hidden size={12} strokeWidth={1.75} />
            Edit
            <span className="sr-only"> (new rule {custom.title})</span>
          </button>
          <RowAction label={`new rule ${custom.title}`} icon={<Undo2 aria-hidden size={12} strokeWidth={1.75} />} onClick={onDiscard} data-discard-new={item.key}>
            Discard
          </RowAction>
        </div>
      </div>
      <div className="flex h-7 items-center text-xs text-ink" style={{ gridArea: "state" }}>
        On<span className="sr-only"> once saved</span>
      </div>
      <div className="flex h-7 items-center" style={{ gridArea: "severity" }}>
        <SeverityBadge severity={item.rule.severity} size="sm" />
      </div>
      <div className="flex min-w-0 flex-col gap-1" style={{ gridArea: "threshold" }}>
        <p className="flex min-h-7 items-center text-sm text-ink-mid">{settings || "Any occurrence counts"}</p>
        <p className="text-xs text-ink-low">{appliesWords(appliesOf(custom), check?.scope)}</p>
      </div>
      <div className="flex h-7 items-center justify-end text-sm" style={{ gridArea: "open" }}>
        <span className="text-ink-low">
          {MISSING}
          <span className="sr-only">: not added yet</span>
        </span>
      </div>
    </li>
  );
}

/** Its open findings on the board, leading to them; a dash for a rule that cannot run (it never looked). */
export function OpenFindings({ rule, locale }: { rule: RuleSettingsRule; locale: string | undefined }) {
  if (!rule.measurable) {
    return (
      <span className="text-ink-low">
        {MISSING}
        <span className="sr-only">: {rule.rule_id} is not measured</span>
      </span>
    );
  }
  const figure = formatCount(rule.open, { locale });
  if (rule.open === 0) {
    return (
      <span className="mono text-ink-low">
        {figure}
        <span className="sr-only"> open findings for {rule.rule_id}</span>
      </span>
    );
  }
  return (
    <Link
      href={`/findings?rule=${encodeURIComponent(rule.rule_id)}`}
      aria-label={`${figure} open findings for ${rule.rule_id}`}
      className="mono text-cite underline-offset-2 hover:underline"
    >
      {figure}
    </Link>
  );
}
