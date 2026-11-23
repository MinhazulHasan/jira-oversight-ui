"use client";

import { CircleAlert, Info } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { inSentence, joinWords, stageLabel } from "@/components/process/labels";
import { SeverityMark } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { NumberField } from "@/components/ui/number-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { TextArea, TextInput } from "@/components/ui/text-field";
import { useFigureLocale } from "@/components/ui/use-figures";
import { limitWords, type CustomRuleBoard } from "@/lib/api/custom-rules";
import { useRuleDraft } from "@/lib/api/hooks";
import {
  CATEGORY_LABELS,
  characterCount,
  CUSTOM_DESCRIPTION_MAX,
  CUSTOM_TITLE_MAX,
  namesSomeone,
  plainText,
  RULE_DRAFT_PERSONAL,
  RULE_DRAFT_TEXT_MAX,
  RULE_DRAFT_TEXT_MIN,
  type RuleCheck,
  type RuleDraft,
  type RuleDraftAvailability,
  type Severity,
} from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  asNumberParam,
  definitionKey,
  describeExample,
  firstProblem,
  formFields,
  formFromAiDraft,
  formProblems,
  withCheck,
  type RuleForm,
} from "./custom-rule-form";
import { fieldBounds, fieldValue, paramWords } from "./model";

const SEVERITY_OPTIONS = [
  { value: "breach", label: "Breach" },
  { value: "warning", label: "Warning" },
] as const;

/** Said under the name or the description while it still holds the AI's words and the rule has changed since. */
export const DRAFTED_WORDS_HINT = "From the AI's draft: check it still fits your changes.";

/**
 * What the draft came to, as the sheet says it under the description: a draft's problems at the form's fields are
 * said at each field (and counted here while any is left), and any other (the rule as a whole) is said here. A draft
 * keeps the form as the AI filled it, so the sheet can tell when the admin has changed the rule since.
 */
type DraftStatus =
  | { kind: "idle" }
  | { kind: "short" }
  /** The words name someone (an email address, an account id): the AI is never sent them. */
  | { kind: "personal" }
  | { kind: "working" }
  | { kind: "done"; draft: RuleDraft; filled: RuleForm | null; elsewhere: readonly string[] }
  | { kind: "failed"; message: string };

export interface CustomRuleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A new rule (its check to pick, its words to draft from), or one in the draft to edit (its check locked). */
  mode: "new" | "edit";
  /** A saved rule's id, said above the title; null for one not saved yet. */
  ruleId: string | null;
  /** The form as it opens: empty for a new rule, the rule's definition for an edit. */
  initial: RuleForm;
  /** The board's name, as the top bar says it. */
  board: string;
  /** The board's checks, issue types and every other rule's name: what the form offers and checks against. */
  checks: CustomRuleBoard["checks"];
  issueTypes: CustomRuleBoard["issueTypes"];
  others: CustomRuleBoard["rules"];
  /** Whether the AI can draft a rule now, and why not. */
  aiDraft: RuleDraftAvailability;
  /** The severity is the form's for a rule not saved yet; a saved rule's is set on its row. */
  showSeverity: boolean;
  /** What the service refused, at its field ("title", "params.hours"): said beside it until the field changes. */
  refused?: ReadonlyMap<string, string>;
  onSubmit: (form: RuleForm) => void;
  /** Where the focus goes as it closes (the button that opened it), for a browser that did not focus that button. */
  onCloseFocus?: () => void;
}

/** A field's label over it, its control, and under it the hint or what is wrong (one line each, said as it changes). */
function Field({
  label,
  htmlFor,
  labelId,
  hint,
  problem,
  messageId,
  aside,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  labelId?: string;
  hint?: ReactNode;
  problem?: string | null;
  messageId: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} id={labelId} className="text-sm font-medium text-ink">
            {label}
          </label>
        ) : (
          <span id={labelId} className="text-sm font-medium text-ink">
            {label}
          </span>
        )}
        {aside}
      </div>
      {children}
      <Message id={messageId} problem={problem} hint={hint} />
    </div>
  );
}

/** What is wrong, in the breach ink with its mark; else the hint, quietly; nothing at all where neither is. */
function Message({ id, problem, hint }: { id: string; problem?: string | null; hint?: ReactNode }) {
  if (problem) {
    return (
      <p id={id} className="flex items-start gap-1.5 text-xs text-breach-ink" data-field-problem="">
        <CircleAlert aria-hidden size={13} strokeWidth={2} className="mt-px shrink-0" />
        {problem}
      </p>
    );
  }
  return hint ? (
    <p id={id} className="text-xs text-pretty text-ink-low">
      {hint}
    </p>
  ) : (
    <span id={id} hidden />
  );
}

/** "12/80": how much of a field's room is used, in the breach ink once it is over. */
function Counter({ length, max }: { length: number; max: number }) {
  const locale = useFigureLocale();
  return (
    <span aria-hidden className={cn("mono text-xs", length > max ? "text-breach-ink" : "text-ink-low")}>
      {formatCount(length, { locale })}/{formatCount(max, { locale })}
    </span>
  );
}

/** A unit drawn inside a number's field: "h", "days", "×", "%". */
function unitSuffix(unit: string | null, text: string): string {
  switch (unit) {
    case "hours":
      return "h";
    case "days":
      return readDays(text) === 1 ? "day" : "days";
    case "ratio":
      return "×";
    default:
      return "%";
  }
}

const readDays = (text: string) => Number(text.trim().replace(",", "."));

/**
 * The "New rule" sheet (JO-20), from the right (the screen's width on a
 * phone): what the admin wants in their own words, which the AI drafts into
 * the form below (drafted, not possible, not understood, no AI now, each said
 * in a live region), and the form itself, built from the board's checks: the
 * rule's name, its check, the check's settings by kind with their units and
 * bounds, the categories and issue types it looks at, how serious it is, and
 * a description. What cannot be saved is said at its field before anything is
 * sent; "Add to changes" puts the rule in the page's draft, never saved until
 * the review. Once the admin changes what a drafted rule flags, the AI's
 * explanation is no longer said (it described the draft), and a name or
 * description still in the AI's words asks to be checked. The example to
 * draft from is on the board's own names. Editing a rule opens the same form
 * with its check locked.
 */
export function CustomRuleSheet(props: CustomRuleSheetProps) {
  const { open, onOpenChange, mode, ruleId, initial, board, checks, issueTypes, others, aiDraft, showSeverity, onSubmit, onCloseFocus } = props;
  const locale = useFigureLocale();
  const ids = useId();
  const fieldDomId = (field: string) => `${ids}-${field.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const formId = `${ids}-form`;
  const draft = useRuleDraft();
  const describeRef = useRef<HTMLTextAreaElement>(null);

  const [form, setForm] = useState<RuleForm>(initial);
  const [describe, setDescribe] = useState("");
  const [status, setStatus] = useState<DraftStatus>({ kind: "idle" });
  /** The fields the service (or the AI's draft) found wrong, until each is changed. */
  const [given, setGiven] = useState<ReadonlyMap<string, string>>(() => new Map(props.refused ?? []));
  /** The fields left once, and whether "Add to changes" has been pressed: what is wrong shows from then on. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);

  const check = checks.find((candidate) => candidate.name === form.check);
  const formBoard = useMemo<CustomRuleBoard>(() => ({ checks, issueTypes, rules: others }), [checks, issueTypes, others]);
  const problems = useMemo(() => formProblems(form, formBoard, {}, locale), [form, formBoard, locale]);
  const example = useMemo(() => describeExample(checks, issueTypes), [checks, issueTypes]);
  const shown = (field: string): string | null => {
    const own = submitted || touched.has(field) ? (problems.get(field) ?? null) : null;
    return own ?? given.get(field) ?? null;
  };
  // The form as the AI filled it, and whether what the rule flags has changed since: its explanation then no longer
  // holds, and a name or description still in the AI's words may say the old limit.
  const filled = status.kind === "done" ? status.filled : null;
  const filledCheck = filled ? checks.find((candidate) => candidate.name === filled.check) : undefined;
  const changedSince = filled !== null && definitionKey(form, check) !== definitionKey(filled, filledCheck);
  const draftedWords = (field: "title" | "description"): string | undefined =>
    changedSince && filled !== null && plainText(form[field]) !== "" && form[field] === filled[field] ? DRAFTED_WORDS_HINT : undefined;

  /** A change to the form: the fields it touches lose what the service said of them. */
  const change = (next: Partial<RuleForm>, ...fields: string[]) => {
    setForm((current) => ({ ...current, ...next }));
    if (fields.length > 0 && fields.some((field) => given.has(field))) {
      setGiven((current) => new Map([...current].filter(([field]) => !fields.some((changed) => field === changed || field.startsWith(`${changed}.`)))));
    }
  };
  const leave = (field: string) => setTouched((current) => new Set(current).add(field));

  const pickCheck = (name: string) => {
    const picked = checks.find((candidate) => candidate.name === name);
    if (!picked) return;
    setForm((current) => withCheck(current, picked));
    setGiven((current) => new Map([...current].filter(([field]) => field === "title" || field === "description")));
  };

  const runDraft = () => {
    const text = plainText(describe);
    // ⌘↵ while a draft is on its way waits for it.
    if (draft.isPending) return;
    const refused = characterCount(text) < RULE_DRAFT_TEXT_MIN ? "short" : namesSomeone(text) ? "personal" : null;
    if (refused) {
      setStatus({ kind: refused });
      describeRef.current?.focus();
      return;
    }
    setStatus({ kind: "working" });
    draft.mutate(text, {
      onSuccess: (answer) => {
        if (answer.outcome !== "drafted" || !answer.draft) {
          setStatus({ kind: "done", draft: answer, filled: null, elsewhere: [] });
          return;
        }
        const filled = formFromAiDraft(answer.draft, checks);
        const fields = new Set(formFields(checks.find((candidate) => candidate.name === filled.check)));
        const atFields = answer.problems.filter((problem) => fields.has(problem.field));
        const elsewhere = answer.problems.filter((problem) => !fields.has(problem.field)).map((problem) => problem.message);
        setStatus({ kind: "done", draft: answer, filled, elsewhere });
        setForm(filled);
        setGiven(new Map(atFields.map((problem) => [problem.field, problem.message])));
        setTouched(new Set());
        setSubmitted(false);
      },
      onError: (error) => setStatus({ kind: "failed", message: error.message }),
    });
  };

  const submit = () => {
    const blocking = new Map([...given, ...problems]);
    if (blocking.size > 0) {
      setSubmitted(true);
      const first = firstProblem(blocking, check);
      if (first) document.getElementById(fieldDomId(first))?.focus();
      return;
    }
    onSubmit(form);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // ⌘↵ (Ctrl+Enter elsewhere): drafts from the description where it is typed, adds the rule from anywhere else.
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (event.target === describeRef.current) runDraft();
    else submit();
  };

  const describeLength = characterCount(plainText(describe));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width={600}
      eyebrow={ruleId ? <span className="mono tracking-normal">{ruleId}</span> : undefined}
      title={mode === "new" ? "New rule" : "Edit rule"}
      description={`For ${board} only. Nothing is saved until you review and save.`}
      onCloseFocus={onCloseFocus}
      footer={
        <>
          <Button variant="secondary" className="ml-auto" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} data-add-to-changes="">
            Add to changes
          </Button>
        </>
      }
    >
      {/* A plain group: the sheet is the dialog; this only hears ⌘↵ from the fields inside it. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="flex flex-col gap-6" onKeyDown={onKeyDown}>
        {mode === "new" ? (
          aiDraft.available ? (
            <section aria-label="Describe the rule" className="flex flex-col gap-2 rounded-md border border-rule-weak bg-rail px-4 pt-3 pb-3.5" data-describe="">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`${ids}-describe`} className="text-sm font-medium text-ink">
                  Describe it <span className="font-normal text-ink-low">(optional)</span>
                </label>
                <Counter length={describeLength} max={RULE_DRAFT_TEXT_MAX} />
              </div>
              <TextArea
                ref={describeRef}
                id={`${ids}-describe`}
                rows={2}
                value={describe}
                onChange={(event) => {
                  setDescribe(event.target.value);
                  if (status.kind === "short" || status.kind === "personal") setStatus({ kind: "idle" });
                }}
                placeholder={example}
                maxLength={RULE_DRAFT_TEXT_MAX * 2}
                invalid={status.kind === "short" || status.kind === "personal" || describeLength > RULE_DRAFT_TEXT_MAX}
                aria-describedby={`${ids}-draft-status`}
                className="min-h-14 bg-sheet"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <DraftStatusLine id={`${ids}-draft-status`} status={status} changed={changedSince} fixes={given.size} />
                <Button
                  size="sm"
                  className="self-start"
                  loading={draft.isPending}
                  disabled={describeLength > RULE_DRAFT_TEXT_MAX}
                  onClick={runDraft}
                  data-draft-with-ai=""
                >
                  {draft.isPending ? "Drafting…" : "Draft with AI"}
                </Button>
              </div>
            </section>
          ) : (
            <p className="flex items-start gap-2 text-xs text-ink-low" data-ai-off="">
              <Info aria-hidden size={13} strokeWidth={1.75} className="mt-px shrink-0" />
              {/* The service's reason says the rule can still be added by hand; said here when it gives none. */}
              {aiDraft.reason ?? "AI drafts aren't available right now. You can still set the rule up below."}
            </p>
          )
        ) : null}

        <form
          id={formId}
          noValidate
          aria-label={mode === "new" ? "New rule" : "Edit rule"}
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field
            label="Name"
            htmlFor={fieldDomId("title")}
            problem={shown("title")}
            hint={draftedWords("title")}
            messageId={`${fieldDomId("title")}-message`}
            aside={<Counter length={characterCount(plainText(form.title))} max={CUSTOM_TITLE_MAX} />}
          >
            <TextInput
              id={fieldDomId("title")}
              value={form.title}
              onChange={(event) => change({ title: event.target.value }, "title")}
              onBlur={() => leave("title")}
              invalid={shown("title") !== null}
              aria-describedby={`${fieldDomId("title")}-message`}
              placeholder="Bugs in review over 3 days"
            />
          </Field>

          <Field
            label="What to check"
            labelId={`${fieldDomId("check")}-label`}
            problem={shown("check")}
            messageId={`${fieldDomId("check")}-message`}
            hint={check ? <CheckHint check={check} /> : "Each check looks at tickets in one way."}
          >
            <Select<string>
              id={fieldDomId("check")}
              label="What to check"
              labelPlacement="hidden"
              options={checks.map((candidate) => ({
                value: candidate.name,
                label: candidate.label,
                hint: candidate.measurable ? undefined : "Not measurable",
              }))}
              // "" until a check is picked: the placeholder shows, and the list stays the form's to hold throughout.
              value={form.check}
              onValueChange={pickCheck}
              placeholder="Pick a check"
              disabled={mode === "edit"}
              invalid={shown("check") !== null}
              describedBy={`${fieldDomId("check")}-message`}
              triggerClassName="w-full"
              className="w-full"
            />
          </Field>
          {mode === "edit" ? (
            <p className="-mt-3 text-xs text-ink-low">To use another check, delete this rule and add a new one.</p>
          ) : null}

          {check ? (
            <CheckParams
              check={check}
              form={form}
              shown={shown}
              fieldDomId={fieldDomId}
              onNumber={(name, text) => change({ numbers: { ...form.numbers, [name]: text } }, `params.${name}`)}
              onChoice={(name, value) => change({ choices: { ...form.choices, [name]: value } }, `params.${name}`)}
              onLeave={leave}
            />
          ) : null}

          {check ? (
            <AppliesTo
              check={check}
              form={form}
              issueTypes={issueTypes}
              shown={shown}
              fieldDomId={fieldDomId}
              onCategories={(categories) => change({ categories }, "applies_to")}
              onTypes={(types) => change({ issueTypes: types }, "applies_to")}
            />
          ) : null}

          {showSeverity ? (
            <Field label="How serious" labelId={`${fieldDomId("severity")}-label`} messageId={`${fieldDomId("severity")}-message`} problem={shown("severity")}>
              <div id={fieldDomId("severity")} tabIndex={-1} className="outline-none">
                <SegmentedControl<Severity>
                  label="How serious"
                  options={SEVERITY_OPTIONS}
                  value={form.severity}
                  onValueChange={(severity) => change({ severity }, "severity")}
                />
              </div>
            </Field>
          ) : null}

          <Field
            label={
              <>
                Description <span className="font-normal text-ink-low">(optional)</span>
              </>
            }
            htmlFor={fieldDomId("description")}
            problem={shown("description")}
            hint={draftedWords("description")}
            messageId={`${fieldDomId("description")}-message`}
            aside={<Counter length={characterCount(plainText(form.description))} max={CUSTOM_DESCRIPTION_MAX} />}
          >
            <TextArea
              id={fieldDomId("description")}
              rows={2}
              value={form.description}
              onChange={(event) => change({ description: event.target.value }, "description")}
              onBlur={() => leave("description")}
              invalid={shown("description") !== null}
              aria-describedby={`${fieldDomId("description")}-message`}
              placeholder="What it is for, in a sentence."
            />
          </Field>
        </form>
      </div>
    </Sheet>
  );
}

/**
 * What the AI's draft came to, said in a live region: drafted, not possible, not understood, no AI now, or failed. A
 * draft is said with how many of its fields are still to fix and what it flags; once the admin changes what the rule
 * flags, "then changed", and what the AI said it flags no longer, since it no longer holds. What it flags is said
 * once: not here when the AI wrote the same words as the rule's description.
 */
function DraftStatusLine({ id, status, changed, fixes }: { id: string; status: DraftStatus; changed: boolean; fixes: number }) {
  const body = (() => {
    switch (status.kind) {
      case "idle":
        return <span className="text-ink-low">The AI fills in the form. You check it before adding it.</span>;
      case "short":
        return <span className="text-breach-ink">Write at least {RULE_DRAFT_TEXT_MIN} characters to draft from.</span>;
      case "personal":
        return <span className="text-breach-ink">{RULE_DRAFT_PERSONAL}</span>;
      case "working":
        return <span className="text-ink-mid">Drafting…</span>;
      case "failed":
        return (
          <span className="text-ink-mid">
            <span className="font-medium text-ink">Couldn&rsquo;t draft the rule.</span> {status.message}
          </span>
        );
      case "done": {
        const { outcome, explanation, note } = status.draft;
        const { filled, elsewhere } = status;
        // The spaces between the lines are for a screen reader, which hears the region as one sentence after another.
        if (outcome === "drafted") {
          const said = explanation && !changed && plainText(explanation) !== plainText(filled?.description ?? "") ? explanation : null;
          return (
            <span className="flex flex-col gap-0.5" data-draft-outcome="drafted" data-draft-changed={changed ? "" : undefined}>
              <span className="font-medium text-ink">
                {changed ? "Drafted by AI, then changed." : "Drafted by AI."} Check it before you add it.
                {fixes > 0 ? ` ${fixes === 1 ? "1 field needs" : `${fixes} fields need`} a fix.` : ""}
              </span>{" "}
              {said ? <span className="text-ink-mid">{said}</span> : null}{" "}
              {elsewhere.map((message) => (
                <span key={message} className="flex items-start gap-1.5 text-breach-ink" data-draft-problem="">
                  <CircleAlert aria-hidden size={13} strokeWidth={2} className="mt-px shrink-0" />
                  {message}{" "}
                </span>
              ))}
            </span>
          );
        }
        const heading = outcome === "not_supported" ? "Can't make that rule." : outcome === "not_understood" ? "Didn't understand that." : "AI drafts aren't available right now.";
        // No AI now: the service's note says so and that the rule can still be set up by hand; said here when it has none.
        const said = note ?? (outcome === "unavailable" ? "You can still set the rule up below." : null);
        return (
          <span className="flex flex-col gap-0.5" data-draft-outcome={outcome}>
            <span className="font-medium text-ink">{heading}</span>{" "}
            {said ? <span className="text-ink-mid">{said}</span> : null}
          </span>
        );
      }
    }
  })();
  return (
    <p id={id} role="status" aria-live="polite" className="min-h-[1lh] min-w-0 text-xs text-pretty" data-draft-status={status.kind}>
      {body}
    </p>
  );
}

/** A check's one line, and why the board cannot measure it where it cannot. */
function CheckHint({ check }: { check: RuleCheck }) {
  const missing = joinWords(check.missing_evidence.map((key) => inSentence(stageLabel(key))));
  return (
    <span className="flex flex-col gap-1">
      <span>{check.summary}</span>
      {!check.measurable ? (
        <span className="flex items-start gap-1.5">
          <span className="flex h-[1lh] items-center">
            <SeverityMark severity="not-measurable" size={10} />
          </span>
          <span>Not measurable on this board{missing ? `: Jira holds no ${missing} evidence` : ""}. It runs once Jira records it.</span>
        </span>
      ) : null}
    </span>
  );
}

interface ParamsProps {
  check: RuleCheck;
  form: RuleForm;
  shown: (field: string) => string | null;
  fieldDomId: (field: string) => string;
  onNumber: (name: string, text: string) => void;
  onChoice: (name: string, value: string | readonly string[]) => void;
  onLeave: (field: string) => void;
}

/** The check's settings, each by its kind: a number in its unit with its bounds, the board's statuses, a choice. */
function CheckParams({ check, form, shown, fieldDomId, onNumber, onChoice, onLeave }: ParamsProps) {
  const locale = useFigureLocale();
  if (check.params.length === 0) return <p className="-mt-1 text-xs text-ink-low">This check has no settings.</p>;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-5">
      {check.params.map((param) => {
        const field = `params.${param.name}`;
        const id = fieldDomId(field);
        const messageId = `${id}-message`;
        if (param.kind === "number") {
          const spec = asNumberParam(param);
          const text = form.numbers[param.name] ?? "";
          const value = fieldValue(spec, text);
          const bounds = `From ${paramWords(spec, spec.min, locale)} to ${paramWords(spec, spec.max, locale)}.`;
          const days = param.unit === "hours" && value !== null && value >= 48 ? ` That is ${limitWords(value, locale)}.` : "";
          return (
            <Field key={param.name} label={param.label} labelId={`${id}-label`} problem={shown(field)} messageId={messageId} hint={`${bounds}${days}`}>
              <NumberField
                id={id}
                value={text}
                onValueChange={(next) => onNumber(param.name, next)}
                onBlur={() => onLeave(field)}
                {...fieldBounds(spec)}
                suffix={unitSuffix(param.unit, text)}
                labelledBy={`${id}-label`}
                describedBy={messageId}
                invalid={shown(field) !== null}
                width="4.5rem"
                className="self-start"
              />
            </Field>
          );
        }
        if (param.kind === "statuses") {
          const chosen = (form.choices[param.name] as readonly string[] | undefined) ?? [];
          const options: ComboboxOption[] = (param.options ?? []).map((option) => ({
            value: option.value,
            label: option.label,
            description: option.category ? CATEGORY_LABELS[option.category] : undefined,
          }));
          return (
            <div key={param.name} className="flex w-full min-w-0 flex-col gap-1.5">
              <span aria-hidden className="text-sm font-medium text-ink">
                {param.label}
              </span>
              <Combobox
                id={id}
                label={param.label}
                labelPlacement="hidden"
                options={options}
                value={chosen}
                onValueChange={(value) => {
                  onChoice(param.name, value);
                  onLeave(field);
                }}
                anyLabel="Pick one or more"
                searchPlaceholder="Search the board's statuses"
                emptyText="No status matches that."
                invalid={shown(field) !== null}
                describedBy={messageId}
                className="w-full"
              />
              <Message id={messageId} problem={shown(field)} />
            </div>
          );
        }
        return (
          <Field key={param.name} label={param.label} labelId={`${id}-label`} problem={shown(field)} messageId={messageId}>
            <Select<string>
              id={id}
              label={param.label}
              labelPlacement="hidden"
              options={(param.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
              value={(form.choices[param.name] as string | undefined) ?? ""}
              onValueChange={(value) => onChoice(param.name, value)}
              placeholder="Pick one"
              invalid={shown(field) !== null}
              describedBy={messageId}
              triggerClassName="min-w-44"
            />
          </Field>
        );
      })}
    </div>
  );
}

interface AppliesToProps {
  check: RuleCheck;
  form: RuleForm;
  issueTypes: readonly string[];
  shown: (field: string) => string | null;
  fieldDomId: (field: string) => string;
  onCategories: (categories: RuleForm["categories"]) => void;
  onTypes: (types: readonly string[] | null) => void;
}

/** What the rule looks at: the status categories its check allows (To do, In progress, Done), and its issue types. */
function AppliesTo({ check, form, issueTypes, shown, fieldDomId, onCategories, onTypes }: AppliesToProps) {
  const categoriesId = fieldDomId("applies_to.status_category");
  const typesId = fieldDomId("applies_to.issue_type");
  const problem = shown("applies_to") ?? shown("applies_to.status_category");
  if (check.scope === "sprint") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Applies to</span>
        <p className="text-sm text-ink-mid">The active sprint, not single tickets.</p>
        <Message id={`${categoriesId}-message`} problem={problem} />
      </div>
    );
  }
  const toggle = (category: (typeof check.categories)[number], on: boolean) =>
    onCategories(check.categories.filter((candidate) => (candidate === category ? on : form.categories.includes(candidate))));
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={`${categoriesId}-message`}>
      <legend className="mb-1.5 text-sm font-medium text-ink">Applies to</legend>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-low" id={`${categoriesId}-label`}>
          Status
        </span>
        {check.categories.length === 1 ? (
          <p className="text-sm text-ink-mid">{CATEGORY_LABELS[check.categories[0]]} only</p>
        ) : (
          <div role="group" aria-labelledby={`${categoriesId}-label`} className="flex flex-wrap gap-x-5 gap-y-1">
            {check.categories.map((category, index) => (
              <Checkbox
                key={category}
                id={index === 0 ? categoriesId : undefined}
                checked={form.categories.includes(category)}
                onCheckedChange={(on) => toggle(category, on)}
              >
                {CATEGORY_LABELS[category]}
              </Checkbox>
            ))}
          </div>
        )}
        <Message id={`${categoriesId}-message`} problem={problem} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Combobox
          id={typesId}
          label="Issue types"
          labelPlacement="above"
          options={issueTypes.map((type) => ({ value: type, label: type }))}
          value={form.issueTypes ?? []}
          onValueChange={(value) => onTypes(value.length > 0 ? value : null)}
          anyLabel="All types"
          searchPlaceholder="Search the board's issue types"
          emptyText="No issue type matches that."
          invalid={shown("applies_to.issue_type") !== null}
          describedBy={`${typesId}-message`}
          className="w-full"
        />
        <Message id={`${typesId}-message`} problem={shown("applies_to.issue_type")} hint={form.issueTypes === null ? "All types leaves out Epics." : undefined} />
      </div>
    </fieldset>
  );
}

