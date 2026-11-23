"use client";

import { formatWeekOf } from "@/components/charts/dates";
import { Callout } from "@/components/ui/callout";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Insights } from "@/lib/api/schemas";
import { useNow } from "@/lib/use-now";

import { EARLIER_WEEK, fromEarlierWeek } from "./model";

/*
 * The top of the sheet, read like a dateline: which week, when it was
 * written, and, once that week is over, that its figures may have moved on.
 */

export function Masthead({ insights }: { insights: Insights }) {
  const locale = useFigureLocale();
  const now = useNow();
  const earlier = now !== null && fromEarlierWeek(insights.week_of, now);

  return (
    <div className="border-b border-rule-weak pb-5">
      <p className="micro text-ink-low">Weekly briefing · {insights.meta.projects.join(", ")}</p>
      <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.012em] text-ink">
        <time dateTime={insights.week_of}>{formatWeekOf(insights.week_of, locale)}</time>
      </h2>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-mid">
        <span>
          Written <Timestamp value={insights.generated_at} mode="datetime" className="text-ink" />
        </span>
        {earlier ? (
          <>
            <span aria-hidden className="text-ink-low">
              ·
            </span>
            <span data-earlier-week>{EARLIER_WEEK}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

/** When the narrative could not be verified, the reader is told plainly, and calmly, what they are reading. */
export function NotVerifiedNotice() {
  return (
    <Callout tone="info" label="Not verified" title="No written briefing this week">
      A number did not match, so the table is shown instead.
    </Callout>
  );
}
