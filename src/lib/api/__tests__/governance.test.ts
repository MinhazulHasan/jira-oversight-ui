import { describe, expect, it } from "vitest";

import { accessLogSearchParams, normalizeAccessLogQuery, parseAccessLogQuery } from "../params";
import {
  accessDetail,
  accessLogEntrySchema,
  ACCESS_LOG_EXPORT_MAX,
  portfolioBoardSchema,
  SIGNED_IN_USER,
  usageSchema,
} from "../schemas";

import accessLogJson from "../../../../docs/sample-responses/access-log.json";
import portfolioJson from "../../../../docs/sample-responses/portfolio.json";
import usageJson from "../../../../docs/sample-responses/usage.json";

/*
 * The governance contract (JO-12, sections 4.16 to 4.18) as this interface
 * reads it: the access log's filters, canonical and checked; an entry's
 * detail read for what the page shows and nothing else; the Portfolio's and
 * usage's own consistency checks.
 */

describe("the access log's filters", () => {
  it("are canonical: actions in the catalogue's order, each once, and the limit always written", () => {
    const query = normalizeAccessLogQuery({ action: ["person_ask", "scorecard_view", "person_ask"], person: "pbc7fe62842ca" });
    expect(query).toEqual({ action: ["scorecard_view", "person_ask"], person: "pbc7fe62842ca", limit: 50, export: false });
    expect(accessLogSearchParams(query).toString()).toBe("action=scorecard_view&action=person_ask&person=pbc7fe62842ca&limit=50");
  });

  it("give an export the service's whole limit unless it says otherwise", () => {
    expect(normalizeAccessLogQuery({ export: true }).limit).toBe(ACCESS_LOG_EXPORT_MAX);
    expect(accessLogSearchParams({ export: true }).toString()).toBe(`limit=${ACCESS_LOG_EXPORT_MAX}&export=true`);
  });

  it("refuse a page past 200, an export past 10,000, a range that ends before it starts, and anything unknown", () => {
    const problems = (search: string) => {
      const parsed = parseAccessLogQuery(new URLSearchParams(search));
      return parsed.ok ? [] : parsed.problems.map((problem) => problem.path);
    };
    expect(problems("limit=200")).toEqual([]);
    expect(problems("limit=201")).toEqual(["limit"]);
    expect(problems("export=true&limit=10000")).toEqual([]);
    expect(problems("export=true&limit=10001")).toEqual(["limit"]);
    expect(problems("from=2026-11-04&to=2026-11-03")).toEqual(["to"]);
    expect(problems("from=2026-02-30")).toEqual(["from"]);
    expect(problems("viewer=someone")).toEqual(["viewer"]);
    expect(problems("viewer=local")).toEqual([]);
    expect(problems("person=557058:abc")).toEqual(["person"]);
    expect(problems("level=people")).toEqual(["level"]);
    expect(problems("viewer=local&viewer=local")).toEqual(["viewer"]);
  });
});

describe("an access log entry", () => {
  const entry = accessLogJson.entries[1];

  it("keeps of its detail the period, the answer's reference and the entries read, and nothing else", () => {
    expect(accessDetail({ days: 90, state: "open", page: 2, outcome: "answered", viewer: "local", secret: "x" })).toEqual({ days: 90, qa_id: null, entries: null });
    expect(accessDetail({ qa_id: "0123456789abcdef0123456789abcdef", entries: 12 })).toEqual({ days: null, qa_id: "0123456789abcdef0123456789abcdef", entries: 12 });
    expect(accessDetail({ qa_id: "not-an-id", days: 0, entries: -1 })).toEqual({ days: null, qa_id: null, entries: null });
    expect(accessDetail(null)).toEqual({ days: null, qa_id: null, entries: null });
    expect(accessDetail([1, 2])).toEqual({ days: null, qa_id: null, entries: null });
  });

  it("never shows a viewer name that holds an email address: it reads as a signed-in user", () => {
    const parsed = accessLogEntrySchema.parse({ ...entry, viewer: { ...entry.viewer, name: "someone@example.com" } });
    expect(parsed.viewer.name).toBe(SIGNED_IN_USER);
  });

  it("is refused with a viewer that is neither a keyed hash nor the local reader", () => {
    expect(accessLogEntrySchema.safeParse({ ...entry, viewer: { ...entry.viewer, hash: "557058:account" } }).success).toBe(false);
  });
});

describe("the Portfolio and usage", () => {
  const board = portfolioJson.boards[0];

  it("a board's row: 8 weeks of trend, never more in progress than open; a sum that differs from the trend's is not refused", () => {
    expect(portfolioBoardSchema.safeParse(board).success).toBe(true);
    expect(portfolioBoardSchema.safeParse({ ...board, open_findings_trend: board.open_findings_trend.slice(1) }).success).toBe(false);
    expect(portfolioBoardSchema.safeParse({ ...board, in_progress: board.open_tickets + 1 }).success).toBe(false);
    expect(portfolioBoardSchema.safeParse({ ...board, open_findings_trend: board.open_findings_trend.map((value) => value + 1) }).success).toBe(true);
    expect(portfolioBoardSchema.safeParse({ ...board, sprint_at_risk: null, unestimated_in_active_sprint: 0, top_rule: null, last_sync_at: null, stale: true }).success).toBe(true);
  });

  it("usage: a budget and its share go together, and the days run oldest first", () => {
    expect(usageSchema.safeParse(usageJson).success).toBe(true);
    const budget = { ...usageJson, today: { ...usageJson.today, budget_tokens: 500_000, budget_used_pct: 41.9 } };
    expect(usageSchema.safeParse(budget).success).toBe(true);
    expect(usageSchema.safeParse({ ...usageJson, today: { ...usageJson.today, budget_tokens: 500_000 } }).success).toBe(false);
    expect(usageSchema.safeParse({ ...usageJson, last_7_days: [...usageJson.last_7_days].reverse() }).success).toBe(false);
  });
});
