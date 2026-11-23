import { Fragment } from "react";

import type { AskResponse } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { describeParams, toolLabel } from "./describe";
import { WithPeople } from "./people-in-facts";

/** A call's parameters in words, ids in mono: "rule R-FLOW-03 · open and resolved · last 7 days". */
export function ParamsInWords({ tool, params }: { tool: string; params: AskResponse["plan"][number]["params"] }) {
  const phrases = describeParams(tool, params);
  if (phrases.length === 0) return <span>no parameters</span>;
  return (
    <>
      {phrases.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <span className="text-ink-low"> · </span> : null}
          {item.lead ? `${item.lead} ` : null}
          <span className={cn(item.mono && "mono")}>
            <WithPeople text={item.text} />
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * The catalogue calls a question was planned into, in words: what was looked
 * at (no data), or what would have been looked at (not measurable).
 */
export function PlanSteps({ plan, className }: { plan: AskResponse["plan"]; className?: string }) {
  if (plan.length === 0) return null;
  return (
    <ol className={cn("flex flex-col gap-2", className)}>
      {plan.map((step, index) => (
        <li key={`${step.tool}-${index}`} className="flex min-w-0 items-baseline gap-2.5 text-sm">
          <span aria-hidden className="mono w-4 shrink-0 text-right text-[11px] text-ink-low">
            {index + 1}
          </span>
          <span className="min-w-0">
            <span className="font-medium text-ink">{toolLabel(step.tool)}</span>
            <span className="text-ink-mid">
              {" "}
              <ParamsInWords tool={step.tool} params={step.params} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
