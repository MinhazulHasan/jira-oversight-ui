"use client";

import { stageColour } from "@/components/charts/palette";
import { Badge, SeverityMark } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { ProcessStage, Rule, Rules } from "@/lib/api/schemas";
import { formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";

import { EVIDENCE_LABEL, fieldName } from "./labels";

type Process = Rules["process"];

/*
 * All nine stages on one line at full width, their segments joined into one
 * track by a 2 px gap of the sheet; three to a line in a narrower column and
 * two on a phone. Container queries, so the rail being open or closed decides
 * the layout rather than the window.
 */
const TRACK = "grid grid-cols-2 gap-x-4 gap-y-6 @lg:grid-cols-3 @5xl:grid-cols-9 @5xl:gap-x-0.5";
const TEXT = "flex min-w-0 flex-col gap-1.5 @5xl:pr-3";

/** A stage is measurable when Jira records it somewhere: a status or a field. */
export function isTracked(stage: ProcessStage): boolean {
  return stage.measurable && stage.evidence !== "none";
}

function EvidenceState({ stage }: { stage: ProcessStage }) {
  if (!isTracked(stage)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-low">
        <SeverityMark severity="not-measurable" size={10} />
        Not measurable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-mid">
      <SeverityMark severity="resolved" size={10} />
      <span>
        <span className="sr-only">{EVIDENCE_LABEL[stage.evidence]}</span>
        <span aria-hidden>{stage.evidence === "field" ? "By a field" : "By status"}</span>
      </span>
    </span>
  );
}

/** What Jira holds for the stage: its statuses, the estimate field, or nothing. */
function StageSource({ stage, estimate }: { stage: ProcessStage; estimate: Process["estimate"] }) {
  const locale = useFigureLocale();
  if (stage.mapped_statuses.length > 0) {
    return (
      <ul aria-label={`Jira statuses for ${stage.label}`} className="flex min-w-0 flex-wrap gap-1">
        {stage.mapped_statuses.map((status) => (
          <li key={status} className="min-w-0 max-w-full">
            {/* Status names are read in full: a long one wraps rather than losing its end. */}
            <Badge size="sm" className="h-auto min-h-5 max-w-full py-1 leading-tight whitespace-normal" title={status}>
              <span className="[overflow-wrap:anywhere]">{status}</span>
            </Badge>
          </li>
        ))}
      </ul>
    );
  }
  if (isTracked(stage) && stage.evidence === "field") {
    const isEstimate = stage.stage === "estimate";
    return (
      <p className="flex min-w-0 flex-col text-xs">
        <span className="truncate text-ink">{isEstimate ? fieldName(estimate.field) : "A Jira field"}</span>
        {isEstimate && estimate.hours_per_point !== null ? (
          <span className="text-ink-low">
            <span className="mono" data-figure>
              {formatHours(estimate.hours_per_point, { locale })}
            </span>{" "}
            per point
          </span>
        ) : null}
      </p>
    );
  }
  return <p className="text-xs text-ink-low">{isTracked(stage) ? "No status mapped" : "No status or field"}</p>;
}

function StageCell({ stage, estimate }: { stage: ProcessStage; estimate: Process["estimate"] }) {
  const tracked = isTracked(stage);
  return (
    <li className="flex min-w-0 flex-col gap-3" data-stage={stage.stage} data-evidence={tracked ? stage.evidence : "none"}>
      <span
        aria-hidden
        className={cn("block h-2 rounded-[3px]", !tracked && "hatch border border-hatch-edge/60")}
        style={tracked ? { background: stageColour(stage.stage) } : undefined}
      />
      <div className={TEXT}>
        <p className="text-sm font-medium text-ink">{stage.label}</p>
        <EvidenceState stage={stage} />
        <StageSource stage={stage} estimate={estimate} />
        {stage.note ? <p className="sr-only">{stage.note}</p> : null}
      </div>
    </li>
  );
}

/**
 * The rules the gap in the evidence stops, each opening its drawer. The steps themselves are marked "Not measurable"
 * in the strip above, so they are not listed again (SQA: the same five steps were said twice). Nothing when every
 * rule can run.
 */
function BlockedRules({ rules, onOpenRule }: { rules: readonly Rule[]; onOpenRule: (ruleId: string) => void }) {
  const blocked = rules.filter((rule) => !rule.measurable);
  if (blocked.length === 0) return null;
  return (
    <Callout tone="not-measurable" title={blocked.length === 1 ? "This rule can't run: Jira doesn't record the steps it needs." : "These rules can't run: Jira doesn't record the steps they need."}>
      <ul className="mt-1 flex flex-col gap-0.5">
        {blocked.map((rule) => (
          <li key={rule.rule_id}>
            <button
              type="button"
              onClick={() => onOpenRule(rule.rule_id)}
              className="pressable -mx-1 inline-flex max-w-full items-baseline gap-2 rounded-xs px-1 py-0.5 text-left hover:bg-hover"
            >
              <span className="mono shrink-0 text-cite">{rule.rule_id}</span>{" "}
              {/* Read whole: on a phone a long title wraps under itself, beside its id. */}
              <span className="min-w-0 break-words text-ink" data-blocked-rule-title>
                {rule.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Callout>
  );
}

function ProcessMapSkeleton() {
  return (
    <SkeletonGroup label="Loading the agreed process" className="flex flex-col gap-5">
      <div className="@container">
        <div className={TRACK}>
          {Array.from({ length: 9 }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="h-2 rounded-[3px]" />
              <div className={cn(TEXT, "gap-2")}>
                <Skeleton className="h-3 w-20 max-w-full" />
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-5 w-16 max-w-full rounded-pill" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-24 w-full rounded-md" />
    </SkeletonGroup>
  );
}

export interface ProcessMapProps {
  /** The process from GET rules; undefined while it loads. */
  process: Process | undefined;
  rules: readonly Rule[] | undefined;
  onOpenRule: (ruleId: string) => void;
}

/** The agreed process as a flow: each stage, the statuses that record it, and whether Jira can prove it. */
export function ProcessMap({ process, rules, onOpenRule }: ProcessMapProps) {
  if (!process || !rules) return <ProcessMapSkeleton />;
  if (process.stages.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No stages in the agreed process"
        description={"No stages are mapped to Jira yet."}
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="@container">
        <ol aria-label="The agreed process, in order" className={TRACK}>
          {process.stages.map((stage) => (
            <StageCell key={stage.stage} stage={stage} estimate={process.estimate} />
          ))}
        </ol>
      </div>
      <BlockedRules rules={rules} onOpenRule={onOpenRule} />
    </div>
  );
}
