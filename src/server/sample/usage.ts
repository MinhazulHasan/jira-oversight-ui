import type { Usage, UsageDay } from "@/lib/api/schemas";

import { memo, meta, type Dataset } from "./dataset";
import { createRng } from "./random";
import { DAY, isoDay } from "./time";

const SEED = 20261112;
const DAYS = 7;

interface DayFigures {
  questions: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
}

/** One UTC day's figures, the same for that day whatever "now" is; today's only up to now. */
function dayFigures(day: string, share: number): DayFigures {
  const rng = createRng(SEED, `usage:${day}`);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const questions = Math.round((weekend ? rng.int(0, 4) : rng.int(11, 27)) * share);
  // The analyst plans, queries and writes: two or three model calls a question, fewer for a scripted one.
  const modelCalls = Math.round(questions * rng.range(1.7, 2.6));
  const inputTokens = Math.round(modelCalls * rng.range(3_800, 8_600));
  const outputTokens = Math.round(modelCalls * rng.range(380, 920));
  return { questions, modelCalls, inputTokens, outputTokens };
}

export function usageView(dataset: Dataset): Usage {
  return memo(dataset, "usage", () => {
    const midnight = Math.floor(dataset.now / DAY) * DAY;
    // Today so far: its share of the day gone, so the figures grow through the day as a live service's do.
    const today = dayFigures(isoDay(midnight), (dataset.now - midnight) / DAY);
    const last: UsageDay[] = Array.from({ length: DAYS }, (_, index) => {
      const start = midnight - (DAYS - 1 - index) * DAY;
      const figures = index === DAYS - 1 ? today : dayFigures(isoDay(start), 1);
      return {
        date: isoDay(start),
        questions: figures.questions,
        model_calls: figures.modelCalls,
        tokens: figures.inputTokens + figures.outputTokens,
      };
    });
    return {
      meta: meta(dataset),
      today: {
        questions: today.questions,
        model_calls: today.modelCalls,
        input_tokens: today.inputTokens,
        output_tokens: today.outputTokens,
        budget_tokens: null,
        budget_used_pct: null,
      },
      last_7_days: last,
      // The sample's figures stand for a service with a model set up.
      ai_model: "on",
    };
  });
}
