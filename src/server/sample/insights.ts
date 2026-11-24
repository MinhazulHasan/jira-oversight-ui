import type { Candidate, FactColumnKind, Insights, InsightSentence } from "@/lib/api/schemas";

import { hotSpots } from "./aggregates";
import { cite, compose, listed, type Piece } from "./ask/compose";
import { REPORT_TIMEZONE, missingFor, type StatusName } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import { openAt } from "./engine";
import { inWeekEnding } from "./series";
import { median, percentile, round4, share } from "./stats";
import { HOUR, WEEK, addDays, iso, zonedDay } from "./time";
import { verify, type VerifiableFacts } from "./verify";
import { workItems, type Issue } from "./world";

/** The weekly briefing (Planning.md Phase 7), built as oversight/insights/weekly.py */

const SEVERITY_WEIGHT = { breach: 3, warning: 2, info: 1 } as const;
const TONE = { breach: "blatantly_bad", warning: "trending_bad", info: "neutral" } as const;
const TOP = 5;
/** Fewer closed intervals than this in either week, and a median says nothing. */
const MIN_INTERVALS = 5;
/** Percentiles over fewer open issues than this are noise (weekly.py's outlier floor). */
const MIN_OPEN_WORK = 10;

type CandidateDraft = Omit<Candidate, "score">;
type Detail = Candidate["detail"][number];

interface Draft {
  candidate: CandidateDraft;
  /** The sentence, every figure bound to a detail entry (row 0) or to one of the candidate's keys. */
  sentence: (facts: VerifiableFacts) => Piece[];
}

const KIND_OF_UNIT: Record<NonNullable<Detail["unit"]>, FactColumnKind> = {
  count: "count",
  hours: "hours",
  ratio: "ratio",
  share: "share",
  points: "number",
  days: "number",
};

/** A candidate as the validator reads it: one row of its detail figures, then one row per issue key it names. */
function asFacts(candidate: CandidateDraft): VerifiableFacts {
  return {
    ref: candidate.id,
    columns: [
      ...candidate.detail.map((entry) => ({
        key: entry.key,
        label: entry.label,
        kind: entry.unit ? KIND_OF_UNIT[entry.unit] : ("text" as const),
      })),
      { key: "issue_key", label: "Issue", kind: "issue_key" as const },
    ],
    rows: [
      Object.fromEntries(candidate.detail.map((entry) => [entry.key, entry.value])),
      ...candidate.issue_keys.map((key) => ({ issue_key: key })),
    ],
    as_of: null,
    note: null,
  };
}

function detail(key: string, label: string, value: number | string, unit: Detail["unit"]): Detail {
  return { key, label, value: typeof value === "number" ? round4(value) : value, unit };
}

function keyCell(facts: VerifiableFacts, key: string): Piece {
  return cite.key(facts, facts.rows.findIndex((row) => row.issue_key === key), "issue_key");
}

/** This week is the 7 days ending now; last week the 7 before, its later edge left to this week. */
function inLastWeek(time: number | null, now: number): boolean {
  return time !== null && inWeekEnding(time, now - WEEK) && time < now - WEEK;
}

/* ------------------------------------------------------------ candidates -- */

/** The status whose median time changed most week on week (weekly.py's wow_change). */
function weekOnWeek(dataset: Dataset): Draft | null {
  const { now } = dataset;
  const statuses = (["To Do", "In Progress", "Done"] as const satisfies readonly StatusName[]).flatMap((status) => {
    const thisWeek: { hours: number; key: string }[] = [];
    const lastWeek: number[] = [];
    for (const issue of dataset.world.issues) {
      for (const interval of issue.intervals) {
        if (interval.status !== status || interval.leftAt === null) continue;
        const hours = (interval.leftAt - interval.enteredAt) / HOUR;
        if (inWeekEnding(interval.leftAt, now)) thisWeek.push({ hours, key: issue.key });
        else if (inLastWeek(interval.leftAt, now)) lastWeek.push(hours);
      }
    }
    if (thisWeek.length < MIN_INTERVALS || lastWeek.length < MIN_INTERVALS) return [];
    const current = median(thisWeek.map((entry) => entry.hours))!;
    const previous = median(lastWeek)!;
    const longest = [...thisWeek].sort((a, b) => b.hours - a.hours).map((entry) => entry.key);
    return [{ status, current, previous, closed: thisWeek.length, closedBefore: lastWeek.length, keys: [...new Set(longest)] }];
  });
  const top = statuses.sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous))[0];
  if (!top) return null;
  const longer = top.current > top.previous;
  return {
    candidate: {
      id: `wow-change-${top.status.toLowerCase().replace(/\s+/g, "-")}`,
      kind: "wow_change",
      title: `Time in ${top.status} ${longer ? "rose" : "fell"} week on week`,
      affected: top.closed,
      severity: longer ? "warning" : "info",
      trend: round4(top.previous > 0 ? top.current / top.previous : 1),
      detail: [
        detail("status", "Status", top.status, null),
        detail("median_this_week_h", "Median this week", top.current, "hours"),
        detail("median_last_week_h", "Median last week", top.previous, "hours"),
        detail("closed_this_week", "Intervals closed this week", top.closed, "count"),
        detail("closed_last_week", "Intervals closed last week", top.closedBefore, "count"),
      ],
      issue_keys: top.keys.slice(0, 5),
      finding_ids: [],
    },
    sentence: (facts) => [
      `Work ${longer ? "spent longer" : "spent less time"} in ${top.status} this week: a median of `,
      cite.hours(facts, 0, "median_this_week_h"),
      " h across ",
      cite.count(facts, 0, "closed_this_week"),
      " closed intervals, against ",
      cite.hours(facts, 0, "median_last_week_h"),
      " h the week before.",
    ],
  };
}

/** The three epics with the most open breaches (weekly.py's breach_hot_spot). */
function hotSpotDrafts(dataset: Dataset): Draft[] {
  const weekAgo = dataset.now - WEEK;
  return hotSpots(dataset)
    .flatMap((spot) => (spot.epicKey !== null && spot.openBreaches > 0 ? [{ ...spot, epicKey: spot.epicKey }] : []))
    .slice(0, 3)
    .map((spot) => {
      const breaches = dataset.engine.findings.filter(
        (finding) => finding.issue?.epicKey === spot.epicKey && finding.rule.severity === "breach",
      );
      const open = breaches.filter((finding) => finding.resolvedAt === null);
      const before = breaches.filter((finding) => openAt(finding, weekAgo)).length;
      const newest = [...open].sort((a, b) => b.firstSeenAt - a.firstSeenAt).map((finding) => finding.issue!.key);
      const change = spot.openBreaches - before;
      return {
        candidate: {
          id: `hot-spot-${spot.epicKey.toLowerCase()}`,
          kind: "breach_hot_spot" as const,
          title: `Open breaches in ${spot.epicTitle}`,
          affected: spot.openBreaches,
          severity: "breach" as const,
          trend: round4(before === 0 ? 2 : Math.max(1, spot.openBreaches / before)),
          detail: [
            detail("epic_title", "Epic", spot.epicTitle, null),
            detail("open_breaches", "Open breaches", spot.openBreaches, "count"),
            detail("open_breaches_week_ago", "Open breaches a week ago", before, "count"),
            detail("open_warnings", "Open warnings", spot.openWarnings, "count"),
          ],
          issue_keys: [...new Set([spot.epicKey, ...newest])].slice(0, 6),
          finding_ids: open.map((finding) => finding.id),
        },
        sentence: (facts: VerifiableFacts): Piece[] => [
          keyCell(facts, spot.epicKey),
          ` ${spot.epicTitle} has `,
          cite.count(facts, 0, "open_breaches"),
          " open breaches",
          ...(change === 0
            ? [", as many as a week ago."]
            : [change > 0 ? ", up from " : ", down from ", cite.count(facts, 0, "open_breaches_week_ago"), " a week ago."]),
        ],
      };
    });
}

function risingRules(dataset: Dataset): Draft[] {
  const { now } = dataset;
  const rules = dataset.rules
    .filter((rule) => missingFor(rule.catalogue).length === 0 && (rule.custom === null || rule.custom.createdAt <= now - 2 * WEEK))
    .map((rule) => (rule.custom ? rule.def : rule.catalogue));
  return rules.flatMap((rule) => {
    const findings = dataset.engine.findings.filter((finding) => finding.rule.id === rule.id);
    const thisWeek = findings.filter((finding) => inWeekEnding(finding.firstSeenAt, now));
    const lastWeek = findings.filter((finding) => inLastWeek(finding.firstSeenAt, now));
    if (thisWeek.length <= lastWeek.length) return [];
    const keys = [...new Set(thisWeek.flatMap((finding) => (finding.issue ? [finding.issue.key] : [])))];
    const title = rule.title.charAt(0).toLowerCase() + rule.title.slice(1);
    return [
      {
        candidate: {
          id: `rising-rule-${rule.id.toLowerCase()}`,
          kind: "rising_rule" as const,
          title: `${rule.id} is rising`,
          affected: thisWeek.length,
          severity: rule.severity,
          trend: round4(lastWeek.length === 0 ? 2 : thisWeek.length / lastWeek.length),
          detail: [
            detail("rule_title", "Rule", rule.title, null),
            detail("first_seen_this_week", "First seen this week", thisWeek.length, "count"),
            detail("first_seen_last_week", "First seen last week", lastWeek.length, "count"),
          ],
          issue_keys: keys.slice(0, 10),
          finding_ids: thisWeek.map((finding) => finding.id),
        },
        sentence: (facts: VerifiableFacts): Piece[] => [
          `${rule.id}, ${title}, fired `,
          cite.count(facts, 0, "first_seen_this_week"),
          " times this week against ",
          cite.count(facts, 0, "first_seen_last_week"),
          " the week before.",
        ],
      },
    ];
  });
}

/** Open work above the project's own p90 for effort ratio or time in status (weekly.py's outlier). */
function outliers(dataset: Dataset): Draft | null {
  const open = workItems(dataset.world).filter((issue) => issue.status !== "Done");
  const ratios = open.flatMap((issue) => (issue.effortRatio === null ? [] : [issue.effortRatio]));
  if (ratios.length < MIN_OPEN_WORK || open.length < MIN_OPEN_WORK) return null;
  const ratioLine = percentile(ratios, 90)!;
  const ageLine = percentile(
    open.map((issue) => issue.statusAgeH),
    90,
  )!;
  const overRatio = open
    .filter((issue) => issue.effortRatio !== null && issue.effortRatio > ratioLine)
    .sort((a, b) => b.effortRatio! - a.effortRatio!);
  const overAge = open.filter((issue) => issue.statusAgeH > ageLine).sort((a, b) => b.statusAgeH - a.statusAgeH);
  const above = [...new Set([...overRatio, ...overAge])];
  if (above.length === 0) return null;

  const named: { issue: Issue; entry: string; unit: "ratio" | "hours" }[] = [];
  if (overRatio[0]) named.push({ issue: overRatio[0], entry: "highest_ratio", unit: "ratio" });
  const oldest = overAge.find((issue) => issue !== overRatio[0]);
  if (oldest) named.push({ issue: oldest, entry: "longest_wait_h", unit: "hours" });

  return {
    candidate: {
      id: "outlier-open-work",
      kind: "outlier",
      title: "Open work above the project's p90",
      affected: above.length,
      severity: "warning",
      trend: 1,
      detail: [
        detail("above_p90", "Open issues above a p90", above.length, "count"),
        detail("p90_effort_ratio", "p90 effort ratio, open work", ratioLine, "ratio"),
        detail("p90_status_age_h", "p90 hours in the current status, open work", ageLine, "hours"),
        ...named.map(({ issue, entry, unit }) =>
          unit === "ratio"
            ? detail(entry, `${issue.key}, effort ratio`, issue.effortRatio!, "ratio")
            : detail(entry, `${issue.key}, hours in ${issue.status}`, issue.statusAgeH, "hours"),
        ),
      ],
      issue_keys: [...new Set([...named.map(({ issue }) => issue.key), ...above.map((issue) => issue.key)])].slice(0, 5),
      finding_ids: [],
    },
    sentence: (facts) => [
      cite.count(facts, 0, "above_p90"),
      above.length === 1 ? " open issue sits" : " open issues sit",
      " above the project's p90 for open work",
      ...(named.length > 0
        ? [
            ": ",
            ...listed(
              named.map(({ issue, entry, unit }): Piece[] =>
                unit === "ratio"
                  ? [keyCell(facts, issue.key), " has used ", cite.ratio(facts, 0, entry), "× its estimate"]
                  : [keyCell(facts, issue.key), " has spent ", cite.hours(facts, 0, entry), ` h in ${issue.status}`],
              ),
            ),
          ]
        : []),
      ".",
    ],
  };
}

/** The active sprint's estimate and logged-time coverage (weekly.py's coverage). */
function sprintCoverage(dataset: Dataset): Draft | null {
  const sprint = dataset.world.activeSprint;
  const members = sprint.memberKeys.map((key) => dataset.world.byKey.get(key)!);
  if (members.length === 0) return null;
  const unestimated = members.filter((issue) => !((issue.storyPoints ?? 0) > 0));
  const estimated = members.length - unestimated.length;
  const logged = members.filter((issue) => issue.timeSpentS > 0).length;
  const estimateShare = share(estimated, members.length)!;
  const loggedShare = share(logged, members.length)!;
  const warnings = dataset.engine.findings.filter(
    (finding) => finding.rule.id === "W-EST-01" && finding.resolvedAt === null && finding.evidenceKey === `unestimated-sprint-${sprint.id}`,
  );
  return {
    candidate: {
      id: `coverage-sprint-${sprint.id}`,
      kind: "coverage",
      title: `Estimates and logged time in ${sprint.name}`,
      affected: unestimated.length,
      severity: estimateShare < 0.8 || loggedShare < 0.8 ? "warning" : "info",
      trend: 1,
      detail: [
        detail("sprint", "Sprint", sprint.name, null),
        detail("issues", "Issues in the sprint", members.length, "count"),
        detail("with_estimate", "With an estimate", estimated, "count"),
        detail("estimate_share", "Share with an estimate", estimateShare, "share"),
        detail("with_logged_time", "With logged time", logged, "count"),
        detail("logged_share", "Share with logged time", loggedShare, "share"),
      ],
      issue_keys: unestimated.map((issue) => issue.key).slice(0, 10),
      finding_ids: warnings.map((finding) => finding.id),
    },
    sentence: (facts) => [
      `In ${sprint.name}, `,
      cite.share(facts, 0, "estimate_share"),
      " of the ",
      cite.count(facts, 0, "issues"),
      " issues have an estimate and ",
      cite.share(facts, 0, "logged_share"),
      " have time logged against them.",
    ],
  };
}

/* -------------------------------------------------------------- briefing -- */

/** The Monday of now's week, in the report zone. */
function weekOf(now: number): string {
  const day = zonedDay(now, REPORT_TIMEZONE);
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

const METHOD =
  "Rules in code decided what counts as a problem. Code then gathered the candidates (epics with the most open breaches, rules firing more often, week-on-week changes, outliers and sprint coverage) and scored each as issues affected × severity weight × week-on-week trend, keeping the top five. The briefing was written from those five candidates only, and every number and issue key in it was checked against them before it was shown. In this sample a script writes the sentences, standing in for the model.";

export interface Briefing {
  insights: Insights;
  /** The sentences joined, and the candidates read as facts: what verification ran over. */
  text: string;
  facts: VerifiableFacts[];
}

export function briefing(dataset: Dataset): Briefing {
  return memo(dataset, "insights", () => {
    const drafts = [
      ...hotSpotDrafts(dataset),
      ...risingRules(dataset),
      weekOnWeek(dataset),
      outliers(dataset),
      sprintCoverage(dataset),
    ].filter((draft): draft is Draft => draft !== null);

    const ranked = drafts
      .map((draft, order) => ({
        draft,
        order,
        score: round4(draft.candidate.affected * SEVERITY_WEIGHT[draft.candidate.severity] * draft.candidate.trend),
      }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, TOP);

    const facts = ranked.map(({ draft }) => asFacts(draft.candidate));
    const sentences: InsightSentence[] = ranked.map(({ draft }, index) => ({
      id: `s${index + 1}`,
      text: compose(draft.sentence(facts[index])).answer,
      tone: TONE[draft.candidate.severity],
      candidate_ids: [draft.candidate.id],
      issue_keys: draft.candidate.issue_keys,
      finding_ids: draft.candidate.finding_ids,
    }));
    const text = sentences.map((sentence) => sentence.text).join(" ");

    return {
      text,
      facts,
      insights: {
        meta: meta(dataset),
        week_of: weekOf(dataset.now),
        generated_at: iso(dataset.world.rulesAt + 30_000),
        verified: verify(text, facts, null).ok,
        sentences,
        candidates: ranked.map(({ draft, score }) => ({ ...draft.candidate, score })),
        method: METHOD,
        model: null,
      },
    };
  });
}

export function insightsView(dataset: Dataset): Insights {
  return briefing(dataset).insights;
}
