"use client";

import { ArrowRight, ArrowUpRight, RotateCcw } from "lucide-react";
import { useId, useRef } from "react";

import { useAriaShortcut } from "@/components/shell/kbd";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ApiError } from "@/lib/api/hooks";
import {
  RULE_SETTINGS_EXAMPLES_MAX,
  RULE_SETTINGS_REASON_MAX,
  type ParamValue,
  type RuleCheck,
  type RuleSettingsImpact,
  type RuleSettingsPreview,
  type RuleSettingsRule,
  type Severity,
} from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  appliesOf,
  appliesWords,
  changeCount,
  changesWord,
  fieldValue,
  fieldWords,
  NO_EXTRAS,
  placeWords,
  settingsWords,
  SEVERITY_WORDS,
  type Draft,
  type DraftExtras,
  type FieldEdit,
  type NewRule,
} from "./model";

/** The preview as the dialog shows it: waiting, failed (with a way to try again), or what it found. */
export interface PreviewState {
  pending: boolean;
  data: RuleSettingsPreview | undefined;
  error: ApiError | null;
  retry: () => void;
}

/** A setting the service refused: its place ("R-EFF-01.params.threshold", "R-EFF-01") and the service's words. */
export interface RefusedSetting {
  path: string;
  message: string;
}

export interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  boardName: string | null;
  rules: readonly RuleSettingsRule[];
  base: Draft;
  draft: Draft;
  edits: readonly FieldEdit[];
  /** The rules the draft adds and the custom rules it deletes (JO-20). */
  extras?: DraftExtras;
  /** The board's checks: a new rule's check and settings in words (JO-20). */
  checks?: readonly RuleCheck[];
  preview: PreviewState;
  saving: boolean;
  /** Someone else saved since the draft began: the save was refused, and nothing was kept. */
  conflict: boolean;
  /** A save that failed for any other reason, in plain words. */
  saveError: string | null;
  /** The reason as typed: the page keeps it until the changes are saved or discarded, so closing loses nothing. */
  reason: string;
  onReasonChange: (reason: string) => void;
  /** The service's words about the reason. */
  reasonProblem: string | null;
  /** The settings the service refused, each listed with its rule and a way to it (they are said beside their rows too). */
  refused: readonly RefusedSetting[];
  /** The service's words about the settings as a whole. */
  generalProblems: readonly string[];
  onSave: () => void;
  onReload: () => void;
  /** Puts a refused setting right: the review closes and the setting's control takes the focus. */
  onEdit: (path: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** What takes the focus as the review closes when the control that opened it is gone. */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

/** A field change's values, as the review lists them: what the board runs now, and what the draft makes it. */
function editWords(rules: readonly RuleSettingsRule[], base: Draft, draft: Draft, edit: FieldEdit, locale?: string) {
  const rule = rules.find((candidate) => candidate.rule_id === edit.ruleId);
  const value = (from: Draft) => {
    const drafted = from[edit.ruleId];
    if (edit.field === "enabled") return drafted?.enabled;
    if (edit.field === "severity") return drafted?.severity;
    // A custom rule's own fields (JO-20): its name, description, what it looks at, its choices.
    if (edit.field === "title") return drafted?.custom?.title;
    if (edit.field === "description") return drafted?.custom?.description || null;
    if (edit.field === "applies_to") return drafted?.custom ? appliesOf(drafted.custom) : null;
    const param = rule?.params.find((candidate) => `params.${candidate.name}` === edit.field);
    if (param && param.kind !== "number") return drafted?.custom?.choices[param.name] ?? null;
    return param ? fieldValue(param, drafted?.params[param.name]) : null;
  };
  return fieldWords(rules, { rule_id: edit.ruleId, field: edit.field, from: value(base), to: value(draft) }, locale);
}

/** A new rule's params as its row and the review say them: its numbers read from their fields, and its choices. */
function newRuleWords(item: NewRule, check: RuleCheck | undefined, locale?: string): string {
  const params: Record<string, ParamValue> = { ...(item.rule.custom.choices as Record<string, string | string[]>) };
  for (const param of check?.params ?? []) {
    if (param.kind !== "number") continue;
    const value = fieldValue({ unit: param.unit }, item.rule.params[param.name]);
    if (value !== null) params[param.name] = value;
  }
  return settingsWords(item.rule.custom.check, params, check, locale);
}

/**
 * The preview's impact for each of the draft's new rules (JO-20): the service names a new rule by the id it would
 * be given, after the board's rules, in the order the request lists the new rules; matched to them in that order.
 */
export function newRuleImpacts(impacts: readonly RuleSettingsImpact[], rules: readonly RuleSettingsRule[], added: readonly NewRule[]): Map<string, NewRule> {
  const known = new Set(rules.map((rule) => rule.rule_id));
  const fresh = impacts.filter((impact) => !known.has(impact.rule_id));
  return new Map(fresh.slice(0, added.length).map((impact, index) => [impact.rule_id, added[index]]));
}

const characters = (text: string) => [...text].length;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

/**
 * Review and save (JO-15): each change, rule by rule (the field, from and to);
 * what they would do to the board's open findings, from the service's
 * preview (how many would close, open and stay, with tickets to look at,
 * each opening in a new tab so the draft stays here); an optional reason for
 * the history; and "Save and re-check" (⌘↵ from any control in the review).
 * It opens at its top, the dialog itself holding the focus, so the changes
 * are what the reader meets first. What a save comes to when it does not go
 * through (someone else's save overtook it, the service refused a setting,
 * it failed) is said under the title, where it is in view however far the
 * body was scrolled; each refused setting with a way to it. A rule added
 * (JO-20) is listed with its definition and, from the preview, how many
 * findings it would raise now; one deleted, how many it would close.
 */
export function ReviewDialog(props: ReviewDialogProps) {
  const { open, onOpenChange, project, boardName, rules, base, draft, edits, preview, saving, conflict, saveError, reason, onSave, onReload } = props;
  const extras = props.extras ?? NO_EXTRAS;
  const checks = props.checks ?? [];
  const locale = useFigureLocale();
  const reasonId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const saveShortcut = useAriaShortcut(["mod", "Enter"]);
  const length = characters(reason);
  const reasonIssue =
    length > RULE_SETTINGS_REASON_MAX
      ? `At most ${formatCount(RULE_SETTINGS_REASON_MAX, { locale })} characters.`
      : EMAIL.test(reason)
        ? "Leave out email addresses: every admin reads the history."
        : props.reasonProblem;
  const deleted = new Set(extras.deleted);
  // The rules the draft changes, in page order: the edited and the deleted, then the new ones by their keys.
  const ruleIds = [
    ...rules.map((rule) => rule.rule_id).filter((id) => deleted.has(id) || edits.some((edit) => edit.ruleId === id)),
    ...extras.added.map((item) => item.key),
  ];
  // A severity change re-files the rule's open findings under the new severity (a rule turned off closes them instead).
  const refiled = new Map<string, Severity>(
    edits.flatMap((edit) => {
      const now = draft[edit.ruleId];
      return edit.field === "severity" && now?.enabled ? [[edit.ruleId, now.severity] as const] : [];
    }),
  );
  const board = boardName ?? project;
  const blocked = saving || conflict || reasonIssue !== null || preview.pending || (preview.error !== null && preview.error.code === "rule_settings_invalid");
  const refusal = props.refused.length > 0 || props.reasonProblem !== null || props.generalProblems.length > 0;

  const notice =
    conflict || refusal || saveError ? (
      <div className="flex flex-col gap-3" data-review-notice="">
        {conflict ? (
          <div role="alert">
            <Callout
              tone="warn"
              title="Someone else changed these settings"
              action={
                <Button size="sm" icon={RotateCcw} onClick={onReload}>
                  Reload
                </Button>
              }
            >
              Nothing was saved here. Reload to see their settings; your edits are not kept.
            </Callout>
          </div>
        ) : null}
        {refusal ? (
          <div role="alert">
            <Callout tone="warn" title="These settings were refused">
              <ul className="flex flex-col gap-2">
                {props.refused.map(({ path, message }) => {
                  const place = placeWords(rules, path, extras.added);
                  return (
                    <li key={path} className="flex items-start justify-between gap-3" data-refused={path}>
                      <span className="min-w-0 text-pretty">
                        {place ? (
                          <>
                            <span className="mono text-xs text-ink-low">{place.ruleId}</span>{" "}
                            <span className="font-medium text-ink">{place.title}</span>
                            {place.label ? <> · {place.label}</> : null}:{" "}
                          </>
                        ) : null}
                        {message}
                      </span>
                      {place ? (
                        <Button size="sm" className="shrink-0" onClick={() => props.onEdit(path)}>
                          {place.ruleId === "New" ? "Edit the new rule" : `Edit ${place.ruleId}`}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
                {props.reasonProblem ? (
                  <li className="flex items-start justify-between gap-3" data-refused="reason">
                    <span className="min-w-0 text-pretty">
                      <span className="font-medium text-ink">Reason</span>: {props.reasonProblem}
                    </span>
                    <Button size="sm" className="shrink-0" onClick={() => reasonRef.current?.focus()}>
                      Edit the reason
                    </Button>
                  </li>
                ) : null}
                {props.generalProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Callout>
          </div>
        ) : null}
        {saveError ? (
          <div role="alert">
            <Callout tone="warn" title="Couldn’t save">
              {saveError} Nothing was changed.
            </Callout>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      width={680}
      title="Review and save"
      description={
        <>
          {changesWord(changeCount(edits, extras))} to {board}&rsquo;s rule settings. Saving re-checks its findings.
        </>
      }
      notice={notice}
      onOpenAutoFocus={(event) => {
        // The dialog itself takes the focus, its scroll left at the top: a field further down (the reason) would scroll
        // the changes out of sight in WebKit, and in Chromium hold a focus ring below the fold.
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
      fallbackFocus={props.fallbackFocus}
      onKeyDown={(event) => {
        // ⌘↵ (Ctrl+Enter elsewhere) saves from any control in the review, as the button's key cap says; a plain Enter
        // is the control's own (a new line in the reason).
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (!blocked) onSave();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Tooltip content="Save and re-check" shortcut={["mod", "↵"]}>
            <Button variant="primary" loading={saving} disabled={blocked && !saving} onClick={onSave} aria-keyshortcuts={saveShortcut}>
              {saving ? "Saving…" : "Save and re-check"}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="flex flex-col gap-6 text-sm">
        <section aria-labelledby={`${reasonId}-changes`} className="flex flex-col gap-2">
          <h3 id={`${reasonId}-changes`} className="micro text-ink-low">
            Changes
          </h3>
          <ul className="flex flex-col divide-y divide-rule-weak rounded-md border border-rule-weak">
            {ruleIds.map((ruleId) => {
              const rule = rules.find((candidate) => candidate.rule_id === ruleId);
              const fresh = extras.added.find((item) => item.key === ruleId);
              if (fresh) {
                const check = checks.find((candidate) => candidate.name === fresh.rule.custom.check);
                const lines: [string, string][] = [
                  ["What it checks", check?.label ?? fresh.rule.custom.check],
                  ["Settings", newRuleWords(fresh, check, locale) || "None"],
                  ["Applies to", appliesWords(appliesOf(fresh.rule.custom), check?.scope)],
                  ["Reported as", SEVERITY_WORDS[fresh.rule.severity]],
                  ...(fresh.rule.custom.description.trim() ? [["Description", fresh.rule.custom.description.trim()] as [string, string]] : []),
                ];
                return (
                  <li key={ruleId} className="flex flex-col gap-1.5 px-3 py-2.5" data-change-new={ruleId}>
                    <p className="flex min-w-0 items-baseline gap-2">
                      <span className="text-xs text-ink-low">New rule</span>{" "}
                      <span className="min-w-0 font-medium text-ink">{fresh.rule.custom.title}</span>
                    </p>
                    <dl className="flex flex-col gap-1">
                      {lines.map(([label, value]) => (
                        <div key={label} className="grid grid-cols-[minmax(7rem,auto)_1fr] items-baseline gap-x-3 text-ink-mid">
                          <dt>{label}</dt>
                          <dd className="text-ink">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              }
              if (deleted.has(ruleId)) {
                return (
                  <li key={ruleId} className="flex flex-col gap-1.5 px-3 py-2.5" data-change-deleted={ruleId}>
                    <p className="flex min-w-0 items-baseline gap-2">
                      <span className="mono text-xs text-ink-low">{ruleId}</span>{" "}
                      <span className="min-w-0 font-medium text-ink">{rule?.title ?? ruleId}</span>
                    </p>
                    <p className="text-ink-mid">Deleted. Its open findings close; an undo brings it back.</p>
                  </li>
                );
              }
              return (
                <li key={ruleId} className="flex flex-col gap-1.5 px-3 py-2.5">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <span className="mono text-xs text-ink-low">{ruleId}</span>{" "}
                    <span className="min-w-0 font-medium text-ink">{rule?.title ?? ruleId}</span>
                  </p>
                  <ul className="flex flex-col gap-1">
                    {edits
                      .filter((edit) => edit.ruleId === ruleId)
                      .map((edit) => {
                        const words = editWords(rules, base, draft, edit, locale);
                        return (
                          <li key={edit.field} className="grid grid-cols-[minmax(7rem,auto)_1fr] items-baseline gap-x-3 text-ink-mid">
                            <span>{words.label}</span>{" "}
                            <span className="flex flex-wrap items-center gap-x-1.5" data-change={`${ruleId}.${edit.field}`}>
                              {/* A threshold's values are figures, in Plex Mono; On, Off, Breach and Warning are words. */}
                              <span className={cn(edit.field.startsWith("params.") && "mono", "text-ink-low line-through decoration-rule-strong")}>
                                {words.from}
                              </span>
                              <ArrowRight aria-hidden size={13} strokeWidth={1.75} className="text-ink-low" />
                              <span className="sr-only"> to </span>
                              <span className={cn(edit.field.startsWith("params.") && "mono", "font-medium text-ink")}>{words.to}</span>
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>

        <Impact preview={preview} rules={rules} ruleIds={ruleIds} refiled={refiled} added={extras.added} deleted={deleted} />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={reasonId} className="text-sm font-medium text-ink">
              Reason <span className="font-normal text-ink-low">(optional)</span>
            </label>
            <span className={cn("mono text-xs", length > RULE_SETTINGS_REASON_MAX ? "text-breach-ink" : "text-ink-low")} aria-hidden>
              {formatCount(length, { locale })}/{formatCount(RULE_SETTINGS_REASON_MAX, { locale })}
            </span>
          </div>
          <textarea
            id={reasonId}
            ref={reasonRef}
            value={reason}
            onChange={(event) => props.onReasonChange(event.target.value)}
            rows={2}
            aria-invalid={reasonIssue !== null || undefined}
            aria-describedby={`${reasonId}-note`}
            placeholder="Why, for the history: agreed with the team on Monday."
            className={cn(
              "min-h-16 w-full resize-y rounded-md border bg-sheet px-3 py-2 text-sm text-ink placeholder:text-ink-low focus-visible:outline-2 focus-visible:outline-offset-0",
              reasonIssue ? "border-breach focus-visible:outline-breach" : "border-rule-control focus-visible:border-focus focus-visible:outline-focus",
            )}
          />
          <p id={`${reasonId}-note`} aria-live="polite" className={cn("text-xs", reasonIssue ? "text-breach-ink" : "text-ink-low")}>
            {reasonIssue ?? "Shown in the history with your name."}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * An example's link: a ticket opens in a new tab, so the review and the draft stay as they are; a sprint has no page.
 * Each link is a 24 px target (WCAG 2.2, 2.5.8), the list's own words setting nothing smaller beside it.
 */
function ExampleKey({ subject }: { subject: string }) {
  if (subject.startsWith("sprint:")) return <span className="mono inline-flex min-h-6 items-center text-ink-mid">Sprint {subject.slice("sprint:".length)}</span>;
  return (
    <a
      href={`/issues/${encodeURIComponent(subject)}`}
      target="_blank"
      rel="noopener"
      className="mono -mx-1 inline-flex min-h-6 items-center gap-0.5 rounded-xs px-1 text-cite underline-offset-2 hover:underline"
    >
      {subject}
      <ArrowUpRight aria-hidden size={11} strokeWidth={1.75} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** One way a rule's findings would go, with the tickets named for it, and "and more" when there are more than those. */
function Examples({ label, subjects, more }: { label: string; subjects: readonly string[]; more: boolean }) {
  if (subjects.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-low" data-examples={label}>
      <span>{label}</span>{" "}
      {subjects.map((subject, index) => (
        <span key={subject} className="inline-flex items-center">
          <ExampleKey subject={subject} />
          {index < subjects.length - 1 ? <span aria-hidden>,</span> : null}{" "}
        </span>
      ))}
      {more ? <span data-examples-more="">and more</span> : null}
    </span>
  );
}

/**
 * A rule's tickets to look at, as the preview names them: at most five each way, so a full list whose findings
 * outnumber it says "and more" (never how many more: the counts are of findings, and a ticket can hold more than
 * one). A rule whose severity changes re-files its open findings: each closes and opens again under the new
 * severity, so a ticket named both ways is listed once, as re-filed.
 */
function ImpactExamples({ impact, refiled }: { impact: RuleSettingsImpact; refiled: boolean }) {
  const { examples } = impact;
  const moreClosing = examples.close.length >= RULE_SETTINGS_EXAMPLES_MAX && impact.would_close > examples.close.length;
  const moreOpening = examples.open.length >= RULE_SETTINGS_EXAMPLES_MAX && impact.would_open > examples.open.length;
  if (!refiled) {
    return (
      <>
        <Examples label="Closes" subjects={examples.close} more={moreClosing} />
        <Examples label="Opens" subjects={examples.open} more={moreOpening} />
      </>
    );
  }
  const opening = new Set(examples.open);
  const both = examples.close.filter((subject) => opening.has(subject));
  const again = new Set(both);
  return (
    <>
      <Examples label="Re-filed" subjects={both} more={moreClosing || moreOpening} />
      <Examples label="Closes" subjects={examples.close.filter((subject) => !again.has(subject))} more={moreClosing} />
      <Examples label="Opens" subjects={examples.open.filter((subject) => !again.has(subject))} more={moreOpening} />
    </>
  );
}

/** What the changes would do to the board's open findings, rule by rule, as the service's preview found it. */
function Impact({
  preview,
  rules,
  ruleIds,
  refiled,
  added,
  deleted,
}: {
  preview: PreviewState;
  rules: readonly RuleSettingsRule[];
  ruleIds: readonly string[];
  /** The rules whose severity the changes change (and that stay on), by the severity they would be reported at. */
  refiled: ReadonlyMap<string, Severity>;
  /** The rules the draft adds, and the custom rules it deletes (JO-20). */
  added: readonly NewRule[];
  deleted: ReadonlySet<string>;
}) {
  const locale = useFigureLocale();
  const figure = (value: number) => formatCount(value, { locale });
  const headId = useId();
  const fresh = preview.data ? newRuleImpacts(preview.data.impact, rules, added) : new Map<string, NewRule>();
  /** "Would raise 12 findings now", "Would close 1 finding": a new rule's and a deleted one's effect in a sentence. */
  const findings = (count: number) => `${figure(count)} ${count === 1 ? "finding" : "findings"}`;
  return (
    <section aria-labelledby={headId} className="flex flex-col gap-2">
      <h3 id={headId} className="micro text-ink-low">
        What it does to open findings
      </h3>
      {preview.error?.code === "rule_settings_invalid" ? (
        // Refused, not failed: the refusal itself is said once, under the title, and beside each setting it names.
        <p className="rounded-md border border-rule-weak px-3 py-2.5 text-sm text-ink-mid">
          These settings were refused.
        </p>
      ) : preview.error ? (
        <div className="rounded-md border border-rule-weak">
          <ErrorState
            size="compact"
            title="Couldn't work out what these changes would do"
            description={preview.error.message}
            onRetry={preview.retry}
            retrying={preview.pending}
          />
        </div>
      ) : (
        <table className="w-full border-separate border-spacing-0 rounded-md border border-rule-weak text-sm" aria-busy={preview.pending || undefined}>
          <caption className="sr-only">What the changes would do to the board&rsquo;s open findings, rule by rule</caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="micro border-b border-rule-weak px-3 py-2 font-medium text-ink-low">
                Rule
              </th>
              {/* Each head on one line, beside "Rule": the three are as tall as it is. */}
              {["Closes", "Opens", "Stays open"].map((label) => (
                <th key={label} scope="col" className="micro w-[6.5rem] border-b border-rule-weak px-3 py-2 text-right font-medium whitespace-nowrap text-ink-low">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.pending || !preview.data
              ? ruleIds.map((ruleId) => (
                  <tr key={ruleId}>
                    <td className="border-b border-rule-weak px-3 py-2.5 last:border-b-0" colSpan={4}>
                      <SkeletonGroup label="Working out what the changes would do" className="flex items-center justify-between gap-6">
                        <Skeleton className="h-3 w-40" />
                        <span className="flex gap-12">
                          <Skeleton className="h-3 w-6" />
                          <Skeleton className="h-3 w-6" />
                          <Skeleton className="h-3 w-6" />
                        </span>
                      </SkeletonGroup>
                    </td>
                  </tr>
                ))
              : preview.data.impact.map((impact) => {
                  const rule = rules.find((candidate) => candidate.rule_id === impact.rule_id);
                  const severity = refiled.get(impact.rule_id);
                  const newRule = fresh.get(impact.rule_id);
                  const gone = deleted.has(impact.rule_id);
                  return (
                    <tr key={impact.rule_id} data-impact={newRule ? newRule.key : impact.rule_id} data-impact-new={newRule ? "" : undefined} className="align-top">
                      <th scope="row" className="border-b border-rule-weak px-3 py-2.5 text-left font-normal">
                        <span className="flex flex-col gap-1">
                          <span className="flex items-baseline gap-2">
                            {/* A new rule has no id until it is saved: it goes by its name. */}
                            <span className={cn("text-xs text-ink-low", !newRule && "mono")}>{newRule ? "New" : impact.rule_id}</span>{" "}
                            <span className="text-ink">{newRule ? newRule.rule.custom.title : (rule?.title ?? impact.rule_id)}</span>
                          </span>
                          {newRule ? (
                            <span className="text-xs text-ink-mid" data-would-raise="">
                              Would raise {findings(impact.would_open)} now.
                            </span>
                          ) : null}
                          {gone ? (
                            <span className="text-xs text-ink-mid" data-would-close="">
                              Would close {findings(impact.would_close)}.
                            </span>
                          ) : null}
                          {severity ? (
                            <span className="text-xs text-pretty text-ink-mid" data-refiled={severity}>
                              Re-filed as {SEVERITY_WORDS[severity]}: a severity change closes each open finding and opens it again
                              under the new severity, so the same tickets count both ways.
                            </span>
                          ) : null}
                          {impact.note ? <span className="text-xs text-ink-low">{impact.note}</span> : null}
                          <ImpactExamples impact={impact} refiled={severity !== undefined} />
                        </span>
                      </th>
                      <td className="mono border-b border-rule-weak px-3 py-2.5 text-right text-ink">{figure(impact.would_close)}</td>
                      <td className="mono border-b border-rule-weak px-3 py-2.5 text-right text-ink">{figure(impact.would_open)}</td>
                      <td className="mono border-b border-rule-weak px-3 py-2.5 text-right text-ink-mid">{figure(impact.would_stay)}</td>
                    </tr>
                  );
                })}
          </tbody>
          {preview.data && !preview.pending ? (
            <tfoot>
              <tr>
                <th scope="row" className="bg-rail px-3 py-2 text-left text-xs font-medium text-ink-mid">
                  In all
                </th>
                <td className="mono bg-rail px-3 py-2 text-right text-ink">{figure(preview.data.totals.would_close)}</td>
                <td className="mono bg-rail px-3 py-2 text-right text-ink">{figure(preview.data.totals.would_open)}</td>
                <td className="bg-rail px-3 py-2" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      )}
      <p className="text-xs text-ink-low">
        Worked out against the board&rsquo;s data as of its last sync. A finding that still holds stays the same finding
        {refiled.size > 0 ? " (except under a severity change, which re-files every open finding of its rule)" : ""}; one that no
        longer holds closes as &ldquo;rule settings changed&rdquo;, never as fixed.
      </p>
    </section>
  );
}
