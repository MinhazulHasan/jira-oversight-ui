"use client";

import { Check } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { CreditField, CreditOption, PeopleCredit } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { autoField, choiceLine, choiceName, coverageOf, recommended, sameChoice, type Choice, type Coverage } from "./model";

/** A choice as the radio group keys it. */
export const choiceKey = (choice: { source: string; field: { key: string } | null }) => `${choice.source}:${choice.field?.key ?? ""}`;

const percent = (share: number) => `${Math.min(1, Math.max(0, share)) * 100}%`;

/** The share of the finished work that counts for someone under the choice: a bar, and the same in words. */
function CoverageLine({ coverage, id }: { coverage: Coverage; id: string }) {
  if (coverage.credited === null) {
    return (
      <span id={id} className="mt-1 text-xs text-ink-low">
        {coverage.words}
      </span>
    );
  }
  return (
    <span className="mt-2 flex min-w-0 flex-col gap-1.5" data-coverage>
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill" style={{ background: "var(--chart-track)" }}>
          <span className="jo-meter-fill absolute inset-y-0 left-0 rounded-pill" style={{ width: percent(coverage.credited), background: "var(--series-1)" }} />
        </span>
        <span aria-hidden className="mono w-11 shrink-0 text-right text-sm font-medium text-ink" data-figure>
          {coverage.share}
        </span>
      </span>
      <span id={id} className="text-xs text-ink-low">
        <span className="mono text-ink-mid" data-figure>
          {coverage.creditedCount}
        </span>{" "}
        of{" "}
        <span className="mono text-ink-mid" data-figure>
          {coverage.finishedCount}
        </span>{" "}
        {coverage.words}
      </span>
    </span>
  );
}

function OptionCard({
  option,
  inUse,
  reads,
  finished,
  days,
}: {
  option: CreditOption;
  inUse: boolean;
  reads: CreditField | null;
  finished: number;
  days: number;
}) {
  const id = useId();
  const locale = useFigureLocale();
  const coverage = coverageOf(option, finished, days, locale);
  return (
    <RadioGroup.Item
      value={choiceKey(option)}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-line ${id}-coverage`}
      data-credit-option={choiceKey(option)}
      className={cn(
        "group pressable relative flex w-full min-w-0 items-start gap-3 rounded-md border border-rule bg-sheet px-4 py-3.5 text-left",
        "hover:border-rule-strong hover:bg-rail",
        "data-[state=checked]:border-ink data-[state=checked]:bg-sheet data-[state=checked]:shadow-[inset_0_0_0_1px_var(--text-hi)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <span
        aria-hidden
        className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full border border-rule-control bg-sheet transition-colors duration-150 group-hover:border-ink-low group-data-[state=checked]:border-ink"
      >
        <RadioGroup.Indicator className="block size-2 rounded-full bg-ink" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span id={`${id}-name`} className="text-sm font-medium text-ink">
            {choiceName(option)}
          </span>
          {recommended(option) && !inUse ? (
            <Badge tone="muted" size="sm">
              Recommended
            </Badge>
          ) : null}
          {inUse ? (
            <Badge size="sm" className="ml-auto gap-1" data-in-use>
              <Check aria-hidden size={11} strokeWidth={2} />
              In use
            </Badge>
          ) : null}
        </span>
        <span id={`${id}-line`} className="text-xs leading-[18px] text-ink-mid">
          {choiceLine(option, reads, finished > 0 && option.source === "auto" && option.source_filled === 0)}
        </span>
        <CoverageLine coverage={coverage} id={`${id}-coverage`} />
      </span>
    </RadioGroup.Item>
  );
}

export interface CreditOptionsProps {
  credit: PeopleCredit;
  value: Choice;
  onValueChange: (choice: Choice) => void;
  disabled?: boolean;
}

/** Each choice the board offers as a card, the one chosen marked in ink: what it does, and how much of the finished work it describes. */
export function CreditOptions({ credit, value, onValueChange, disabled = false }: CreditOptionsProps) {
  const current: Choice = { source: credit.setting.source, field: credit.setting.field };
  const reads = autoField(credit);
  const arrowAt = useRef(0);
  return (
    <RadioGroup.Root
      onKeyDownCapture={(event) => {
        if (event.key.startsWith("Arrow")) arrowAt.current = event.timeStamp;
      }}
      // Radix picks on arrow focus only while the key is still down; a quick tap would move focus without choosing.
      onFocus={(event) => {
        const target = event.target;
        if (event.timeStamp - arrowAt.current < 400 && target instanceof HTMLElement && target.getAttribute("role") === "radio" && target.dataset.state === "unchecked") target.click();
      }}
      value={choiceKey(value)}
      onValueChange={(next) => {
        const option = credit.options.find((candidate) => choiceKey(candidate) === next);
        if (option) onValueChange({ source: option.source, field: option.field });
      }}
      aria-label="Whom tickets count for"
      disabled={disabled}
      loop
      className="flex flex-col gap-2"
    >
      {credit.options.map((option) => (
        <OptionCard
          key={choiceKey(option)}
          option={option}
          inUse={sameChoice(option, current)}
          reads={reads}
          finished={credit.finished}
          days={credit.period.days}
        />
      ))}
    </RadioGroup.Root>
  );
}

/** The cards while the setting loads: the same cards in their final shape, so nothing moves when it arrives. */
export function CreditOptionsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonGroup label="Loading whom tickets count for" className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-start gap-3 rounded-md border border-rule-weak px-4 py-3.5">
          <Skeleton className="mt-[3px] size-4 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex h-5 items-center">
              <Skeleton className={cn("h-3", index === 0 ? "w-20" : "w-16")} />
            </span>
            <span className="flex h-[18px] items-center">
              <Skeleton className="h-2.5 w-64 max-w-full" />
            </span>
            <span className="mt-2 flex items-center gap-3">
              <Skeleton className="h-1.5 flex-1 rounded-pill" />
              <Skeleton className="h-3 w-8" />
            </span>
            <span className="mt-1.5 flex h-[17px] items-center">
              <Skeleton className="h-2.5 w-60 max-w-full" />
            </span>
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}
