"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { useId, useState } from "react";

import { SeverityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { TextArea } from "@/components/ui/text-field";
import { useFigureLocale } from "@/components/ui/use-figures";
import { getIgnored } from "@/lib/api/client";
import { oversightKeys, useRules } from "@/lib/api/hooks";
import { useIgnorePreview } from "@/lib/api/ignore-hooks";
import { canonicalIgnoreQuery, type IgnoreRecord, type IgnoreRequest } from "@/lib/api/ignores";
import { FINDINGS_PAGE_SIZES } from "@/lib/api/params";
import { IGNORE_REASON_MAX, type Severity } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Every open finding on a finished ticket, on the whole board. */
const FINISHED = { query: canonicalIgnoreQuery({ ticket: "finished" }) };
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

interface RuleRow {
  ruleId: string;
  title: string;
  severity: Severity | null;
  open: number;
  /** Findings held by this rule's own ignores on finished tickets. */
  ignored: number;
  ignoreIds: string[];
}

type Mark = boolean | "indeterminate";

/** At most 10,000 ignores, as many as one request may restore. */
const MAX_PAGES = 100;

/** Every ignore on the board, page by page: the ignored list is the one place that says which are by rule. */
async function allIgnores(signal: AbortSignal): Promise<IgnoreRecord[]> {
  const all: IgnoreRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const next = await getIgnored({ page, page_size: FINDINGS_PAGE_SIZES.max }, { signal });
    all.push(...next.items);
    if (next.items.length < next.page_size || all.length >= next.total) break;
  }
  return all;
}

const startMark = (row: RuleRow): Mark => (row.ignored === 0 ? false : row.open === 0 ? true : "indeterminate");
/** A rule with nothing on finished tickets: listed, but there is nothing to ignore or restore. */
const idle = (row: RuleRow) => row.open === 0 && row.ignored === 0;
const SEVERITY_ORDER: Record<Severity, number> = { breach: 0, warning: 1 };

export interface FinishedIgnoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ignore: (body: IgnoreRequest) => Promise<{ findings: number }>;
  restore: (ignoreIds: string[]) => Promise<void>;
  onSaved: (ignored: number, restored: number) => void;
  fallbackFocus?: () => HTMLElement | null | undefined;
}

/** Which rules are ignored on finished tickets, as one list to change: tick to ignore a rule there, untick to count it again. */
export function FinishedIgnoreDialog({ open, onOpenChange, ignore, restore, onSaved, fallbackFocus }: FinishedIgnoreDialogProps) {
  const locale = useFigureLocale();
  const listId = useId();
  const reasonId = useId();
  const count = (value: number) => formatCount(value, { locale });
  const preview = useIgnorePreview(open ? { target: FINISHED, scope: "finding" } : null);
  const ignores = useQuery({
    queryKey: [...oversightKeys.findings(), "finished-rules"],
    queryFn: ({ signal }) => allIgnores(signal),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const rules = useRules();
  const loading = !preview.data || !ignores.data || !rules.data;
  const failed = (preview.error && !preview.data) || (ignores.error && !ignores.data) || (rules.error && !rules.data);

  // Every rule that runs on the board, breaches first, each with what it has on finished tickets.
  const rows: RuleRow[] = [];
  let wholeTicket = 0;
  if (preview.data && ignores.data && rules.data) {
    const severityOf = new Map(rules.data.rules.map((rule) => [rule.rule_id, rule.severity]));
    const blank = (ruleId: string, title: string): RuleRow => ({ ruleId, title, severity: severityOf.get(ruleId) ?? null, open: 0, ignored: 0, ignoreIds: [] });
    const byRule = new Map<string, RuleRow>();
    for (const rule of rules.data.rules) if (rule.enabled) byRule.set(rule.rule_id, blank(rule.rule_id, rule.title));
    for (const entry of preview.data.by_rule) {
      const row = byRule.get(entry.rule_id) ?? blank(entry.rule_id, entry.rule_title);
      row.open = entry.findings;
      byRule.set(entry.rule_id, row);
    }
    for (const record of ignores.data) {
      if (record.status_category !== "done" || record.findings === 0) continue;
      if (record.scope === "ticket" || record.rule_id === null) {
        wholeTicket += record.findings;
        continue;
      }
      const row = byRule.get(record.rule_id) ?? blank(record.rule_id, record.rule_title ?? record.rule_id);
      row.ignored += record.findings;
      row.ignoreIds.push(record.ignore_id);
      byRule.set(record.rule_id, row);
    }
    const rank = (row: RuleRow) => (row.severity ? SEVERITY_ORDER[row.severity] : 2);
    rows.push(...[...byRule.values()].sort((a, b) => rank(a) - rank(b) || a.ruleId.localeCompare(b.ruleId)));
  }
  const live = rows.filter((row) => !idle(row));

  const markOf = (row: RuleRow): Mark => marks[row.ruleId] ?? startMark(row);
  const toIgnore = live.filter((row) => marks[row.ruleId] === true && row.open > 0);
  const toRestore = live.filter((row) => marks[row.ruleId] === false && row.ignored > 0);
  const ignoring = toIgnore.reduce((sum, row) => sum + row.open, 0);
  const restoring = toRestore.reduce((sum, row) => sum + row.ignored, 0);
  const allMark: Mark = live.length > 0 && live.every((row) => markOf(row) === true) ? true : live.every((row) => markOf(row) === false) ? false : "indeterminate";

  const length = [...reason].length;
  const reasonIssue =
    length > IGNORE_REASON_MAX ? `At most ${count(IGNORE_REASON_MAX)} characters.` : EMAIL.test(reason) ? "Leave out email addresses: every admin reads the reason." : null;
  const changed = ignoring + restoring > 0;
  const blocked = saving || loading || !changed || (ignoring > 0 && reasonIssue !== null);

  const label =
    ignoring > 0 && restoring > 0
      ? `Ignore ${count(ignoring)}, restore ${count(restoring)}`
      : ignoring > 0
        ? `Ignore ${count(ignoring)} ${ignoring === 1 ? "finding" : "findings"}`
        : restoring > 0
          ? `Restore ${count(restoring)} ${restoring === 1 ? "finding" : "findings"}`
          : "Save";

  const save = async () => {
    if (blocked) return;
    setSaving(true);
    setFailure(null);
    try {
      let ignored = 0;
      if (toIgnore.length > 0) {
        const said = reason.trim();
        const done = await ignore({
          target: { query: canonicalIgnoreQuery({ ticket: "finished", rule: toIgnore.map((row) => row.ruleId) }) },
          scope: "finding",
          reason: said === "" ? null : said,
        });
        ignored = done.findings;
      }
      if (toRestore.length > 0) await restore(toRestore.flatMap((row) => row.ignoreIds));
      onSaved(ignored, restoring);
      onOpenChange(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (failed) {
    body = (
      <div className="rounded-md border border-rule-weak">
        <ErrorState
          size="compact"
          title="Couldn't read the findings on finished tickets"
          description={(preview.error ?? ignores.error ?? rules.error)?.message}
          onRetry={() => {
            void preview.refetch();
            void ignores.refetch();
            void rules.refetch();
          }}
          retrying={preview.isFetching || ignores.isFetching || rules.isFetching}
        />
      </div>
    );
  } else if (loading) {
    body = (
      <SkeletonGroup label="Reading the findings on finished tickets" className="overflow-hidden rounded-md border border-rule-weak">
        <span className="flex h-10 items-center border-b border-rule-weak bg-rail px-3">
          <Skeleton className="h-3 w-44" />
        </span>
        {[62, 48, 55].map((width) => (
          <span key={width} className="flex h-9 items-center gap-3 border-b border-rule-weak px-3 last:border-b-0">
            <Skeleton className="size-3.5 rounded-[3px]" />
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 flex-1" style={{ maxWidth: `${width}%` }} />
            <Skeleton className="ml-auto h-2.5 w-14" />
          </span>
        ))}
      </SkeletonGroup>
    );
  } else if (rows.length === 0) {
    body = <p className="rounded-md border border-rule-weak bg-rail px-3 py-2.5 text-sm text-ink-mid">No rule runs on this board.</p>;
  } else {
    body = (
      <div className="overflow-hidden rounded-md border border-rule-weak" role="group" aria-labelledby={listId}>
        <label className={cn("flex min-h-10 items-center gap-3 border-b border-rule-weak bg-rail px-3 py-2 text-sm text-ink-mid", live.length > 0 ? "cursor-pointer" : "cursor-default")}>
          <Box
            mark={allMark}
            disabled={live.length === 0}
            onChange={(on) => setMarks(Object.fromEntries(live.map((row) => [row.ruleId, on])))}
            label="Every rule"
          />
          <span className="flex-1">Every rule</span>
          <span className="mono text-xs text-ink-low">
            {count(live.reduce((sum, row) => sum + row.open, 0))} open · {count(live.reduce((sum, row) => sum + row.ignored, 0))} ignored
          </span>
        </label>
        <ScrollArea axis="y" label="Rules" className="max-h-[17.5rem] overscroll-contain">
          <ul className="divide-y divide-rule-weak">
            {rows.map((row) => {
              const mark = markOf(row);
              const moved = marks[row.ruleId] !== undefined && marks[row.ruleId] !== startMark(row);
              const quiet = idle(row);
              return (
                <li key={row.ruleId} data-finished-rule={row.ruleId} data-idle={quiet || undefined}>
                  <label
                    className={cn(
                      "flex h-10 items-center gap-3 px-3 text-sm",
                      quiet ? "cursor-default" : "cursor-pointer hover:bg-hover",
                      moved && "bg-rail",
                    )}
                  >
                    <Box
                      mark={quiet ? false : mark}
                      disabled={quiet}
                      onChange={(on) => setMarks((current) => ({ ...current, [row.ruleId]: on }))}
                      label={`${row.ruleId} ${row.title}`}
                    />
                    <span className="w-[4.25rem] shrink-0">{row.severity ? <SeverityBadge severity={row.severity} size="sm" /> : null}</span>
                    <span className={cn("mono w-[4.75rem] shrink-0 text-xs", quiet ? "text-ink-low opacity-70" : "text-ink-low")}>{row.ruleId}</span>
                    <span className={cn("min-w-0 flex-1 truncate", quiet ? "text-ink-low" : "text-ink")} title={row.title}>
                      {row.title}
                    </span>
                    {quiet ? (
                      <span className="shrink-0 text-xs text-ink-low" data-figure>
                        None on finished tickets
                      </span>
                    ) : moved && (mark === true ? row.open > 0 : row.ignored > 0) ? (
                      <span className="shrink-0 text-xs font-medium text-ink" data-figure>
                        {mark === true ? `Ignore ${count(row.open)}` : `Restore ${count(row.ignored)}`}
                      </span>
                    ) : (
                      <span className="mono shrink-0 text-xs text-ink-mid" data-figure>
                        {row.open > 0 ? `${count(row.open)} open` : null}
                        {row.open > 0 && row.ignored > 0 ? " · " : null}
                        {row.ignored > 0 ? `${count(row.ignored)} ignored` : null}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      width={640}
      title="Findings on finished tickets"
      description="Tick a rule to ignore its findings on every finished ticket. Untick it to count them again."
      notice={
        failure ? (
          <div role="alert">
            <Callout tone="warn" title="Couldn't save">
              {failure} Try again.
            </Callout>
          </div>
        ) : null
      }
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
      }}
      fallbackFocus={fallbackFocus}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={blocked && !saving} onClick={() => void save()} data-finished-save="">
            {saving ? "Saving…" : label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 text-sm">
        <section className="flex flex-col gap-2">
          <h3 id={listId} className="micro text-ink-low">
            Rules
          </h3>
          {body}
          <p className="text-xs text-ink-low">
            {wholeTicket > 0
              ? `${count(wholeTicket)} more ${wholeTicket === 1 ? "is" : "are"} ignored with their whole ticket: restore those from the ticket or the Ignored list. `
              : ""}
            Ignored findings leave every open count. Nothing changes in Jira.
          </p>
        </section>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={reasonId} className={cn("text-sm font-medium text-ink", ignoring === 0 && "text-ink-low")}>
              Reason <span className="font-normal text-ink-low">(optional)</span>
            </label>
            <span className={cn("mono text-xs", length > IGNORE_REASON_MAX ? "text-breach-ink" : "text-ink-low")} aria-hidden>
              {count(length)}/{count(IGNORE_REASON_MAX)}
            </span>
          </div>
          <TextArea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            disabled={ignoring === 0}
            invalid={reasonIssue !== null}
            aria-describedby={`${reasonId}-note`}
            placeholder="Closed before the team estimated work."
          />
          <p id={`${reasonId}-note`} aria-live="polite" className={cn("text-xs", reasonIssue ? "text-breach-ink" : "text-ink-low")}>
            {reasonIssue ?? "Shown with the new ignores, with your name."}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

function Box({ mark, onChange, label, disabled = false }: { mark: Mark; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <CheckboxPrimitive.Root
      checked={mark}
      onCheckedChange={(next) => onChange(next === true)}
      aria-label={label}
      disabled={disabled}
      className="pressable flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-rule-control bg-sheet disabled:pointer-events-none disabled:opacity-40 data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink"
    >
      <CheckboxPrimitive.Indicator>
        {mark === "indeterminate" ? (
          <Minus aria-hidden size={10} strokeWidth={3} className="text-sheet" />
        ) : (
          <Check aria-hidden size={10} strokeWidth={3} className="text-sheet" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
