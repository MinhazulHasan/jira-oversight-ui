"use client";

import { ChevronDown, UserRoundCheck } from "lucide-react";
import { useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { fieldTrigger } from "@/components/ui/surfaces";
import { useSavePeopleCredit, type ApiError } from "@/lib/api/hooks";
import type { PeopleCredit } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { CreditDialog, type CreditProblem } from "./credit-dialog";
import { choiceName, savedTitle, type Choice } from "./model";

const TOAST = "people-credit";

export interface CreditControlProps {
  /** The board's setting over the page's period, as the page read it. */
  credit: PeopleCredit | undefined;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
}

function problemOf(error: ApiError): CreditProblem {
  if (error.status === 409) return { kind: "stale", message: error.message };
  if (error.status === 422) return { kind: "refused", message: error.message };
  return { kind: "failed", message: "Nothing was changed. Try again." };
}

/** "Counts for: Automatic" beside the period: opens whom tickets count for, for an admin to change. */
export function CreditControl({ credit, failed, retrying, onRetry }: CreditControlProps) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<CreditProblem | null>(null);
  const save = useSavePeopleCredit();
  const trigger = useRef<HTMLButtonElement>(null);
  const current: Choice | null = credit ? { source: credit.setting.source, field: credit.setting.field } : null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
        className={cn(fieldTrigger, "h-8 gap-2 pr-2 pl-2.5 text-sm")}
        data-credit-control
      >
        <UserRoundCheck aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        <span className="text-ink-low">Counts for:</span>{" "}
        {current ? (
          <span className="truncate font-medium text-ink" data-credit-choice>
            {choiceName(current)}
          </span>
        ) : failed ? (
          <span className="text-ink-low">Not loaded</span>
        ) : (
          <span className="flex h-4 w-[4.5rem] items-center" aria-hidden>
            <Skeleton className="h-3 w-full" />
          </span>
        )}
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      </button>
      <CreditDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setProblem(null);
        }}
        credit={credit}
        failed={failed}
        retrying={retrying}
        onRetry={() => {
          setProblem(null);
          onRetry();
        }}
        saving={save.isPending}
        problem={problem}
        onSave={async (to) => {
          if (!credit) return;
          try {
            await save.mutateAsync({ source: to.source, field: to.source === "field" ? (to.field?.key ?? null) : null, revision: credit.setting.revision });
          } catch (error) {
            setProblem(problemOf(error as ApiError));
            return;
          }
          setProblem(null);
          notify.ok(savedTitle(to), { id: TOAST });
          setOpen(false);
        }}
      />
    </>
  );
}
