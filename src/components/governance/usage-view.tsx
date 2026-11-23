"use client";

import { Info } from "lucide-react";
import { useMemo } from "react";

import { BarList, type BarListItem } from "@/components/charts/bar-list";
import { ChartFrame } from "@/components/charts/chart-frame";
import type { ChartTableData } from "@/components/charts/chart-table";
import { Meter } from "@/components/charts/meter";
import { ErrorState } from "@/components/ui/error-state";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile, StatTileGrid } from "@/components/ui/stat-tile";
import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import { useUsage, type ApiError } from "@/lib/api/hooks";
import type { Usage, UsageDay } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

/*
 * Usage (JO-12): how much Ask is used, as the oversight service counts it
 * from its own records: today's questions, model calls and tokens (UTC, the
 * day the budget resets on), against the daily AI budget where one is set,
 * and the last seven days. Insights' model calls count towards the same
 * budget; a question can take several calls (the analyst plans, queries and
 * writes).
 */

/** At or past this share of the budget the meter turns amber: the day's budget is nearly used. */
const BUDGET_WARNING = 0.9;
const ROW = 32;

function errorDetail(error: ApiError): string {
  return error.status > 0 ? `HTTP ${error.status} · ${error.code}` : error.code;
}

/** "Wed 29 Oct": a UTC day as the list names it, the last one "Today". */
function dayLabel(day: UsageDay, last: boolean, locale?: string): string {
  if (last) return "Today";
  return new Intl.DateTimeFormat(locale ?? "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day.date}T12:00:00Z`),
  );
}

function Budget({ data }: { data: Usage }) {
  const locale = useFigureLocale();
  const { today } = data;
  const used = today.input_tokens + today.output_tokens;
  if (data.ai_model === "off") {
    return (
      <p className="flex max-w-[76ch] items-start gap-2 text-sm text-ink-mid" data-usage-budget="no-model">
        <Info aria-hidden size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-ink-low" />
        No AI model is set up. Ask answers from the figures and uses no tokens.
      </p>
    );
  }
  if (today.budget_tokens === null) {
    return (
      <p className="flex max-w-[76ch] items-start gap-2 text-sm text-ink-mid" data-usage-budget="none">
        <Info aria-hidden size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-ink-low" />
        No daily AI budget is set.
      </p>
    );
  }
  const share = used / today.budget_tokens;
  // Used up exactly as the service decides it, by the tokens (at or over the budget), never by a rounded share: at
  // 99,960 of 100,000 the service still asks the model, though its share rounds to 100.0.
  const spent = used >= today.budget_tokens;
  return (
    <div className="flex max-w-[44rem] flex-col gap-2" data-usage-budget="set">
      {/* What was used, even past the budget (the last call can take the day over it): the bar stops full, the figures
          say how far over. */}
      <Meter
        label="Today's AI budget"
        value={used}
        total={today.budget_tokens}
        noun="tokens"
        tone={share >= BUDGET_WARNING ? "warning" : "neutral"}
      />
      <p className="text-xs text-ink-low">
        {spent ? (
          <span className="text-warn-ink">
            Used up. Ask answers without the AI model until the budget resets.
          </span>
        ) : (
          // The share is the meter's, once, as a whole percentage; this line says what is left.
          <>
            <span className="mono">{formatCount(today.budget_tokens - used, { locale })}</span>{" "}
            {today.budget_tokens - used === 1 ? "token" : "tokens"} left today.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * When the service's day ends, as an instant: its days are UTC days (the last of the seven is today), so it resets at
 * the next UTC midnight, which the page says in the reader's own time (SQA: "Today" rolled over in a US evening with
 * nothing to say so). Null before the figures are in.
 */
export function resetsAt(data: Usage | undefined): string | null {
  const today = data?.last_7_days.at(-1)?.date;
  if (!today) return null;
  const midnight = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(midnight) ? new Date(midnight + 24 * 60 * 60 * 1000).toISOString() : null;
}

function Today({ data }: { data: Usage | undefined }) {
  const state = data ? "ready" : "loading";
  const today = data?.today;
  const reset = resetsAt(data);
  // Plain words (SQA): one figure of AI use, its tokens in and out together, as the budget counts them.
  const tokens = today ? today.input_tokens + today.output_tokens : null;
  return (
    <Section
      id="today"
      title="Today"
      description={reset ? <>Resets at <Timestamp value={reset} mode="time" />.</> : undefined}
    >
      <div className="flex flex-col gap-5">
        <StatTileGrid columns={2} label="Today's figures">
          <StatTile label="Questions" value={today?.questions ?? null} state={state} />
          <StatTile label="AI tokens used" value={tokens} state={state} />
        </StatTileGrid>
        {data ? <Budget data={data} /> : <Skeleton className="h-4 w-[min(32rem,90%)]" />}
      </div>
    </Section>
  );
}

/**
 * What the 7-day list draws: tokens a day while a model is answering; questions a day when no model is set up, or
 * none was used all week (answers built in code use no tokens, so a busy week would read as seven zeros).
 */
type Plotted = "tokens" | "questions";

function plotted(data: Usage): Plotted {
  const tokens = data.last_7_days.reduce((sum, day) => sum + day.tokens, 0);
  return data.ai_model === "on" && tokens > 0 ? "tokens" : "questions";
}

function LastWeek({ data }: { data: Usage | undefined }) {
  const locale = useFigureLocale();
  const days = data?.last_7_days;
  const what: Plotted = data ? plotted(data) : "tokens";
  const items = useMemo<BarListItem[]>(
    () =>
      (days ?? []).map((day, index) => ({
        id: day.date,
        label: dayLabel(day, index === (days?.length ?? 0) - 1, locale),
        meta: undefined,
        value: what === "tokens" ? day.tokens : day.questions,
      })),
    [days, locale, what],
  );
  const table = useMemo<ChartTableData | undefined>(
    () =>
      days
        ? {
            columns: [{ header: "Day" }, { header: "Questions", numeric: true }, { header: "AI requests", numeric: true }, { header: "Tokens", numeric: true }],
            rows: days.map((day, index) => [
              dayLabel(day, index === days.length - 1, locale),
              formatCount(day.questions, { locale }),
              formatCount(day.model_calls, { locale }),
              formatCount(day.tokens, { locale }),
            ]),
          }
        : undefined,
    [days, locale],
  );
  const totals = (days ?? []).reduce((sum, day) => ({ questions: sum.questions + day.questions, tokens: sum.tokens + day.tokens }), {
    questions: 0,
    tokens: 0,
  });
  const value = (day: UsageDay) => (what === "tokens" ? day.tokens : day.questions);
  // The busiest day, only when there was one: never "the most on" a day of zero.
  const busiest = days?.reduce<UsageDay | null>((top, day) => (value(day) > (top ? value(top) : 0) ? day : top), null) ?? null;
  const nothing = totals.questions === 0 && totals.tokens === 0;
  const noun = (count: number, one: string, many: string) => `${formatCount(count, { locale })} ${count === 1 ? one : many}`;
  const title = what === "tokens" ? "Tokens a day" : "Questions a day";
  const summary = !days || !busiest
    ? "No usage to show."
    : what === "tokens"
      ? `${noun(totals.questions, "question", "questions")} and ${noun(totals.tokens, "token", "tokens")} over the last 7 days; the most on ${dayLabel(busiest, busiest === days[days.length - 1], locale)}, ${noun(busiest.tokens, "token", "tokens")}.`
      : `${noun(totals.questions, "question", "questions")} over the last 7 days; the most on ${dayLabel(busiest, busiest === days[days.length - 1], locale)}, ${noun(busiest.questions, "question", "questions")}.`;
  return (
    <Section
      id="last-7-days"
      title="Last 7 days"
      description={
        what === "tokens"
          ? "Tokens each day, oldest first."
          : "Questions each day, oldest first."
      }
    >
      <ChartFrame
        title={title}
        summary={summary}
        table={table}
        state={data ? (nothing ? "empty" : "ready") : "loading"}
        loadingShape="bars"
        emptyTitle="No questions in the last 7 days"
        emptyDescription="Nothing asked yet."
        height={Math.max(2, data ? items.length : 7) * ROW}
      >
        <BarList items={items} title={title} valueNoun={what} layout="inline" />
      </ChartFrame>
    </Section>
  );
}

export function UsageView() {
  const { data, error, refetch, isFetching } = useUsage();
  if (!data && error) {
    return (
      <ErrorState
        title="Usage could not be loaded"
        description={`${error.message}`}
        detail={errorDetail(error)}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }
  return (
    <div className="flex flex-col gap-9">
      <Today data={data} />
      <LastWeek data={data} />
    </div>
  );
}
