"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { useAriaShortcut } from "@/components/shell/kbd";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { PeopleCredit } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { CreditOptions, CreditOptionsSkeleton } from "./credit-options";
import { sameChoice, type Choice } from "./model";

/** Why a change did not go through, in the page's words. */
export interface CreditProblem {
  /** "stale": someone changed it since; the setting is read again before anyone chooses. */
  kind: "stale" | "refused" | "failed";
  message: string;
}

export interface CreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credit: PeopleCredit | undefined;
  /** The setting could not be read (with nothing on screen to show). */
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  saving: boolean;
  problem: CreditProblem | null;
  onSave: (to: Choice) => void;
}

const focusChosen = (dialog: HTMLElement | null) =>
  dialog?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]') ?? dialog?.querySelector<HTMLElement>('[role="radio"]');

/** "Whom tickets count for": the choices as cards, each with its coverage over the page's period, and Save. */
export function CreditDialog({ open, onOpenChange, credit, failed, retrying, onRetry, saving, problem, onSave }: CreditDialogProps) {
  const locale = useFigureLocale();
  const saveShortcut = useAriaShortcut(["mod", "Enter"]);
  const current: Choice | null = credit ? { source: credit.setting.source, field: credit.setting.field } : null;
  // The choice made in the dialog; none yet means the one in use. Opening the dialog again starts from the one in use.
  const [picked, setPicked] = useState<Choice | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(null);
  }
  const chosen = picked ?? current;
  const changed = chosen !== null && current !== null && !sameChoice(chosen, current);
  const save = () => {
    if (chosen && changed && !saving) onSave(chosen);
  };

  const notice = problem ? (
    <div role="alert">
      <Callout
        tone="warn"
        title={problem.kind === "stale" ? "Changed since you opened this" : "Couldn’t save"}
        action={
          problem.kind === "stale" ? (
            <Button size="sm" icon={RotateCcw} onClick={onRetry} loading={retrying}>
              Look again
            </Button>
          ) : null
        }
      >
        {problem.message}
      </Callout>
    </div>
  ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      width={600}
      title="Whom tickets count for"
      description="Every ticket, open or finished, counts for the people this choice names. Tickets without them count for no one."
      notice={notice}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const dialog = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        (focusChosen(dialog) ?? dialog)?.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
        event.preventDefault();
        save();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Tooltip content="Save" shortcut={["mod", "↵"]}>
            <Button variant="primary" loading={saving} disabled={!changed && !saving} onClick={save} aria-keyshortcuts={saveShortcut} data-credit-save>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Tooltip>
        </>
      }
    >
      <Section
        title="Counts for"
        headingLevel={3}
        className="pt-1"
        actions={
          credit ? (
            <span className="text-xs text-ink-low" data-credit-period>
              Last {credit.period.days} days ·{" "}
              <span className="mono text-ink-mid" data-figure>
                {formatCount(credit.finished, { locale })}
              </span>{" "}
              finished
            </span>
          ) : (
            <Skeleton className="h-3 w-32" />
          )
        }
      >
        {credit && chosen ? (
          <CreditOptions credit={credit} value={chosen} onValueChange={setPicked} disabled={saving} />
        ) : failed ? (
          <ErrorState title="Couldn't load the choices" description="Try again." onRetry={onRetry} retrying={retrying} />
        ) : (
          <CreditOptionsSkeleton />
        )}
      </Section>
    </Dialog>
  );
}
