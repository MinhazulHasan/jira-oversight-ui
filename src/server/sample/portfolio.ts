import { PORTFOLIO_ATTENTION_MAX, PORTFOLIO_TREND_POINTS, type Portfolio, type PortfolioBoard } from "@/lib/api/schemas";
import { isStale } from "@/lib/sync";

import type { RuleDef } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import type { FindingRecord } from "./engine";
import { overview } from "./overview";
import { trendPoints } from "./series";
import { DAY, iso } from "./time";

/*
 * GET /portfolio (JO-12) for the sample: its synced boards (DEMO and MOB, and
 * HELP once its first sync has run), each with its Overview's own figures (the
 * very aggregates the Overview is built from, so the two can never disagree),
 * the oldest open breaches across them, and how many boards have not synced
 * yet (JO-17), which have no row. The service lists every synced board the
 * same way, each from its own Overview, and the sample keeps to its
 * definitions: the trend in the weeks GET /trends counts, "Needs attention"
 * one row for each ticket and rule (with how many open findings it holds), its
 * ties taking turns by board, then by issue number, then rule.
 */

/** The sprint rules the row reads: unestimated work in the active sprint, and the sprint at risk. */
const UNESTIMATED_RULE = "W-EST-01";
const SPRINT_RULE = "W-SPR-01";

const issueNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function boardRow(dataset: Dataset): PortfolioBoard {
  const view = overview(dataset);
  const { totals, status_mix: mix, by_rule: rules } = view;
  const active = dataset.world.activeSprint;
  const open = dataset.engine.findings.filter((finding) => finding.resolvedAt === null);

  // As the service counts it: open breaches and warnings at the end of each of the 7 weeks before this one (Monday
  // 00:00 UTC, GET /trends's weeks), then the open findings now.
  const breaches = trendPoints(dataset, "open_breaches", PORTFOLIO_TREND_POINTS).map((point) => point.value ?? 0);
  const warnings = trendPoints(dataset, "open_warnings", PORTFOLIO_TREND_POINTS).map((point) => point.value ?? 0);
  const trend = [
    ...breaches.slice(0, -1).map((value, index) => value + warnings[index]),
    totals.open_breaches.current + totals.open_warnings.current,
  ];

  // The rule with the most open findings, the catalogue's order breaking a tie (by_rule is in that order).
  const top = rules.reduce<(typeof rules)[number] | null>((best, rule) => (rule.open > (best?.open ?? 0) ? rule : best), null);
  // A rule the board turned off (JO-15) is not measured there: null, as for one that cannot run.
  const runs = (id: string) => dataset.rules.some((rule) => rule.def.id === id && rule.enabled);
  const unestimated = rules.find((rule) => rule.rule_id === UNESTIMATED_RULE && runs(rule.rule_id));
  const risk = rules.find((rule) => rule.rule_id === SPRINT_RULE && runs(rule.rule_id));
  const firstSeen = dataset.engine.findings.reduce<number | null>(
    (earliest, finding) => (earliest === null || finding.firstSeenAt < earliest ? finding.firstSeenAt : earliest),
    null,
  );

  return {
    project: { key: dataset.board.key, name: dataset.board.name },
    last_sync_at: iso(dataset.world.syncAt),
    open_tickets: mix.filter((status) => status.status_category !== "done").reduce((sum, status) => sum + status.count, 0),
    in_progress: mix.filter((status) => status.status_category === "indeterminate").reduce((sum, status) => sum + status.count, 0),
    open_breaches: totals.open_breaches.current,
    open_warnings: totals.open_warnings.current,
    new_findings_7d: totals.new_7d.current,
    resolved_findings_7d: totals.resolved_7d.current,
    open_findings_trend: trend,
    // When the rules first saw the board, as the service's Overview says it.
    tracking_since: firstSeen === null ? null : iso(firstSeen),
    // The sample's board always has a sprint running.
    active_sprint: true,
    // W-EST-01 holds only while the sprint runs, so its open findings are the active sprint's unestimated work.
    unestimated_in_active_sprint: unestimated?.measurable ? unestimated.open : null,
    sprint_at_risk: risk?.measurable
      ? open.some((finding) => finding.rule.id === SPRINT_RULE && finding.sprint?.id === active.id)
      : null,
    top_rule: top ? { id: top.rule_id, title: top.title, open: top.open } : null,
    // Said when the Portfolio is read (portfolioView), by the clock the service would read it by.
    stale: false,
  };
}

/** A board's open breaches on tickets, one for each ticket and rule, in its own order: first seen, issue number, key, rule. */
function oldestOf(dataset: Dataset): TicketAndRule[] {
  return memo(dataset, "portfolio:oldest", () =>
    [...ticketsAndRules(dataset.engine.findings).values()].sort(
      (a, b) =>
        a.firstSeenAt - b.firstSeenAt ||
        issueNumber(a.issueKey) - issueNumber(b.issueKey) ||
        compareText(a.issueKey, b.issueKey) ||
        compareText(a.rule.id, b.rule.id),
    ),
  );
}

/**
 * The Portfolio over the synced boards' datasets, in the service's order;
 * `boards`, the reader's boards when they read only some (the service lists
 * those alone), leaves the others out, and `notSynced` (the served boards that
 * have not synced yet) is counted for those boards alone too.
 *
 * "Needs attention" is the ten oldest across the boards listed: oldest first;
 * breaches first seen at the same moment (one rules run stamps every board
 * alike) take turns by board, each board's first, then each board's second, so
 * one board never fills the list on a tie; then board, issue number, issue key
 * and rule.
 *
 * One clock and one rule (JO-14), the service's: `now` is when the Portfolio
 * is read, by the server's own clock (`wallClock`), never earlier than the
 * sample's; a board is stale by the top bar's rule (src/lib/sync.ts, two
 * hours), and each breach in "Needs attention" is aged to that now while its
 * board is fresh, else as at its last sync, to the last rules run that saw it
 * (as Findings' "Open for" reads "at last sync"). So a sample pinned to
 * SAMPLE_NOW and read days later is stale, its breaches aged as at the sync,
 * as everywhere else. The page reads the same rule on the reader's clock.
 */
export function portfolioView(
  datasets: readonly Dataset[],
  boards?: readonly string[],
  wallClock: number = Date.now(),
  notSynced: readonly string[] = [],
): Portfolio {
  const [first] = datasets;
  // DEMO is always synced, so there is always one: its meta, with the latest board's sync time and the boards listed.
  if (first === undefined) throw new Error("the sample's Portfolio needs at least one synced board");
  const latest = datasets.reduce((last, dataset) => (dataset.world.syncAt > last.world.syncAt ? dataset : last), first);
  const listed = datasets.filter((dataset) => boards === undefined || boards.includes(dataset.board.key));
  const keys = listed.map((dataset) => dataset.board.key);
  const portfolioMeta = { ...meta(latest), projects: keys.length > 0 ? keys : [first.board.key] };
  const boardsNotSynced = notSynced.filter((key) => boards === undefined || boards.includes(key)).length;

  const turns = listed.flatMap((dataset, boardIndex) => {
    const seen = new Map<number, number>();
    return oldestOf(dataset).map((pair) => {
      const turn = seen.get(pair.firstSeenAt) ?? 0;
      seen.set(pair.firstSeenAt, turn + 1);
      return { dataset, boardIndex, turn, pair };
    });
  });
  const oldest = turns
    .sort(
      (a, b) =>
        a.pair.firstSeenAt - b.pair.firstSeenAt ||
        a.turn - b.turn ||
        a.boardIndex - b.boardIndex ||
        issueNumber(a.pair.issueKey) - issueNumber(b.pair.issueKey) ||
        compareText(a.pair.issueKey, b.pair.issueKey) ||
        compareText(a.pair.rule.id, b.pair.rule.id),
    )
    .slice(0, PORTFOLIO_ATTENTION_MAX);

  const readAt = (dataset: Dataset) => Math.max(wallClock, dataset.now);
  const staleOf = (dataset: Dataset) => isStale(new Date(dataset.world.syncAt), readAt(dataset));
  const attention = oldest.map(({ dataset, pair }) => ({
    project: dataset.board.key,
    issue_key: pair.issueKey,
    rule_id: pair.rule.id,
    title: pair.rule.title,
    severity: pair.rule.severity,
    opened_at: iso(pair.firstSeenAt),
    last_seen_at: iso(pair.lastSeenAt),
    age_days: Math.floor(((staleOf(dataset) ? pair.lastSeenAt : readAt(dataset)) - pair.firstSeenAt) / DAY),
    findings: pair.findings,
  }));
  return {
    meta: portfolioMeta,
    boards: listed.map((dataset) => ({ ...memo(dataset, "portfolio", () => boardRow(dataset)), stale: staleOf(dataset) })),
    attention,
    boards_not_synced: boardsNotSynced,
  };
}

/** One ticket and rule in "Needs attention": its open breaches of that rule, how many, the oldest's first sighting. */
interface TicketAndRule {
  issueKey: string;
  rule: RuleDef;
  firstSeenAt: number;
  lastSeenAt: number;
  findings: number;
}

/**
 * The open breaches on tickets, one entry for each ticket and rule, as the service lists them: a rule can hold more
 * than one open finding on a ticket (R-FLOW-02 opens one for each transition that skipped a stage), and listing the
 * same ticket and rule twice reads as a duplicate, so they are one, first seen at the oldest, last seen at the latest.
 */
function ticketsAndRules(findings: readonly FindingRecord[]): Map<string, TicketAndRule> {
  const pairs = new Map<string, TicketAndRule>();
  for (const finding of findings) {
    if (finding.resolvedAt !== null || finding.rule.severity !== "breach" || finding.issue === null) continue;
    const key = `${finding.issue.key}:${finding.rule.id}`;
    const pair = pairs.get(key);
    if (pair === undefined) {
      pairs.set(key, { issueKey: finding.issue.key, rule: finding.rule, firstSeenAt: finding.firstSeenAt, lastSeenAt: finding.lastSeenAt, findings: 1 });
      continue;
    }
    pair.firstSeenAt = Math.min(pair.firstSeenAt, finding.firstSeenAt);
    pair.lastSeenAt = Math.max(pair.lastSeenAt, finding.lastSeenAt);
    pair.findings += 1;
  }
  return pairs;
}
