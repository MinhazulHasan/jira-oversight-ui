import { LOCAL_VIEWER, LOCAL_VIEWER_NAME, type ApiErrorCode, type Health, type Projects, type Trend } from "@/lib/api/schemas";

import type { JsonRoute, Route } from "../endpoints";
import type { PeopleComparison } from "../env";
import { accessLogView } from "./access-log";
import { askSample } from "./ask";
import { baselineView } from "./baseline";
import { DEFAULT_BOARD, type SampleBoard } from "./boards";
import { REPORT_TIMEZONE, API_VERSION } from "./catalogue";
import { meta, type Dataset } from "./dataset";
import { findingDetail, findingsPage } from "./findings";
import { insightsView } from "./insights";
import { issueTimeline } from "./issues";
import { overview } from "./overview";
import { directoryView, peopleView } from "./people";
import { personCardView } from "./person-card";
import { portfolioView } from "./portfolio";
import { draftView, previewView, saveView, settingsView, type SettingsAnswer, type SettingsReader } from "./rule-settings";
import { rulesView } from "./rules";
import { scorecardView } from "./scorecard";
import { boardsAround, boardsInOrder, type ServedBoards } from "./served";
import { TREND_DEFINITIONS, trendPoints } from "./series";
import { startSync, syncState } from "./sync";
import { iso } from "./time";
import { usageView } from "./usage";

/** What the sample answers a validated route with: a body, or "no such thing" */
export type SampleAnswer =
  | { found: true; body: unknown }
  | {
      found: false;
      message: string;
      status?: 400 | 403 | 404 | 409 | 422;
      error?: ApiErrorCode;
      issues?: { path: string; message: string }[];
    };

/** The sample's settings a response depends on (env.ts): whether people may be compared. */
export interface SampleOptions {
  peopleComparison: PeopleComparison;
  boards?: ServedBoards;
  sync?: { board?: SampleBoard; at: number; readMs: number };
  settings?: { reader: SettingsReader; at: number; recheckMs: number };
}

function settingsAnswer(answer: SettingsAnswer): SampleAnswer {
  return answer.ok
    ? { found: true, body: answer.body }
    : { found: false, status: answer.status, error: answer.error, message: answer.message, ...(answer.issues ? { issues: answer.issues } : {}) };
}

function health(dataset: Dataset): Health {
  return {
    meta: meta(dataset),
    status: "ok",
    message: null,
    data_mode: "sample",
    read_only: true,
    api_version: API_VERSION,
    last_synced_at: iso(dataset.world.syncAt),
    projects: [dataset.board.key],
    report_timezone: REPORT_TIMEZONE,
  };
}

function projects(boards: ServedBoards): Projects {
  return {
    default: DEFAULT_BOARD.key,
    projects: boardsInOrder(boards).map((board) => {
      if (!boards.synced(board)) return { key: board.key, name: board.name, issues: 0, last_synced_at: null, synced: false, type: board.type };
      const { world } = boards.dataset(board);
      return { key: board.key, name: board.name, issues: world.issues.length, last_synced_at: iso(world.syncAt), synced: true, type: board.type };
    }),
  };
}

/** The synced boards' datasets, and the keys of the boards not synced yet, in the service's order. */
function syncedAndNot(boards: ServedBoards): { datasets: Dataset[]; notSynced: string[] } {
  const ordered = boardsInOrder(boards);
  return {
    datasets: ordered.filter((board) => boards.synced(board)).map((board) => boards.dataset(board)),
    notSynced: ordered.filter((board) => !boards.synced(board)).map((board) => board.key),
  };
}

/** Everyone while sign-in is off, as the access log names them. */
const LOCAL_SETTINGS_READER: SettingsReader = { hash: LOCAL_VIEWER, name: LOCAL_VIEWER_NAME };

function trend(dataset: Dataset, route: Extract<Route, { name: "trend" }>): Trend {
  const { metric, last_n } = route.query;
  const definition = TREND_DEFINITIONS[metric];
  return {
    meta: meta(dataset),
    metric,
    period: "week",
    last_n,
    label: definition.label,
    unit: definition.unit,
    direction_good: definition.direction_good,
    note: definition.note,
    series: trendPoints(dataset, metric, last_n),
  };
}

/** Every JSON route; a person's picture is bytes, served from sample/people.ts's boardPicture. */
export function sampleResponse(
  dataset: Dataset,
  route: JsonRoute,
  latencyMs = 0,
  options: SampleOptions = { peopleComparison: "on" },
): SampleAnswer {
  const found = (body: unknown): SampleAnswer => ({ found: true, body });
  const boards = options.boards ?? boardsAround(dataset);
  switch (route.name) {
    case "health":
      return found(health(dataset));
    case "projects":
      return found(projects(boards));
    case "refresh":
      return found(syncState(options.sync?.board ?? dataset.board));
    case "refresh_start": {
      const { board = dataset.board, at = dataset.now, readMs = 0 } = options.sync ?? {};
      return found(startSync(board, at, readMs));
    }
    case "overview":
      return found(overview(dataset));
    case "people":
      return found(peopleView(dataset));
    case "people_directory":
      return found(directoryView(dataset));
    case "people_scorecard":
      return scorecardView(dataset, route.query, options.peopleComparison);
    case "person_card": {
      const others = syncedAndNot(boards).datasets.filter((other) => other.board.key !== dataset.board.key);
      const card = personCardView(dataset, route.personId, route.query.days, others);
      return card.found ? found(card.body) : { found: false, message: card.message };
    }
    case "findings":
      return found(findingsPage(dataset, route.query));
    case "finding": {
      const detail = findingDetail(dataset, route.findingId);
      return detail ? found(detail) : { found: false, message: "No finding with that id is in the sample data." };
    }
    case "issue_timeline": {
      const timeline = issueTimeline(dataset, route.issueKey);
      return timeline ? found(timeline) : { found: false, message: `${route.issueKey} is not in the sample data.` };
    }
    case "ask":
      return found(
        askSample(dataset, route.question, latencyMs, {
          level: route.level,
          mentions: route.mentions,
          comparison: options.peopleComparison,
        }),
      );
    case "insights":
      return found(insightsView(dataset));
    case "trend":
      return found(trend(dataset, route));
    case "rules":
      return found(rulesView(dataset));
    case "baseline":
      return found(baselineView(dataset));
    case "portfolio": {
      const { datasets, notSynced } = syncedAndNot(boards);
      return found(portfolioView(datasets, route.boards, Date.now(), notSynced));
    }
    case "access_log": {
      const page = accessLogView(dataset, route.query);
      return page.ok ? found(page.body) : { found: false, message: page.message, status: 400, error: "bad_request" };
    }
    case "usage":
      return found(usageView(dataset));
    case "rule_settings":
      return found(settingsView(dataset));
    case "rule_settings_preview":
      return settingsAnswer(previewView(dataset, route.body, options.settings?.at ?? dataset.now));
    case "rule_settings_save": {
      const { reader, at, recheckMs } = options.settings ?? { reader: LOCAL_SETTINGS_READER, at: dataset.now, recheckMs: 0 };
      return settingsAnswer(saveView(dataset, route.body, reader, at, recheckMs));
    }
    case "rule_settings_draft":
      // The sample's scripted drafter in the model's place: nothing is saved.
      return found(draftView(dataset, route.body));
  }
}
