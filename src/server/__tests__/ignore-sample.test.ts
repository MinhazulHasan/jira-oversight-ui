// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ignoredPageSchema,
  ignorePreviewRequestSchema,
  ignorePreviewSchema,
  ignoreRequestSchema,
  ignoreResultSchema,
  restoreResultSchema,
  type IgnoreTarget,
} from "@/lib/api/ignores";
import { normalizeFindingsQuery, normalizeIgnoredQuery, type FindingsQueryInput } from "@/lib/api/params";
import { findingDetailSchema, findingsPageSchema, issueTimelineSchema, overviewSchema, type IgnoreScope } from "@/lib/api/schemas";

import { STATUS } from "../sample/catalogue";
import { sampleDataset, type Dataset } from "../sample/dataset";
import type { FindingRecord } from "../sample/engine";
import { findingDetail, findingsPage } from "../sample/findings";
import { ignoredView, ignorePreviewView, ignoreView, restoreView } from "../sample/ignore-views";
import { activeIgnores, resetSampleIgnores } from "../sample/ignores";
import { issueTimeline } from "../sample/issues";
import { overview } from "../sample/overview";
import { peopleView } from "../sample/people";
import { portfolioView } from "../sample/portfolio";
import { previewView } from "../sample/rule-settings";
import { rulesView } from "../sample/rules";
import { resetSampleRuleSettings } from "../sample/settings-store";

const NOW = Date.parse("2026-11-04T14:30:00Z");
const ADMIN = { hash: "c".repeat(32), name: "Morgan Ellis" };

afterEach(() => {
  resetSampleIgnores();
  resetSampleRuleSettings();
});

const open = (dataset: Dataset) => dataset.engine.findings.filter((finding) => finding.resolvedAt === null && finding.issue !== null);
const page = (dataset: Dataset, query: FindingsQueryInput) => findingsPageSchema.parse(findingsPage(dataset, normalizeFindingsQuery(query)));
const stateCount = (dataset: Dataset, state: string) => page(dataset, { state: "all" }).facets.state.find((entry) => entry.value === state)?.count;

function ignore(target: IgnoreTarget, scope: IgnoreScope, reason: string | null = null) {
  const before = sampleDataset(NOW);
  // As the route checks and rebuilds them.
  const preview = ignorePreviewSchema.parse(ignorePreviewView(before, ignorePreviewRequestSchema.parse({ target, scope })));
  const result = ignoreResultSchema.parse(ignoreView(before, ignoreRequestSchema.parse({ target, scope, reason }), ADMIN, NOW));
  return { before, preview, result, after: sampleDataset(NOW) };
}

/** An open finding of the rule on a ticket that holds no other open finding, so a ticket's ignore and a rule's agree. */
function loneFinding(dataset: Dataset, ruleId: string): FindingRecord {
  const finding = open(dataset).find(
    (candidate) => candidate.rule.id === ruleId && open(dataset).filter((other) => other.issue!.key === candidate.issue!.key).length === 1,
  );
  if (!finding) throw new Error(`no lone open ${ruleId} finding`);
  return finding;
}

describe("ignoring one finding", () => {
  it("resolves it as ignored at once: it leaves every open count, and is neither resolved nor new", () => {
    const dataset = sampleDataset(NOW);
    const target = open(dataset).find((finding) => finding.rule.severity === "breach" && finding.firstSeenAt >= NOW - 7 * 86_400_000)!;
    const { before, preview, result, after } = ignore({ finding_ids: [target.id] }, "finding", "  Closed long ago,\nnot worth it  ");

    expect(preview).toMatchObject({ findings: 1, tickets: 1, already_ignored: 0, by_rule: [{ rule_id: target.rule.id, findings: 1 }] });
    expect(result.ignored).toEqual({ findings: 1, tickets: 1 });
    expect(result.ignore_ids).toHaveLength(1);

    const was = overviewSchema.parse(overview(before)).totals;
    const now = overviewSchema.parse(overview(after)).totals;
    expect(now.open_breaches.current).toBe(was.open_breaches.current - 1);
    // A week ago it was open: the history stands.
    expect(now.open_breaches.previous).toBe(was.open_breaches.previous);
    expect(now.resolved_7d.current).toBe(was.resolved_7d.current);
    expect(now.new_7d.current).toBe(was.new_7d.current - 1);

    expect(page(after, {}).total).toBe(page(before, {}).total - 1);
    expect(stateCount(after, "ignored")).toBe(1);
    expect(stateCount(after, "resolved")).toBe(stateCount(before, "resolved"));
    expect(rulesView(after).rules.find((rule) => rule.rule_id === target.rule.id)?.open).toBe(
      (rulesView(before).rules.find((rule) => rule.rule_id === target.rule.id)?.open ?? 0) - 1,
    );

    const detail = findingDetailSchema.parse(findingDetail(after, target.id));
    expect(detail.finding).toMatchObject({ state: "ignored", resolved_why: "ignored", resolved_at: new Date(NOW).toISOString() });
    expect(detail.finding.ignore).toEqual({
      scope: "finding",
      rule_id: target.rule.id,
      reason: "Closed long ago, not worth it",
      by: "Morgan Ellis",
      at: new Date(NOW).toISOString(),
      ignore_id: result.ignore_ids[0],
    });
    const listed = page(after, { state: "ignored" });
    expect(listed.items.map((finding) => finding.finding_id)).toEqual([target.id]);
    expect(page(after, { state: "resolved" }).items.some((finding) => finding.finding_id === target.id)).toBe(false);
  });

  it("is left out of every earlier point of the open series too, so the line has no cliff", () => {
    const dataset = sampleDataset(NOW);
    const target = open(dataset).find((finding) => finding.rule.severity === "breach" && finding.firstSeenAt < NOW - 30 * 86_400_000)!;
    const { before, after } = ignore({ finding_ids: [target.id] }, "finding");
    const series = (data: Dataset) => overviewSchema.parse(overview(data)).totals.open_breaches.series.map((point) => point.value);
    const was = series(before);
    const now = series(after);
    expect(now[now.length - 1]).toBe(was[was.length - 1] - 1);
    expect(now[now.length - 2]).toBe(was[was.length - 2] - 1);
    const trend = (data: Dataset) => portfolioView([data], undefined, NOW).boards[0].open_findings_trend;
    expect(trend(after)[trend(after).length - 2]).toBe(trend(before)[trend(before).length - 2] - 1);
  });

  it("leaves the people's and the Portfolio's open counts by exactly that finding", () => {
    const dataset = sampleDataset(NOW);
    const target = open(dataset).find((finding) => finding.rule.severity === "warning" && finding.issue!.assigneeAccountId !== null)!;
    const { before, after } = ignore({ finding_ids: [target.id] }, "finding");
    const row = (view: ReturnType<typeof peopleView>) => view.people.find((entry) => entry.person?.id === findingDetail(before, target.id)!.finding.assignee?.id)!;
    expect(row(peopleView(after)).open_warnings).toBe(row(peopleView(before)).open_warnings - 1);
    const board = (dataset: Dataset) => portfolioView([dataset], undefined, NOW).boards[0];
    expect(board(after).open_warnings).toBe(board(before).open_warnings - 1);
    expect(board(after).resolved_findings_7d).toBe(board(before).resolved_findings_7d);
  });

  it("is said again as already ignored, and a second ignore of it gives back the ignore that stands", () => {
    const target = open(sampleDataset(NOW))[0];
    const first = ignore({ finding_ids: [target.id] }, "finding");
    const again = ignore({ finding_ids: [target.id] }, "finding");
    expect(again.preview).toMatchObject({ findings: 0, tickets: 0, already_ignored: 1, by_rule: [] });
    expect(again.result).toMatchObject({ ignored: { findings: 0, tickets: 0 }, ignore_ids: [] });
    const both = ignoreView(sampleDataset(NOW), { target: { issue_keys: [target.issue!.key] }, scope: "ticket", reason: null }, ADMIN, NOW);
    expect(both.ignore_ids).not.toContain(first.result.ignore_ids[0]);
  });
});

describe("ignoring a whole ticket", () => {
  it("covers every rule on it, the open findings of rules not named among them", () => {
    const dataset = sampleDataset(NOW);
    const busy = open(dataset).find((finding) => new Set(open(dataset).filter((other) => other.issue!.key === finding.issue!.key).map((other) => other.rule.id)).size > 1)!;
    const key = busy.issue!.key;
    const onTicket = open(dataset).filter((finding) => finding.issue!.key === key);
    const { preview, result, after } = ignore({ finding_ids: [busy.id] }, "ticket");
    expect(preview.findings).toBe(onTicket.length);
    expect(preview.tickets).toBe(1);
    expect(result.ignored.findings).toBe(onTicket.length);
    expect(open(after).some((finding) => finding.issue!.key === key)).toBe(false);
    const timeline = issueTimelineSchema.parse(issueTimeline(after, key));
    expect(timeline.findings.filter((finding) => finding.state === "ignored").every((finding) => finding.ignore?.scope === "ticket")).toBe(true);
    expect(activeIgnores().ticket(key)?.id).toBe(result.ignore_ids[0]);
  });

  it("by key takes a ticket's scope, and counts nothing on a ticket with nothing open", () => {
    const dataset = sampleDataset(NOW);
    const key = loneFinding(dataset, "R-EST-01").issue!.key;
    const quiet = dataset.world.issues.find((issue) => (dataset.engine.byIssue.get(issue.key) ?? []).every((finding) => finding.resolvedAt !== null))!;
    const { preview, result } = ignore({ issue_keys: [key, quiet.key] }, "ticket");
    expect(preview).toMatchObject({ findings: 1, tickets: 1 });
    expect(result.ignore_ids).toHaveLength(1);
  });
});

describe("ignoring all that match", () => {
  it("on finished tickets: every open finding there, each ticket and rule once; the preview is the result", () => {
    const dataset = sampleDataset(NOW);
    const finished = open(dataset).filter((finding) => STATUS[finding.issue!.status].category === "done");
    expect(finished.length).toBeGreaterThan(20);
    const listed = page(dataset, { ticket: "finished", page_size: 100 });
    expect(listed.total).toBe(finished.length);
    expect(listed.items.every((finding) => finding.scope === "issue")).toBe(true);

    const { preview, result, after } = ignore({ query: { ticket: "finished" } }, "finding", "Finished work: not going back to it");
    expect(preview.findings).toBe(finished.length);
    expect(result.ignored).toEqual({ findings: preview.findings, tickets: preview.tickets });
    expect(preview.by_rule.reduce((sum, entry) => sum + entry.findings, 0)).toBe(preview.findings);
    const pairs = new Set(finished.map((finding) => `${finding.issue!.key} ${finding.rule.id}`));
    expect(result.ignore_ids).toHaveLength(pairs.size);
    expect(page(after, { ticket: "finished" }).total).toBe(0);
    expect(page(after, { ticket: "open" }).total).toBe(page(dataset, { ticket: "open" }).total);
    expect(page(after, { state: "ignored" }).total).toBe(finished.length);
  });

  it("narrowed by the filters, and never a sprint's finding", () => {
    const dataset = sampleDataset(NOW);
    const sprint = dataset.engine.findings.find((finding) => finding.issue === null && finding.resolvedAt === null);
    expect(sprint).toBeDefined();
    const { preview } = ignore({ query: { rule: [sprint!.rule.id] } }, "finding");
    expect(preview.findings).toBe(0);
    const estimates = ignore({ query: { rule: ["R-EST-01"], ticket: "open" } }, "finding");
    expect(estimates.preview.by_rule.map((entry) => entry.rule_id)).toEqual(["R-EST-01"]);
    expect(estimates.preview.findings).toBe(page(estimates.before, { rule: ["R-EST-01"], ticket: "open" }).total);
  });
});

describe("restoring", () => {
  it("removes the ignore, and the findings the rules still hold reopen as themselves, first seen when they were", () => {
    const dataset = sampleDataset(NOW);
    const target = loneFinding(dataset, "R-EST-01");
    const { result } = ignore({ finding_ids: [target.id] }, "finding");
    const restored = restoreResultSchema.parse(restoreView(sampleDataset(NOW), { ignore_ids: result.ignore_ids }, ADMIN, NOW));
    expect(restored).toMatchObject({ restored: 1, recheck: { state: "succeeded" } });
    const after = sampleDataset(NOW);
    const again = after.engine.byId.get(target.id)!;
    expect(again).toMatchObject({ resolvedAt: null, resolvedWhy: null, firstSeenAt: target.firstSeenAt });
    expect(again.ignore).toBeUndefined();
    expect(ignoredPageSchema.parse(ignoredView(after, normalizeIgnoredQuery({}))).total).toBe(0);
    // Restored once: a second restore of the same id finds nothing standing.
    expect(restoreView(after, { ignore_ids: result.ignore_ids }, ADMIN, NOW).restored).toBe(0);
  });

  it("of a ticket's ignore keeps a rule's ignore on the same ticket", () => {
    const dataset = sampleDataset(NOW);
    const target = loneFinding(dataset, "R-EST-01");
    const rule = ignore({ finding_ids: [target.id] }, "finding").result.ignore_ids[0];
    const ticket = ignoreView(sampleDataset(NOW), { target: { issue_keys: [target.issue!.key] }, scope: "ticket", reason: null }, ADMIN, NOW);
    expect(ticket.ignored.findings).toBe(0);
    restoreView(sampleDataset(NOW), { ignore_ids: ticket.ignore_ids }, ADMIN, NOW);
    expect(sampleDataset(NOW).engine.byId.get(target.id)?.ignore?.id).toBe(rule);
  });
});

describe("the ignored list", () => {
  it("lists the standing ignores with their ticket, rule, findings held, who and why; filtered, sorted and paged", () => {
    const dataset = sampleDataset(NOW);
    const estimate = loneFinding(dataset, "R-EST-01");
    const flow = open(dataset).find((finding) => finding.rule.id !== "R-EST-01" && finding.issue!.key !== estimate.issue!.key)!;
    ignore({ finding_ids: [estimate.id] }, "finding", "Agreed with James");
    ignore({ finding_ids: [flow.id] }, "ticket");
    const view = (query = {}) => ignoredPageSchema.parse(ignoredView(sampleDataset(NOW), normalizeIgnoredQuery(query)));

    const all = view();
    expect(all.total).toBe(2);
    const rule = all.items.find((item) => item.scope === "finding")!;
    expect(rule).toMatchObject({
      issue_key: estimate.issue!.key,
      rule_id: "R-EST-01",
      rule_title: estimate.rule.title,
      findings: 1,
      reason: "Agreed with James",
      by: "Morgan Ellis",
      status: estimate.issue!.status,
      status_category: STATUS[estimate.issue!.status].category,
    });
    expect(all.items.find((item) => item.scope === "ticket")).toMatchObject({ issue_key: flow.issue!.key, rule_id: null, rule_title: null });
    expect(view({ rule: ["R-EST-01"] }).items.map((item) => item.issue_key)).toEqual([estimate.issue!.key]);
    expect(view({ q: estimate.issue!.key.toLowerCase() }).items.map((item) => item.issue_key)).toEqual([estimate.issue!.key]);
    expect(view({ sort: "rule_id", order: "asc" }).items.at(-1)?.rule_id).toBeNull();
    expect(view({ page_size: 1, page: 2 }).items).toHaveLength(1);
  });
});

describe("rule settings beside ignores", () => {
  it("a preview neither closes nor opens an ignored finding", () => {
    const dataset = sampleDataset(NOW);
    const stuck = open(dataset).filter((finding) => finding.rule.id === "W-AGE-01");
    expect(stuck.length).toBeGreaterThan(1);
    ignore({ finding_ids: [stuck[0].id] }, "finding");
    const answer = previewView(sampleDataset(NOW), { changes: [{ rule_id: "W-AGE-01", enabled: false }] }, NOW);
    if (!answer.ok) throw new Error("refused");
    const impact = (answer.body as { impact: { rule_id: string; open_now: number; would_close: number }[] }).impact[0];
    expect(impact).toMatchObject({ rule_id: "W-AGE-01", open_now: stuck.length - 1, would_close: stuck.length - 1 });
  });
});
