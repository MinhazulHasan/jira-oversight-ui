"use client";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useRestoreCount } from "@/lib/api/ignore-hooks";
import type { Finding } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

export interface RestoreDialogProps {
  /** The ignored findings to restore; null while nothing is asked. */
  findings: readonly Finding[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoring: boolean;
  failure: string | null;
  onRestore: (reopened: number) => void;
  fallbackFocus?: () => HTMLElement | null | undefined;
}

/** Several restored at once: what comes back, said before it runs. */
export function RestoreDialog({ findings, open, onOpenChange, restoring, failure, onRestore, fallbackFocus }: RestoreDialogProps) {
  const locale = useFigureLocale();
  const reopened = useRestoreCount(findings, open);
  const count = reopened ?? findings?.length ?? 0;
  const wholeTickets = new Set((findings ?? []).filter((finding) => finding.ignore?.scope === "ticket").map((finding) => finding.issue_key)).size;
  const noun = count === 1 ? "finding" : "findings";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (restoring) return;
        onOpenChange(next);
      }}
      width={480}
      title={
        <>
          Restore <span className="mono">{formatCount(count, { locale })}</span> {noun}?
        </>
      }
      description="Their ignores are removed. The rules check them again, and the ones they still hold count as open."
      notice={
        failure ? (
          <div role="alert">
            <Callout tone="warn" title="Couldn't restore">
              {failure} Nothing was changed.
            </Callout>
          </div>
        ) : null
      }
      onOpenAutoFocus={(event) => {
        // Keeping them is the safe default: the press on Restore is the choice.
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.querySelector<HTMLElement>("[data-restore-keep]")?.focus();
      }}
      fallbackFocus={fallbackFocus}
      footer={
        <>
          <Button variant="secondary" disabled={restoring} onClick={() => onOpenChange(false)} data-restore-keep="">
            Keep ignored
          </Button>
          <Button variant="primary" loading={restoring} onClick={() => onRestore(count)} data-restore-confirm="">
            {restoring ? "Restoring…" : `Restore ${formatCount(count, { locale })} ${noun}`}
          </Button>
        </>
      }
    >
      {wholeTickets > 0 ? (
        <p className="text-sm text-pretty text-ink-mid" data-restore-tickets="">
          {wholeTickets === 1
            ? "One of them was ignored with every rule on its ticket, so that ticket's other ignored findings come back too."
            : `${formatCount(wholeTickets, { locale })} tickets were ignored with every rule on them, so their other ignored findings come back too.`}
        </p>
      ) : null}
    </Dialog>
  );
}
