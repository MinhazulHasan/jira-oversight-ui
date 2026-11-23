"use client";

import { EARLIER_WEEK, fromEarlierWeek, TONES } from "@/components/insights/model";
import { Badge, SeverityMark } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Skeleton, SkeletonGroup, SkeletonText } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Overview } from "@/lib/api/schemas";
import { formatDate } from "@/lib/format";
import { useNow } from "@/lib/use-now";

import { INSIGHTS_HREF } from "./links";
import { SectionLink } from "./section-link";

/**
 * The opening of the latest weekly briefing, each sentence with its tone (the
 * Insights page's words), and, once its week is over, that its figures may
 * have moved on. The full briefing, with the findings behind each sentence,
 * is one click away.
 */
export function InsightTeaser({ data, className }: { data?: Overview; className?: string }) {
  const locale = useFigureLocale();
  const now = useNow();
  const insight = data?.latest_insight;
  const earlier = insight !== undefined && insight !== null && now !== null && fromEarlierWeek(insight.week_of, now);

  return (
    <Section
      id="latest-insight"
      title="Latest insight"
      actions={insight ? <SectionLink href={INSIGHTS_HREF}>Read the briefing</SectionLink> : undefined}
      className={className}
    >
      {!data ? (
        <SkeletonGroup label="Loading the latest insight" className="flex flex-col gap-3">
          <Skeleton className="my-[3px] h-3 w-56" />
          <SkeletonText lines={3} className="max-w-[68ch] py-1" />
        </SkeletonGroup>
      ) : !insight ? (
        <EmptyState size="compact" title="No weekly briefing yet" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-low">
            <span>
              Week of{" "}
              <time dateTime={insight.week_of} className="mono" data-figure>
                {formatDate(insight.week_of, { locale, timeZone: "UTC" })}
              </time>
            </span>
            <span aria-hidden>·</span>
            <span>
              Written <Timestamp value={insight.generated_at} mode="relative" />
            </span>
            {earlier ? (
              <>
                <span aria-hidden>·</span>
                <span data-earlier-week>{EARLIER_WEEK}</span>
              </>
            ) : null}
            {insight.verified ? null : (
              <>
                <span aria-hidden>·</span>
                <Badge tone="muted" size="sm">
                  Figures not verified
                </Badge>
              </>
            )}
          </p>
          <ul className="flex flex-col gap-2.5">
            {insight.sentences.map((sentence) => (
              <li key={sentence.id} className="flex items-start gap-2.5">
                <SeverityMark severity={TONES[sentence.tone].mark} size={9} className="mt-[0.5em]" />
                <p className="max-w-[68ch] text-base text-ink">
                  <span className="sr-only">{TONES[sentence.tone].label}: </span>
                  {sentence.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
