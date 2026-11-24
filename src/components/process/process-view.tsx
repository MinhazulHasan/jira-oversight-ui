"use client";

import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { usePeopleLevel } from "@/components/shell/people-level";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useRules, type ApiError } from "@/lib/api/hooks";
import type { ProcessStage } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { RULE_SETTINGS_HREF } from "./labels";
import { ProcessMap } from "./process-map";
import { RuleCatalogue } from "./rule-catalogue";
import { RuleDrawer, useOpenRule } from "./rule-drawer";

const NO_STAGES: ProcessStage[] = [];

/** The technical detail for a support message: the status and the stable code, never the body. */
export function errorDetail(error: ApiError | null): string | undefined {
  if (!error) return undefined;
  return `${error.status > 0 ? `HTTP ${error.status}` : "No response"} · ${error.code}`;
}

/** The Process page's data regions. */
export function ProcessView() {
  const query = useRules();
  const locale = useFigureLocale();
  const [openRule, setOpenRule] = useOpenRule();
  const [order, setOrder] = useState<string[]>([]);
  // An admin (people level) changes how the board runs its rules on the rule settings page.
  const admin = usePeopleLevel();
  const data = query.data;

  if (!data && query.isError) {
    return (
      <ErrorState
        title="Couldn't load the process and its rules"
        description="Try again."
        detail={errorDetail(query.error)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const open = (ruleId: string | null) => void setOpenRule(ruleId);
  const stages = data?.process.stages ?? NO_STAGES;

  return (
    <div className="flex flex-col gap-9">
      <Section
        id="process-map"
        title="The agreed process"
        count={data ? formatCount(stages.length, { locale }) : undefined}
        description={
          data
            ? `Each step of the agreed process and where Jira records it.`
            : "Each step of the agreed process and where Jira records it."
        }
      >
        <ProcessMap process={data?.process} rules={data?.rules} onOpenRule={open} />
      </Section>

      <Section
        id="rule-catalogue"
        title="Rules"
        count={data ? formatCount(data.rules.length, { locale }) : undefined}
        actions={
          admin ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={RULE_SETTINGS_HREF}>
                <SlidersHorizontal aria-hidden strokeWidth={1.75} />
                Edit rule settings
              </Link>
            </Button>
          ) : undefined
        }
        description={
          data
            ? `Rules and early warnings, with their open findings.`
            : "Rules and early warnings, with their open findings."
        }
      >
        <RuleCatalogue
          rules={data?.rules}
          stages={stages}
          openRuleId={openRule}
          onOpenRule={open}
          onOrderChange={setOrder}
        />
      </Section>

      {data ? <RuleDrawer rules={data.rules} stages={stages} order={order} openId={openRule} onOpen={open} /> : null}
    </div>
  );
}
