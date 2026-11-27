"use client";

import { RadioGroup } from "radix-ui";
import { useId, useState } from "react";

import { useAriaShortcut } from "@/components/shell/kbd";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { TextArea } from "@/components/ui/text-field";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useIgnorePreview } from "@/lib/api/ignore-hooks";
import type { IgnorePreview, IgnoreRequest, IgnoreTarget } from "@/lib/api/ignores";
import { IGNORE_REASON_MAX, type IgnoreScope } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What the admin asked to ignore, and how the dialog offers it. */
export interface IgnoreAsk {
  target: IgnoreTarget;
  /** The scope it opens at. */
  scope: IgnoreScope;
  /** Whether the admin picks between the findings' own rules and every rule on their tickets. */
  choose: boolean;
  /** One ticket's key, when the target is about one ticket ("DEMO-12"): the choice names it. */
  ticket: string | null;
  /** One rule, when the target is one finding: the choice names it. */
  ruleId: string | null;
}

export interface IgnoreDialogProps {
  ask: IgnoreAsk | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  /** Why the last ignore did not go through, in plain words. */
  failure: string | null;
  onIgnore: (body: IgnoreRequest, preview: IgnorePreview) => void;
  fallbackFocus?: () => HTMLElement | null | undefined;
}

const characters = (text: string) => [...text].length;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
const findingsWord = (count: number) => (count === 1 ? "finding" : "findings");

/** The two scopes as cards, in the words of what is being ignored: one finding, one ticket, or many. */
function scopeWords(ask: IgnoreAsk): Record<IgnoreScope, { name: string; line: string }> {
  if (ask.ticket && ask.ruleId) {
    return {
      finding: { name: "Only this rule", line: `${ask.ruleId} on ${ask.ticket}, now and if it fires again.` },
      ticket: { name: "Every rule on this ticket", line: `All of ${ask.ticket}'s findings, now and later.` },
    };
  }
  return {
    finding: { name: "Only these rules", line: "Each finding's own rule on its ticket." },
    ticket: { name: "Every rule on these tickets", line: "All findings on the tickets, now and later." },
  };
}

function ScopeCards({ ask, value, onValueChange }: { ask: IgnoreAsk; value: IgnoreScope; onValueChange: (scope: IgnoreScope) => void }) {
  const id = useId();
  const words = scopeWords(ask);
  return (
    <section aria-labelledby={`${id}-head`} className="flex flex-col gap-2">
      <h3 id={`${id}-head`} className="micro text-ink-low">
        What to ignore
      </h3>
      <RadioGroup.Root
        value={value}
        onValueChange={(next) => onValueChange(next === "ticket" ? "ticket" : "finding")}
        aria-labelledby={`${id}-head`}
        loop
        className="grid gap-2 sm:grid-cols-2"
      >
        {(["finding", "ticket"] as const).map((scope) => (
          <RadioGroup.Item
            key={scope}
            value={scope}
            aria-labelledby={`${id}-${scope}-name`}
            aria-describedby={`${id}-${scope}-line`}
            data-ignore-scope={scope}
            className={cn(
              "group pressable relative flex w-full min-w-0 items-start gap-3 rounded-md border border-rule bg-sheet px-3.5 py-3 text-left",
              "hover:border-rule-strong hover:bg-rail",
              "data-[state=checked]:border-ink data-[state=checked]:bg-sheet data-[state=checked]:shadow-[inset_0_0_0_1px_var(--text-hi)]",
            )}
          >
            <span
              aria-hidden
              className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full border border-rule-control bg-sheet transition-colors duration-150 group-hover:border-ink-low group-data-[state=checked]:border-ink motion-reduce:transition-none"
            >
              <RadioGroup.Indicator className="block size-2 rounded-full bg-ink" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span id={`${id}-${scope}-name`} className="text-sm font-medium text-ink">
                {words[scope].name}
              </span>
              <span id={`${id}-${scope}-line`} className="text-xs leading-[18px] text-pretty text-ink-mid">
                {words[scope].line}
              </span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </section>
  );
}

const PREVIEW_ROWS = 3;

/** What the ignore would take now, by rule, from the service's own preview: the count the button says is this one. */
function Preview({ preview, retry }: { preview: ReturnType<typeof useIgnorePreview>; retry: () => void }) {
  const locale = useFigureLocale();
  const id = useId();
  const figure = (value: number) => (
    <span className="mono font-medium text-ink" data-figure>
      {formatCount(value, { locale })}
    </span>
  );
  const data = preview.data;
  let body;
  if (preview.error && !data) {
    body = (
      <div className="rounded-md border border-rule-weak">
        <ErrorState size="compact" title="Couldn't work out what this ignores" description={preview.error.message} onRetry={retry} retrying={preview.isFetching} />
      </div>
    );
  } else if (!data) {
    body = (
      <SkeletonGroup label="Working out what this ignores" className="overflow-hidden rounded-md border border-rule-weak">
        <span className="flex h-10 items-center border-b border-rule-weak bg-rail px-3">
          <Skeleton className="h-3 w-44" />
        </span>
        {Array.from({ length: PREVIEW_ROWS }, (_, row) => (
          <span key={row} className="flex h-9 items-center gap-3 border-b border-rule-weak px-3 last:border-b-0">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 flex-1" style={{ maxWidth: `${[62, 48, 55][row]}%` }} />
            <Skeleton className="ml-auto h-2.5 w-6" />
          </span>
        ))}
      </SkeletonGroup>
    );
  } else {
    body = (
      <div
        className={cn(
          "overflow-hidden rounded-md border border-rule-weak transition-opacity duration-150 motion-reduce:transition-none",
          preview.isPlaceholderData && "opacity-60",
        )}
        aria-busy={preview.isPlaceholderData || undefined}
        data-ignore-preview=""
      >
        <p className="flex min-h-10 items-center border-b border-rule-weak bg-rail px-3 py-2 text-sm text-ink-mid" role="status">
          {data.findings === 0 ? (
            <span>Nothing open to ignore.</span>
          ) : (
            <span>
              {figure(data.findings)} open {findingsWord(data.findings)} on {figure(data.tickets)} {data.tickets === 1 ? "ticket" : "tickets"}
            </span>
          )}
        </p>
        {data.by_rule.length > 0 ? (
          <ScrollArea axis="y" label="Findings by rule" className="max-h-[11.25rem] overscroll-contain">
            <ul className="divide-y divide-rule-weak">
              {data.by_rule.map((entry) => (
                <li key={entry.rule_id} className="flex h-9 items-center gap-3 px-3 text-sm" data-preview-rule={entry.rule_id}>
                  <span className="mono w-[4.75rem] shrink-0 text-xs text-ink-low">{entry.rule_id}</span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={entry.rule_title}>
                    {entry.rule_title}
                  </span>
                  <span className="mono shrink-0 text-ink" data-figure>
                    {formatCount(entry.findings, { locale })}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : null}
      </div>
    );
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="micro text-ink-low">
        What it ignores now
      </h3>
      {body}
      <p className="text-xs text-ink-low" data-already-ignored="">
        {data && data.already_ignored > 0
          ? `${formatCount(data.already_ignored, { locale })} ${data.already_ignored === 1 ? "is" : "are"} ignored already and left as they are. `
          : ""}
        Ignored findings leave every open count. Nothing changes in Jira.
      </p>
    </section>
  );
}

export function IgnoreDialog({ ask, open, onOpenChange, saving, failure, onIgnore, fallbackFocus }: IgnoreDialogProps) {
  const locale = useFigureLocale();
  const reasonId = useId();
  const shortcut = useAriaShortcut(["mod", "Enter"]);
  const [scope, setScope] = useState<IgnoreScope>(ask?.scope ?? "finding");
  const [reason, setReason] = useState("");
  const preview = useIgnorePreview(open && ask ? { target: ask.target, scope } : null);
  const data = preview.data;
  const length = characters(reason);
  const reasonIssue =
    length > IGNORE_REASON_MAX
      ? `At most ${formatCount(IGNORE_REASON_MAX, { locale })} characters.`
      : EMAIL.test(reason)
        ? "Leave out email addresses: every admin reads the reason."
        : null;
  const count = data?.findings ?? null;
  const blocked = saving || !data || preview.isFetching || data.findings === 0 || reasonIssue !== null;

  const submit = () => {
    if (!ask || !data || blocked) return;
    const said = reason.trim();
    onIgnore({ target: ask.target, scope, reason: said === "" ? null : said }, data);
  };

  const title =
    count === null ? (
      <span className="inline-flex items-center gap-2">
        Ignore <Skeleton className="inline-block h-4 w-9 align-middle" /> findings?
      </span>
    ) : count === 0 ? (
      "Nothing to ignore"
    ) : (
      <>
        Ignore <span className="mono">{formatCount(count, { locale })}</span> {findingsWord(count)}?
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      width={540}
      title={title}
      description={count === 1 ? "It stops counting as open. You can restore it at any time." : "They stop counting as open. You can restore them at any time."}
      notice={
        failure ? (
          <div role="alert">
            <Callout tone="warn" title="Couldn't ignore">
              {failure} Nothing was changed.
            </Callout>
          </div>
        ) : null
      }
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (!(event.currentTarget instanceof HTMLElement)) return;
        // The chosen scope where there is a choice, else the reason: typing starts at once.
        const first = event.currentTarget.querySelector<HTMLElement>('[role="radio"][data-state="checked"], textarea');
        (first ?? event.currentTarget).focus({ preventScroll: true });
      }}
      fallbackFocus={fallbackFocus}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
        event.preventDefault();
        submit();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Tooltip content="Ignore" shortcut={["mod", "↵"]}>
            <Button variant="primary" loading={saving} disabled={blocked && !saving} onClick={submit} aria-keyshortcuts={shortcut} data-ignore-confirm="">
              {saving ? "Ignoring…" : count ? `Ignore ${formatCount(count, { locale })} ${findingsWord(count)}` : "Ignore"}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="flex flex-col gap-6 text-sm">
        {ask?.choose ? <ScopeCards ask={ask} value={scope} onValueChange={setScope} /> : null}
        <Preview preview={preview} retry={() => void preview.refetch()} />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={reasonId} className="text-sm font-medium text-ink">
              Reason <span className="font-normal text-ink-low">(optional)</span>
            </label>
            <span className={cn("mono text-xs", length > IGNORE_REASON_MAX ? "text-breach-ink" : "text-ink-low")} aria-hidden>
              {formatCount(length, { locale })}/{formatCount(IGNORE_REASON_MAX, { locale })}
            </span>
          </div>
          <TextArea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            invalid={reasonIssue !== null}
            aria-describedby={`${reasonId}-note`}
            placeholder="Closed before the team estimated work."
          />
          <p id={`${reasonId}-note`} aria-live="polite" className={cn("text-xs", reasonIssue ? "text-breach-ink" : "text-ink-low")}>
            {reasonIssue ?? "Shown with the ignore, with your name."}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
