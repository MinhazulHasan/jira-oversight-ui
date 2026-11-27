// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { findingsQuerySchema } from "@/lib/api/params";
import { apiErrorBodySchema, findingSchema, findingsPageSchema, type Finding } from "@/lib/api/schemas";
import { sealSession } from "@/server/auth/cookies";
import { emailHash } from "@/server/auth/roles";
import { APP, SECRET, SESSION_KEYS, stubAuthEnv } from "@/server/auth/__tests__/fixtures";
import { activeIgnores } from "@/server/sample/ignores";

import findingJson from "../../../../docs/sample-responses/finding.json";
import findingsJson from "../../../../docs/sample-responses/findings.json";

const NOW = "2026-11-04T14:30:00Z";
const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" };
const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };
const ORIGIN = "http://localhost:3400";
const LOCAL = "Local (sign-in off)";
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "h".repeat(43), boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";
const BOARD = "jo-board=DEMO";
const WEEK = 7 * 24 * 3600 * 1000;
const IGNORE_FIELDS = ["at", "by", "reason", "rule_id", "scope"];
const LISTED_FIELDS = [
  "at", "by", "findings", "ignore_id", "issue_key", "issue_summary", "issue_type", "reason", "rule_id", "rule_title", "scope", "status",
  "status_category",
];

interface Facet {
  value: string;
  count: number;
}

interface FindingsBody {
  total: number;
  items: Finding[];
  facets: { state: Facet[]; rules: Facet[]; severity: Facet[]; people: Facet[] };
}

interface PreviewBody {
  findings: number;
  tickets: number;
  by_rule: { rule_id: string; rule_title: string; findings: number }[];
  already_ignored: number;
}

interface ResultBody {
  ignored: { findings: number; tickets: number };
  ignore_ids: string[];
}

interface Listed {
  ignore_id: string;
  scope: string;
  issue_key: string;
  rule_id: string | null;
  rule_title: string | null;
  findings: number;
  reason: string | null;
  by: string | null;
  at: string;
}

interface ListedBody {
  items: Listed[];
  total: number;
  page: number;
  page_size: number;
}

type Target = { finding_ids: string[] } | { issue_keys: string[] } | { query: Record<string, unknown> };

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/").map(decodeURIComponent) }) });

function read(path: string, cookie?: string) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }), params(url));
}

interface Sent {
  origin?: string | null;
  type?: string;
  cookie?: string;
  raw?: string;
}

/** A POST as the dashboard's own pages send it (JSON, from its origin), or as anything else might. */
function post(path: string, body: unknown, { origin = ORIGIN, type = "application/json", cookie, raw }: Sent = {}) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  const headers: Record<string, string> = { "content-type": type };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return POST(new NextRequest(url, { method: "POST", body: raw ?? JSON.stringify(body), headers }), params(url));
}

async function ok<T>(response: Response | Promise<Response>): Promise<T> {
  const answered = await response;
  const text = await answered.text();
  expect(answered.status, text).toBe(200);
  expect(answered.headers.get("cache-control")).toBe("no-store");
  return JSON.parse(text) as T;
}

async function expectProblem(response: Response | Promise<Response>, status: number, error: string) {
  const answered = await response;
  expect(answered.status).toBe(status);
  const body = apiErrorBodySchema.parse(await answered.json());
  expect(body.error).toBe(error);
  return body;
}

function stub(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

/** Every finding a query lists, a page at a time. */
async function allFindings(search: string, cookie?: string): Promise<Finding[]> {
  const items: Finding[] = [];
  for (let page = 1; ; page += 1) {
    const body = await ok<FindingsBody>(read(`findings?${search}${search ? "&" : ""}page_size=100&page=${page}`, cookie));
    items.push(...body.items);
    if (body.items.length === 0 || items.length >= body.total) {
      expect(items).toHaveLength(body.total);
      return items;
    }
  }
}

async function openTotal(search = ""): Promise<number> {
  return (await ok<FindingsBody>(read(`findings${search ? `?${search}` : ""}`))).total;
}

/** Tickets with open findings of two rules or more, by key: what an ignore of a whole ticket is tried on. */
async function ticketsWithRules(search: string): Promise<string[]> {
  const rules = new Map<string, Set<string>>();
  for (const finding of await allFindings(search)) {
    if (finding.issue_key) rules.set(finding.issue_key, (rules.get(finding.issue_key) ?? new Set()).add(finding.rule_id));
  }
  return [...rules].filter(([, held]) => held.size > 1).map(([key]) => key);
}

/** Every ignore that stands, restored through the route as an admin would: the sample back as it was. */
async function restoreEverything() {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const body = await ok<ListedBody>(read(`findings/ignored?page_size=100&page=${page}`));
    ids.push(...body.items.map((item) => item.ignore_id));
    if (body.items.length === 0 || ids.length >= body.total) break;
  }
  if (ids.length > 0) await ok(post("findings/restore", { ignore_ids: ids }));
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  stub(SAMPLE);
  await restoreEverything();
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------------ the contract's shapes -- */

const IGNORED_AT = "2026-11-26T09:15:00.000Z";

/** The documented open finding (DEMO-1098, R-EST-01), ignored: `ignore` null for one whose ignore was just restored. */
function ignored(overrides: Record<string, unknown> = {}, ignore: Record<string, unknown> | null = {}): unknown {
  return {
    ...findingJson.finding,
    state: "ignored",
    resolved_at: IGNORED_AT,
    resolved_why: "ignored",
    ignore:
      ignore === null
        ? null
        : { scope: "finding", rule_id: "R-EST-01", reason: "Closed before the rules ran", by: "Morgan Ellis", at: IGNORED_AT, ...ignore },
    ...overrides,
  };
}

describe("an ignored finding, as the contract carries it", () => {
  it("is ignored, resolved as ignored, with who ignored it, when and why", () => {
    expect(findingSchema.parse(ignored())).toMatchObject({
      state: "ignored",
      resolved_at: IGNORED_AT,
      resolved_why: "ignored",
      ignore: { scope: "finding", rule_id: "R-EST-01", reason: "Closed before the rules ran", by: "Morgan Ellis", at: IGNORED_AT },
    });
    expect(findingSchema.parse(ignored({}, { scope: "ticket", rule_id: null, reason: null })).ignore).toMatchObject({ scope: "ticket", rule_id: null });
    // Below the people level the service names no one; and between a restore and its re-check no ignore holds it.
    expect(findingSchema.parse(ignored({}, { by: null })).ignore?.by).toBeNull();
    expect(findingSchema.parse(ignored({}, null)).ignore).toBeNull();
    expect(findingSchema.parse(findingJson.finding).ignore).toBeNull();
  });

  it("refuses what an ignored finding cannot be", () => {
    for (const [why, finding] of [
      ["not resolved", ignored({ resolved_at: null })],
      ["resolved but said ignored", ignored({ state: "resolved" })],
      ["open but resolved as ignored", ignored({ state: "open", resolved_at: null })],
      ["ignored but cleared", ignored({ resolved_why: "cleared" })],
      ["a scope that is neither", ignored({}, { scope: "epic" })],
      ["one rule with no rule", ignored({}, { scope: "finding", rule_id: null })],
      ["a whole ticket with one rule", ignored({}, { scope: "ticket", rule_id: "R-EST-01" })],
      ["a reason over 500 characters", ignored({}, { reason: "x".repeat(501) })],
      ["a time that is not one", ignored({}, { at: "yesterday" })],
    ] as const) {
      expect(findingSchema.safeParse(finding).success, why).toBe(false);
    }
    // 500 characters as the service counts them: an emoji is one.
    expect(findingSchema.safeParse(ignored({}, { reason: "📈".repeat(500) })).success).toBe(true);
  });

  it("never shows an email address for who ignored it, nor in its reason", () => {
    const parsed = findingSchema.safeParse(ignored({}, { by: "jane.doe@example.org", reason: "Asked by jane.doe@example.org" }));
    expect(!parsed.success || !JSON.stringify(parsed.data).includes("jane.doe@example.org")).toBe(true);
  });

  it("lists Ignored after Open and Resolved among the states of a page", () => {
    const state = [
      { value: "open", label: "Open", count: 808 },
      { value: "resolved", label: "Resolved", count: 737 },
      { value: "ignored", label: "Ignored", count: 1 },
    ];
    const page = findingsPageSchema.parse({ ...findingsJson, items: [ignored()], facets: { ...findingsJson.facets, state } });
    expect(page.facets.state.map((entry) => entry.value)).toEqual(["open", "resolved", "ignored"]);
    expect(page.items[0].state).toBe("ignored");
  });

  it("reads state=ignored and the ticket filter, open or finished, and nothing else", () => {
    expect(findingsQuerySchema.parse({ state: "ignored", ticket: "finished" })).toMatchObject({ state: "ignored", ticket: "finished" });
    expect(findingsQuerySchema.parse({ ticket: "open" }).ticket).toBe("open");
    expect(findingsQuerySchema.parse({}).ticket).toBeUndefined();
    for (const ticket of ["closed", "Finished", "done", "any"]) expect(findingsQuerySchema.safeParse({ ticket }).success, ticket).toBe(false);
    expect(findingsQuerySchema.safeParse({ state: "hidden" }).success).toBe(false);
  });
});

/* -------------------------------------------------------------- the sample, through the route -- */

describe("ignoring findings on the sample, through the interface (sign-in off: people level)", () => {
  beforeEach(() => stub(SAMPLE));

  async function preview(target: Target, scope: "finding" | "ticket") {
    const body = await ok<PreviewBody & { meta: unknown }>(post("findings/ignore/preview", { target, scope }));
    expect(Object.keys(body).sort()).toEqual(["already_ignored", "by_rule", "findings", "meta", "tickets"]);
    for (const entry of body.by_rule) expect(Object.keys(entry).sort()).toEqual(["findings", "rule_id", "rule_title"]);
    expect(body.by_rule.reduce((sum, entry) => sum + entry.findings, 0)).toBe(body.findings);
    return body;
  }

  async function ignore(target: Target, scope: "finding" | "ticket", reason: string | null = null) {
    const body = await ok<ResultBody & { meta: unknown }>(post("findings/ignore", { target, scope, reason }));
    expect(Object.keys(body).sort()).toEqual(["ignore_ids", "ignored", "meta"]);
    expect(new Set(body.ignore_ids).size).toBe(body.ignore_ids.length);
    return body;
  }

  for (const kind of ["finding ids", "issue keys", "a query"] as const) {
    it(`previews an ignore by ${kind} without changing anything, then ignores exactly what it said`, async () => {
      let target: Target;
      let scope: "finding" | "ticket" = "finding";
      if (kind === "finding ids") {
        target = { finding_ids: (await allFindings("ticket=finished")).slice(0, 6).map((finding) => finding.finding_id) };
      } else if (kind === "issue keys") {
        target = { issue_keys: (await ticketsWithRules("ticket=open")).slice(0, 2) };
        scope = "ticket";
      } else {
        target = { query: { ticket: "finished", rule: ["R-FLOW-02"] } };
      }
      const before = await openTotal();

      const asked = await preview(target, scope);

      expect(asked.findings).toBeGreaterThan(0);
      expect(asked.already_ignored).toBe(0);
      expect(await openTotal()).toBe(before);
      const done = await ignore(target, scope, "Agreed with James");
      expect(done.ignored).toEqual({ findings: asked.findings, tickets: asked.tickets });
      expect(await openTotal()).toBe(before - asked.findings);
      const set = await allFindings("state=ignored");
      expect(set).toHaveLength(asked.findings);
      expect(new Set(set.map((finding) => finding.issue_key)).size).toBe(asked.tickets);
      for (const finding of set) {
        expect([finding.state, finding.resolved_why]).toEqual(["ignored", "ignored"]);
        expect(finding.resolved_at).not.toBeNull();
        expect(Object.keys(finding.ignore ?? {}).filter((name) => name !== "ignore_id").sort()).toEqual(IGNORE_FIELDS);
        expect(finding.ignore).toMatchObject({ scope, rule_id: scope === "ticket" ? null : finding.rule_id, reason: "Agreed with James", by: LOCAL });
      }
    });
  }

  it("ignores every open finding on a finished ticket, and nothing on an open one", async () => {
    const finished = await allFindings("ticket=finished");
    const onOpen = await openTotal("ticket=open");
    const asked = await preview({ query: { ticket: "finished" } }, "finding");
    expect(asked.findings).toBe(finished.length);
    expect(asked.tickets).toBe(new Set(finished.map((finding) => finding.issue_key)).size);

    await ignore({ query: { ticket: "finished" } }, "finding");

    expect(await openTotal("ticket=finished")).toBe(0);
    expect(await openTotal("ticket=open")).toBe(onOpen);
    expect((await allFindings("state=ignored")).map((finding) => finding.finding_id).sort()).toEqual(finished.map((finding) => finding.finding_id).sort());
    // A sprint finding belongs to no ticket: neither filter lists it, and it stays open.
    const sprints = (await allFindings("state=all")).filter((finding) => finding.scope === "sprint");
    expect(sprints.length).toBeGreaterThan(0);
    for (const ticket of ["open", "finished"]) {
      expect((await allFindings(`ticket=${ticket}&state=all`)).some((finding) => finding.scope === "sprint")).toBe(false);
    }
  });

  it("an ignored finding leaves every open count at once, and counts as neither resolved nor new", async () => {
    const counts = async () => {
      const overview = await ok<{ totals: Record<string, { current: number; series: { end_at: string }[] }> }>(read("overview"));
      const portfolio = await ok<{ boards: { project: { key: string }; open_breaches: number; open_warnings: number; new_findings_7d: number; resolved_findings_7d: number }[] }>(
        read("portfolio"),
      );
      const people = await ok<{ people: { person: { id: string } | null; open_breaches: number; open_warnings: number }[] }>(read("people"));
      const rules = await ok<{ rules: { rule_id: string; open: number }[] }>(read("rules"));
      const breaches = await ok<{ series: { value: number | null }[] }>(read("trends?metric=open_breaches"));
      const warnings = await ok<{ series: { value: number | null }[] }>(read("trends?metric=open_warnings"));
      const findings = await ok<FindingsBody>(read("findings"));
      const demo = portfolio.boards.find((board) => board.project.key === "DEMO");
      return {
        totals: Object.fromEntries(Object.entries(overview.totals).map(([name, total]) => [name, total.current])),
        windowEnd: Date.parse(overview.totals.new_7d.series.at(-1)?.end_at ?? ""),
        portfolio: demo && [demo.open_breaches, demo.open_warnings, demo.new_findings_7d, demo.resolved_findings_7d],
        people: Object.fromEntries(people.people.map((row) => [row.person?.id ?? "unassigned", [row.open_breaches, row.open_warnings]])),
        rules: Object.fromEntries(rules.rules.map((rule) => [rule.rule_id, rule.open])),
        trends: [breaches.series.at(-1)?.value, warnings.series.at(-1)?.value],
        total: findings.total,
        state: Object.fromEntries(findings.facets.state.map((entry) => [entry.value, entry.count])),
      };
    };
    const before = await counts();
    const [whole] = await ticketsWithRules("ticket=open");
    const others = (findings: Finding[]) => findings.filter((finding) => finding.scope === "issue" && finding.issue_key !== whole);
    const breaches = others(await allFindings("severity=breach&ticket=finished")).slice(0, 4).map((finding) => finding.finding_id);
    const fresh = others(await allFindings("first_seen=7d&severity=warning")).slice(0, 3).map((finding) => finding.finding_id);
    await ignore({ finding_ids: [...breaches, ...fresh] }, "finding");
    await ignore({ issue_keys: [whole] }, "ticket");

    const after = await counts();
    const gone = await allFindings("state=ignored");
    const tally = (pick: (finding: Finding) => string) =>
      gone.reduce<Record<string, number>>((found, finding) => ({ ...found, [pick(finding)]: (found[pick(finding)] ?? 0) + 1 }), {});
    const bySeverity = tally((finding) => finding.severity);
    const byRule = tally((finding) => finding.rule_id);
    const byPerson = tally((finding) => `${finding.assignee?.id ?? "unassigned"} ${finding.severity}`);
    const newThisWeek = gone.filter((finding) => {
      const seen = Date.parse(finding.first_seen_at);
      return seen >= before.windowEnd - WEEK && seen <= before.windowEnd;
    }).length;
    expect(gone.length).toBeGreaterThanOrEqual(9);
    expect(newThisWeek).toBeGreaterThan(0);

    expect(after.totals.open_breaches).toBe(before.totals.open_breaches - (bySeverity.breach ?? 0));
    expect(after.totals.open_warnings).toBe(before.totals.open_warnings - (bySeverity.warning ?? 0));
    expect(after.totals.new_7d).toBe(before.totals.new_7d - newThisWeek);
    expect(after.totals.resolved_7d).toBe(before.totals.resolved_7d);
    expect(after.portfolio).toEqual([
      before.totals.open_breaches - (bySeverity.breach ?? 0),
      before.totals.open_warnings - (bySeverity.warning ?? 0),
      before.totals.new_7d - newThisWeek,
      before.totals.resolved_7d,
    ]);
    for (const [who, [openBreaches, openWarnings]] of Object.entries(before.people)) {
      expect(after.people[who], who).toEqual([openBreaches - (byPerson[`${who} breach`] ?? 0), openWarnings - (byPerson[`${who} warning`] ?? 0)]);
    }
    for (const [rule, open] of Object.entries(before.rules)) expect(after.rules[rule], rule).toBe(open - (byRule[rule] ?? 0));
    expect(after.trends).toEqual([
      (before.trends[0] ?? 0) - (bySeverity.breach ?? 0),
      (before.trends[1] ?? 0) - (bySeverity.warning ?? 0),
    ]);
    expect(after.total).toBe(before.total - gone.length);
    expect(after.state).toEqual({ open: before.state.open - gone.length, resolved: before.state.resolved, ignored: gone.length });
  });

  it("restores the same findings, first seen as before, and the ignore leaves the list", async () => {
    const [whole] = await ticketsWithRules("ticket=open");
    const single = (await allFindings("ticket=finished"))[0];
    const before = new Map((await allFindings("")).map((finding) => [finding.finding_id, finding.first_seen_at]));
    const made = [await ignore({ issue_keys: [whole] }, "ticket"), await ignore({ finding_ids: [single.finding_id] }, "finding", "Old work")];
    const ids = made.flatMap((body) => body.ignore_ids);
    const held = await allFindings("state=ignored");
    expect(held.length).toBeGreaterThan(2);

    const restored = await ok<{ meta: unknown; restored: number; recheck: { state: string } | null }>(post("findings/restore", { ignore_ids: ids }));

    expect(Object.keys(restored).sort()).toEqual(["meta", "recheck", "restored"]);
    expect(restored.restored).toBe(ids.length);
    expect((await ok<ListedBody>(read("findings/ignored"))).total).toBe(0);
    const now = new Map((await allFindings("")).map((finding) => [finding.finding_id, finding.first_seen_at]));
    for (const finding of held) expect(now.get(finding.finding_id), finding.finding_id).toBe(before.get(finding.finding_id));
    expect(await openTotal("state=ignored")).toBe(0);
    // Restoring again changes nothing: those ignores are history now.
    expect((await ok<{ restored: number }>(post("findings/restore", { ignore_ids: ids }))).restored).toBe(0);
  });

  it("lists each standing ignore once, with its ticket, rule, findings now, who, when and why, a page at a time", async () => {
    const singles = (await allFindings("ticket=finished&rule=R-EST-01")).slice(0, 30);
    await ignore({ finding_ids: singles.map((finding) => finding.finding_id) }, "finding", "Closed before we started");
    const [whole] = await ticketsWithRules("ticket=open");
    await ignore({ issue_keys: [whole] }, "ticket");

    const first = await ok<ListedBody & { meta: unknown }>(read("findings/ignored"));

    expect(Object.keys(first).sort()).toEqual(["items", "meta", "page", "page_size", "total"]);
    const pairs = new Set(singles.map((finding) => `${finding.issue_key} ${finding.rule_id}`));
    expect([first.total, first.page, first.page_size, first.items.length]).toEqual([pairs.size + 1, 1, 25, 25]);
    const every = [...first.items, ...(await ok<ListedBody>(read("findings/ignored?page=2"))).items];
    expect(new Set(every.map((item) => item.ignore_id)).size).toBe(pairs.size + 1);
    for (const item of every) {
      expect(Object.keys(item).sort()).toEqual(LISTED_FIELDS);
      expect(item.by).toBe(LOCAL);
      if (item.scope === "ticket") {
        expect([item.issue_key, item.rule_id, item.rule_title, item.reason]).toEqual([whole, null, null, null]);
        expect(item.findings).toBeGreaterThan(1);
      } else {
        expect(pairs.has(`${item.issue_key} ${item.rule_id}`)).toBe(true);
        expect([item.rule_title, item.reason, item.findings]).toEqual(["Work started without an estimate", "Closed before we started", 1]);
      }
    }
    const byKey = (await ok<ListedBody>(read("findings/ignored?sort=issue_key&order=asc&page_size=100"))).items;
    const numbers = byKey.map((item) => Number(item.issue_key.split("-")[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    const ruled = (await ok<ListedBody>(read("findings/ignored?rule=R-EST-01&page_size=100"))).items;
    expect(ruled.filter((item) => item.scope === "finding")).toHaveLength(pairs.size);
    const one = singles[0].issue_key ?? "";
    expect(new Set((await ok<ListedBody>(read(`findings/ignored?q=${one}`))).items.map((item) => item.issue_key))).toEqual(new Set([one]));
    for (const bad of ["page_size=0", "page_size=101", "sort=severity", "order=up", "colour=red", "page=0", "project=AIL"]) {
      await expectProblem(read(`findings/ignored?${bad}`), 400, "bad_request");
    }
  });

  it("refuses a body the contract does not allow, before anything changes", async () => {
    const [finding] = await allFindings("ticket=finished");
    const [key] = await ticketsWithRules("ticket=open");
    const before = await openTotal();
    for (const [why, path, body] of [
      ["issue keys need the ticket scope", "findings/ignore", { target: { issue_keys: [key] }, scope: "finding" }],
      ["two targets", "findings/ignore", { target: { finding_ids: [finding.finding_id], issue_keys: [key] }, scope: "ticket" }],
      ["no target", "findings/ignore", { scope: "finding" }],
      ["no finding ids", "findings/ignore", { target: { finding_ids: [] }, scope: "finding" }],
      ["a finding id that is not one", "findings/ignore", { target: { finding_ids: [key] }, scope: "finding" }],
      ["a scope that is neither", "findings/ignore", { target: { finding_ids: [finding.finding_id] }, scope: "epic" }],
      ["a reason over 500 characters", "findings/ignore", { target: { finding_ids: [finding.finding_id] }, scope: "finding", reason: "x".repeat(501) }],
      ["a field it does not take", "findings/ignore", { target: { finding_ids: [finding.finding_id] }, scope: "finding", level: "people" }],
      ["a filter the findings list does not take", "findings/ignore", { target: { query: { state: "open" } }, scope: "finding" }],
      ["a ticket filter that is not one", "findings/ignore/preview", { target: { query: { ticket: "closed" } }, scope: "finding" }],
      ["10,001 issue keys", "findings/ignore/preview", { target: { issue_keys: Array.from({ length: 10_001 }, (_, n) => `DEMO-${n + 1}`) }, scope: "ticket" }],
      ["no ignore ids", "findings/restore", { ignore_ids: [] }],
      ["ignore ids that are not a list", "findings/restore", { ignore_ids: "all" }],
    ] as const) {
      const response = await post(path, body);
      expect([400, 422], why).toContain(response.status);
      expect(apiErrorBodySchema.safeParse(await response.json()).success, why).toBe(true);
    }
    expect(await openTotal()).toBe(before);
    expect(await openTotal("state=ignored")).toBe(0);
  });

  it("takes POSTs only from the dashboard's own pages, as JSON, with no query parameters", async () => {
    const [finding] = await allFindings("ticket=finished");
    const body = { target: { finding_ids: [finding.finding_id] }, scope: "finding" };
    for (const path of ["findings/ignore/preview", "findings/ignore", "findings/restore"]) {
      const sent = path === "findings/restore" ? { ignore_ids: ["a".repeat(32)] } : body;
      for (const origin of [null, "https://evil.example", "null", "http://localhost:3401"]) {
        await expectProblem(post(path, sent, { origin }), 403, "forbidden");
      }
      for (const type of ["text/plain", "application/x-www-form-urlencoded", ""]) await expectProblem(post(path, sent, { type }), 403, "forbidden");
      await expectProblem(post(`${path}?project=DEMO`, sent), 400, "bad_request");
    }
    await expectProblem(post("findings/ignore", null, { raw: "{target:" }), 400, "bad_request");
    expect(await openTotal("state=ignored")).toBe(0);
  });

  it("refuses a body far larger than any ignore before reading it, and reads one the contract allows", async () => {
    const [finding] = await allFindings("ticket=finished");
    const body = JSON.stringify({ target: { finding_ids: [finding.finding_id] }, scope: "finding" });
    const padded = `${body.slice(0, -1)}${" ".repeat(1100 * 1024)}}`;
    expect((await post("findings/ignore", null, { raw: padded })).status).toBe(413);
    expect(await openTotal("state=ignored")).toBe(0);
    // Far beyond the 16 KB of the other POSTs: a long list of findings is a body the service takes (1 MB).
    const roomy = `${body.slice(0, -1)}${" ".repeat(600 * 1024)}}`;
    expect((await ok<ResultBody>(post("findings/ignore", null, { raw: roomy }))).ignored.findings).toBe(1);
  });

  it("reads a restore that names the most ignore ids a request may", async () => {
    const ids = Array.from({ length: 10_000 }, (_, index) => `ig-${String(index).padStart(60, "0")}`);
    expect((await ok<{ restored: number }>(post("findings/restore", { ignore_ids: ids }))).restored).toBe(0);
  });

  it("the sample's shared helper says which ignore covers a ticket and its rules", async () => {
    const single = (await allFindings("ticket=finished&rule=R-EST-01"))[0];
    const [whole] = await ticketsWithRules("ticket=open");
    const key = single.issue_key ?? "";
    const made = await ignore({ finding_ids: [single.finding_id] }, "finding", "Old");
    await ignore({ issue_keys: [whole] }, "ticket");

    const held = activeIgnores("DEMO");

    expect(held.covers(key, ["R-FLOW-02", "R-EST-01"])).toMatchObject({ scope: "finding", ruleId: "R-EST-01", reason: "Old" });
    expect(held.covers(key, ["R-FLOW-02"])).toBeNull();
    expect(held.ticket(key)).toBeNull();
    expect(held.ticket(whole)).toMatchObject({ scope: "ticket", ruleId: null });
    expect(held.covers(whole, ["W-AGE-01"])).toEqual(held.ticket(whole));
    await ok(post("findings/restore", { ignore_ids: made.ignore_ids }));
    expect(activeIgnores("DEMO").covers(key, ["R-EST-01"])).toBeNull();
  });
});

/* ------------------------------------------------------------------------- sign-in on -- */

describe("ignoring findings with sign-in on", () => {
  beforeEach(() => stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" }));

  it("refuses a user (team level) every ignore route, before the sample is asked anything", async () => {
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    const target = { finding_ids: ["0b7b3b0f61c477e61699982f24892735"] };
    for (const [path, body] of [
      ["findings/ignore/preview", { target, scope: "finding" }],
      ["findings/ignore", { target, scope: "finding", reason: null }],
      ["findings/restore", { ignore_ids: ["a".repeat(32)] }],
    ] as const) {
      await expectProblem(post(path, body, { origin: APP, cookie: session }), 403, "people_not_allowed");
    }
    await expectProblem(read("findings/ignored", session), 403, "people_not_allowed");
    expect(activeIgnores("DEMO").covers("DEMO-1098", ["R-EST-01"])).toBeNull();
  });

  it("lets an admin ignore from APP_URL's origin, named by their display name, never their email address", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = `jo-session=${await sealSession({ ...IDENTITY, name: "Morgan Ellis", eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    const body = { target: { finding_ids: ["0b7b3b0f61c477e61699982f24892735"] }, scope: "finding", reason: null };
    await expectProblem(post("findings/ignore", body, { origin: "http://127.0.0.1:3400", cookie: session }), 403, "forbidden");

    const done = await ok<ResultBody>(post("findings/ignore", body, { origin: APP, cookie: session }));

    expect(done.ignored).toEqual({ findings: 1, tickets: 1 });
    const [listed] = (await ok<ListedBody>(read("findings/ignored", session))).items;
    expect(listed.by).toBe("Morgan Ellis");
    const [shown] = await allFindings("state=ignored", session);
    expect(shown.ignore?.by).toBe("Morgan Ellis");
    expect(JSON.stringify([listed, shown])).not.toContain(LEAD);
    await ok(post("findings/restore", { ignore_ids: done.ignore_ids }, { origin: APP, cookie: session }));
  });
});

/* -------------------------------------------------------------------------- live mode -- */

describe("ignoring findings against the service (live)", () => {
  beforeEach(() => stub(LIVE));

  const meta = { ...findingsJson.meta, data_mode: "live" };

  /** The service, answering as `answer` says; every call it gets is kept. */
  function service(answer: (url: URL, init: RequestInit | undefined) => Response) {
    const upstream = vi.fn<typeof fetch>(async (input, init) => answer(new URL(String(input)), init));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  it("posts each body as this interface checked it, at people level, naming the reader", async () => {
    const upstream = service((url) => {
      if (url.pathname.endsWith("/preview")) {
        return Response.json({ meta, findings: 2, tickets: 1, by_rule: [{ rule_id: "R-EST-01", rule_title: "Work started without an estimate", findings: 2 }], already_ignored: 0 });
      }
      if (url.pathname.endsWith("/restore")) {
        // The service's re-check, as its rule settings apply state says it.
        return Response.json({ meta, restored: 1, recheck: { state: "running", applied_revision: 0, started_at: "2026-11-04T14:35:00.000Z", finished_at: null, message: null, result: null } });
      }
      return Response.json({ meta, ignored: { findings: 2, tickets: 1 }, ignore_ids: ["c".repeat(32)] });
    });
    const ids = ["b".repeat(32), "a".repeat(32), "b".repeat(32)];

    await ok(post("findings/ignore/preview", { target: { finding_ids: ids }, scope: "finding" }, { cookie: BOARD }));
    await ok(post("findings/ignore", { target: { finding_ids: ids }, scope: "finding", reason: "  Closed\n long ago  " }, { cookie: BOARD }));
    const restored = await ok<{ restored: number; recheck: { state: string } | null }>(
      post("findings/restore", { ignore_ids: ["c".repeat(32)] }, { cookie: BOARD }),
    );

    expect(restored.restored).toBe(1);
    expect(restored.recheck?.state).toBe("running");
    const calls = upstream.mock.calls.map(([url, init]) => ({ url: new URL(String(url)), init }));
    expect(calls.map((call) => call.url.pathname)).toEqual(["/api/v1/findings/ignore/preview", "/api/v1/findings/ignore", "/api/v1/findings/restore"]);
    for (const { url } of calls) expect(Object.fromEntries(url.searchParams)).toEqual({ project: "DEMO", level: "people" });
    for (const { init } of calls) {
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("x-service-key")).toBe("svc-key");
      expect(headers.get("x-oversight-viewer")).toBe("local");
      expect(headers.get("x-oversight-viewer-name")).toBe(encodeURIComponent(LOCAL));
    }
    const sent = calls.map((call) => JSON.parse(String(call.init?.body)) as Record<string, unknown>);
    expect(Object.keys(sent[0]).sort()).toEqual(["scope", "target"]);
    expect(Object.keys(sent[1]).sort()).toEqual(["reason", "scope", "target"]);
    expect([...((sent[1].target as { finding_ids: string[] }).finding_ids)].sort()).toEqual(["a".repeat(32), "b".repeat(32)]);
    expect(sent[1].reason).toBe("Closed long ago");
    expect(sent[2]).toEqual({ ignore_ids: ["c".repeat(32)] });
  });

  it("reads findings at the reader's level, so the service names who ignored only for an admin", async () => {
    const upstream = service(() => Response.json({ ...findingsJson, meta }));
    await ok(read("findings?state=ignored&ticket=finished", BOARD));
    const url = new URL(String(upstream.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v1/findings");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ state: "ignored", ticket: "finished", project: "DEMO", level: "people" });
  });

  it("refuses a service answer that breaks the contract: 502 upstream_invalid", async () => {
    service(() => Response.json({ meta, findings: 3, tickets: 1, by_rule: [{ rule_id: "R-EST-01", rule_title: "Work started without an estimate", findings: 2 }], already_ignored: 0 }));
    await expectProblem(post("findings/ignore/preview", { target: { finding_ids: ["a".repeat(32)] }, scope: "finding" }, { cookie: BOARD }), 502, "upstream_invalid");
    service(() => Response.json({ meta, ignored: { findings: 2, tickets: 1 }, ignore_ids: ["c".repeat(32), "c".repeat(32)] }));
    await expectProblem(post("findings/ignore", { target: { finding_ids: ["a".repeat(32)] }, scope: "finding" }, { cookie: BOARD }), 502, "upstream_invalid");
    service(() => Response.json({ ...findingsJson, meta, items: [ignored({ resolved_why: "cleared" })] }));
    await expectProblem(read("findings?state=ignored", BOARD), 502, "upstream_invalid");
  });

  it("never forwards a body the contract does not allow", async () => {
    const upstream = service(() => Response.json({ meta, ignored: { findings: 0, tickets: 0 }, ignore_ids: [] }));
    const refused = await post("findings/ignore", { target: { issue_keys: ["DEMO-1"] }, scope: "finding" }, { cookie: BOARD });
    expect([400, 422]).toContain(refused.status);
    expect(upstream).not.toHaveBeenCalled();
  });
});
