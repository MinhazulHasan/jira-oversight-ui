"use client";

import { ListPlus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAriaShortcut } from "@/components/shell/kbd";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Section } from "@/components/ui/section";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useProjects, useRuleSettings, useRuleSettingsPreview, useSaveRuleSettings, type ApiError } from "@/lib/api/hooks";
import { CUSTOM_RULE_LIMIT, type RuleSettings, type RuleSettingsHistoryEntry } from "@/lib/api/schemas";
import { boardFromCookieHeader } from "@/lib/board";
import { formatCount } from "@/lib/format";
import { notify } from "@/lib/notify";

import { useAddRuleTarget } from "./add-rule";
import { SettingsNote, SettingsStatus, useClock } from "./apply-status";
import { EMPTY_FORM, formDraftRule, formFromRule, type RuleForm } from "./custom-rule-form";
import { CustomRuleSheet } from "./custom-rule-sheet";
import { HistoryList, UndoConfirm } from "./history";
import { LeaveConfirm, useLeaveGuard } from "./leave-guard";
import {
  blockingProblems,
  changeCount,
  changesWord,
  draftOf,
  draftProblems,
  editsOf,
  fieldId,
  fieldPath,
  requestChanges,
  undoChanges,
  type Draft,
  type DraftExtras,
  type DraftRule,
  type NewRule,
} from "./model";
import { ReviewDialog, type RefusedSetting } from "./review-dialog";
import { NewRuleRow, RuleListHead, RuleRow } from "./rule-row";
import { RuleSettingsSkeleton } from "./skeleton";

/** The draft while the reader edits: the board and the settings (at a revision) it started from, and what it is now. */
interface Editing extends DraftExtras {
  project: string;
  base: Draft;
  baseRevision: number;
  draft: Draft;
  /** The rules it adds (JO-20), in the order added; the board's own rules it deletes. */
  added: readonly NewRule[];
  deleted: readonly string[];
}

/** What the review says of a save or a preview that did not go through, under its title. */
interface ReviewProblems {
  /** The service's words about the reason. */
  reason: string | null;
  /** About the settings as a whole. */
  general: string[];
  /** Each setting it refused, by its place (said beside its row too). */
  fields: RefusedSetting[];
  /** A save that failed for any other reason. */
  failure: string | null;
}

const NO_PROBLEMS: ReviewProblems = { reason: null, general: [], fields: [], failure: null };

/** The sheet: a new rule, a saved custom rule to edit (its check locked), or a new one edited before it is saved. */
type SheetTarget = { kind: "new" } | { kind: "edit"; ruleId: string } | { kind: "edit-new"; key: string };

interface SheetState {
  target: SheetTarget;
  /** Each opening a form of its own, from what it opens on. */
  session: number;
  initial: RuleForm;
  /** What the service refused of a new rule, at its fields, when the sheet opens to put it right. */
  refused?: ReadonlyMap<string, string>;
  /** The control that opened it, which takes the focus back as it closes. */
  from: HTMLElement | null;
}

/**
 * The control a problem's place names, to put it right: a threshold's own field; for the severity, its chosen
 * option; for anything else of the rule (on or off, the rule as a whole), its switch.
 */
function controlFor(path: string): HTMLElement | null {
  const [ruleId, field] = path.split(".");
  return (
    document.getElementById(fieldId(path)) ??
    (field === "severity" ? document.querySelector<HTMLElement>(`[data-rule="${ruleId}"] [role="radio"][data-state="checked"]`) : null) ??
    document.getElementById(fieldId(fieldPath(ruleId, "enabled")))
  );
}

/**
 * A refusal's places in the page's terms: a new rule (JO-20) is named by the service, and by this interface's
 * route, as "new-0" for the first the request added; the page knows it by its own key.
 */
function pagePath(path: string, added: readonly NewRule[]): string {
  const match = /^new-(\d+)(\..*)?$/.exec(path);
  const item = match ? added[Number(match[1])] : undefined;
  return item ? `${item.key}${match?.[2] ?? ""}` : path;
}

/** The service's refusal of settings, split into what belongs beside a rule's field and what the review says itself. */
function splitProblems(error: ApiError, settings: RuleSettings, added: readonly NewRule[]): { fields: Map<string, string>; reason: string | null; general: string[] } {
  const ids = new Set([...settings.rules.map((rule) => rule.rule_id), ...added.map((item) => item.key)]);
  const fields = new Map<string, string>();
  let reason: string | null = null;
  const general: string[] = [];
  for (const issue of error.issues) {
    const path = pagePath(issue.path, added);
    const ruleId = path.split(".")[0];
    if (ids.has(ruleId)) fields.set(path, issue.message);
    else if (issue.path === "reason") reason = issue.message;
    else general.push(issue.message);
  }
  if (fields.size === 0 && reason === null && general.length === 0) general.push(error.message);
  return { fields, reason, general };
}

/**
 * Whether the board picked in the top bar is no longer this page's: picked in another tab since (the pick is a
 * cookie every tab shares). A save now would reach that board, so nothing is sent until the page is loaded again.
 */
function pickedElsewhere(project: string): boolean {
  const picked = boardFromCookieHeader(document.cookie);
  return picked !== null && picked !== project;
}

const SAVE_TOAST = "rule-settings";

/**
 * The rule settings page (JO-15): a board's rules, grouped as the catalogue
 * groups them, each with its switch, severity and thresholds, edited as a
 * draft; a bar that counts the unsaved changes; the review (with the
 * service's preview) that saves them; the board's history, the latest with
 * Undo; and whether the findings reflect the settings yet, read every two
 * seconds while the service re-checks the board (and, once the page is left,
 * by the shell's RecheckFollower, which reads every figure the rules decide
 * afresh when the re-check ends).
 *
 * The board's own rules (JO-20) have a group of their own, "Custom rules",
 * with the same controls and Edit and Delete; "Add rule" (the page header's,
 * add-rule.tsx) opens the "New rule" sheet, whose rule joins the draft as
 * "New" until it is saved. A rule added or deleted counts in the bar, shows
 * in the review with what it would do, and can be taken back before saving.
 *
 * The focus never falls to the page's body: a dialog or the sheet gives it
 * back to the control that opened it, and an action that takes its own
 * button away (Discard, a save, an undo) leaves it on the status card, which
 * says where things stand; a refused setting's Edit leaves it on the setting.
 */
export function RuleSettingsView() {
  const query = useRuleSettings();
  const projects = useProjects();
  const preview = useRuleSettingsPreview();
  const save = useSaveRuleSettings();
  const undo = useSaveRuleSettings();
  const locale = useFigureLocale();
  const clock = useClock();
  const statusRef = useRef<HTMLDivElement>(null);
  /** The refused setting whose control takes the focus once the review has closed (its Edit, or a save refused). */
  const editAfterReview = useRef<string | null>(null);
  const reviewShortcut = useAriaShortcut(["mod", "Enter"]);
  /** Numbers the page's new rules, so each has a key of its own until the service gives it an id. */
  const nextKey = useRef(1);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [serverProblems, setServerProblems] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState(false);
  const [boardMoved, setBoardMoved] = useState(false);
  const [review, setReview] = useState<ReviewProblems>(NO_PROBLEMS);
  const [undoing, setUndoing] = useState<{ entry: RuleSettingsHistoryEntry | null; problem: string | null; conflict: boolean }>({
    entry: null,
    problem: null,
    conflict: false,
  });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const settings = query.data;
  const saved = useMemo(() => (settings ? draftOf(settings) : null), [settings]);
  const rules = useMemo(() => settings?.rules ?? [], [settings]);
  const base = editing?.base ?? saved;
  const draft = editing?.draft ?? saved;
  const extras = useMemo<DraftExtras>(() => ({ added: editing?.added ?? [], deleted: editing?.deleted ?? [] }), [editing]);
  const edits = useMemo(() => (base && draft ? editsOf(rules, base, draft, extras) : []), [rules, base, draft, extras]);
  const count = changeCount(edits, extras);
  const dirty = count > 0;
  const shown = useMemo(() => {
    const problems = new Map(draft ? draftProblems(rules, draft, { base: base ?? undefined, touched, locale, extras }) : []);
    for (const [path, message] of serverProblems) if (!problems.has(path)) problems.set(path, message);
    return problems;
  }, [rules, draft, base, touched, locale, serverProblems, extras]);
  const blocking = useMemo(
    () => (base && draft ? blockingProblems(rules, base, draft, locale, extras) : new Map<string, string>()),
    [rules, base, draft, locale, extras],
  );
  const changes = useMemo(
    () => (base && draft ? requestChanges(rules, base, draft, extras, settings?.checks ?? []) : []),
    [rules, base, draft, extras, settings],
  );
  const boardName = projects.data?.projects.find((project) => project.key === settings?.project)?.name ?? null;
  const board = boardName ?? settings?.project ?? "this board";
  const leaving = useLeaveGuard(dirty);
  const deleted = useMemo(() => new Set(extras.deleted), [extras]);
  const standing = settings ? settings.custom_count + extras.added.length : 0;
  const full = settings !== undefined && standing >= settings.custom_limit;

  /** Back to the settings as saved: no draft, nothing left, no problem said. */
  const clearDraft = () => {
    setEditing(null);
    setTouched(new Set());
    setServerProblems(new Map());
    setReason("");
  };

  /** The draft as it starts from the settings as saved, or as it stands. */
  const start = (current: Editing | null): Editing | null =>
    current ?? (settings && saved ? { project: settings.project, base: saved, baseRevision: settings.revision, draft: saved, added: [], deleted: [] } : null);

  /** The draft with a change made, or no draft at all once it changes nothing. */
  const settle = (next: Editing): Editing | null =>
    changeCount(editsOf(rules, next.base, next.draft, next), next) === 0 ? null : next;

  const update = (ruleId: string, next: DraftRule) => {
    setEditing((current) => {
      const from = start(current);
      return from ? settle({ ...from, draft: { ...from.draft, [ruleId]: next } }) : current;
    });
    setServerProblems((current) => new Map([...current].filter(([path]) => path.split(".")[0] !== ruleId)));
  };

  /* --------------------------------------------------- custom rules -- */

  const openSheet = (target: SheetTarget, from: HTMLElement | null, refused?: ReadonlyMap<string, string>) => {
    let initial: RuleForm = EMPTY_FORM;
    if (target.kind === "edit" && draft?.[target.ruleId]?.custom) initial = formFromRule({ ...draft[target.ruleId], custom: draft[target.ruleId].custom! });
    if (target.kind === "edit-new") {
      const item = extras.added.find((candidate) => candidate.key === target.key);
      if (item) initial = formFromRule(item.rule);
    }
    setSheet((current) => ({ target, session: (current?.session ?? 0) + 1, initial, refused, from }));
    setSheetOpen(true);
    // The sheet rises where a toast stands: what a toast says is said elsewhere too, so it steps aside rather than lie
    // over the sheet's "Add to changes", as it does for a person card's sheet.
    notify.dismiss();
  };

  const addRule = (from: HTMLElement | null) => {
    if (!settings || full) return;
    openSheet({ kind: "new" }, from);
  };
  useAddRuleTarget(
    settings ? addRule : null,
    full ? `This board has ${formatCount(settings?.custom_limit ?? CUSTOM_RULE_LIMIT, { locale })} custom rules, the most it holds. Delete one first.` : null,
  );

  /** The sheet's rule put into the draft: a new rule added, or the rule it edited changed. */
  const submitSheet = (form: RuleForm) => {
    if (!sheet) return;
    const { target } = sheet;
    if (target.kind === "new") {
      const key = `draft-${nextKey.current}`;
      nextKey.current += 1;
      setEditing((current) => {
        const from = start(current);
        return from ? settle({ ...from, added: [...from.added, { key, rule: formDraftRule(form) }] }) : current;
      });
      notify.ok("Rule added to your changes", { id: SAVE_TOAST, description: `Review and save to add it to ${board}.` });
    } else if (target.kind === "edit-new") {
      setEditing((current) => {
        const from = start(current);
        if (!from) return current;
        return settle({ ...from, added: from.added.map((item) => (item.key === target.key ? { ...item, rule: formDraftRule(form) } : item)) });
      });
      setServerProblems((current) => new Map([...current].filter(([path]) => path.split(".")[0] !== target.key)));
      notify.ok("New rule changed", { id: SAVE_TOAST, description: "Review and save to add it." });
    } else {
      const now = draft?.[target.ruleId];
      if (now) update(target.ruleId, { ...now, params: { ...form.numbers }, custom: formDraftRule(form, now.enabled).custom });
      notify.ok("Edit added to your changes", { id: SAVE_TOAST, description: `Review and save to change it on ${board}.` });
    }
    setSheetOpen(false);
  };

  /** Where the focus goes as the sheet closes: what opened it, or what stands for it now. */
  const sheetCloseFocus = () => {
    const target = sheet?.target;
    const from = sheet?.from;
    const standIn =
      target?.kind === "edit"
        ? document.querySelector<HTMLElement>(`[data-edit-rule="${target.ruleId}"]`)
        : target?.kind === "edit-new"
          ? document.querySelector<HTMLElement>(`[data-edit-new="${target.key}"]`)
          : null;
    (from?.isConnected ? from : (standIn ?? document.querySelector<HTMLElement>("[data-add-rule]") ?? statusRef.current))?.focus({ preventScroll: false });
  };

  /** After the draft changes the row, the control that stands for an action (Keep for Delete, Delete for Keep) takes the focus. */
  const focusSoon = (selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());

  const deleteRule = (ruleId: string) => {
    setEditing((current) => {
      const from = start(current);
      return from ? settle({ ...from, deleted: [...from.deleted.filter((id) => id !== ruleId), ruleId] }) : current;
    });
    setServerProblems((current) => new Map([...current].filter(([path]) => path.split(".")[0] !== ruleId)));
    focusSoon(`[data-keep-rule="${ruleId}"]`);
    const title = rules.find((rule) => rule.rule_id === ruleId)?.title ?? ruleId;
    notify.info("Marked for deletion", { id: SAVE_TOAST, description: `“${title}” is deleted when you save.` });
  };

  const keepRule = (ruleId: string) => {
    setEditing((current) => {
      const from = start(current);
      return from ? settle({ ...from, deleted: from.deleted.filter((id) => id !== ruleId) }) : current;
    });
    focusSoon(`[data-delete-rule="${ruleId}"]`);
    notify.info("Kept", { id: SAVE_TOAST, description: "The rule is no longer marked for deletion." });
  };

  const discardNew = (key: string) => {
    // The row and its buttons go with it: the status card, which says where the settings stand, has the focus.
    statusRef.current?.focus();
    setEditing((current) => {
      const from = start(current);
      return from ? settle({ ...from, added: from.added.filter((item) => item.key !== key) }) : current;
    });
    setServerProblems((current) => new Map([...current].filter(([path]) => path.split(".")[0] !== key)));
    notify.info("New rule discarded", { id: SAVE_TOAST, description: "It will not be added." });
  };

  /* ------------------------------------------------------ the draft -- */

  const discard = () => {
    // The bar and its buttons go with the draft: the status card, which says where the settings stand, has the focus.
    statusRef.current?.focus();
    clearDraft();
    notify.info("Changes discarded", { id: SAVE_TOAST, description: `${board}'s rule settings are as saved.` });
  };

  const reload = () => {
    setReviewOpen(false);
    setConflict(false);
    clearDraft();
    setUndoing({ entry: null, problem: null, conflict: false });
    void query.refetch();
    notify.info("Settings reloaded", { id: SAVE_TOAST, description: `Showing ${board}'s rule settings as they now stand.` });
  };

  /** Whether the board this page shows is still the one a change would reach; says so on the page when it is not. */
  const onThisBoard = (project: string) => {
    if (!pickedElsewhere(project)) return true;
    setBoardMoved(true);
    return false;
  };

  const openReview = () => {
    if (!settings || !dirty || reviewOpen || !onThisBoard(editing?.project ?? settings.project)) return;
    if (blocking.size > 0) {
      setTouched((current) => new Set([...current, ...blocking.keys()]));
      const [path] = blocking.keys();
      document.getElementById(fieldId(path))?.focus();
      notify.warn("Some values can't be saved", { id: SAVE_TOAST, description: "Each is said beside its rule." });
      return;
    }
    setConflict(false);
    setReview(NO_PROBLEMS);
    save.reset();
    setReviewOpen(true);
    preview.mutate({ changes }, { onError: (error) => onRefused(error, false) });
  };

  /**
   * A refusal of the settings: beside each rule's field, and in the review each refused setting with a way to it,
   * the reason's problem and what belongs to no field. A save whose every problem has its field on the page closes
   * the review on the first of them, there to be put right; a new rule's (JO-20) is put right in its sheet, from
   * the review.
   */
  const onRefused = (error: ApiError, saving: boolean) => {
    if (!settings || error.code !== "rule_settings_invalid") return false;
    const { fields, reason: aboutReason, general } = splitProblems(error, settings, extras.added);
    setServerProblems(fields);
    const onNewRule = [...fields.keys()].some((path) => extras.added.some((item) => path.split(".")[0] === item.key));
    if (saving && fields.size > 0 && aboutReason === null && general.length === 0 && !onNewRule) {
      editAfterReview.current = [...fields.keys()][0];
      setReviewOpen(false);
      notify.warn("Not saved", { id: SAVE_TOAST, description: "The oversight service refused some values. Each is said beside its rule." });
    } else {
      setReview({ reason: aboutReason, general, fields: [...fields].map(([path, message]) => ({ path, message })), failure: null });
    }
    return true;
  };

  /** Puts a refused setting right: the review closes, and the setting's control takes the focus (a new rule's sheet opens). */
  const editRefused = (path: string) => {
    const key = path.split(".")[0];
    const fresh = extras.added.find((item) => item.key === key);
    setReviewOpen(false);
    if (fresh) {
      const refused = new Map(
        [...serverProblems].filter(([place]) => place.split(".")[0] === key).map(([place, message]) => [place.split(".").slice(1).join(".") || "title", message]),
      );
      openSheet({ kind: "edit-new", key }, document.querySelector<HTMLElement>(`[data-edit-new="${key}"]`), refused);
      return;
    }
    editAfterReview.current = path;
  };

  const onSave = () => {
    if (!editing || !settings) return;
    if (editing.project !== settings.project || !onThisBoard(editing.project)) {
      setReviewOpen(false);
      return;
    }
    const said = reason.trim();
    // The board by the name the page gives it (SQA: "Re-checking AIL" beside a page that says "AILED").
    const named = (project: string) => (project === settings.project ? board : project);
    save.mutate(
      { revision: editing.baseRevision, changes, ...(said ? { reason: said } : {}) },
      {
        onSuccess: (next) => {
          setReviewOpen(false);
          clearDraft();
          notify.ok(`Saved. Re-checking ${named(next.project)}…`, { id: SAVE_TOAST, description: `Revision ${next.revision}: ${changesWord(count)}.` });
        },
        onError: (error) => {
          if (error.code === "rule_settings_conflict") {
            setConflict(true);
          } else if (!onRefused(error, true)) {
            // Said in the review, under its title, in view however far its body was scrolled. Not as a toast too: at a
            // laptop's width one would lie over "Save and re-check", the very button a reader tries again with.
            setReview({ ...NO_PROBLEMS, failure: error.message });
          }
        },
      },
    );
  };

  const confirmUndo = () => {
    const entry = undoing.entry;
    if (!entry || !settings) return;
    if (!onThisBoard(settings.project)) {
      setUndoing({ entry: null, problem: null, conflict: false });
      return;
    }
    undo.mutate(
      { revision: settings.revision, changes: undoChanges(entry), undo_of: entry.change_id, reason: `Undo of revision ${entry.revision}` },
      {
        onSuccess: (next) => {
          setUndoing({ entry: null, problem: null, conflict: false });
          notify.ok(`Undone. Re-checking ${next.project === settings.project ? board : next.project}…`, {
            id: SAVE_TOAST,
            description: `Revision ${next.revision} sets back revision ${entry.revision}.`,
          });
        },
        onError: (error) => {
          const conflicted = error.code === "rule_settings_conflict";
          const words = conflicted
            ? "Someone else changed these settings, so nothing was undone. Reload to see them."
            : error.issues.length > 0
              ? error.issues.map((issue) => issue.message).join(" ")
              : `${error.message} Nothing was changed.`;
          setUndoing({ entry, problem: words, conflict: conflicted });
        },
      },
    );
  };

  // Review and save from anywhere on the page: ⌘↵ (Ctrl+Enter elsewhere), as the bar's key cap says; not while the
  // "New rule" sheet is open, which takes ⌘↵ for itself.
  useEffect(() => {
    if (!dirty || sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.defaultPrevented) return;
      event.preventDefault();
      document.querySelector<HTMLButtonElement>("[data-review-and-save]")?.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, sheetOpen]);

  if (!settings && query.error) {
    return (
      <ErrorState
        title="Couldn't load the rule settings"
        description={query.error.message}
        detail={`${query.error.status > 0 ? `HTTP ${query.error.status}` : "No response"} · ${query.error.code}`}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (!settings || !draft || !base) return <RuleSettingsSkeleton />;

  const stale = editing !== null && (settings.revision !== editing.baseRevision || settings.project !== editing.project);
  const groups = [
    { id: "rules", title: "Hard and fast rules", description: "What a ticket must not do.", kind: "rule" },
    { id: "warnings", title: "Early warnings", description: "Signs a rule is about to be broken.", kind: "warning" },
  ] as const;
  const customRules = rules.filter((rule) => rule.custom);
  const checkOf = (name: string) => settings.checks.find((check) => check.name === name);
  /** Every rule's name as the draft has it, the sheet's own rule apart: a new name must be its own on the board. */
  const otherTitles = (own: string | null) => [
    ...rules.filter((rule) => rule.rule_id !== own).map((rule) => ({ rule_id: rule.rule_id, title: draft[rule.rule_id]?.custom?.title ?? rule.title })),
    ...extras.added.filter((item) => item.key !== own).map((item) => ({ rule_id: item.key, title: item.rule.custom.title })),
  ];
  const sheetOwn = sheet ? (sheet.target.kind === "edit" ? sheet.target.ruleId : sheet.target.kind === "edit-new" ? sheet.target.key : null) : null;

  const row = (rule: RuleSettings["rules"][number]) => (
    <RuleRow
      key={rule.rule_id}
      rule={rule}
      draft={draft[rule.rule_id]}
      edited={edits.some((edit) => edit.ruleId === rule.rule_id)}
      problems={shown}
      onChange={(next) => update(rule.rule_id, next)}
      onParamBlur={(name) => setTouched((current) => new Set(current).add(fieldPath(rule.rule_id, `params.${name}`)))}
      check={rule.custom ? checkOf(rule.check) : undefined}
      deleted={deleted.has(rule.rule_id)}
      custom={
        rule.custom
          ? {
              onEdit: (from) => openSheet({ kind: "edit", ruleId: rule.rule_id }, from),
              onDelete: () => deleteRule(rule.rule_id),
              onKeep: () => keepRule(rule.rule_id),
            }
          : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2.5">
        <SettingsStatus ref={statusRef} settings={settings} boardName={boardName} />
        <SettingsNote />
      </div>

      {boardMoved ? (
        <div role="alert">
          <Callout
            tone="warn"
            title="Another board was picked in another tab"
            action={
              <Button size="sm" icon={RotateCcw} onClick={leaving.reload}>
                Reload the page
              </Button>
            }
          >
            Nothing was sent. Reload the page to see the board picked{dirty ? "; your unsaved changes are not kept" : ""}.
          </Callout>
        </div>
      ) : stale ? (
        <Callout
          tone="warn"
          title="These settings changed while you were editing"
          action={
            <Button size="sm" icon={RotateCcw} onClick={reload}>
              Discard and reload
            </Button>
          }
        >
          {settings.updated_by ?? "Someone"} saved revision {formatCount(settings.revision, { locale })}
          {settings.updated_at ? ` at ${clock(settings.updated_at)}` : ""}. Saving your edits would be refused: discard them to
          see the settings as they now stand.
        </Callout>
      ) : null}

      {groups.map((group) => {
        const members = rules.filter((rule) => rule.kind === group.kind && !rule.custom);
        if (members.length === 0) return null;
        return (
          <Section key={group.id} id={group.id} title={group.title} count={formatCount(members.length, { locale })} description={group.description}>
            <div className="@container/rules overflow-hidden rounded-md border border-rule-weak">
              <div className="pt-2.5">
                <RuleListHead />
              </div>
              <ul className="flex flex-col divide-y divide-rule-weak" aria-label={group.title}>
                {members.map(row)}
              </ul>
            </div>
          </Section>
        );
      })}

      <Section
        id="custom"
        title="Custom rules"
        count={formatCount(customRules.length + extras.added.length, { locale })}
        description="Rules added for this board."
      >
        {customRules.length === 0 && extras.added.length === 0 ? (
          <div className="rounded-md border border-rule-weak">
            <EmptyState
              size="compact"
              icon={ListPlus}
              title="No custom rules yet"
              description="Add one for anything the rules above do not check."
              action={
                <Button size="sm" icon={Plus} onClick={(event) => addRule(event.currentTarget)} data-add-rule-empty="">
                  Add rule
                </Button>
              }
            />
          </div>
        ) : (
          <div className="@container/rules overflow-hidden rounded-md border border-rule-weak">
            <div className="pt-2.5">
              <RuleListHead />
            </div>
            <ul className="flex flex-col divide-y divide-rule-weak" aria-label="Custom rules">
              {customRules.map(row)}
              {extras.added.map((item) => (
                <NewRuleRow
                  key={item.key}
                  item={item}
                  check={checkOf(item.rule.custom.check)}
                  onEdit={(from) => openSheet({ kind: "edit-new", key: item.key }, from)}
                  onDiscard={() => discardNew(item.key)}
                />
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section id="history" title="History" count={formatCount(settings.history.length, { locale })} description="Newest first.">
        <HistoryList
          history={settings.history}
          rules={rules}
          checks={settings.checks}
          board={board}
          undoBlocked={dirty ? "Save or discard your changes first: undoing would lose them." : null}
          onUndo={(entry) => setUndoing({ entry, problem: null, conflict: false })}
        />
      </Section>

      {/* The bar's room is kept whether it shows or not, so nothing on the page moves when it appears. While it shows,
          the page keeps a control the keyboard reaches clear of it (data-unsaved-bar, globals.css). */}
      <div className="sticky bottom-4 z-[var(--z-sticky)] -mt-4 flex h-12 justify-center" data-print="hide">
        {dirty ? (
          <div
            role="region"
            aria-label="Unsaved changes"
            data-unsaved-bar=""
            className="rise flex items-center gap-3 rounded-lg border border-rule bg-sheet py-2 pr-2 pl-4 shadow-pop"
          >
            <p className="text-sm whitespace-nowrap text-ink" aria-live="polite">
              <span className="mono">{formatCount(count, { locale })}</span> unsaved {count === 1 ? "change" : "changes"}
            </p>
            <span aria-hidden className="h-5 w-px bg-rule-weak" />
            <Button variant="ghost" size="sm" onClick={() => discard()}>
              Discard
            </Button>
            <Tooltip content="Review and save" shortcut={["mod", "↵"]}>
              <Button variant="primary" size="sm" onClick={openReview} data-review-and-save="" aria-keyshortcuts={reviewShortcut}>
                Review and save
              </Button>
            </Tooltip>
          </div>
        ) : null}
      </div>

      {sheet ? (
        <CustomRuleSheet
          key={sheet.session}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          mode={sheet.target.kind === "new" ? "new" : "edit"}
          ruleId={sheet.target.kind === "edit" ? sheet.target.ruleId : null}
          initial={sheet.initial}
          board={board}
          checks={settings.checks}
          issueTypes={settings.issue_types}
          others={otherTitles(sheetOwn)}
          aiDraft={settings.ai_draft}
          showSeverity={sheet.target.kind !== "edit"}
          refused={sheet.refused}
          onSubmit={submitSheet}
          onCloseFocus={sheetCloseFocus}
        />
      ) : null}

      <ReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        project={settings.project}
        boardName={boardName}
        rules={rules}
        base={base}
        draft={draft}
        edits={edits}
        extras={extras}
        checks={settings.checks}
        preview={{ pending: preview.isPending, data: preview.data, error: preview.error, retry: () => preview.mutate({ changes }) }}
        saving={save.isPending}
        conflict={conflict}
        saveError={review.failure}
        reason={reason}
        onReasonChange={setReason}
        reasonProblem={review.reason}
        refused={review.fields}
        generalProblems={review.general}
        onSave={onSave}
        onReload={reload}
        onEdit={editRefused}
        onCloseAutoFocus={(event) => {
          const path = editAfterReview.current;
          editAfterReview.current = null;
          // A refused setting to put right: its control takes the focus, brought into view.
          const control = path !== null ? controlFor(path) : null;
          if (control) {
            event.preventDefault();
            control.focus();
            return;
          }
          // Saved (or reloaded): the bar and its button are gone, so the reader hears where things stand instead.
          if (!dirty) {
            event.preventDefault();
            statusRef.current?.focus();
          }
        }}
        // Opened by a click that gave the button no focus (Safari): the bar's own button while there are edits.
        fallbackFocus={() => document.querySelector<HTMLElement>("[data-review-and-save]") ?? statusRef.current}
      />
      <UndoConfirm
        entry={undoing.entry}
        rules={rules}
        checks={settings.checks}
        board={board}
        undoing={undo.isPending}
        problem={undoing.problem}
        conflict={undoing.conflict}
        onConfirm={confirmUndo}
        onCancel={() => setUndoing({ entry: null, problem: null, conflict: false })}
        onReload={reload}
        // Undone: the change it undid is no longer the latest, so its Undo is gone; the status says where things stand.
        fallbackFocus={() => statusRef.current}
      />
      <LeaveConfirm
        open={leaving.asking}
        what={`${formatCount(count, { locale })} unsaved ${count === 1 ? "change" : "changes"} to ${board}’s rule settings`}
        onStay={leaving.stay}
        onLeave={leaving.leave}
        // Asked from the palette, whose field is gone by now: staying, the bar's Review and save stands for the edits.
        fallbackFocus={() => document.querySelector<HTMLElement>("[data-review-and-save]")}
      />
    </div>
  );
}
