// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizeFindingsQuery, NO_EPIC, type FindingsQueryInput } from "@/lib/api/params";
import { TREND_METRICS, UNASSIGNED, UNASSIGNED_LABEL, type FactSet } from "@/lib/api/schemas";

import { askSample } from "../sample/ask";
import { baselineView } from "../sample/baseline";
import { STATUS } from "../sample/catalogue";
import { buildDataset } from "../sample/dataset";
import { findingDetail, findingsPage, matchingFindings } from "../sample/findings";
import { insightsView } from "../sample/insights";
import { issueTimeline } from "../sample/issues";
import { overview } from "../sample/overview";
import { compareByName, peopleView } from "../sample/people";
import { rulesView } from "../sample/rules";
import { trendPoints } from "../sample/series";
import { personOf } from "../sample/team";

/*
 * Every view must agree with every other: a figure on the Overview is the
 * total behind the Findings filter it clicks through to, the open count in
 * the rule catalogue, the last point of its trend, the number the weekly
 * briefing quotes and the fact an answer cites.
 */

const NOW = Date.parse("2026-11-04T14:30:00Z");

for (const at of [NOW, Date.parse("2027-01-15T12:00:00Z")]) {
  describe(`the sample views at ${new Date(at).toISOString()}`, () => {
    const dataset = buildDataset(at);
    const view = overview(dataset);
    const rules = rulesView(dataset);
    const insights = insightsView(dataset);
    const total = (query: FindingsQueryInput) => findingsPage(dataset, normalizeFindingsQuery({ page_size: 1, ...query })).total;
    const ask = (question: string) => askSample(dataset, question, 0);
    const factsOf = (question: string, tool: string): FactSet => {
      const fact = ask(question).facts.find((candidate) => candidate.tool === tool);
      if (!fact) throw new Error(`${question} has no ${tool} facts`);
      return fact;
    };

    it("counts open breaches and warnings the same way everywhere", () => {
      for (const severity of ["breach", "warning"] as const) {
        const tile = severity === "breach" ? view.totals.open_breaches : view.totals.open_warnings;
        const metric = severity === "breach" ? "open_breaches" : "open_warnings";
        const series = trendPoints(dataset, metric);
        expect(total({ state: "open", severity })).toBe(tile.current);
        expect(series[series.length - 1].value).toBe(tile.current);
        expect(rules.rules.filter((rule) => rule.severity === severity).reduce((sum, rule) => sum + rule.open, 0)).toBe(tile.current);
        expect(view.by_rule.filter((rule) => rule.severity === severity).reduce((sum, rule) => sum + rule.open, 0)).toBe(tile.current);
      }
    });

    it("gives each rule one open count: overview, catalogue, findings facet and Ask facts", () => {
      const facets = findingsPage(dataset, normalizeFindingsQuery({ state: "open" })).facets.rules;
      const status = factsOf("Which rules can't be measured in Jira today?", "oversight_rule_status");
      for (const rule of rules.rules) {
        expect(view.by_rule.find((entry) => entry.rule_id === rule.rule_id)?.open).toBe(rule.open);
        expect(facets.find((entry) => entry.value === rule.rule_id)?.count).toBe(rule.open);
        expect(total({ state: "open", rule: [rule.rule_id] })).toBe(rule.open);
        expect(status.rows.find((row) => row.rule_id === rule.rule_id)?.open_findings).toBe(rule.open);
      }
    });

    it("makes facet counts add up to the totals they split", () => {
      const page = findingsPage(dataset, normalizeFindingsQuery({ state: "open" }));
      const sum = (entries: { count: number }[]) => entries.reduce((acc, entry) => acc + entry.count, 0);
      expect(sum(page.facets.severity)).toBe(page.total);
      expect(sum(page.facets.rules)).toBe(page.total);
      expect(sum(page.facets.epics)).toBe(page.total);
      const states = Object.fromEntries(page.facets.state.map((entry) => [entry.value, entry.count]));
      expect(states.open).toBe(page.total);
      expect(states.open + states.resolved).toBe(total({ state: "all" }));
    });

    it("lets each hot spot click through to exactly its findings", () => {
      const groups = findingsPage(dataset, normalizeFindingsQuery({ state: "open" })).facets.epics;
      for (const spot of view.hot_spots) {
        const epic = [spot.epic_key ?? NO_EPIC];
        expect(total({ state: "open", severity: "breach", epic })).toBe(spot.open_breaches);
        expect(total({ state: "open", severity: "warning", epic })).toBe(spot.open_warnings);
        expect(groups.find((entry) => entry.value === epic[0])?.count).toBe(spot.open_breaches + spot.open_warnings);
        expect(spot.series[spot.series.length - 1].value).toBe(spot.open_breaches + spot.open_warnings);
      }
    });

    it("answers 'which epics have the most open breaches' with the overview's hot spots", () => {
      const facts = factsOf("Which epics have the most open breaches?", "oversight_hot_spots");
      expect(
        facts.rows.map((row) => [row.epic_key, row.open_breaches, row.open_warnings, row.issues]),
      ).toEqual(view.hot_spots.map((spot) => [spot.epic_key, spot.open_breaches, spot.open_warnings, spot.issues]));
    });

    it("draws every trend card from the trends endpoint's series, and every Ask trend fact too", () => {
      for (const metric of TREND_METRICS) {
        const series = trendPoints(dataset, metric);
        if (metric in view.trend_cards) {
          const card = view.trend_cards[metric as keyof typeof view.trend_cards];
          expect(card.points).toEqual(series);
          expect(card.current).toBe(series[series.length - 1].value);
          expect(card.previous).toBe(series[series.length - 2].value);
        }
        expect(trendPoints(dataset, metric, 4)).toEqual(series.slice(-4));
      }
      const effort = factsOf("How is effort against estimate trending?", "oversight_trend");
      expect(effort.rows.map((row) => [row.week_of, row.value])).toEqual(
        trendPoints(dataset, "median_effort_ratio").map((point) => [point.t, point.value]),
      );
    });

    it("counts new findings this week the way the findings filter does", () => {
      expect(total({ state: "all", first_seen: "7d" })).toBe(view.totals.new_7d.current);
    });

    it("puts every piece of work in one status", () => {
      expect(view.status_mix.reduce((sum, entry) => sum + entry.count, 0)).toBe(view.totals.issues_in_scope.current);
    });

    it("quotes the overview's coverage in Ask", () => {
      const facts = factsOf("How much work was estimated before it started?", "oversight_coverage");
      const row = facts.rows[0];
      expect([row.covered, row.total, row.share]).toEqual([
        view.coverage.estimate.covered,
        view.coverage.estimate.total,
        view.coverage.estimate.share,
      ]);
    });

    it("lists the same skipped-stage findings in Ask as the findings filter finds", () => {
      const answer = ask("Which tickets went straight from To Do to Done this month?");
      const facts = answer.facts[0];
      expect(facts.rows.length).toBe(total({ state: "all", rule: ["R-FLOW-02"], first_seen: "30d" }));
    });

    it("writes the briefing from the same figures", () => {
      expect(view.latest_insight?.sentences).toEqual(insights.sentences.slice(0, 2));
      expect(view.latest_insight?.week_of).toBe(insights.week_of);
      for (const candidate of insights.candidates) {
        const figure = (key: string) => candidate.detail.find((entry) => entry.key === key)?.value;
        if (candidate.kind === "breach_hot_spot") {
          const spot = view.hot_spots.find((entry) => entry.epic_key === candidate.issue_keys[0]);
          expect(spot?.open_breaches).toBe(candidate.affected);
          expect(figure("open_breaches")).toBe(candidate.affected);
          expect(candidate.finding_ids).toHaveLength(candidate.affected);
        }
        if (candidate.kind === "rising_rule") {
          const ruleId = candidate.title.split(" ")[0];
          expect(total({ state: "all", rule: [ruleId], first_seen: "7d" })).toBe(candidate.affected);
        }
        expect(candidate.score).toBeCloseTo(
          candidate.affected * { breach: 3, warning: 2, info: 1 }[candidate.severity] * candidate.trend,
          2,
        );
      }
      const scores = insights.candidates.map((candidate) => candidate.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });

    it("shows the same finding in the list, the drawer and the issue page", () => {
      const page = findingsPage(dataset, normalizeFindingsQuery({ state: "all", page_size: 50 }));
      for (const item of page.items) {
        const detail = findingDetail(dataset, item.finding_id);
        expect(detail?.finding).toEqual(item);
        if (item.issue_key) {
          const issue = issueTimeline(dataset, item.issue_key);
          expect(issue?.findings).toContainEqual(item);
          expect(detail?.timeline).toEqual(issue?.intervals);
          expect(item.assignee).toEqual(issue?.issue.assignee);
        } else {
          expect(item.assignee).toBeNull();
        }
      }
    });

    describe("and the board's people", () => {
      const people = peopleView(dataset).people;
      const idOf = (row: (typeof people)[number]) => row.person?.id ?? UNASSIGNED;
      const open = (person: string[]) => matchingFindings(dataset, normalizeFindingsQuery({ state: "open", person }));
      const sprintFindings = (state: "open" | "all") =>
        matchingFindings(dataset, normalizeFindingsQuery({ state })).filter((finding) => finding.scope === "sprint").length;

      it("count each person's open findings as the person filter and its facet do", () => {
        const facet = findingsPage(dataset, normalizeFindingsQuery({ state: "open" })).facets.people;
        for (const row of people) {
          const person = [idOf(row)];
          expect(total({ state: "open", severity: "breach", person })).toBe(row.open_breaches);
          expect(total({ state: "open", severity: "warning", person })).toBe(row.open_warnings);
          expect(facet.find((entry) => entry.value === person[0])?.count).toBe(row.open_breaches + row.open_warnings);
          expect(new Set(open(person).map((finding) => finding.issue_key)).size).toBe(row.tickets_with_findings);
        }
      });

      it("give every ticket on the board to exactly one row, by its assignee now", () => {
        // The board's work: an Epic is a container, so no one's tickets count it (JO-12, G5).
        const issues = dataset.world.issues.filter((issue) => issue.type !== "Epic");
        expect(people.reduce((sum, row) => sum + row.tickets, 0)).toBe(issues.length);
        for (const row of people) {
          const theirs = issues.filter((issue) => (personOf(issue)?.id ?? UNASSIGNED) === idOf(row));
          expect(theirs.length).toBe(row.tickets);
          expect(theirs.filter((issue) => STATUS[issue.status].category !== "done").length).toBe(row.open_tickets);
        }
      });

      it("leave sprint findings to no one, even to the unassigned", () => {
        const everyone = people.map(idOf);
        const split = people.reduce((sum, row) => sum + row.open_breaches + row.open_warnings, 0);
        expect(split).toBe(total({ state: "open" }) - sprintFindings("open"));
        expect(total({ state: "all", person: everyone })).toBe(total({ state: "all" }) - sprintFindings("all"));
        const unassigned = new Set(dataset.world.issues.filter((issue) => personOf(issue) === null).map((issue) => issue.key));
        const onUnassigned = dataset.engine.findings.filter((finding) => finding.issue !== null && unassigned.has(finding.issue.key));
        expect(total({ state: "all", person: [UNASSIGNED] })).toBe(onUnassigned.length);
        expect(onUnassigned.length).toBeGreaterThan(0);
        const facet = findingsPage(dataset, normalizeFindingsQuery({ state: "open" })).facets.people;
        expect(facet.reduce((sum, entry) => sum + entry.count, 0)).toBe(split);
      });

      it("find nothing for an id nobody on the board has", () => {
        expect(total({ state: "all", person: ["p000000000000"] })).toBe(0);
        expect(total({ state: "all", person: ["p000000000000", idOf(people[0])] })).toBe(total({ state: "all", person: [idOf(people[0])] }));
      });

      it("list the same people in the facet as in the people list, by name, then Unassigned", () => {
        const facet = findingsPage(dataset, normalizeFindingsQuery()).facets.people;
        const named = people.flatMap((row) => (row.person ? [row.person] : [])).sort(compareByName);
        expect(facet.slice(0, -1).map((entry) => [entry.value, entry.label])).toEqual(named.map((person) => [person.id, person.name]));
        expect(facet.at(-1)).toMatchObject({ value: UNASSIGNED, label: UNASSIGNED_LABEL });
      });

      it("order the people list by open breaches, open warnings, open tickets, then name", () => {
        const key = (row: (typeof people)[number]) => [-row.open_breaches, -row.open_warnings, -row.open_tickets];
        for (let index = 1; index < people.length; index += 1) {
          const [before, after] = [key(people[index - 1]), key(people[index])];
          const order = before.findIndex((value, at) => value !== after[at]);
          if (order >= 0) {
            expect(before[order]).toBeLessThan(after[order]);
          } else {
            const name = (row: (typeof people)[number]) => row.person ?? { id: UNASSIGNED, name: UNASSIGNED_LABEL };
            expect(compareByName(name(people[index - 1]), name(people[index]))).toBeLessThan(0);
          }
        }
      });
    });

    it("dates every response by the same sync", () => {
      const synced = view.meta.last_synced_at;
      for (const meta of [rules.meta, insights.meta, baselineView(dataset).meta, findingsPage(dataset, normalizeFindingsQuery()).meta]) {
        expect(meta.last_synced_at).toBe(synced);
      }
      expect(baselineView(dataset).figures.snapshot.last_synced_at).toBe(synced);
    });

    it("keeps the baseline's own figures coherent", () => {
      const { figures, comparison } = baselineView(dataset);
      const logged = figures.resolved.with_logged_time;
      expect(logged.timespent.count).toBeLessThanOrEqual(logged.aggregate.count);
      expect(figures.resolved.straight_todo_to_done.count).toBeLessThanOrEqual(figures.resolved.in_window);
      expect(Object.values(figures.snapshot.by_type).reduce((sum, count) => sum + count, 0)).toBe(figures.snapshot.total_issues);
      expect(comparison.some((row) => !row.match)).toBe(true);
      for (const row of comparison) expect(row.match).toBe(row.expected === row.actual);
    });
  });
}
