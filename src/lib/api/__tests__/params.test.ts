import { describe, expect, it } from "vitest";

import {
  findingsSearchParams,
  normalizeFindingsQuery,
  normalizeTrendQuery,
  parseFindingsQuery,
  parseTrendQuery,
  trendSearchParams,
} from "../params";

describe("findings parameters", () => {
  it("fill in defaults: open findings, newest first, 25 to a page", () => {
    expect(normalizeFindingsQuery()).toEqual({
      rule: [],
      severity: undefined,
      state: "open",
      epic: [],
      person: [],
      q: undefined,
      first_seen: "all",
      sort: "first_seen_at",
      order: "desc",
      page: 1,
      page_size: 25,
    });
  });

  it("serialise canonically: defaults left out, lists sorted and de-duplicated", () => {
    const search = findingsSearchParams({ rule: ["R-FLOW-02", "R-EST-01", "R-FLOW-02"], epic: ["DEMO-763", "none"], state: "open", page: 2 });
    expect(search.toString()).toBe("rule=R-EST-01&rule=R-FLOW-02&epic=DEMO-763&epic=none&page=2");
    expect(findingsSearchParams({}).toString()).toBe("");
    expect(findingsSearchParams({ person: ["unassigned", "pe0f1fe0c54ec", "p0998d9f44491", "unassigned"], q: "import" }).toString()).toBe(
      "person=p0998d9f44491&person=pe0f1fe0c54ec&person=unassigned&q=import",
    );
  });

  it("parse back to the same query they were written from", () => {
    const query = normalizeFindingsQuery({
      rule: ["W-AGE-01"],
      severity: "warning",
      state: "all",
      epic: ["DEMO-704"],
      person: ["p3f9a2c41b0de", "unassigned"],
      q: "import",
      first_seen: "30d",
      sort: "severity",
      order: "asc",
      page: 3,
      page_size: 50,
    });
    const parsed = parseFindingsQuery(findingsSearchParams(query));
    expect(parsed).toEqual({ ok: true, value: query });
  });

  it("refuse unknown names, a single value given twice, and values out of range", () => {
    expect(parseFindingsQuery(new URLSearchParams("colour=red"))).toEqual({
      ok: false,
      problems: [{ path: "colour", message: "is not a parameter of this endpoint" }],
    });
    expect(parseFindingsQuery(new URLSearchParams("sort=severity&sort=rule_id")).ok).toBe(false);
    expect(parseFindingsQuery(new URLSearchParams("page_size=101")).ok).toBe(false);
    expect(parseFindingsQuery(new URLSearchParams("epic=demo-1")).ok).toBe(false);
    expect(parseFindingsQuery(new URLSearchParams("first_seen=1y")).ok).toBe(false);
  });

  it("treat an empty value as not given", () => {
    expect(parseFindingsQuery(new URLSearchParams("q=&rule=&severity=&person="))).toEqual({ ok: true, value: normalizeFindingsQuery() });
  });

  it("take a board's own rules by their ids (JO-20): two or three digits, as the service numbers them", () => {
    const parsed = parseFindingsQuery(new URLSearchParams("rule=R-CUS-101&rule=W-CUS-07&rule=R-EFF-01"));
    expect(parsed.ok && normalizeFindingsQuery(parsed.value).rule).toEqual(["R-CUS-101", "R-EFF-01", "W-CUS-07"]);
    for (const value of ["R-CUS-1", "R-CUS-1000", "r-cus-01", "X-CUS-01"]) expect(parseFindingsQuery(new URLSearchParams({ rule: value })).ok, value).toBe(false);
  });

  it("take people as epics are taken: an id or 'unassigned', repeatable, at most 50, exactly as written", () => {
    const parsed = parseFindingsQuery(new URLSearchParams("person=unassigned&person=p3f9a2c41b0de&person=unassigned"));
    expect(parsed.ok && normalizeFindingsQuery(parsed.value).person).toEqual(["p3f9a2c41b0de", "unassigned"]);
    // Upper case, a bare hash, an account id, or a name: refused, never guessed at.
    for (const value of ["P3F9A2C41B0DE", "Unassigned", "3f9a2c41b0de", "p3f9a2c41b0d", "acc-01", "557058:0e7d3f6c-1d2b", "Ada Brooks", "none"]) {
      expect(parseFindingsQuery(new URLSearchParams({ person: value })).ok, value).toBe(false);
    }
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `person=p${index.toString(16).padStart(12, "0")}`).join("&");
    expect(parseFindingsQuery(new URLSearchParams(ids(50))).ok).toBe(true);
    expect(parseFindingsQuery(new URLSearchParams(ids(51)))).toEqual({
      ok: false,
      problems: [{ path: "person", message: expect.any(String) }],
    });
  });
});

describe("trend parameters", () => {
  it("default to the last twelve weeks", () => {
    expect(normalizeTrendQuery({ metric: "reopen_rate" })).toEqual({ metric: "reopen_rate", period: "week", last_n: 12 });
    expect(trendSearchParams({ metric: "reopen_rate", last_n: 4 }).toString()).toBe("metric=reopen_rate&period=week&last_n=4");
  });

  it("refuse more than twelve weeks or an unknown metric", () => {
    expect(parseTrendQuery(new URLSearchParams("metric=reopen_rate&last_n=13")).ok).toBe(false);
    expect(parseTrendQuery(new URLSearchParams("metric=velocity")).ok).toBe(false);
    expect(parseTrendQuery(new URLSearchParams("metric=open_breaches&period=month")).ok).toBe(false);
  });
});
