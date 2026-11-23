import { describe, expect, it } from "vitest";

import { insightsSchema, type Candidate } from "@/lib/api/schemas";

import sample from "../../../../docs/sample-responses/insights.json";
import { bindSentence, quotedDetails, writtenForms } from "../bind";
import {
  candidatesOf,
  EARLIER_WEEK,
  epicKeyOf,
  findingsTarget,
  fromEarlierWeek,
  needsRuleHint,
  primaryHref,
  ruleIdOf,
  sentenceSource,
  TONES,
  tonesIn,
  trendWord,
} from "../model";

const briefing = insightsSchema.parse(sample);
const byId = (id: string): Candidate => {
  const found = briefing.candidates.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no candidate ${id}`);
  return found;
};

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    id: "x",
    kind: "outlier",
    title: "Something",
    score: 1,
    affected: 1,
    severity: "warning",
    trend: 1,
    detail: [],
    issue_keys: [],
    finding_ids: [],
    ...overrides,
  };
}

describe("where a candidate's findings are", () => {
  it("sends a hot spot to its epic's open breaches", () => {
    const spot = byId("hot-spot-demo-704");
    expect(epicKeyOf(spot)).toBe("DEMO-704");
    expect(findingsTarget(spot)).toEqual({
      href: "/findings?epic=DEMO-704&severity=breach",
      count: 73,
      noun: ["open breach", "open breaches"],
      exact: true,
    });
  });

  it("sends a rising rule to that rule's findings first seen this week, open or not", () => {
    const rising = byId("rising-rule-r-est-01");
    expect(ruleIdOf(rising)).toBe("R-EST-01");
    expect(findingsTarget(rising)?.href).toBe("/findings?rule=R-EST-01&state=all&first_seen=7d");
    expect(findingsTarget(rising)?.count).toBe(9);
  });

  it("filters any other kind by the rule its findings were raised under, once known", () => {
    const coverage = byId("coverage-sprint-4426");
    expect(needsRuleHint(coverage)).toBe(true);
    expect(findingsTarget(coverage)).toMatchObject({
      href: `/findings?finding=${coverage.finding_ids[0]}`,
      count: 24,
      exact: false,
    });
    expect(findingsTarget(coverage, "W-EST-01")).toMatchObject({ href: "/findings?rule=W-EST-01", count: 24, exact: true });
    expect(findingsTarget(coverage, "not a rule")?.exact).toBe(false);
  });

  it("opens a single finding directly, and has nothing to open without findings", () => {
    const id = "0b7b3b0f61c477e61699982f24892735";
    expect(findingsTarget(candidate({ kind: "coverage", finding_ids: [id] }))).toMatchObject({
      href: `/findings?finding=${id}`,
      exact: true,
    });
    const outlier = candidate({ kind: "outlier", issue_keys: ["DEMO-12", "DEMO-40"] });
    expect(findingsTarget(outlier)).toBeNull();
    expect(needsRuleHint(outlier)).toBe(false);
    expect(primaryHref(outlier, null)).toBe("/issues/DEMO-12");
    expect(primaryHref(candidate({}), null)).toBeNull();
  });

  it("falls back to the first issue key for a hot spot whose id names no epic", () => {
    const spot = candidate({ kind: "breach_hot_spot", id: "spot-1", severity: "breach", issue_keys: ["DEMO-9"], finding_ids: ["0b7b3b0f61c477e61699982f24892735", "f6c5eaefacc6af95dc0efd83187bd778"] });
    expect(findingsTarget(spot)?.href).toBe("/findings?epic=DEMO-9&severity=breach");
  });
});

describe("the trend", () => {
  it("names the trend's direction from the figure as shown", () => {
    expect(trendWord(1.2857)).toBe("rising");
    expect(trendWord(1.004)).toBe("steady");
    expect(trendWord(0.8)).toBe("easing");
  });
});

describe("the briefing", () => {
  it("lists its tones in a fixed order, in plain words (go-live, SQA)", () => {
    expect(tonesIn(briefing.sentences)).toEqual(["blatantly_bad", "trending_bad"]);
    expect(Object.values(TONES).map((tone) => tone.label)).toEqual(["Serious", "Getting worse", "For information"]);
  });

  it("is from an earlier week once its week is over, by the reader's clock (SQA)", () => {
    // Week of Mon 2 Nov 2026: this week until the Monday after, 9 Nov, 00:00 UTC.
    expect(fromEarlierWeek("2026-11-02", Date.parse("2026-11-04T14:30:00Z"))).toBe(false);
    expect(fromEarlierWeek("2026-11-02", Date.parse("2026-11-08T23:59:59Z"))).toBe(false);
    expect(fromEarlierWeek("2026-11-02", Date.parse("2026-11-09T00:00:00Z"))).toBe(true);
    expect(fromEarlierWeek("2026-11-02", Date.parse("2026-11-17T09:00:00Z"))).toBe(true);
    expect(fromEarlierWeek("not a date", Date.parse("2026-11-17T09:00:00Z"))).toBe(false);
    expect(EARLIER_WEEK).toBe("From an earlier week. Figures may have changed since.");
  });

  it("lets a sentence that names no candidate still click through to its own sources", () => {
    const orphan = { ...briefing.sentences[0], candidate_ids: [] };
    expect(sentenceSource(orphan)).toMatchObject({ finding_ids: orphan.finding_ids, issue_keys: orphan.issue_keys, detail: [] });
    expect(findingsTarget(sentenceSource(orphan)!)?.exact).toBe(false);
    expect(sentenceSource({ ...orphan, finding_ids: [], issue_keys: [] })).toBeNull();
  });

  it("finds each sentence's candidates in rank order", () => {
    expect(candidatesOf(briefing.sentences[3], briefing.candidates).map((each) => each.id)).toEqual(["coverage-sprint-4426"]);
    expect(candidatesOf({ ...briefing.sentences[0], candidate_ids: ["nope"] }, briefing.candidates)).toEqual([]);
  });
});

describe("binding a sentence to its candidates", () => {
  const bound = (index: number) => {
    const sentence = briefing.sentences[index];
    return bindSentence(sentence.text, candidatesOf(sentence, briefing.candidates), sentence.issue_keys);
  };
  const figures = (index: number) =>
    bound(index).flatMap((part) => (part.kind === "figure" ? [`${part.text}=${part.detailKey}`] : []));

  it("ties each quoted figure to the detail it came from", () => {
    expect(figures(0)).toEqual(["73=open_breaches", "71=open_breaches_week_ago"]);
    expect(figures(2)).toEqual(["54=open_breaches"]);
    expect(figures(3)).toEqual(["65%=estimate_share", "94=issues", "59%=logged_share"]);
    expect(figures(4)).toEqual(["9=first_seen_this_week", "7=first_seen_last_week"]);
  });

  it("links the issue keys the candidates name, and keeps the text whole", () => {
    const parts = bound(0);
    expect(parts[0]).toEqual({ kind: "key", text: "DEMO-704", issueKey: "DEMO-704" });
    expect(parts.map((part) => part.text).join("")).toBe(briefing.sentences[0].text);
  });

  it("never finds a figure inside a name, a rule id, a longer number or a share", () => {
    const spot = candidate({
      id: "c",
      detail: [
        { key: "sprint", label: "Sprint", value: "Sprint 26", unit: null },
        { key: "a", label: "A", value: 26, unit: "count" },
        { key: "b", label: "B", value: 1, unit: "count" },
        { key: "c", label: "C", value: 65, unit: "count" },
        { key: "d", label: "D", value: 1136, unit: "count" },
      ],
    });
    const parts = bindSentence("In Sprint 26, R-EST-01 rose 1.5 times to 65% and 1,136 issues.", [spot]);
    expect(parts.filter((part) => part.kind === "figure").map((part) => part.text)).toEqual(["1,136"]);
    expect(bindSentence("DEMO-5 is not a candidate's key.", [spot]).every((part) => part.kind === "text")).toBe(true);
  });

  it("writes each kind of figure as the briefing does", () => {
    expect(writtenForms({ key: "s", label: "S", value: 0.6489, unit: "share" })).toEqual(["65%"]);
    expect(writtenForms({ key: "h", label: "H", value: 31.25, unit: "hours" })).toEqual(["31.3"]);
    expect(writtenForms({ key: "r", label: "R", value: 1.4231, unit: "ratio" })).toEqual(["1.42"]);
    expect(writtenForms({ key: "c", label: "C", value: 1136, unit: "count" })).toEqual(["1,136", "1136"]);
    expect(writtenForms({ key: "t", label: "T", value: "Sprint 26", unit: null })).toEqual([]);
    expect(writtenForms({ key: "n", label: "N", value: null, unit: "count" })).toEqual([]);
  });

  it("collects the details a sentence quotes, by candidate", () => {
    expect(quotedDetails(bound(3)).get("coverage-sprint-4426")).toEqual(new Set(["estimate_share", "issues", "logged_share"]));
  });
});
