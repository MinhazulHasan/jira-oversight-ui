"use client";

import { BarList, barListTable, type BarListItem } from "@/components/charts/bar-list";
import { ChartFrame } from "@/components/charts/chart-frame";
import { formatWeekOf } from "@/components/charts/dates";
import { Section } from "@/components/ui/section";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount, formatDate, formatHours } from "@/lib/format";

import { weeklyTotals, type IssueData } from "./model";

const ROW_H = 46;

/**
 * Time logged on the issue, week by week (Monday to Sunday, UTC). Totals
 * only: the contract never says who logged the time, and neither does this.
 */
export function IssueWorklogs({ data }: { data: IssueData | null }) {
  const locale = useFigureLocale();
  const weeks = data ? weeklyTotals(data.worklogs) : [];
  const items: BarListItem[] = weeks.map((week) => ({
    id: week.week,
    label: formatWeekOf(week.week, locale),
    value: week.hours,
  }));
  const total = weeks.reduce((sum, week) => sum + week.hours, 0);
  const busiest = weeks.reduce<(typeof weeks)[number] | null>((best, week) => (!best || week.hours > best.hours ? week : best), null);
  const logged = data?.issue.time_spent_h ?? null;
  const key = data?.issue.key ?? "this issue";
  const height = Math.max(3, items.length) * ROW_H;
  const hours = (value: number) => formatHours(value, { locale });

  const footnote =
    items.length === 0
      ? undefined
      : logged === null || Math.abs(logged - total) < 0.05
        ? `Total ${hours(total)}.`
        : `Worklogs total ${hours(total)}; Jira's time spent is ${hours(logged)}.`;

  return (
    <Section title="Time logged" id="worklogs" count={data && items.length > 0 ? hours(total) : undefined}>
      <ChartFrame
        title="Hours by week"
        description="Totals by week"
        summary={
          busiest
            ? `${hours(total)} logged on ${key} over ${formatCount(items.length, { locale })} ${items.length === 1 ? "week" : "weeks"}; the most, ${hours(busiest.hours)}, in the week of ${formatDate(busiest.week, { locale, timeZone: "UTC" })}.`
            : `No time logged on ${key}.`
        }
        table={items.length > 0 ? barListTable(items, { category: "Week", value: "Hours", format: formatHours, locale }) : undefined}
        state={!data ? "loading" : items.length === 0 ? "empty" : "ready"}
        loadingShape="bars"
        emptyTitle={`No time logged on ${key}`}
        emptyDescription="None recorded."
        height={height}
        footnote={footnote}
      >
        <BarList items={items} title={`Hours logged a week on ${key}`} valueNoun="logged" format={formatHours} total={total} />
      </ChartFrame>
    </Section>
  );
}
