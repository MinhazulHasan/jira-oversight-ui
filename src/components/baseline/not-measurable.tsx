"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Section } from "@/components/ui/section";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Baseline } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

import { stageName } from "./labels";

function ProcessLink() {
  return (
    <Button asChild size="sm">
      <Link href="/process#process-map">
        See the agreed process
        <ArrowRight aria-hidden strokeWidth={1.75} />
      </Link>
    </Button>
  );
}

/**
 * The steps of the agreed process Jira holds no evidence for. Said calmly,
 * with the hatch: for the reader this gap is a finding, not a fault.
 */
export function NotMeasurableBlock({ data }: { data: Baseline | undefined }) {
  const locale = useFigureLocale();
  const evidence = data?.figures.evidence;
  const missing = evidence?.not_measurable.map(stageName) ?? [];
  const steps = missing.length === 1 ? "one step" : `${formatCount(missing.length, { locale })} steps`;

  return (
    <Section
      id="not-measurable"
      title="Not measurable"
      count={evidence ? formatCount(missing.length, { locale }) : undefined}
    >
      {!evidence ? (
        <SkeletonGroup label="Loading what Jira cannot measure">
          <Skeleton className="h-36 w-full rounded-md" />
        </SkeletonGroup>
      ) : missing.length === 0 ? (
        <Callout tone="info" label="Evidence" action={<ProcessLink />}>
          Jira holds evidence for every step.
        </Callout>
      ) : (
        <Callout
          tone="not-measurable"
          title={`Jira holds no evidence for ${steps} of the agreed process`}
          action={<ProcessLink />}
        >
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {missing.map((label) => (
              <li key={label} className="font-medium text-ink">
                {label}
              </li>
            ))}
          </ul>
          <p className="mt-2">Rules that need these steps cannot run.</p>
        </Callout>
      )}
    </Section>
  );
}
